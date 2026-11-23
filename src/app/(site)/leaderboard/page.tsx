import { Trophy } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { getFeaturedCompetition } from "@/server/competitions";
import { LeaderboardView } from "@/components/leaderboard-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live leaderboard" };

export default async function CurrentLeaderboard() {
  const c = await getFeaturedCompetition();
  if (!c)
    return (
      <div className="mx-auto max-w-3xl px-4 py-20">
        <EmptyState title="No competition running yet" icon={<Trophy className="size-8" />}>
          The leaderboard appears here as soon as the first Pin Hunters week opens.
        </EmptyState>
      </div>
    );
  return <LeaderboardView slug={c.slug} />;
}
