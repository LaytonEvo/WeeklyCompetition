export interface JackpotConfig {
  jackpotEnabled: boolean;
  jackpotAmountPence: number;
  jackpotMaxWinners: number | null;
  jackpotMaxPerPlayer: number;
  jackpotMaxLiabilityPence: number | null;
  jackpotSubsequentQualify: boolean;
}

export interface FundingInfo {
  coverageLimitPence: number;
  perEventLimitPence: number | null;
  validFrom: Date;
  validTo: Date;
  simulatorCoverageConfirmed: boolean;
}

/** Maximum total jackpot payout possible under the configuration. Infinity = unbounded. */
export function maxJackpotExposure(c: JackpotConfig): number {
  if (!c.jackpotEnabled || c.jackpotAmountPence <= 0) return 0;
  const winnersCap = c.jackpotSubsequentQualify ? c.jackpotMaxWinners : 1;
  const byWinners = winnersCap === null ? Infinity : winnersCap * c.jackpotAmountPence;
  const byLiability = c.jackpotMaxLiabilityPence ?? Infinity;
  return Math.min(byWinners, byLiability);
}

/**
 * Validate that a jackpot can be published. Returns a list of blocking problems
 * (empty = OK). The payout ceiling must be bounded and covered by confirmed,
 * in-date funding that explicitly covers simulator play.
 */
export function validateJackpotFunding(
  c: JackpotConfig,
  funding: FundingInfo | null,
  window: { startsAt: Date; endsAt: Date },
): string[] {
  if (!c.jackpotEnabled) return [];
  const problems: string[] = [];
  if (c.jackpotAmountPence <= 0) problems.push("Jackpot amount must be greater than zero.");
  const exposure = maxJackpotExposure(c);
  if (!Number.isFinite(exposure)) {
    problems.push("Maximum jackpot payout is unbounded — set a maximum number of winners or a maximum total liability.");
  }
  if (!funding) {
    problems.push("No jackpot funding or insurance arrangement is linked.");
    return problems;
  }
  if (!funding.simulatorCoverageConfirmed) {
    problems.push("The funding/insurance record has not been confirmed as covering simulator hole-in-ones.");
  }
  if (Number.isFinite(exposure) && exposure > funding.coverageLimitPence) {
    problems.push(`Maximum possible payout (${exposure}p) exceeds the funding/coverage limit (${funding.coverageLimitPence}p).`);
  }
  if (funding.perEventLimitPence !== null && c.jackpotAmountPence > funding.perEventLimitPence) {
    problems.push("Jackpot amount exceeds the per-event coverage limit.");
  }
  if (funding.validFrom > window.startsAt || funding.validTo < window.endsAt) {
    problems.push("Funding/insurance validity dates do not cover the whole competition.");
  }
  return problems;
}

export interface JackpotEligibilityInput {
  config: JackpotConfig;
  /** Approved jackpot awards already granted in this competition (excluding this claim). */
  approvedCount: number;
  /** Approved jackpot awards already granted to this player in this competition. */
  approvedForPlayer: number;
  /** Total jackpot pence already committed in this competition. */
  liabilityCommittedPence: number;
}

export function jackpotEligibility(i: JackpotEligibilityInput): { eligible: boolean; reason?: string; amountPence: number } {
  const c = i.config;
  if (!c.jackpotEnabled) return { eligible: false, reason: "Jackpot not enabled for this competition", amountPence: 0 };
  if (!c.jackpotSubsequentQualify && i.approvedCount > 0)
    return { eligible: false, reason: "Only the first verified hole-in-one qualifies under the published rules", amountPence: 0 };
  if (c.jackpotMaxWinners !== null && i.approvedCount >= c.jackpotMaxWinners)
    return { eligible: false, reason: `Maximum of ${c.jackpotMaxWinners} jackpot winner(s) reached`, amountPence: 0 };
  if (i.approvedForPlayer >= c.jackpotMaxPerPlayer)
    return { eligible: false, reason: "Player has reached the per-player jackpot limit", amountPence: 0 };
  if (c.jackpotMaxLiabilityPence !== null && i.liabilityCommittedPence + c.jackpotAmountPence > c.jackpotMaxLiabilityPence)
    return { eligible: false, reason: "Maximum total jackpot liability would be exceeded", amountPence: 0 };
  return { eligible: true, amountPence: c.jackpotAmountPence };
}
