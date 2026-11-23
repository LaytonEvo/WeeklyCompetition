import { and, eq, gt, inArray, lt, notInArray, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, type DbOrTx } from "@/db";
import { bookings, competitions, payments, rounds, simulators } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import { checkinCode } from "@/lib/crypto";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { DEFAULT_TZ } from "@/lib/time";
import { computeSlots, lockSimulator, overlappingCount } from "./availability";

export type Booking = typeof bookings.$inferSelect;
type Competition = typeof competitions.$inferSelect;

const BOOKABLE: Competition["status"][] = ["scheduled", "open"];
/** Round statuses that count as a used/held entry. */
const LIVE_ROUND_STATUSES = ["booked", "checked_in", "in_progress", "paused", "completed", "disqualified"] as const;

/**
 * Enforce per-customer and total-entrant limits. Counts existing rounds plus
 * rounds reserved by unexpired holds, so concurrent checkouts can't exceed a cap.
 */
export async function assertEntryLimits(tx: DbOrTx, c: Competition, customerId: string | null, extraRounds: number, now = new Date()) {
  if (!customerId) return;
  if (c.maxRoundsPerCustomer !== null) {
    const [{ used }] = await tx
      .select({ used: sql<number>`count(*)::int` })
      .from(rounds)
      .where(and(eq(rounds.competitionId, c.id), eq(rounds.customerId, customerId), inArray(rounds.status, [...LIVE_ROUND_STATUSES])));
    const [{ held }] = await tx
      .select({ held: sql<number>`coalesce(sum(${bookings.roundsQty}), 0)::int` })
      .from(bookings)
      .where(and(eq(bookings.competitionId, c.id), eq(bookings.customerId, customerId), eq(bookings.status, "held"), gt(bookings.holdExpiresAt, now)));
    if (used + held + extraRounds > c.maxRoundsPerCustomer) {
      throw new ConflictError(`The rules allow a maximum of ${c.maxRoundsPerCustomer} round(s) per player in this competition.`);
    }
  }
  if (c.maxEntrants !== null) {
    const [{ already }] = await tx
      .select({ already: sql<number>`count(*)::int` })
      .from(rounds)
      .where(and(eq(rounds.competitionId, c.id), eq(rounds.customerId, customerId), inArray(rounds.status, [...LIVE_ROUND_STATUSES])));
    if (already === 0) {
      const [{ entrants }] = await tx
        .select({ entrants: sql<number>`count(distinct ${rounds.customerId})::int` })
        .from(rounds)
        .where(and(eq(rounds.competitionId, c.id), inArray(rounds.status, [...LIVE_ROUND_STATUSES])));
      if (entrants >= c.maxEntrants) throw new ConflictError("This competition has reached its maximum number of entrants.");
    }
  }
}

export interface CreateBookingInput {
  competitionId: string;
  customerId: string | null;
  startsAt: Date;
  roundsQty: number;
  source: "online" | "walk_in" | "staff";
  status: "held" | "confirmed" | "checked_in";
  holdMinutes?: number;
  minNoticeMinutes?: number;
  /** Staff override of availability rules (requires availability.override). Capacity is still enforced unless forceCapacity. */
  overrideAvailability?: boolean;
  forceCapacity?: boolean;
  attribution?: { utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null; referralCode?: string | null };
  now?: Date;
}

/**
 * Reserve simulator time. All capacity decisions for a simulator are
 * serialised with a transaction-scoped advisory lock, so two customers can
 * never both obtain the last place in a slot.
 */
