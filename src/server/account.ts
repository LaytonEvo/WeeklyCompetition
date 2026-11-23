import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bookings, competitions, customers, prizeAwards, rounds, shots } from "@/db/schema";
import { closestToPin } from "@/lib/scoring/strategies";
import { customerPosition } from "./leaderboard";

/** Everything a signed-in customer may see about themselves. */
export async function accountOverview(customerId: string) {
  const [me] = await db.select().from(customers).where(eq(customers.id, customerId));
  const upcoming = await db
    .select({ b: bookings, c: competitions })
    .from(bookings)
    .innerJoin(competitions, eq(competitions.id, bookings.competitionId))
    .where(and(eq(bookings.customerId, customerId), inArray(bookings.status, ["confirmed", "held", "checked_in"]), gt(bookings.endsAt, new Date())))
    .orderBy(asc(bookings.startsAt));

  const myRounds = await db
    .select({ r: rounds, c: competitions })
    .from(rounds)
    .innerJoin(competitions, eq(competitions.id, rounds.competitionId))
    .where(eq(rounds.customerId, customerId))
    .orderBy(desc(competitions.startsAt), desc(rounds.createdAt));
  const roundIds = myRounds.map((x) => x.r.id);
  const myShots = roundIds.length ? await db.select().from(shots).where(and(inArray(shots.roundId, roundIds), eq(shots.status, "active"))) : [];

  const byComp = new Map<string, { competition: typeof competitions.$inferSelect; rounds: { round: typeof rounds.$inferSelect; shots: typeof myShots; best: number | null }[] }>();
  for (const { r, c } of myRounds) {
    const entry = byComp.get(c.id) ?? { competition: c, rounds: [] };
    const rs = myShots.filter((s) => s.roundId === r.id).sort((a, b) => a.shotNumber - b.shotNumber);
    let best: number | null = null;
    if (r.status === "completed") {
      for (const s of rs) {
        const score = closestToPin.qualifyingScore({ shotId: s.id, roundId: r.id, customerId, distanceMm: s.distanceMm, valid: s.valid, onGreen: s.onGreen, isHoleInOne: s.isHoleInOne, hioStatus: s.hioStatus, recordedAt: s.recordedAt }, { requireOnGreen: c.requireOnGreen, hioCountsForWeekly: c.hioCountsForWeekly });
        if (score !== null && (best === null || score < best)) best = score;
      }
    }
    entry.rounds.push({ round: r, shots: rs, best });
    byComp.set(c.id, entry);
  }
  const history = await Promise.all(
    [...byComp.values()].map(async (h) => ({
      ...h,
      position: ["open", "closed", "awaiting_verification", "finalised", "archived"].includes(h.competition.status) ? await customerPosition(h.competition, customerId) : null,
      best: h.rounds.reduce<number | null>((m, r) => (r.best !== null && (m === null || r.best < m) ? r.best : m), null),
    })),
  );
  const prizes = await db
    .select({ a: prizeAwards, c: competitions })
    .from(prizeAwards)
    .innerJoin(competitions, eq(competitions.id, prizeAwards.competitionId))
    .where(eq(prizeAwards.customerId, customerId))
    .orderBy(desc(prizeAwards.createdAt));
  const allBest = history.map((h) => h.best).filter((x): x is number => x !== null);
  return {
    me,
    upcoming,
    history,
    prizes,
    stats: {
      rounds: myRounds.filter((x) => x.r.status === "completed").length,
      shots: myShots.length,
      personalBest: allBest.length ? Math.min(...allBest) : null,
      competitions: history.length,
    },
  };
}
