import { formatMm } from "@/lib/distance";

/**
 * Scoring strategies make the competition engine format-agnostic. Customer,
 * booking, payment, round and winner systems only ever deal in an abstract
 * integer "score" with a direction. Add a new format by adding a strategy
 * here and enabling it in FORMAT_AVAILABILITY.
 */
export type ScoreDirection = "asc" | "desc";

export interface ScoringShot {
  shotId: string;
  roundId: string;
  customerId: string;
  distanceMm: number | null;
  valid: boolean;
  onGreen: boolean;
  isHoleInOne: boolean;
  hioStatus: "pending_review" | "approved" | "rejected" | null;
  recordedAt: Date;
}

export interface ScoringRules {
  requireOnGreen: boolean;
  hioCountsForWeekly: boolean;
}

export interface ScoringStrategy {
  format: "closest_to_pin" | "longest_drive" | "putting_challenge";
  label: string;
  metricLabel: string;
  direction: ScoreDirection;
  /** Returns the shot's score if it qualifies for ranking, else null. */
  qualifyingScore(shot: ScoringShot, rules: ScoringRules): number | null;
  formatScore(score: number | null, precision?: 2 | 3): string;
}

export const closestToPin: ScoringStrategy = {
  format: "closest_to_pin",
  label: "Closest to the pin",
  metricLabel: "Distance to hole",
  direction: "asc",
  qualifyingScore(shot, rules) {
    if (!shot.valid) return null;
    if (shot.isHoleInOne) {
      // A hole-in-one only counts once verified, and scores exactly zero.
      if (shot.hioStatus !== "approved") return null;
      if (!rules.hioCountsForWeekly) return null;
      return 0;
    }
    if (shot.distanceMm === null) return null;
    if (rules.requireOnGreen && !shot.onGreen) return null;
    return shot.distanceMm;
  },
  formatScore: (s, p = 2) => formatMm(s, p),
};

/** Implemented for architecture validation; not enabled for the initial release. */
export const longestDrive: ScoringStrategy = {
  format: "longest_drive",
  label: "Longest drive",
  metricLabel: "Carry distance",
  direction: "desc",
  qualifyingScore(shot) {
    if (!shot.valid || shot.distanceMm === null) return null;
    return shot.distanceMm;
  },
  formatScore: (s, p = 2) => formatMm(s, p),
};

export const STRATEGIES: Record<ScoringStrategy["format"], ScoringStrategy | undefined> = {
  closest_to_pin: closestToPin,
  longest_drive: longestDrive,
  putting_challenge: undefined,
};

/** Formats that can be selected when creating a competition. */
export const FORMAT_AVAILABILITY: Record<ScoringStrategy["format"], boolean> = {
  closest_to_pin: true,
  longest_drive: false,
  putting_challenge: false,
};

export function strategyFor(format: ScoringStrategy["format"]): ScoringStrategy {
  const s = STRATEGIES[format];
  if (!s) throw new Error(`Scoring format "${format}" is not implemented`);
  return s;
}
