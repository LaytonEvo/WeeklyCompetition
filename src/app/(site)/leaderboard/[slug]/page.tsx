import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LeaderboardView } from "@/components/leaderboard-view";
import { getCompetitionBySlug, PUBLIC_STATUSES } from "@/server/competitions";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = await getCompetitionBySlug((await params).slug);
  return c ? { title: `${c.name} leaderboard`, description: `Live closest-to-the-pin leaderboard for ${c.name} at Evolution Golf.` } : {};
}

export default async function LeaderboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const c = await getCompetitionBySlug((await params).slug);
  if (!c || !PUBLIC_STATUSES.includes(c.status)) notFound();
  return <LeaderboardView slug={c.slug} />;
}

