import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { bookings, competitions, customers, hioClaims, rounds, shots } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import { MAX_DISTANCE_MM } from "@/lib/distance";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { bumpLeaderboard } from "@/lib/realtime";
import { strategyFor } from "@/lib/scoring/strategies";

export type Round = typeof rounds.$inferSelect;
export type Shot = typeof shots.$inferSelect;

async function lockRound(tx: DbOrTx, roundId: string) {
  const [r] = await tx.select().from(rounds).where(eq(rounds.id, roundId)).for("update");
  if (!r) throw new NotFoundError("Round");
  const [c] = await tx.select().from(competitions).where(eq(competitions.id, r.competitionId));
  return { round: r, competition: c };
}

export async function activeShots(tx: DbOrTx, roundId: string) {
  return tx.select().from(shots).where(and(eq(shots.roundId, roundId), eq(shots.status, "active"))).orderBy(asc(shots.shotNumber));
}

/**
 * Start a round. Rounds can only START while the competition is open and
 * before its deadline; a round started in time may be completed after it.
 */
export async function startRound(roundId: string, actor: Actor & { type: "user" }, now = new Date()) {
  return db.transaction(async (tx) => {
    const { round, competition } = await lockRound(tx, roundId);
    if (round.status === "in_progress") return round;
    if (!["booked", "checked_in"].includes(round.status)) throw new ConflictError(`This round is ${round.status.replace("_", " ")} and can't be started.`);
    if (competition.status !== "open" || now >= competition.endsAt || now < competition.startsAt) {
      throw new ConflictError("Rounds can only be started while the competition is open.");
    }
    // One live round per customer at a time keeps the record unambiguous.
    const [live] = await tx
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(eq(rounds.customerId, round.customerId), inArray(rounds.status, ["in_progress", "paused"]), ne(rounds.id, roundId)));
    if (live) throw new ConflictError("This player already has a round in progress. Complete or pause it first.");
    const [after] = await tx
      .update(rounds)
      .set({ status: "in_progress", startedAt: now, supervisedByUserId: actor.id, checkedInAt: round.checkedInAt ?? now, updatedAt: now })
      .where(eq(rounds.id, roundId))
      .returning();
    if (round.bookingId) {
      await tx
        .update(bookings)
        .set({ status: "checked_in", checkedInAt: now, checkedInByUserId: actor.id, updatedAt: now })
        .where(and(eq(bookings.id, round.bookingId), inArray(bookings.status, ["confirmed", "no_show"])));
    }
    await tx.update(customers).set({ lastActivityAt: now }).where(eq(customers.id, round.customerId));
    await audit(tx, actor, "round.start", "round", roundId, { before: { status: round.status } });
    return after;
  });
}

export const shotInputSchema = z
  .object({
    shotNumber: z.number().int().min(1).max(20),
    distanceMm: z.number().int().min(0).max(MAX_DISTANCE_MM).nullable(),
    onGreen: z.boolean(),
    valid: z.boolean().default(true),
    isHoleInOne: z.boolean().default(false),
    simulatorShotId: z.string().max(128).nullable().optional(),
    hioStatement: z.string().max(2000).optional(),
    hioSecondWitness: z.string().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.isHoleInOne && !v.hioStatement?.trim())
      ctx.addIssue({ code: "custom", path: ["hioStatement"], message: "Describe what you witnessed for the hole-in-one claim" });
    if (!v.isHoleInOne && v.distanceMm === 0)
      ctx.addIssue({ code: "custom", path: ["distanceMm"], message: "A distance of 0 is only possible for a hole-in-one — tick hole-in-one instead" });
    if (!v.isHoleInOne && v.valid && v.distanceMm === null)
      ctx.addIssue({ code: "custom", path: ["distanceMm"], message: "Enter the distance, or mark the shot as invalid / no result" });
  });
export type ShotInput = z.input<typeof shotInputSchema>;

/**
 * Record a shot. Idempotent on (round, shot number): a retried submission
 * with identical values returns the existing shot instead of failing, so a
 * dropped connection at the counter never creates duplicates.
 */
