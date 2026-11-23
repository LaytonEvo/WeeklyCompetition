import { describe, expect, it } from "vitest";
import { displayPrecisions, formatMm, parseMetresToMm } from "@/lib/distance";
import { formatPence, parsePoundsToPence } from "@/lib/money";
import { maxJackpotExposure, jackpotEligibility, validateJackpotFunding } from "@/lib/scoring/jackpot";
import { allocatePrizes } from "@/lib/scoring/prizes";
import { computeStandings, type CompetitorInfo } from "@/lib/scoring/ranking";
import { closestToPin, type ScoringShot } from "@/lib/scoring/strategies";

let seq = 0;
function shot(customerId: string, distanceMm: number | null, extra: Partial<ScoringShot> = {}): ScoringShot {
  seq++;
  return {
    shotId: `s${seq}`,
    roundId: `r-${customerId}`,
    customerId,
    distanceMm,
    valid: true,
    onGreen: true,
    isHoleInOne: false,
    hioStatus: null,
    recordedAt: new Date(2026, 0, 1, 12, 0, seq),
    ...extra,
  };
}
const people = (ids: string[]) => new Map<string, CompetitorInfo>(ids.map((id) => [id, { customerId: id, displayName: id.toUpperCase(), roundsCompleted: 1 }]));
const rules = { requireOnGreen: true, hioCountsForWeekly: true };

describe("distance handling", () => {
  it("parses metres into integer millimetres without float error", () => {
    expect(parseMetresToMm("1.34")).toBe(1340);
    expect(parseMetresToMm("0.42")).toBe(420);
    expect(parseMetresToMm("0.1")).toBe(100);
    expect(parseMetresToMm("12.345")).toBe(12345);
    expect(parseMetresToMm("4.26 m")).toBe(4260);
    expect(parseMetresToMm("abc")).toBeNull();
    expect(parseMetresToMm("-1")).toBeNull();
    expect(parseMetresToMm("1.2345")).toBeNull();
    expect(parseMetresToMm("999")).toBeNull();
  });
  it("formats millimetres as metres", () => {
    expect(formatMm(420)).toBe("0.42 m");
    expect(formatMm(1340)).toBe("1.34 m");
    expect(formatMm(0)).toBe("0.00 m");
    expect(formatMm(1005)).toBe("1.01 m");
    expect(formatMm(1004)).toBe("1.00 m");
    expect(formatMm(1004, 3)).toBe("1.004 m");
    expect(formatMm(null)).toBe("—");
  });
  it("increases precision where 2dp would create an artificial tie", () => {
    expect(displayPrecisions([1001, 1004, 2000])).toEqual([3, 3, 2]);
    expect(displayPrecisions([1000, 1000, 2000])).toEqual([2, 2, 2]); // genuine tie stays 2dp
  });
});

describe("money", () => {
  it("formats and parses integer pence", () => {
    expect(formatPence(500)).toBe("£5.00");
    expect(formatPence(100_000, { compact: true })).toBe("£1,000");
    expect(parsePoundsToPence("£1,000")).toBe(100_000);
    expect(parsePoundsToPence("5.5")).toBe(550);
    expect(parsePoundsToPence("5.555")).toBeNull();
    expect(() => formatPence(1.5)).toThrow();
  });
});

describe("closest-to-the-pin qualification", () => {
  it("only counts valid shots, on the green when required", () => {
    expect(closestToPin.qualifyingScore(shot("a", 1000), rules)).toBe(1000);
    expect(closestToPin.qualifyingScore(shot("a", 1000, { valid: false }), rules)).toBeNull();
    expect(closestToPin.qualifyingScore(shot("a", 1000, { onGreen: false }), rules)).toBeNull();
    expect(closestToPin.qualifyingScore(shot("a", 1000, { onGreen: false }), { ...rules, requireOnGreen: false })).toBe(1000);
    expect(closestToPin.qualifyingScore(shot("a", null), rules)).toBeNull();
  });
  it("scores a hole-in-one as exactly zero only once approved", () => {
    expect(closestToPin.qualifyingScore(shot("a", 0, { isHoleInOne: true, hioStatus: "pending_review" }), rules)).toBeNull();
    expect(closestToPin.qualifyingScore(shot("a", 0, { isHoleInOne: true, hioStatus: "approved" }), rules)).toBe(0);
    expect(closestToPin.qualifyingScore(shot("a", 0, { isHoleInOne: true, hioStatus: "rejected" }), rules)).toBeNull();
    expect(closestToPin.qualifyingScore(shot("a", 0, { isHoleInOne: true, hioStatus: "approved" }), { ...rules, hioCountsForWeekly: false })).toBeNull();
  });
});

