import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { competitions, customers, prizeAwards } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { bumpLeaderboard } from "@/lib/realtime";
import { allocatePrizes } from "@/lib/scoring/prizes";
import { getCompetition, getPrizes, outstandingVerification } from "./competitions";
import { getStandings } from "./leaderboard";

export async function provisionalResults(competitionId: string, playoffOrder: Record<number, string[]> = {}) {
  const c = await getCompetition(competitionId);
  const [standings, prizes, outstanding] = await Promise.all([getStandings(c), getPrizes(c.id), outstandingVerification(c.id)]);
  const allocation = allocatePrizes(
    standings,
    prizes.map((p) => ({ rank: p.rank, amountPence: p.amountPence, description: p.description })),
    c.tiePolicy,
    playoffOrder,
  );
  const jackpots = await db.select().from(prizeAwards).where(and(eq(prizeAwards.competitionId, c.id), eq(prizeAwards.kind, "jackpot")));
  return { competition: c, standings, prizes, allocation, outstanding, jackpots };
}

/**
 * Finalise official results. Refuses while rounds are unverified, hole-in-one
 * claims are pending, or a playoff tie is unresolved. Idempotent: a second
 * call on a finalised competition returns the existing awards; the partial
 * unique index on prize_awards prevents double-awarding.
 */
export async function finaliseCompetition(competitionId: string, actor: Actor & { type: "user" }, opts: { playoffOrder?: Record<number, string[]>; notes?: string } = {}) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(competitions).where(eq(competitions.id, competitionId)).for("update");
    if (!c) throw new NotFoundError("Competition");
    if (c.status === "finalised" || c.status === "archived") {
      return { competition: c, awards: await tx.select().from(prizeAwards).where(eq(prizeAwards.competitionId, c.id)), alreadyFinalised: true };
    }
    if (!["closed", "awaiting_verification"].includes(c.status)) throw new ConflictError("Results can only be finalised after the competition has closed.");
    const out = await outstandingVerification(c.id, tx);
    if (out.blocking > 0) throw new ConflictError(`Resolve ${out.openRounds.length} unfinished round(s) and ${out.pendingHio.length} pending hole-in-one claim(s) first.`);

    const standings = await getStandings(c, {}, tx);
    const prizes = await getPrizes(c.id, tx);
    const { allocations, unresolvedPlayoffs } = allocatePrizes(
      standings,
      prizes.map((p) => ({ rank: p.rank, amountPence: p.amountPence, description: p.description })),
      c.tiePolicy,
      opts.playoffOrder ?? {},
    );
    if (unresolvedPlayoffs.length) {
      throw new ConflictError(`Record the playoff result for tied position(s) ${unresolvedPlayoffs.map((u) => u.rank).join(", ")} before finalising.`);
    }
    const byCustomer = new Map(standings.map((s) => [s.customerId, s]));
    const now = new Date();
    const deadline = new Date(now.getTime() + c.jackpotClaimDays * 86400_000);
    const awards = [];
    for (const a of allocations) {
      const s = byCustomer.get(a.customerId)!;
      const [row] = await tx
        .insert(prizeAwards)
        .values({
          competitionId: c.id,
          customerId: a.customerId,
          kind: "weekly",
          rank: a.rank,
          distanceMm: s.bestScore,
          roundId: s.bestRoundId,
          shotId: s.bestShotId,
          prizeAmountPence: a.amountPence,
          prizeDescription: a.description,
          splitWays: a.splitWays,
          status: "awaiting_claim",
          verifiedAt: now,
          approvedByUserId: actor.id,
          claimDeadline: deadline,
          notificationStatus: "queued",
          notes: [a.remainderPence ? `Equal split left ${a.remainderPence}p undistributed — business to decide.` : null, opts.notes ?? null].filter(Boolean).join(" ") || null,
        })
        .onConflictDoNothing()
        .returning();
      if (row) awards.push(row);
    }
    const [after] = await tx
      .update(competitions)
      .set({ status: "finalised", finalisedAt: now, finalisedByUserId: actor.id, updatedAt: now })
      .where(eq(competitions.id, c.id))
      .returning();
    await audit(tx, actor, "competition.finalise", "competition", c.id, {
      after: { awards: awards.map((a) => ({ customerId: a.customerId, rank: a.rank, amount: a.prizeAmountPence })), playoffOrder: opts.playoffOrder ?? null },
      reason: opts.notes ?? null,
    });
    await bumpLeaderboard(tx, c.id);
    return { competition: after, awards, alreadyFinalised: false };
  });
}