export async function createBooking(tx: DbOrTx, input: CreateBookingInput, actor: Actor): Promise<Booking> {
  const now = input.now ?? new Date();
  const [c] = await tx.select().from(competitions).where(eq(competitions.id, input.competitionId));
  if (!c) throw new NotFoundError("Competition");
  if (!BOOKABLE.includes(c.status)) throw new ConflictError("This competition is not currently accepting entries.");
  const [sim] = await tx.select().from(simulators).where(eq(simulators.id, c.simulatorId));
  if (!sim) throw new NotFoundError("Simulator");
  if (input.roundsQty < 1 || input.roundsQty > 10) throw new AppError("Invalid number of rounds.");

  await lockSimulator(tx, sim.id);

  const endsAt = new Date(input.startsAt.getTime() + sim.slotMinutes * input.roundsQty * 60_000);
  if (input.startsAt >= c.endsAt) throw new ConflictError("That time is after the competition closes.");

  if (!input.overrideAvailability) {
    const date = DateTime.fromJSDate(input.startsAt, { zone: DEFAULT_TZ }).toISODate()!;
    const [day] = await computeSlots(
      {
        simulatorId: sim.id,
        window: c,
        fromDate: date,
        toDate: date,
        slotsNeeded: input.roundsQty,
        now,
        minNoticeMinutes: input.minNoticeMinutes ?? 0,
        staffView: input.source !== "online",
      },
      tx,
    );
    const slot = day?.slots.find((s) => s.startsAt.getTime() === input.startsAt.getTime());
    if (!slot) throw new ConflictError("That session time isn't offered. Please choose another time.");
    if (slot.status === "full") throw new ConflictError("Sorry — that session has just been taken. Please choose another time.");
    if (slot.status !== "available") throw new ConflictError(slot.reason ? `That session is unavailable (${slot.reason}).` : "That session is no longer available.");
  } else if (!input.forceCapacity) {
    const used = await overlappingCount(tx, sim.id, input.startsAt, endsAt, now);
    if (used >= sim.slotCapacity) throw new ConflictError("The simulator is already fully booked at that time.");
  }

  await assertEntryLimits(tx, c, input.customerId, input.roundsQty, now);

  const holdMinutes = input.holdMinutes ?? 10;
  const [b] = await tx
    .insert(bookings)
    .values({
      simulatorId: sim.id,
      competitionId: c.id,
      customerId: input.customerId,
      startsAt: input.startsAt,
      endsAt,
      status: input.status,
      source: input.source,
      roundsQty: input.roundsQty,
      holdExpiresAt: input.status === "held" ? new Date(now.getTime() + holdMinutes * 60_000) : null,
      checkinCode: checkinCode(),
      overrideByUserId: input.overrideAvailability && actor.type === "user" ? actor.id : null,
      checkedInAt: input.status === "checked_in" ? now : null,
      checkedInByUserId: input.status === "checked_in" && actor.type === "user" ? actor.id : null,
      ...input.attribution,
    })
    .returning();
  await audit(tx, actor, input.overrideAvailability ? "booking.create_override" : "booking.create", "booking", b.id, {
    after: { startsAt: b.startsAt, status: b.status, source: b.source, roundsQty: b.roundsQty },
  });
  return b;
}

/** Create one round per purchased/authorised entry. Idempotent per payment. */
export async function createRoundsForPayment(tx: DbOrTx, opts: { booking: Booking | null; paymentId: string; customerId: string; competition: Competition; qty: number; status?: "booked" | "checked_in" }) {
  const existing = await tx.select({ id: rounds.id }).from(rounds).where(eq(rounds.paymentId, opts.paymentId));
  if (existing.length >= opts.qty) return tx.select().from(rounds).where(eq(rounds.paymentId, opts.paymentId));
  const toCreate = opts.qty - existing.length;
  await tx.insert(rounds).values(
    Array.from({ length: toCreate }, () => ({
      competitionId: opts.competition.id,
      customerId: opts.customerId,
      bookingId: opts.booking?.id ?? null,
      paymentId: opts.paymentId,
      shotsAllowed: opts.competition.shotsPerRound,
      status: opts.status ?? ("booked" as const),
      checkedInAt: opts.status === "checked_in" ? new Date() : null,
    })),
  );
  return tx.select().from(rounds).where(eq(rounds.paymentId, opts.paymentId));
}

export async function getBookingByCode(code: string) {
  const [b] = await db.select().from(bookings).where(eq(bookings.checkinCode, code.trim().toUpperCase()));
  return b ?? null;
}

export async function checkInBooking(bookingId: string, actor: Actor & { type: "user" }) {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
    if (!b) throw new NotFoundError("Booking");
    if (b.status === "checked_in") return b;
    if (!["confirmed", "no_show"].includes(b.status)) throw new ConflictError(`A ${b.status.replace("_", " ")} booking cannot be checked in.`);
    const [after] = await tx
      .update(bookings)
      .set({ status: "checked_in", checkedInAt: new Date(), checkedInByUserId: actor.id, updatedAt: new Date() })
      .where(eq(bookings.id, bookingId))
      .returning();
    await tx
      .update(rounds)
      .set({ status: "checked_in", checkedInAt: new Date(), updatedAt: new Date() })
      .where(and(eq(rounds.bookingId, bookingId), eq(rounds.status, "booked")));
    await audit(tx, actor, "booking.check_in", "booking", bookingId, { before: { status: b.status } });
    return after;
  });
}

/**
 * No-show: releases the slot. Purchased rounds are NOT forfeited — they stay
 * "booked" and can be played in another session within the same competition
 * (see no-show policy in settings).
 */
