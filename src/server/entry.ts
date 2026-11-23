import { and, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { bookings, competitions, payments, rounds, simulators } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { getSettings } from "@/lib/settings";
import { stripeConfigured } from "@/lib/env";
import { DEFAULT_TZ } from "@/lib/time";
import { computeSlots } from "./availability";
import { createBooking, createRoundsForPayment } from "./bookings";
import { findOrCreateCustomer, getCustomer, type Attribution, type RegistrationInput } from "./customers";
import { isLaunchApproved } from "./legal";
import { sendBookingConfirmation } from "./messages";
import { createCheckoutSession, createPendingPayment, recordCounterPayment } from "./payments";

export interface OnlineEntryInput {
  competitionId: string;
  startsAt: Date;
  roundsQty: number;
  registration: RegistrationInput;
  attribution?: Attribution;
  idempotencyKey: string;
}

export interface OnlineEntryResult {
  bookingCode: string;
  checkoutUrl: string | null;
  mode: "paid" | "free";
}

/**
 * Journey A: online registration + booking (+ Stripe Checkout for paid mode).
 * The slot hold, customer record and pending payment commit atomically.
 */
export async function startOnlineEntry(input: OnlineEntryInput): Promise<OnlineEntryResult> {
  const s = await getSettings();
  const [comp] = await db.select().from(competitions).where(eq(competitions.id, input.competitionId));
  if (!comp) throw new NotFoundError("Competition");
  if (input.roundsQty > s.booking.maxRoundsPerBooking) throw new AppError(`You can book up to ${s.booking.maxRoundsPerBooking} rounds at a time.`);
  if (!(await isLaunchApproved(comp))) throw new ConflictError("Entries for this competition are not open yet.");
  if (comp.entryMode === "paid" && !stripeConfigured()) throw new ConflictError("Online payment isn't available yet — please visit the store to enter.");

  // Retried form submission: return the original booking.
  const [prior] = await db.select().from(payments).where(eq(payments.idempotencyKey, input.idempotencyKey));
  if (prior?.bookingId) {
    const [b] = await db.select().from(bookings).where(eq(bookings.id, prior.bookingId));
    return { bookingCode: b.checkinCode, checkoutUrl: null, mode: comp.entryMode };
  }

  const actor: Actor = { type: "system", label: "online-booking" };
  const result = await db.transaction(async (tx) => {
    const { customer } = await findOrCreateCustomer(
      tx,
      input.registration,
      {
        source: "online_booking",
        termsVersion: comp.termsVersion,
        privacyNoticeVersion: s.privacy.privacyNoticeVersion,
        marketingNoticeVersion: s.privacy.marketingNoticeVersion,
      },
      actor,
      { ...input.attribution, acquisitionSource: input.attribution?.utmSource ?? input.attribution?.acquisitionSource ?? "website" },
    );
    const booking = await createBooking(
      tx,
      {
        competitionId: comp.id,
        customerId: customer.id,
        startsAt: input.startsAt,
        roundsQty: input.roundsQty,
        source: "online",
        status: comp.entryMode === "paid" ? "held" : "confirmed",
        holdMinutes: s.booking.holdMinutes,
        minNoticeMinutes: s.booking.minNoticeMinutes,
        attribution: input.attribution,
      },
      { type: "customer", id: customer.id, label: customer.email },
    );
    if (comp.entryMode === "paid") {
      const payment = await createPendingPayment(tx, {
        customerId: customer.id,
        competitionId: comp.id,
        bookingId: booking.id,
        roundsQty: input.roundsQty,
        amountPence: comp.entryFeePence * input.roundsQty,
        idempotencyKey: input.idempotencyKey,
      });
      return { customer, booking, payment };
    }
    const [payment] = await tx
      .insert(payments)
      .values({
        customerId: customer.id,
        competitionId: comp.id,
        bookingId: booking.id,
        method: "free_entry",
        status: "complimentary",
        amountPence: 0,
        roundsQty: input.roundsQty,
        idempotencyKey: input.idempotencyKey,
        paidAt: new Date(),
      })
      .returning();
    await createRoundsForPayment(tx, { booking, paymentId: payment.id, customerId: customer.id, competition: comp, qty: input.roundsQty });
    return { customer, booking, payment };
  });

  if (comp.entryMode === "free") {
    await sendBookingConfirmation(result.booking.id);
    return { bookingCode: result.booking.checkinCode, checkoutUrl: null, mode: "free" };
  }

  const base = process.env.APP_URL ?? "http://localhost:3000";
  try {
    const session = await createCheckoutSession(result.payment.id, {
      customerEmail: result.customer.email,
      competitionName: comp.name,
      unitAmountPence: comp.entryFeePence,
      holdExpiresAt: result.booking.holdExpiresAt!,
      successUrl: `${base}/booking/${result.booking.checkinCode}?paid=1`,
      cancelUrl: `${base}/booking/${result.booking.checkinCode}?cancelled=1`,
    });
    return { bookingCode: result.booking.checkinCode, checkoutUrl: session.url, mode: "paid" };
  } catch (e) {
    // Release the hold so the slot isn't blocked by a failed checkout.
    await db.update(bookings).set({ status: "cancelled", cancelReason: "Checkout could not be created", updatedAt: new Date() }).where(eq(bookings.id, result.booking.id));
    await db.update(payments).set({ status: "failed", failureReason: String((e as Error).message).slice(0, 300) }).where(eq(payments.id, result.payment.id));
    throw e instanceof AppError ? e : new AppError("We couldn't start the payment. Please try again.");
  }
}

/** Find the slot a walk-in can use now (the current or next free slot today). */
export async function suggestWalkInSlot(competitionId: string, roundsQty = 1, now = new Date()) {
  const [comp] = await db.select().from(competitions).where(eq(competitions.id, competitionId));
  if (!comp) throw new NotFoundError("Competition");
  const today = DateTime.fromJSDate(now, { zone: DEFAULT_TZ }).toISODate()!;
  const [day] = await computeSlots({ simulatorId: comp.simulatorId, window: comp, fromDate: today, toDate: today, slotsNeeded: roundsQty, now, staffView: true });
  return day?.slots ?? [];
}

export interface WalkInInput {
  competitionId: string;
  customerId?: string;
  newCustomer?: RegistrationInput;
  roundsQty: number;
  startsAt?: Date;
  method: "card_terminal" | "cash" | "complimentary" | "free_entry";
  amountPence?: number;
  reference?: string;
  authorisationReason?: string;
  overrideAvailability?: boolean;
  idempotencyKey: string;
}

/**
 * Journey B/C: walk-in or returning customer at the counter, in one atomic
 * step: customer → booking (checked in) → payment/authorisation → rounds.
 */
export async function walkInEntry(input: WalkInInput, actor: Actor & { type: "user" }) {
  const s = await getSettings();
  const [comp] = await db.select().from(competitions).where(eq(competitions.id, input.competitionId));
  if (!comp) throw new NotFoundError("Competition");
  if (comp.status !== "open") throw new ConflictError("Walk-in entries can only be taken while the competition is open.");
  if (!(await isLaunchApproved(comp))) throw new ConflictError("This competition's entry mode has not been approved for launch.");
  if (comp.entryMode === "free" && !["free_entry", "complimentary"].includes(input.method)) throw new AppError("This is a free-entry competition — no payment should be taken.");
  if (comp.entryMode === "paid" && input.method === "free_entry") throw new AppError("This competition requires paid entry (or a manager-authorised complimentary entry).");

  const [prior] = await db.select().from(payments).where(eq(payments.idempotencyKey, input.idempotencyKey));
  if (prior) {
    const [b] = prior.bookingId ? await db.select().from(bookings).where(eq(bookings.id, prior.bookingId)) : [];
    const prevRounds = await db.select().from(rounds).where(eq(rounds.paymentId, prior.id));
    return { booking: b, payment: prior, rounds: prevRounds, duplicate: true };
  }

  const [sim] = await db.select().from(simulators).where(eq(simulators.id, comp.simulatorId));
  let startsAt = input.startsAt;
  if (!startsAt) {
    const slots = await suggestWalkInSlot(comp.id, input.roundsQty);
    const slot = slots.find((x) => x.status === "available");
    if (!slot) throw new ConflictError("No free simulator slot is left today. A manager can override availability.");
    startsAt = slot.startsAt;
  }

  return db.transaction(async (tx) => {
    let customerId = input.customerId;
    if (!customerId) {
      if (!input.newCustomer) throw new AppError("Choose an existing customer or enter new customer details.");
      const { customer } = await findOrCreateCustomer(
        tx,
        input.newCustomer,
        {
          source: "walk_in_counter",
          termsVersion: comp.termsVersion,
          privacyNoticeVersion: s.privacy.privacyNoticeVersion,
          marketingNoticeVersion: s.privacy.marketingNoticeVersion,
          recordedByUserId: actor.id,
        },
        actor,
        { acquisitionSource: "walk_in" },
      );
      customerId = customer.id;
    } else {
      await getCustomer(customerId, tx);
    }
    const booking = await createBooking(
      tx,
      {
        competitionId: comp.id,
        customerId,
        startsAt: startsAt!,
        roundsQty: input.roundsQty,
        source: "walk_in",
        status: "checked_in",
        overrideAvailability: input.overrideAvailability,
      },
      actor,
    );
    const payment = await recordCounterPayment(
      tx,
      {
        customerId,
        competitionId: comp.id,
        bookingId: booking.id,
        roundsQty: input.roundsQty,
        method: input.method,
        amountPence: input.method === "card_terminal" || input.method === "cash" ? (input.amountPence ?? comp.entryFeePence * input.roundsQty) : 0,
        reference: input.reference,
        authorisationReason: input.authorisationReason,
        idempotencyKey: input.idempotencyKey,
      },
      actor,
    );
    const created = await createRoundsForPayment(tx, { booking, paymentId: payment.id, customerId, competition: comp, qty: input.roundsQty, status: "checked_in" });
    await audit(tx, actor, "entry.walk_in", "booking", booking.id, { after: { customerId, rounds: created.length, method: input.method, simulator: sim?.name } });
    return { booking, payment, rounds: created, duplicate: false };
  });
}

/** Returning customer with unused paid rounds can start them without paying again. */
export async function unusedRounds(customerId: string, competitionId: string) {
  return db
    .select()
    .from(rounds)
    .where(and(eq(rounds.customerId, customerId), eq(rounds.competitionId, competitionId), inArray(rounds.status, ["booked", "checked_in", "in_progress", "paused"])));
}
