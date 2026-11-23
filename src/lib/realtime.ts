import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { competitions } from "@/db/schema";

export const LEADERBOARD_CHANNEL = "ph_leaderboard";

/**
 * Bump the leaderboard version and queue a Postgres NOTIFY. NOTIFY inside a
 * transaction is only delivered on commit, so listeners never see
 * uncommitted results.
 */
export async function bumpLeaderboard(tx: DbOrTx, competitionId: string) {
  await tx
    .update(competitions)
    .set({ leaderboardVersion: sql`${competitions.leaderboardVersion} + 1` })
    .where(eq(competitions.id, competitionId));
  await tx.execute(sql`select pg_notify(${LEADERBOARD_CHANNEL}, ${competitionId})`);
}