export async function recordShot(roundId: string, input: ShotInput, actor: Actor & { type: "user" }) {
  const data = shotInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const { round } = await lockRound(tx, roundId);
    if (round.status !== "in_progress") throw new ConflictError(round.status === "paused" ? "Resume the round before recording shots." : "This round is not in progress.");
    const current = await activeShots(tx, roundId);
    const existing = current.find((s) => s.shotNumber === data.shotNumber);
    const distanceMm = data.isHoleInOne ? 0 : data.distanceMm;
    if (existing) {
      const same = existing.distanceMm === distanceMm && existing.onGreen === (data.isHoleInOne || data.onGreen) && existing.valid === data.valid && existing.isHoleInOne === data.isHoleInOne;
      if (same) return { shot: existing, duplicate: true };
      throw new ConflictError(`Shot ${data.shotNumber} is already recorded. Use "Correct" to change it.`);
    }
    if (data.shotNumber !== current.length + 1) throw new ConflictError(`Next shot to record is shot ${current.length + 1}.`);
    if (data.shotNumber > round.shotsAllowed) throw new ConflictError(`This round only allows ${round.shotsAllowed} shots.`);

    const [shot] = await tx
      .insert(shots)
      .values({
        roundId,
        shotNumber: data.shotNumber,
        distanceMm,
        onGreen: data.isHoleInOne ? true : data.onGreen,
        valid: data.valid,
        isHoleInOne: data.isHoleInOne,
        hioStatus: data.isHoleInOne ? "pending_review" : null,
        simulatorShotId: data.simulatorShotId ?? null,
        recordedByUserId: actor.id,
      })
      .returning();

    if (data.isHoleInOne) {
      const [claim] = await tx
        .insert(hioClaims)
        .values({
          shotId: shot.id,
          competitionId: round.competitionId,
          customerId: round.customerId,
          witnessUserId: actor.id,
          staffStatement: data.hioStatement!.trim(),
          secondWitnessName: data.hioSecondWitness?.trim() || null,
        })
        .returning();
      await audit(tx, actor, "hio.claim_created", "hio_claim", claim.id, { after: { shotId: shot.id, roundId } });
    }
    await audit(tx, actor, "shot.record", "shot", shot.id, { after: { roundId, shotNumber: shot.shotNumber, distanceMm, valid: shot.valid, onGreen: shot.onGreen, hio: shot.isHoleInOne } });
    return { shot, duplicate: false };
  });
}

/**
 * Correct a shot. The original row is kept (status=superseded) and a new row
 * records the corrected values with a mandatory reason. Correcting a shot in
 * a completed (verified) round requires elevated permission.
 */
