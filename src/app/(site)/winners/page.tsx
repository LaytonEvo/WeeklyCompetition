import { Trophy } from "lucide-react";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatLocal } from "@/lib/time";
import { publicCompetitionsArchive, publicWinners } from "@/server/public";

export const dynamic = "force-dynamic";
export const metadata = { title: "Winners" };

export default async function WinnersPage() {
  const [winners, archive] = await Promise.all([publicWinners(52), publicCompetitionsArchive()]);
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <PageHeader eyebrow="Archive" title="Weekly winners" description="Every verified Pin Hunters champion. Results become official once our team has finalised the week." />
      {winners.length === 0 ? (
        <EmptyState title="No winners yet" icon={<Trophy className="size-8" />}>The first weekly champion will be crowned when week one is finalised.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {winners.map((w) => (
            <Link key={w.awardId} href={`/leaderboard/${w.slug}`}>
              <Card className="group flex items-center justify-between p-5 transition hover:shadow-[var(--shadow-lift)]">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">{w.competition}</div>
                  <div className="mt-1 text-lg font-semibold">{w.name}{w.shared ? " (shared)" : ""}</div>
                  <div className="text-sm text-muted">Week ending {formatLocal(new Date(w.endsAt), "d LLL yyyy")}</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-3xl font-bold text-pine tabular">{w.distance}</div>
                  {w.prize && <div className="text-sm font-semibold text-gold">{w.prize}</div>}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <h2 className="mt-14 text-sm font-semibold uppercase tracking-[0.14em] text-muted">All competitions</h2>
      <ul className="mt-3 divide-y divide-line rounded-[var(--radius-card)] ring-1 ring-line">
        {archive.map((c) => (
          <li key={c.id}>
            <Link href={`/leaderboard/${c.slug}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-cream">
              <span className="font-medium">{c.name}</span>
              <span className="text-sm text-muted">{formatLocal(c.startsAt, "d LLL")} – {formatLocal(c.endsAt, "d LLL yyyy")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
