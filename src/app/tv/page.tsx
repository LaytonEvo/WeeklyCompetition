import { TvDisplay } from "@/components/tv-display";
import { Logo } from "@/components/ui";
import { getSettings } from "@/lib/settings";
import { getFeaturedCompetition } from "@/server/competitions";
import { getPublicLeaderboard } from "@/server/leaderboard";
import { publicCompetitionView } from "@/server/public";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shop TV", robots: { index: false } };

/**
 * Stable, read-only URL for the in-store television: /tv (or /tv?location=ringwood).
 * Shows only public leaderboard data.
 */
export default async function TvPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const { location } = await searchParams;
  const s = await getSettings();
  const c = await getFeaturedCompetition(location);
  if (!c) {
    return (
      <div className="bg-turf flex h-dvh flex-col items-center justify-center text-white">
        <Logo light />
        <p className="mt-6 font-display text-5xl font-bold uppercase">Next challenge coming soon</p>
        <meta httpEquiv="refresh" content="300" />
      </div>
    );
  }
  const [board, view] = await Promise.all([getPublicLeaderboard(c, 10, false), publicCompetitionView(c)]);
  return (
    <TvDisplay
      initial={board}
      view={{ name: c.name, holeName: c.holeName, holeDistanceYards: c.holeDistanceYards, endsAt: view.endsAt, startsAt: view.startsAt, status: c.status, topPrize: view.topPrize, jackpot: view.jackpot, shotsPerRound: c.shotsPerRound, entryFee: view.entryFee }}
      rotateSeconds={s.leaderboard.tvRotateSeconds}
      business={s.brand.businessName}
      siteUrl={process.env.APP_URL ?? ""}
    />
  );
}
