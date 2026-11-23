import type { ScoringRules, ScoringShot, ScoringStrategy } from "./strategies";

export type TiePolicy = "equal_rank_split" | "countback" | "playoff";

export interface CompetitorInfo {
  customerId: string;
  displayName: string;
  roundsCompleted: number;
}

export interface Standing {
  rank: number;
  customerId: string;
  displayName: string;
  bestScore: number;
  bestShotId: string;
  bestRoundId: string;
  bestShotAt: Date;
  /** All qualifying scores, best first (used for countback). */
  scores: number[];
  roundsCompleted: number;
  holeInOne: boolean;
  /** Number of competitors sharing this rank. */
  tiedWith: number;
  /** True when the tie policy is "playoff" and this rank is shared. */
  needsPlayoff: boolean;
}

function cmp(direction: "asc" | "desc", a: number, b: number) {
  return direction === "asc" ? a - b : b - a;
}

/** Compare two competitors under the published tie policy. 0 = tied. */
function compareCompetitors(
  a: { scores: number[] },
  b: { scores: number[] },
  direction: "asc" | "desc",
  policy: TiePolicy,
): number {
  const first = cmp(direction, a.scores[0], b.scores[0]);
  if (first !== 0 || policy !== "countback") return first;
  // Countback: compare next-best qualifying shots in turn. A competitor with
  // fewer qualifying shots loses the countback at the first missing position.
  const n = Math.max(a.scores.length, b.scores.length);
  for (let i = 1; i < n; i++) {
    const as = a.scores[i];
    const bs = b.scores[i];
    if (as === undefined && bs === undefined) return 0;
    if (as === undefined) return 1;
    if (bs === undefined) return -1;
    const c = cmp(direction, as, bs);
    if (c !== 0) return c;
  }
  return 0;
}

/**
 * Derive standings from raw shots. Each competitor appears once, ranked by
 * their single best qualifying shot. Uses standard competition ranking
 * (1, 1, 3). Display order within a tie is alphabetical and carries no
 * meaning — it is not a tie-break.
 */
export function computeStandings(
  shots: ScoringShot[],
  competitors: Map<string, CompetitorInfo>,
  strategy: ScoringStrategy,
  rules: ScoringRules,
  policy: TiePolicy,
): Standing[] {
  type Acc = {
    customerId: string;
    entries: { score: number; shot: ScoringShot }[];
  };
  const byCustomer = new Map<string, Acc>();
  for (const shot of shots) {
    const score = strategy.qualifyingScore(shot, rules);
    if (score === null) continue;
    const acc = byCustomer.get(shot.customerId) ?? { customerId: shot.customerId, entries: [] };
    acc.entries.push({ score, shot });
    byCustomer.set(shot.customerId, acc);
  }

  const rows = [...byCustomer.values()].map((acc) => {
    acc.entries.sort((x, y) => cmp(strategy.direction, x.score, y.score) || x.shot.recordedAt.getTime() - y.shot.recordedAt.getTime());
    const best = acc.entries[0];
    const info = competitors.get(acc.customerId);
    return {
      customerId: acc.customerId,
      displayName: info?.displayName ?? "Player",
      roundsCompleted: info?.roundsCompleted ?? 0,
      scores: acc.entries.map((e) => e.score),
      bestScore: best.score,
      bestShotId: best.shot.shotId,
      bestRoundId: best.shot.roundId,
      bestShotAt: best.shot.recordedAt,
      holeInOne: acc.entries.some((e) => e.shot.isHoleInOne && e.score === 0),
    };
  });

  rows.sort(
    (a, b) =>
      compareCompetitors(a, b, strategy.direction, policy) ||
      a.displayName.localeCompare(b.displayName) ||
      a.customerId.localeCompare(b.customerId),
  );

  const out: Standing[] = [];
  for (let i = 0; i < rows.length; i++) {
    const prev = out[i - 1];
    const tiedWithPrev = i > 0 && compareCompetitors(rows[i - 1], rows[i], strategy.direction, policy) === 0;
    const rank = tiedWithPrev ? prev.rank : i + 1;
    out.push({ ...rows[i], rank, tiedWith: 1, needsPlayoff: false });
  }
  // annotate tie group sizes
  const groupSizes = new Map<number, number>();
  for (const s of out) groupSizes.set(s.rank, (groupSizes.get(s.rank) ?? 0) + 1);
  for (const s of out) {
    s.tiedWith = groupSizes.get(s.rank)!;
    s.needsPlayoff = policy === "playoff" && s.tiedWith > 1;
  }
  return out;
}
