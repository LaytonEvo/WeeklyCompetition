import type { Standing, TiePolicy } from "./ranking";

export interface PrizeDef {
  rank: number;
  amountPence: number;
  description: string;
}

export interface PrizeAllocation {
  customerId: string;
  rank: number;
  amountPence: number;
  description: string;
  splitWays: number;
  /** Pence left undistributed by an equal split (reported to admin, never silently assigned). */
  remainderPence: number;
}

export interface AllocationResult {
  allocations: PrizeAllocation[];
  /** Tie groups that touch a prize position and need an admin-recorded playoff result. */
  unresolvedPlayoffs: { rank: number; customerIds: string[] }[];
}

/**
 * Allocate prizes from final standings.
 * - Tied competitors occupying positions p..p+k-1 share the pooled prizes for
 *   those positions equally (standard "split" convention).
 * - Under the "playoff" policy, a tied group touching a prize position must
 *   be resolved by an explicit playoff ordering supplied by an administrator.
 */
export function allocatePrizes(
  standings: Standing[],
  prizes: PrizeDef[],
  policy: TiePolicy,
  playoffOrder: Record<number, string[]> = {},
): AllocationResult {
  const prizeByPos = new Map(prizes.map((p) => [p.rank, p]));
  const maxPrizePos = prizes.reduce((m, p) => Math.max(m, p.rank), 0);
  const allocations: PrizeAllocation[] = [];
  const unresolvedPlayoffs: AllocationResult["unresolvedPlayoffs"] = [];

  const groups = new Map<number, Standing[]>();
  for (const s of standings) groups.set(s.rank, [...(groups.get(s.rank) ?? []), s]);

  for (const [rank, members] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (rank > maxPrizePos) break;
    const positions = Array.from({ length: members.length }, (_, i) => rank + i);
    const groupPrizes = positions.map((p) => prizeByPos.get(p)).filter(Boolean) as PrizeDef[];
    if (groupPrizes.length === 0) continue;

    if (members.length > 1 && policy === "playoff") {
      const order = playoffOrder[rank];
      const ids = members.map((m) => m.customerId);
      const valid =
        order && order.length === ids.length && order.every((id) => ids.includes(id)) && new Set(order).size === order.length;
      if (!valid) {
        unresolvedPlayoffs.push({ rank, customerIds: ids });
        continue;
      }
      order.forEach((customerId, i) => {
        const p = prizeByPos.get(rank + i);
        if (p) allocations.push({ customerId, rank: rank + i, amountPence: p.amountPence, description: p.description, splitWays: 1, remainderPence: 0 });
      });
      continue;
    }

    const pooled = groupPrizes.reduce((sum, p) => sum + p.amountPence, 0);
    const each = Math.floor(pooled / members.length);
    const remainder = pooled - each * members.length;
    const description =
      members.length > 1
        ? `Shared ${groupPrizes.map((p) => p.description || `position ${p.rank}`).join(" + ")} (${members.length}-way tie)`
        : groupPrizes[0].description;
    for (const m of members) {
      allocations.push({ customerId: m.customerId, rank, amountPence: each, description, splitWays: members.length, remainderPence: remainder });
    }
  }
  return { allocations, unresolvedPlayoffs };
}
