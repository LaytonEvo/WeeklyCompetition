import { LiveLeaderboard } from "@/components/live";
import { getFeaturedCompetition } from "@/server/competitions";
import { getPublicLeaderboard } from "@/server/leaderboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Top 10", robots: { index: false } };

/**
 * Embeddable top-10 widget for the main Evolution Golf website:
 * <iframe src="https://<host>/widget/top10" width="100%" height="640" style="border:0"></iframe>
 */
export default async function Top10Widget() {
  const c = await getFeaturedCompetition();
  if (!c) return <p className="p-4 text-sm text-muted">Pin Hunters — next challenge coming soon.</p>;
  const board = await getPublicLeaderboard(c, 10, false);
  return (
    <div className="p-3">
      <div className="mb-3 flex items-baseline justify-between">
        <a href="/leaderboard" target="_top" className="font-display text-xl font-bold uppercase text-pine">Pin Hunters · Top 10</a>
        <span className="text-xs text-muted">{c.name}</span>
      </div>
      <LiveLeaderboard initial={board} limit={10} searchable={false} compact />
    </div>
  );
}
