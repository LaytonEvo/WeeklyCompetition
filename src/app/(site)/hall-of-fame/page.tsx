import { Sparkles } from "lucide-react";
import Link from "next/link";
import { Card, EmptyState, Eyebrow, PageHeader } from "@/components/ui";
import { formatLocal } from "@/lib/time";
import { publicHallOfFame } from "@/server/public";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hall of Fame" };

export default async function HallOfFamePage() {
  const { holeInOnes, closest } = await publicHallOfFame(100);
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <PageHeader eyebrow="Pin Hunters" title="Hall of Fame" description="Verified hole-in-ones and the closest shots ever recorded in finalised competitions." />
      <section>
        <Eyebrow>Hole-in-ones</Eyebrow>
        {holeInOnes.length === 0 ? (
          <div className="mt-4"><EmptyState title="Still waiting for the first ace" icon={<Sparkles className="size-8" />}>Every verified hole-in-one is recorded here permanently.</EmptyState></div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {holeInOnes.map((h) => (
              <div key={h.claimId} className="bg-turf rounded-[var(--radius-card)] p-6 text-white">
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-gold">Hole-in-one</div>
                <div className="mt-3 font-display text-3xl font-bold">{h.name}</div>
                <div className="mt-1 text-sm text-white/75">{h.hole || h.competition}</div>
                <div className="mt-4 text-xs text-white/60">{formatLocal(new Date(h.date), "d LLLL yyyy")} · <Link className="underline" href={`/leaderboard/${h.slug}`}>{h.competition}</Link></div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="mt-14">
        <Eyebrow>Closest ever</Eyebrow>
        {closest.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Records appear once competitions are finalised.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {closest.map((c, i) => (
              <li key={i}>
                <Card className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-4">
                    <span className="font-display text-3xl font-bold text-line">{i + 1}</span>
                    <div><div className="font-semibold">{c.name}</div><div className="text-sm text-muted">{c.competition}</div></div>
                  </div>
                  <div className="font-display text-3xl font-bold text-pine tabular">{c.distance}</div>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