export async function markNoShow(bookingId: string, actor: Actor) {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
    if (!b) throw new NotFoundError("Booking");
    if (b.status !== "confirmed") throw new ConflictError("Only confirmed bookings can be marked as no-show.");
    await tx.update(bookings).set({ status: "no_show", updatedAt: new Date() }).where(eq(bookings.id, bookingId));
    await audit(tx, actor, "booking.no_show", "booking", bookingId);
  });
}

/** Move a booking to another time (late arrival, reschedule). Capacity-checked under the lock. */
export async function moveBooking(bookingId: string, newStart: Date, actor: Actor, override = false) {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
    if (!b) throw new NotFoundError("Booking");
    if (!["confirmed", "no_show", "held"].includes(b.status)) throw new ConflictError("This booking can't be moved.");
    const [c] = await tx.select().from(competitions).where(eq(competitions.id, b.competitionId));
    const [sim] = await tx.select().from(simulators).where(eq(simulators.id, b.simulatorId));
    await lockSimulator(tx, sim.id);
    const newEnd = new Date(newStart.getTime() + (b.endsAt.getTime() - b.startsAt.getTime()));
    if (newStart < c.startsAt || newEnd > c.endsAt) throw new ConflictError("The new time is outside the competition window.");
    if (!override) {
      const date = DateTime.fromJSDate(newStart, { zone: DEFAULT_TZ }).toISODate()!;
      const [day] = await computeSlots({ simulatorId: sim.id, window: c, fromDate: date, toDate: date, slotsNeeded: b.roundsQty, staffView: true }, tx);
      // the booking's own capacity must not count against itself
      const slot = day?.slots.find((s) => s.startsAt.getTime() === newStart.getTime());
      if (!slot || slot.status === "unavailable" || slot.status === "past") throw new ConflictError("That time isn't available.");
    }
    const used = await overlappingCount(tx, sim.id, newStart, newEnd, new Date(), b.id);
    if (used >= sim.slotCapacity) throw new ConflictError("The simulator is fully booked at that time.");
    const [after] = await tx
      .update(bookings)
      .set({ startsAt: newStart, endsAt: newEnd, status: b.status === "no_show" ? "confirmed" : b.status, reminderSentAt: null, updatedAt: new Date() })
      .where(eq(bookings.id, bookingId))
      .returning();
    await audit(tx, actor, "booking.move", "booking", bookingId, { before: { startsAt: b.startsAt }, after: { startsAt: newStart } });
    return after;
  });
}

/**
 * Cancel a booking. Unplayed rounds attached to it are cancelled. Refunds are
 * a separate, explicit decision (see payments.refundPayment).
 */
export async function cancelBooking(bookingId: string, actor: Actor, reason: string, txIn?: DbOrTx) {
  const run = async (tx: DbOrTx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
    if (!b) throw new NotFoundError("Booking");
    if (["cancelled", "completed", "expired"].includes(b.status)) return b;
    const started = await tx
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(eq(rounds.bookingId, bookingId), notInArray(rounds.status, ["booked", "checked_in", "cancelled"])));
    if (started.length) throw new ConflictError("A round in this booking has already started and can't be cancelled.");
    const [after] = await tx
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() })
      .where(eq(bookings.id, bookingId))
      .returning();
    await tx
      .update(rounds)
      .set({ status: "cancelled", statusReason: reason, updatedAt: new Date() })
      .where(and(eq(rounds.bookingId, bookingId), inArray(rounds.status, ["booked", "checked_in"])));
    await tx
      .update(payments)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(payments.bookingId, bookingId), eq(payments.status, "pending")));
    await audit(tx, actor, "booking.cancel", "booking", bookingId, { before: { status: b.status }, reason });
    return after;
  };
  return txIn ? run(txIn) : db.transaction(run);
}

/** Expire unpaid holds. Returns expired bookings so callers can also expire their Stripe sessions. */
export async function expireHolds(now = new Date()) {
  return db.transaction(async (tx) => {
    const expired = await tx
      .update(bookings)
      .set({ status: "expired", updatedAt: now })
      .where(and(eq(bookings.status, "held"), lt(bookings.holdExpiresAt, now)))
      .returning();
    if (expired.length) {
      await tx
        .update(payments)
        .set({ status: "expired", updatedAt: now })
        .where(and(inArray(payments.bookingId, expired.map((b) => b.id)), eq(payments.status, "pending")));
    }
    return expired;
  });
}

/** Mark past confirmed bookings with no check-in as no-shows, after the grace period. */
export async function sweepNoShows(graceMinutes: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - graceMinutes * 60_000);
  return db
    .update(bookings)
    .set({ status: "no_show", updatedAt: now })
    .where(and(eq(bookings.status, "confirmed"), lt(bookings.endsAt, cutoff)))
    .returning({ id: bookings.id });
}