export async function correctShot(
  shotId: string,
  input: Omit<ShotInput, "shotNumber"> | { remove: true },
  reason: string,
  actor: Actor & { type: "user" },
  opts: { canCorrectVerified: boolean },
) {
  if (!reason.trim()) throw new AppError("A reason is required to correct a recorded shot.");
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(shots).where(eq(shots.id, shotId)).for("update");
    if (!old || old.status !== "active") throw new NotFoundError("Active shot");
    const { round } = await lockRound(tx, old.roundId);
    const verified = round.status === "completed";
    if (verified && !opts.canCorrectVerified) throw new ForbiddenError("Only a manager can correct a verified round.");
    if (!["in_progress", "paused", "completed"].includes(round.status)) throw new ConflictError("Shots in this round can no longer be changed.");
    if (old.isHoleInOne && old.hioStatus === "approved") throw new ConflictError("An approved hole-in-one can't be edited. Contact a super admin.");

    await tx.update(shots).set({ status: "superseded" }).where(eq(shots.id, shotId));
    let replacement: Shot | null = null;
    if ("remove" in input) {
      // Undo is only allowed for the latest shot of a live round, so numbering stays contiguous.
      const current = await activeShots(tx, round.id);
      if (verified || current.some((s) => s.shotNumber > old.shotNumber)) throw new ConflictError("Only the most recent shot of a live round can be undone.");
    } else {
      const data = shotInputSchema.parse({ ...input, shotNumber: old.shotNumber });
      [replacement] = await tx
        .insert(shots)
        .values({
          roundId: round.id,
          shotNumber: old.shotNumber,
          distanceMm: data.isHoleInOne ? 0 : data.distanceMm,
          onGreen: data.isHoleInOne ? true : data.onGreen,
          valid: data.valid,
          isHoleInOne: data.isHoleInOne,
          hioStatus: data.isHoleInOne ? "pending_review" : null,
          simulatorShotId: old.simulatorShotId,
          supersedesShotId: old.id,
          correctionReason: reason,
          recordedByUserId: actor.id,
        })
        .returning();
      if (data.isHoleInOne) {
        await tx.insert(hioClaims).values({
          shotId: replacement.id,
          competitionId: round.competitionId,
          customerId: round.customerId,
          witnessUserId: actor.id,
          staffStatement: data.hioStatement!.trim(),
          secondWitnessName: data.hioSecondWitness?.trim() || null,
        });
      }
    }
    // A superseded pending claim is withdrawn.
    if (old.isHoleInOne && old.hioStatus === "pending_review") {
      await tx.update(hioClaims).set({ status: "rejected", decisionReason: `Shot corrected: ${reason}`, reviewedAt: new Date(), reviewedByUserId: actor.id }).where(eq(hioClaims.shotId, old.id));
    }
    await audit(tx, actor, "remove" in input ? "shot.undo" : verified ? "shot.correct_verified" : "shot.correct", "shot", old.id, {
      before: { distanceMm: old.distanceMm, valid: old.valid, onGreen: old.onGreen, hio: old.isHoleInOne },
      after: replacement ? { id: replacement.id, distanceMm: replacement.distanceMm, valid: replacement.valid, onGreen: replacement.onGreen, hio: replacement.isHoleInOne } : null,
      reason,
    });
    if (verified) await bumpLeaderboard(tx, round.competitionId);
    return replacement;
  });
}

export async function setRoundStatus(
  roundId: string,
  to: "paused" | "in_progress" | "voided" | "disqualified",
  reason: string,
  actor: Actor & { type: "user" },
) {
  const allowed: Record<typeof to, Round["status"][]> = {
    paused: ["in_progress"],
    in_progress: ["paused"],
    voided: ["in_progress", "paused"],
    disqualified: ["in_progress", "paused", "completed"],
  };
  if (to !== "in_progress" && !reason.trim()) throw new AppError("A reason is required.");
  return db.transaction(async (tx) => {
    const { round } = await lockRound(tx, roundId);
    if (!allowed[to].includes(round.status)) throw new ConflictError(`Can't change a ${round.status.replace("_", " ")} round to ${to.replace("_", " ")}.`);
    const [after] = await tx.update(rounds).set({ status: to, statusReason: reason || round.statusReason, updatedAt: new Date() }).where(eq(rounds.id, roundId)).returning();
    await audit(tx, actor, `round.${to === "in_progress" ? "resume" : to}`, "round", roundId, { before: { status: round.status }, reason });
    if (round.status === "completed") await bumpLeaderboard(tx, round.competitionId);
    return after;
  });
}

/**
 * Interrupted round (e.g. simulator failure): void the round and issue a
 * replacement round against the same payment. The voided round and its shots
 * are retained for audit but never count.
 */
