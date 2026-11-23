import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { competitions, customers, rounds, shots } from "@/db/schema";
import { displayPrecisions } from "@/lib/distance";
import { computeStandings, type CompetitorInfo, type Standing } from "@/lib/scoring/ranking";
import { strategyFor, type ScoringShot } from "@/lib/scoring/strategies";
import { publicDisplayName } from "./customers";

type Competition = typeof competitions.$inferSelect;

/**
 * Authoritative standings, derived on demand from raw verified shots:
 * active (non-superseded) shots in COMPLETED rounds only. Voided,
 * disqualified, cancelled and in-progress rounds never count.
 */
export async function getStandings(c: Competition, opts: { includePendingHio?: boolean } = {}, tx: DbOrTx = db): Promise<Standing[]> {
  const strategy = strategyFor(c.format);
  const rows = await tx
    .select({
      shotId: shots.id,
      roundId: shots.roundId,
      customerId: rounds.customerId,
      distanceMm: shots.distanceMm,
      valid: shots.valid,
      onGreen: shots.onGreen,
      isHoleInOne: shots.isHoleInOne,
      hioStatus: shots.hioStatus,
      recordedAt: shots.recordedAt,
    })
    .from(shots)
    .innerJoin(rounds, eq(rounds.id, shots.roundId))
    .where(and(eq(rounds.competitionId, c.id), eq(rounds.status, "completed"), eq(shots.status, "active")));

  const scoring: ScoringShot[] = rows.map((r) => ({
    ...r,
    hioStatus: opts.includePendingHio && r.hioStatus === "pending_review" ? "approved" : r.hioStatus,
  }));

  const ids = [...new Set(rows.map((r) => r.customerId))];
  const competitors = new Map<string, CompetitorInfo>();
  if (ids.length) {
    const people = await tx.select().from(customers).where(inArray(customers.id, ids));
    const counts = await tx
      .select({ customerId: rounds.customerId, n: sql<number>`count(*)::int` })
      .from(rounds)
      .where(and(eq(rounds.competitionId, c.id), eq(rounds.status, "completed"), inArray(rounds.customerId, ids)))
      .groupBy(rounds.customerId);
    const countMap = new Map(counts.map((x) => [x.customerId, x.n]));
    for (const p of people) competitors.set(p.id, { customerId: p.id, displayName: publicDisplayName(p), roundsCompleted: countMap.get(p.id) ?? 0 });
  }
  return computeStandings(scoring, competitors, strategy, { requireOnGreen: c.requireOnGreen, hioCountsForWeekly: c.hioCountsForWeekly }, c.tiePolicy);
}

export interface PublicLeaderboardRow {
  rank: number;
  tied: boolean;
  name: string;
  best: string;
  bestMm: number;
  rounds: number | null;
  bestAt: string;
  holeInOne: boolean;
  /** Opaque, non-identifying key for React lists & highlight animations. */
  key: string;
}

export interface PublicLeaderboard {
  competition: {
    id: string;
    slug: string;
    name: string;
    status: string;
    endsAt: string;
    startsAt: string;
    holeName: string;
    holeDistanceYards: number | null;
  };
  version: number;
  updatedAt: string;
  entrants: number;
  rows: PublicLeaderboardRow[];
}

/** Public projection — contains no contact details or internal IDs. */
export async function getPublicLeaderboard(c: Competition, limit = 100, showRounds = true): Promise<PublicLeaderboard> {
  const standings = await getStandings(c);
  const strategy = strategyFor(c.format);
  const top = standings.slice(0, limit);
  const precisions = displayPrecisions(top.map((s) => s.bestScore));
  const { createHash } = await import("node:crypto");
  return {
    competition: {
      id: c.id,
      slug: c.slug,
      name: c.name,
      status: c.status,
      endsAt: c.endsAt.toISOString(),
      startsAt: c.startsAt.toISOString(),
      holeName: c.holeName,
      holeDistanceYards: c.holeDistanceYards,
    },
    version: c.leaderboardVersion,
    updatedAt: new Date().toISOString(),
    entrants: standings.length,
    rows: top.map((s, i) => ({
      rank: s.rank,
      tied: s.tiedWith > 1,
      name: s.displayName,
      best: strategy.formatScore(s.bestScore, precisions[i]),
      bestMm: s.bestScore,
      rounds: showRounds && c.showRoundsCount ? s.roundsCompleted : null,
      bestAt: s.bestShotAt.toISOString(),
      holeInOne: s.holeInOne,
      key: createHash("sha256").update(`${c.id}:${s.customerId}`).digest("hex").slice(0, 12),
    })),
  };
}

/** Position of one customer (for result emails / share cards). */
export async function customerPosition(c: Competition, customerId: string) {
  const standings = await getStandings(c);
  const s = standings.find((x) => x.customerId === customerId);
  return s ? { rank: s.rank, tied: s.tiedWith > 1, bestScore: s.bestScore, of: standings.length } : null;
}