describe("standings", () => {
  it("ranks by best valid shot, one row per player", () => {
    const s = computeStandings(
      [shot("a", 4260), shot("a", 1340), shot("b", 880), shot("c", 1240), shot("c", 9000), shot("d", 500, { onGreen: false })],
      people(["a", "b", "c", "d"]),
      closestToPin,
      rules,
      "equal_rank_split",
    );
    expect(s.map((x) => [x.customerId, x.rank, x.bestScore])).toEqual([
      ["b", 1, 880],
      ["c", 2, 1240],
      ["a", 3, 1340],
    ]);
  });
  it("uses standard competition ranking for ties (1,1,3)", () => {
    const s = computeStandings([shot("a", 500), shot("b", 500), shot("c", 600)], people(["a", "b", "c"]), closestToPin, rules, "equal_rank_split");
    expect(s.map((x) => x.rank)).toEqual([1, 1, 3]);
    expect(s[0].tiedWith).toBe(2);
  });
  it("millimetre differences are not ties even if they display the same at 2dp", () => {
    const s = computeStandings([shot("a", 1004), shot("b", 1001)], people(["a", "b"]), closestToPin, rules, "equal_rank_split");
    expect(s.map((x) => [x.customerId, x.rank])).toEqual([["b", 1], ["a", 2]]);
  });
  it("countback compares next-best shots", () => {
    const s = computeStandings([shot("a", 500), shot("a", 900), shot("b", 500), shot("b", 800)], people(["a", "b"]), closestToPin, rules, "countback");
    expect(s.map((x) => [x.customerId, x.rank])).toEqual([["b", 1], ["a", 2]]);
  });
  it("countback that is still level remains a tie", () => {
    const s = computeStandings([shot("a", 500), shot("b", 500)], people(["a", "b"]), closestToPin, rules, "countback");
    expect(s.map((x) => x.rank)).toEqual([1, 1]);
  });
  it("multiple hole-in-ones tie at zero regardless of which came first", () => {
    const early = shot("a", 0, { isHoleInOne: true, hioStatus: "approved", recordedAt: new Date(2026, 0, 1) });
    const late = shot("b", 0, { isHoleInOne: true, hioStatus: "approved", recordedAt: new Date(2026, 0, 5) });
    const s = computeStandings([late, early, shot("c", 10)], people(["a", "b", "c"]), closestToPin, rules, "equal_rank_split");
    expect(s.map((x) => x.rank)).toEqual([1, 1, 3]);
    expect(s[0].holeInOne && s[1].holeInOne).toBe(true);
  });
  it("flags playoff ties", () => {
    const s = computeStandings([shot("a", 500), shot("b", 500)], people(["a", "b"]), closestToPin, rules, "playoff");
    expect(s.every((x) => x.needsPlayoff)).toBe(true);
  });
  it("handles an empty leaderboard and a high-volume one", () => {
    expect(computeStandings([], people([]), closestToPin, rules, "equal_rank_split")).toEqual([]);
    const ids = Array.from({ length: 5000 }, (_, i) => `p${i}`);
    const shots = ids.flatMap((id, i) => [shot(id, 100 + ((i * 7919) % 20000)), shot(id, 30000)]);
    const t0 = performance.now();
    const s = computeStandings(shots, people(ids), closestToPin, rules, "equal_rank_split");
    expect(s).toHaveLength(5000);
    for (let i = 1; i < s.length; i++) expect(s[i].bestScore).toBeGreaterThanOrEqual(s[i - 1].bestScore);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe("prize allocation", () => {
  const prizes = [
    { rank: 1, amountPence: 10_000, description: "£100" },
    { rank: 2, amountPence: 5_000, description: "£50" },
  ];
  it("awards single winners", () => {
    const s = computeStandings([shot("a", 1), shot("b", 2), shot("c", 3)], people(["a", "b", "c"]), closestToPin, rules, "equal_rank_split");
    const { allocations } = allocatePrizes(s, prizes, "equal_rank_split");
    expect(allocations.map((a) => [a.customerId, a.amountPence])).toEqual([["a", 10_000], ["b", 5_000]]);
  });
  it("splits pooled prizes equally between tied players", () => {
    const s = computeStandings([shot("a", 1), shot("b", 1), shot("c", 3)], people(["a", "b", "c"]), closestToPin, rules, "equal_rank_split");
    const { allocations } = allocatePrizes(s, prizes, "equal_rank_split");
    expect(allocations.map((a) => [a.customerId, a.amountPence, a.splitWays])).toEqual([["a", 7_500, 2], ["b", 7_500, 2]]);
  });
  it("reports undistributable remainder pence instead of inventing a tie-break", () => {
    const s = computeStandings([shot("a", 1), shot("b", 1), shot("c", 1)], people(["a", "b", "c"]), closestToPin, rules, "equal_rank_split");
    const { allocations } = allocatePrizes(s, [{ rank: 1, amountPence: 10_000, description: "" }], "equal_rank_split");
    expect(allocations.every((a) => a.amountPence === 3333 && a.remainderPence === 1)).toBe(true);
  });
  it("requires an explicit playoff order under the playoff policy", () => {
    const s = computeStandings([shot("a", 1), shot("b", 1)], people(["a", "b"]), closestToPin, rules, "playoff");
    const unresolved = allocatePrizes(s, prizes, "playoff");
    expect(unresolved.unresolvedPlayoffs).toEqual([{ rank: 1, customerIds: ["a", "b"] }]);
    const resolved = allocatePrizes(s, prizes, "playoff", { 1: ["b", "a"] });
    expect(resolved.allocations.map((a) => [a.customerId, a.rank, a.amountPence])).toEqual([["b", 1, 10_000], ["a", 2, 5_000]]);
  });
});

describe("jackpot liability", () => {
  const base = { jackpotEnabled: true, jackpotAmountPence: 100_000, jackpotMaxWinners: 3, jackpotMaxPerPlayer: 1, jackpotMaxLiabilityPence: null, jackpotSubsequentQualify: true };
  const funding = { coverageLimitPence: 300_000, perEventLimitPence: null, validFrom: new Date(2020, 0, 1), validTo: new Date(2030, 0, 1), simulatorCoverageConfirmed: true };
  const win = { startsAt: new Date(2026, 0, 1), endsAt: new Date(2026, 0, 7) };
  it("computes maximum exposure", () => {
    expect(maxJackpotExposure(base)).toBe(300_000);
    expect(maxJackpotExposure({ ...base, jackpotMaxWinners: null })).toBe(Infinity);
    expect(maxJackpotExposure({ ...base, jackpotMaxWinners: null, jackpotMaxLiabilityPence: 200_000 })).toBe(200_000);
    expect(maxJackpotExposure({ ...base, jackpotSubsequentQualify: false, jackpotMaxWinners: null })).toBe(100_000);
    expect(maxJackpotExposure({ ...base, jackpotEnabled: false })).toBe(0);
  });
  it("blocks publication when exposure exceeds funding or is unbounded", () => {
    expect(validateJackpotFunding(base, funding, win)).toEqual([]);
    expect(validateJackpotFunding({ ...base, jackpotMaxWinners: 4 }, funding, win).join()).toMatch(/exceeds/);
    expect(validateJackpotFunding({ ...base, jackpotMaxWinners: null }, funding, win).join()).toMatch(/unbounded/);
    expect(validateJackpotFunding(base, null, win).join()).toMatch(/No jackpot funding/);
    expect(validateJackpotFunding(base, { ...funding, simulatorCoverageConfirmed: false }, win).join()).toMatch(/simulator/);
    expect(validateJackpotFunding(base, { ...funding, validTo: new Date(2026, 0, 3) }, win).join()).toMatch(/validity/);
  });
  it("evaluates eligibility against caps", () => {
    expect(jackpotEligibility({ config: base, approvedCount: 0, approvedForPlayer: 0, liabilityCommittedPence: 0 }).eligible).toBe(true);
    expect(jackpotEligibility({ config: base, approvedCount: 3, approvedForPlayer: 0, liabilityCommittedPence: 300_000 }).eligible).toBe(false);
    expect(jackpotEligibility({ config: base, approvedCount: 1, approvedForPlayer: 1, liabilityCommittedPence: 100_000 }).reason).toMatch(/per-player/);
    expect(jackpotEligibility({ config: { ...base, jackpotSubsequentQualify: false }, approvedCount: 1, approvedForPlayer: 0, liabilityCommittedPence: 0 }).eligible).toBe(false);
    expect(jackpotEligibility({ config: { ...base, jackpotMaxLiabilityPence: 150_000 }, approvedCount: 1, approvedForPlayer: 0, liabilityCommittedPence: 100_000 }).eligible).toBe(false);
  });
});