export async function restartRound(roundId: string, reason: string, actor: Actor & { type: "user" }) {
  if (!reason.trim()) throw new AppError("A reason is required to restart a round.");
  return db.transaction(async (tx) => {
    const { round } = await lockRound(tx, roundId);
    if (!["in_progress", "paused"].includes(round.status)) throw new ConflictError("Only a live round can be restarted.");
    await tx.update(rounds).set({ status: "voided", statusReason: `Restarted: ${reason}`, updatedAt: new Date() }).where(eq(rounds.id, roundId));
    await tx
      .update(hioClaims)
      .set({ status: "rejected", decisionReason: "Round voided and restarted", reviewedAt: new Date(), reviewedByUserId: actor.id })
      .where(and(eq(hioClaims.status, "pending_review"), sql`${hioClaims.shotId} in (select id from shots where round_id = ${roundId})`));
    const [replacement] = await tx
      .insert(rounds)
      .values({
        competitionId: round.competitionId,
        customerId: round.customerId,
        bookingId: round.bookingId,
        paymentId: round.paymentId,
        shotsAllowed: round.shotsAllowed,
        status: "checked_in",
        checkedInAt: new Date(),
        restartOfRoundId: round.id,
      })
      .returning();
    await audit(tx, actor, "round.restart", "round", roundId, { after: { replacementRoundId: replacement.id }, reason });
    return replacement;
  });
}

/**
 * Complete & verify a round. If fewer shots than allowed were recorded a
 * reason is required (remaining shots are forfeited). Updates the leaderboard.
 */
export async function completeRound(roundId: string, actor: Actor & { type: "user" }, earlyReason?: string) {
  return db.transaction(async (tx) => {
    const { round, competition } = await lockRound(tx, roundId);
    if (round.status === "completed") return { round, alreadyCompleted: true };
    if (round.status !== "in_progress") throw new ConflictError("Only a round in progress can be completed.");
    const current = await activeShots(tx, roundId);
    if (current.length < round.shotsAllowed && !earlyReason?.trim()) {
      throw new AppError(`Only ${current.length} of ${round.shotsAllowed} shots recorded. Give a reason to finish early (remaining shots are forfeited).`);
    }
    const now = new Date();
    const [after] = await tx
      .update(rounds)
      .set({ status: "completed", completedAt: now, verifiedByUserId: actor.id, statusReason: earlyReason ?? null, updatedAt: now })
      .where(eq(rounds.id, roundId))
      .returning();
    if (round.bookingId) {
      const [{ open }] = await tx
        .select({ open: sql<number>`count(*)::int` })
        .from(rounds)
        .where(and(eq(rounds.bookingId, round.bookingId), inArray(rounds.status, ["booked", "checked_in", "in_progress", "paused"])));
      if (open === 0) await tx.update(bookings).set({ status: "completed", updatedAt: now }).where(eq(bookings.id, round.bookingId));
    }
    await audit(tx, actor, "round.complete", "round", roundId, { after: { shots: current.length }, reason: earlyReason ?? null });
    await bumpLeaderboard(tx, competition.id);
    return { round: after, alreadyCompleted: false };
  });
}

/** Best qualifying score in a set of shots (for the live console). */
export function bestOfShots(shotRows: Shot[], c: Pick<typeof competitions.$inferSelect, "format" | "requireOnGreen" | "hioCountsForWeekly">, customerId: string) {
  const strategy = strategyFor(c.format);
  let best: { score: number; shot: Shot } | null = null;
  for (const s of shotRows) {
    // In the live console a pending hole-in-one is shown as provisional 0.
    const score = strategy.qualifyingScore(
      { shotId: s.id, roundId: s.roundId, customerId, distanceMm: s.distanceMm, valid: s.valid, onGreen: s.onGreen, isHoleInOne: s.isHoleInOne, hioStatus: s.isHoleInOne ? "approved" : null, recordedAt: s.recordedAt },
      { requireOnGreen: c.requireOnGreen, hioCountsForWeekly: true },
    );
    if (score === null) continue;
    if (!best || (strategy.direction === "asc" ? score < best.score : score > best.score)) best = { score, shot: s };
  }
  return best;
}

export async function getRoundWithShots(roundId: string) {
  const [r] = await db.select().from(rounds).where(eq(rounds.id, roundId));
  if (!r) throw new NotFoundError("Round");
  const all = await db.select().from(shots).where(eq(shots.roundId, roundId)).orderBy(asc(shots.shotNumber), asc(shots.recordedAt));
  return { round: r, shots: all, active: all.filter((s) => s.status === "active") };
}
