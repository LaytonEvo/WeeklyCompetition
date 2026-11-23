import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { competitions, customers, hioClaims, prizeAwards, rounds, shotEvidence, shots } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { bumpLeaderboard } from "@/lib/realtime";
import { jackpotEligibility } from "@/lib/scoring/jackpot";

export async function listClaims(status?: "pending_review" | "approved" | "rejected") {
  return db
    .select({ claim: hioClaims, customer: customers, competition: competitions, shot: shots })
    .from(hioClaims)
    .innerJoin(customers, eq(customers.id, hioClaims.customerId))
    .innerJoin(competitions, eq(competitions.id, hioClaims.competitionId))
    .innerJoin(shots, eq(shots.id, hioClaims.shotId))
    .where(status ? eq(hioClaims.status, status) : undefined)
    .orderBy(desc(hioClaims.createdAt));
}

export async function evidenceForShot(shotId: string, roundId: string) {
  return db
    .select()
    .from(shotEvidence)
    .where(or(eq(shotEvidence.shotId, shotId), and(eq(shotEvidence.roundId, roundId), sql`${shotEvidence.shotId} is null`)));
}

/**
 * Administrator decision on a hole-in-one claim.
 * - Evidence must be attached before approval.
 * - The reviewer cannot be the witnessing staff member (four-eyes rule).
 * - Jackpot eligibility (winner caps, per-player caps, liability cap) is
 *   evaluated at approval time, under a lock, so caps can't be exceeded by
 *   concurrent approvals.
 */
export async function reviewClaim(claimId: string, decision: "approve" | "reject", reason: string, actor: Actor & { type: "user" }) {
  if (!reason.trim()) throw new AppError("Record the reason for this decision.");
  return db.transaction(async (tx) => {
    const [claim] = await tx.select().from(hioClaims).where(eq(hioClaims.id, claimId)).for("update");
    if (!claim) throw new NotFoundError("Hole-in-one claim");
    if (claim.status !== "pending_review") throw new ConflictError("This claim has already been decided.");
    if (claim.witnessUserId === actor.id) throw new ForbiddenError("The witnessing staff member cannot review their own claim. Ask another manager.");
    const [shot] = await tx.select().from(shots).where(eq(shots.id, claim.shotId));
    if (shot.status !== "active") throw new ConflictError("This shot has been superseded by a correction.");
    const [round] = await tx.select().from(rounds).where(eq(rounds.id, shot.roundId));
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"jackpot:" + claim.competitionId}))`);
    const [c] = await tx.select().from(competitions).where(eq(competitions.id, claim.competitionId));

    if (decision === "reject") {
      await tx.update(hioClaims).set({ status: "rejected", reviewedByUserId: actor.id, reviewedAt: new Date(), decisionReason: reason }).where(eq(hioClaims.id, claimId));
      await tx.update(shots).set({ hioStatus: "rejected" }).where(eq(shots.id, shot.id));
      await audit(tx, actor, "hio.reject", "hio_claim", claimId, { reason });
      await bumpLeaderboard(tx, c.id);
      return { status: "rejected" as const };
    }

    const evidence = await tx
      .select({ id: shotEvidence.id })
      .from(shotEvidence)
      .where(or(eq(shotEvidence.shotId, shot.id), and(eq(shotEvidence.roundId, shot.roundId), sql`${shotEvidence.shotId} is null`)));
    if (evidence.length === 0) throw new ConflictError("Upload supporting evidence (simulator screenshot) before approving.");
    if (!["completed", "in_progress", "paused"].includes(round.status)) throw new ConflictError(`The round is ${round.status}; the claim can't be approved.`);

    const approved = await tx
      .select({ customerId: prizeAwards.customerId, amount: prizeAwards.prizeAmountPence })
      .from(prizeAwards)
      .where(and(eq(prizeAwards.competitionId, c.id), eq(prizeAwards.kind, "jackpot"), inArray(prizeAwards.status, ["verified", "awaiting_claim", "claimed", "fulfilled"])));
    const elig = jackpotEligibility({
      config: c,
      approvedCount: approved.length,
      approvedForPlayer: approved.filter((a) => a.customerId === claim.customerId).length,
      liabilityCommittedPence: approved.reduce((s, a) => s + a.amount, 0),
    });

    await tx
      .update(hioClaims)
      .set({
        status: "approved",
        reviewedByUserId: actor.id,
        reviewedAt: new Date(),
        decisionReason: reason,
        jackpotEligible: elig.eligible,
        jackpotIneligibleReason: elig.reason ?? null,
        jackpotAmountPence: elig.eligible ? elig.amountPence : 0,
      })
      .where(eq(hioClaims.id, claimId));
    await tx.update(shots).set({ hioStatus: "approved" }).where(eq(shots.id, shot.id));

    let award = null;
    if (elig.eligible) {
      [award] = await tx
        .insert(prizeAwards)
        .values({
          competitionId: c.id,
          customerId: claim.customerId,
          kind: "jackpot",
          distanceMm: 0,
          roundId: shot.roundId,
          shotId: shot.id,
          hioClaimId: claim.id,
          prizeAmountPence: elig.amountPence,
          prizeDescription: "Hole-in-one jackpot",
          status: "awaiting_claim",
          verifiedAt: new Date(),
          approvedByUserId: actor.id,
          claimDeadline: new Date(Date.now() + c.jackpotClaimDays * 86400_000),
        })
        .returning();
    }
    await audit(tx, actor, "hio.approve", "hio_claim", claimId, { after: { jackpotEligible: elig.eligible, reason: elig.reason, awardId: award?.id }, reason });
    await bumpLeaderboard(tx, c.id);
    return { status: "approved" as const, jackpotEligible: elig.eligible, ineligibleReason: elig.reason, award };
  });
}

/** Public Hall of Fame entries: approved hole-in-ones. Names only with publication consent. */
export async function hallOfFameHoleInOnes() {
  const rows = await db
    .select({ claim: hioClaims, customer: customers, competition: competitions, shot: shots })
    .from(hioClaims)
    .innerJoin(customers, eq(customers.id, hioClaims.customerId))
    .innerJoin(competitions, eq(competitions.id, hioClaims.competitionId))
    .innerJoin(shots, eq(shots.id, hioClaims.shotId))
    .where(eq(hioClaims.status, "approved"))
    .orderBy(desc(shots.recordedAt));
  return rows;
}
