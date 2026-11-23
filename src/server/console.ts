import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { bookings, competitions, customers, hioClaims, payments, rounds, shotEvidence, shots } from "@/db/schema";
import { formatMm } from "@/lib/distance";
import { DEFAULT_TZ } from "@/lib/time";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { applyDueTransitions } from "./competitions";
import { publicDisplayName } from "./customers";
import { bestOfShots } from "./rounds";

export type ConsoleRound = Awaited<ReturnType<typeof consoleState>>["rounds"][number];
export type ConsoleBooking = Awaited<ReturnType<typeof consoleState>>["bookings"][number];

/** Everything the counter console needs in one round-trip. */
export async function consoleState() {
  await applyDueTransitions(SYSTEM_ACTOR);
  const comps = await db
    .select()
    .from(competitions)
    .where(inArray(competitions.status, ["open", "closed", "awaiting_verification"]))
    .orderBy(desc(competitions.startsAt));
  const compIds = comps.map((c) => c.id);
  const now = DateTime.now().setZone(DEFAULT_TZ);
  const dayStart = now.startOf("day").toUTC().toJSDate();
  const dayEnd = now.endOf("day").toUTC().toJSDate();

  const live = compIds.length
    ? await db
        .select({ r: rounds, c: customers })
        .from(rounds)
        .innerJoin(customers, eq(customers.id, rounds.customerId))
        .where(and(inArray(rounds.competitionId, compIds), inArray(rounds.status, ["checked_in", "in_progress", "paused"])))
        .orderBy(asc(rounds.createdAt))
    : [];
  const recent = compIds.length
    ? await db
        .select({ r: rounds, c: customers })
        .from(rounds)
        .innerJoin(customers, eq(customers.id, rounds.customerId))
        .where(and(inArray(rounds.competitionId, compIds), eq(rounds.status, "completed"), gte(rounds.completedAt, dayStart)))
        .orderBy(desc(rounds.completedAt))
        .limit(8)
    : [];
  const all = [...live, ...recent];
  const ids = all.map((x) => x.r.id);
  const shotRows = ids.length ? await db.select().from(shots).where(inArray(shots.roundId, ids)).orderBy(asc(shots.shotNumber), asc(shots.recordedAt)) : [];
  const evidence = ids.length ? await db.select().from(shotEvidence).where(inArray(shotEvidence.roundId, ids)) : [];
  const claims = shotRows.length ? await db.select().from(hioClaims).where(inArray(hioClaims.shotId, shotRows.map((s) => s.id))) : [];

  const roundsOut = all.map(({ r, c }) => {
    const comp = comps.find((x) => x.id === r.competitionId)!;
    const active = shotRows.filter((s) => s.roundId === r.id && s.status === "active");
    const best = bestOfShots(active, comp, c.id);
    return {
      id: r.id,
      status: r.status,
      statusReason: r.statusReason,
      shotsAllowed: r.shotsAllowed,
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      customer: { id: c.id, name: `${c.firstName} ${c.lastName}`, display: publicDisplayName(c), fittingInterest: c.fittingInterest },
      competition: { id: comp.id, name: comp.name, requireOnGreen: comp.requireOnGreen, status: comp.status, endsAt: comp.endsAt.toISOString() },
      best: best ? { mm: best.score, label: best.shot.isHoleInOne ? (best.shot.hioStatus === "approved" ? "Ace" : "Ace (pending)") : formatMm(best.score), shotNumber: best.shot.shotNumber } : null,
      shots: active.map((s) => ({
        id: s.id,
        n: s.shotNumber,
        distanceMm: s.distanceMm,
        label: s.isHoleInOne ? "HOLE-IN-ONE" : s.distanceMm !== null ? formatMm(s.distanceMm) : "No result",
        onGreen: s.onGreen,
        valid: s.valid,
        hio: s.isHoleInOne,
        hioStatus: s.hioStatus,
        hioClaimId: claims.find((cl) => cl.shotId === s.id)?.id ?? null,
        corrected: Boolean(s.supersedesShotId),
        evidence: evidence.filter((e) => e.shotId === s.id).length,
      })),
      history: shotRows.filter((s) => s.roundId === r.id && s.status === "superseded").length,
      roundEvidence: evidence.filter((e) => !e.shotId).length,
    };
  });

  const todays = compIds.length
    ? await db
        .select({ b: bookings, c: customers })
        .from(bookings)
        .leftJoin(customers, eq(customers.id, bookings.customerId))
        .where(and(inArray(bookings.competitionId, compIds), gte(bookings.startsAt, dayStart), lt(bookings.startsAt, dayEnd), inArray(bookings.status, ["confirmed", "checked_in", "no_show", "completed", "held"])))
        .orderBy(asc(bookings.startsAt))
    : [];
  const payRows = todays.length ? await db.select().from(payments).where(inArray(payments.bookingId, todays.map((t) => t.b.id))) : [];

  return {
    competitions: comps.map((c) => ({ id: c.id, name: c.name, status: c.status, entryMode: c.entryMode, entryFeePence: c.entryFeePence, shotsPerRound: c.shotsPerRound, endsAt: c.endsAt.toISOString() })),
    rounds: roundsOut,
    bookings: todays.map(({ b, c }) => ({
      id: b.id,
      code: b.checkinCode,
      startsAt: b.startsAt.toISOString(),
      status: b.status,
      source: b.source,
      roundsQty: b.roundsQty,
      customer: c ? `${c.firstName} ${c.lastName}` : "—",
      payment: payRows.find((p) => p.bookingId === b.id)?.status ?? null,
    })),
    serverTime: new Date().toISOString(),
  };
}

/** Rounds a returning customer can start without a new payment. */
export async function customerOpenEntitlements(customerId: string) {
  return db
    .select({ r: rounds, c: competitions })
    .from(rounds)
    .innerJoin(competitions, eq(competitions.id, rounds.competitionId))
    .where(and(eq(rounds.customerId, customerId), eq(competitions.status, "open"), inArray(rounds.status, ["booked", "checked_in"])));
}