const PRIZE_TRANSITIONS: Record<string, string[]> = {
  provisional: ["verified", "cancelled"],
  verified: ["awaiting_claim", "cancelled"],
  awaiting_claim: ["claimed", "fulfilled", "expired", "cancelled"],
  claimed: ["fulfilled", "cancelled"],
  fulfilled: [],
  expired: ["awaiting_claim"],
  cancelled: [],
};

export async function updatePrize(
  awardId: string,
  to: "claimed" | "fulfilled" | "expired" | "cancelled" | "awaiting_claim",
  details: { paidAmountPence?: number; paymentMethod?: string; paymentReference?: string; notes?: string },
  actor: Actor & { type: "user" },
) {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(prizeAwards).where(eq(prizeAwards.id, awardId)).for("update");
    if (!a) throw new NotFoundError("Prize");
    if (!PRIZE_TRANSITIONS[a.status].includes(to)) throw new ConflictError(`Can't move a ${a.status.replace("_", " ")} prize to ${to.replace("_", " ")}.`);
    const patch: Partial<typeof prizeAwards.$inferInsert> = { status: to, updatedAt: new Date() };
    if (to === "claimed") patch.claimedAt = new Date();
    if (to === "fulfilled") {
      if (details.paidAmountPence === undefined || !details.paymentMethod?.trim() || !details.paymentReference?.trim())
        throw new AppError("Record the amount paid, payment method and transaction reference.");
      if (a.prizeAmountPence > 0 && details.paidAmountPence !== a.prizeAmountPence && !details.notes?.trim())
        throw new AppError("The amount paid differs from the prize amount — add a note explaining why.");
      Object.assign(patch, { paidAmountPence: details.paidAmountPence, paymentMethod: details.paymentMethod, paymentReference: details.paymentReference, paidAt: new Date(), paidRecordedByUserId: actor.id });
    }
    if (to === "cancelled" || to === "expired") {
      if (!details.notes?.trim()) throw new AppError("Add a note explaining this change.");
    }
    if (details.notes) patch.notes = [a.notes, details.notes].filter(Boolean).join("\n");
    const [after] = await tx.update(prizeAwards).set(patch).where(eq(prizeAwards.id, awardId)).returning();
    await audit(tx, actor, `prize.${to}`, "prize_award", awardId, { before: { status: a.status }, after: { status: to, ...details } });
    return after;
  });
}

/** Expire unclaimed prizes past their deadline (scheduler). Never touches fulfilled prizes. */
export async function expireUnclaimedPrizes(now = new Date()) {
  const due = await db.select().from(prizeAwards).where(eq(prizeAwards.status, "awaiting_claim"));
  const expired = [];
  for (const a of due) {
    if (a.claimDeadline && a.claimDeadline < now) {
      const [x] = await db.update(prizeAwards).set({ status: "expired", notes: [a.notes, "Claim deadline passed (automatic)."].filter(Boolean).join("\n"), updatedAt: now }).where(and(eq(prizeAwards.id, a.id), eq(prizeAwards.status, "awaiting_claim"))).returning();
      if (x) expired.push(x);
    }
  }
  return expired;
}

/** Public winners archive (names via publicDisplayName at render time). */
export async function winnersArchive(limit = 52) {
  return db
    .select({ award: prizeAwards, competition: competitions, customer: customers })
    .from(prizeAwards)
    .innerJoin(competitions, eq(competitions.id, prizeAwards.competitionId))
    .innerJoin(customers, eq(customers.id, prizeAwards.customerId))
    .where(and(inArray(competitions.status, ["finalised", "archived"]), ne(prizeAwards.status, "cancelled")))
    .orderBy(desc(competitions.endsAt), asc(prizeAwards.rank))
    .limit(limit);
}
