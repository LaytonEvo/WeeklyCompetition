import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { competitions, hioClaims, rounds } from "@/db/schema";
import { stripeConfigured } from "@/lib/env";
import { formatMm } from "@/lib/distance";
import { formatPence } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { getFeaturedCompetition, getPrizes, PUBLIC_STATUSES, type Competition } from "./competitions";
import { publicDisplayName } from "./customers";
import { hallOfFameHoleInOnes } from "./hio";
import { getPublicLeaderboard } from "./leaderboard";
import { isLaunchApproved } from "./legal";
import { winnersArchive } from "./results";

export interface PublicCompetitionView {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: Competition["status"];
  startsAt: string;
  endsAt: string;
  entryMode: "paid" | "free";
  shotsPerRound: number;
  holeName: string;
  holeDistanceYards: number | null;
  requireOnGreen: boolean;
  /** Only populated when the launch gate is approved — no prize/price claims otherwise. */
  approved: boolean;
  entryFee: string | null;
  prizes: { rank: number; label: string }[];
  topPrize: string | null;
  jackpot: string | null;
  canEnterOnline: boolean;
  enterOnlineBlockedReason: string | null;
}

export async function publicCompetitionView(c: Competition): Promise<PublicCompetitionView> {
  const approved = await isLaunchApproved(c);
  const prizes = approved ? await getPrizes(c.id) : [];
  const accepting = ["scheduled", "open"].includes(c.status) && c.endsAt > new Date();
  const paidNeedsStripe = c.entryMode === "paid" && !stripeConfigured();
  const canEnterOnline = approved && accepting && !paidNeedsStripe;
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    status: c.status,
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    entryMode: c.entryMode,
    shotsPerRound: c.shotsPerRound,
    holeName: c.holeName,
    holeDistanceYards: c.holeDistanceYards,
    requireOnGreen: c.requireOnGreen,
    approved,
    entryFee: approved ? (c.entryMode === "free" ? "Free" : formatPence(c.entryFeePence)) : null,
    prizes: prizes.map((p) => ({ rank: p.rank, label: p.amountPence > 0 ? formatPence(p.amountPence, { compact: true }) : p.description })),
    topPrize: prizes[0] ? (prizes[0].amountPence > 0 ? formatPence(prizes[0].amountPence, { compact: true }) : prizes[0].description) : null,
    jackpot: approved && c.jackpotEnabled && c.jackpotAmountPence > 0 ? formatPence(c.jackpotAmountPence, { compact: true }) : null,
    canEnterOnline,
    enterOnlineBlockedReason: !approved ? "Entries open soon" : !accepting ? "Entries closed" : paidNeedsStripe ? "Enter in store" : null,
  };
}

export async function getHomeData() {
  const settings = await getSettings();
  const featured = await getFeaturedCompetition();
  const view = featured ? await publicCompetitionView(featured) : null;
  const board = featured ? await getPublicLeaderboard(featured, 10, settings.leaderboard.showRoundsCount) : null;
  const roundsCount = featured
    ? (await db.select({ n: sql<number>`count(*)::int` }).from(rounds).where(and(eq(rounds.competitionId, featured.id), eq(rounds.status, "completed"))))[0].n
    : 0;
  return { settings, featured, view, board, roundsCount, winners: await publicWinners(6), hallOfFame: await publicHallOfFame(6) };
}

export async function publicWinners(limit = 24) {
  const rows = await winnersArchive(limit * 3);
  const out = [];
  for (const r of rows) {
    if (r.award.kind !== "weekly" || r.award.rank !== 1) continue;
    const approved = await isLaunchApproved(r.competition);
    out.push({
      awardId: r.award.id,
      competition: r.competition.name,
      slug: r.competition.slug,
      endsAt: r.competition.endsAt.toISOString(),
      name: publicDisplayName(r.customer),
      distance: r.award.distanceMm !== null ? formatMm(r.award.distanceMm) : "—",
      prize: approved && r.award.prizeAmountPence > 0 ? formatPence(r.award.prizeAmountPence, { compact: true }) : null,
      shared: r.award.splitWays > 1,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function publicHallOfFame(limit = 24) {
  const hio = await hallOfFameHoleInOnes();
  // Best-ever closest shots across finalised competitions (excluding hole-in-ones).
  const closest = await db.execute<{ distance_mm: number; first_name: string; last_name: string; id: string; display_name_style: "first_initial" | "full" | "initials" | "anonymous"; publication_consent: boolean; anonymised_at: Date | null; name: string; slug: string }>(sql`
    select distinct on (c.id) s.distance_mm, cu.id, cu.first_name, cu.last_name, cu.display_name_style, cu.publication_consent, cu.anonymised_at, c.name, c.slug
    from shots s join rounds r on r.id = s.round_id join customers cu on cu.id = r.customer_id join competitions c on c.id = r.competition_id
    where s.status = 'active' and s.valid and s.on_green and not s.is_hole_in_one and r.status = 'completed' and c.status in ('finalised','archived')
    order by c.id, s.distance_mm asc`);
  const best = closest.rows
    .sort((a, b) => a.distance_mm - b.distance_mm)
    .slice(0, 5)
    .map((r) => ({
      name: publicDisplayName({ id: r.id, firstName: r.first_name, lastName: r.last_name, displayNameStyle: r.display_name_style, publicationConsent: r.publication_consent, anonymisedAt: r.anonymised_at }),
      distance: formatMm(r.distance_mm),
      competition: r.name,
      slug: r.slug,
    }));
  return {
    holeInOnes: hio.slice(0, limit).map((h) => ({
      claimId: h.claim.id,
      // Hall of Fame publication requires explicit publication consent; otherwise anonymised.
      name: h.customer.publicationConsent ? publicDisplayName(h.customer) : "Anonymous player",
      competition: h.competition.name,
      slug: h.competition.slug,
      date: h.shot.recordedAt.toISOString(),
      hole: h.competition.holeName,
    })),
    closest: best,
  };
}

export async function publicCompetitionsArchive() {
  return db
    .select()
    .from(competitions)
    .where(inArray(competitions.status, PUBLIC_STATUSES))
    .orderBy(desc(competitions.startsAt))
    .limit(60);
}

export async function pendingHioCount(competitionId: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(hioClaims).where(and(eq(hioClaims.competitionId, competitionId), eq(hioClaims.status, "pending_review")));
  return n;
}
