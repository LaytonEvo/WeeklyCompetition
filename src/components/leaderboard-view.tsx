import Link from "next/link";
import { Countdown, LiveLeaderboard } from "@/components/live";
import { Badge, Card, LinkButton } from "@/components/ui";
import { getSettings } from "@/lib/settings";
import { formatLocal } from "@/lib/time";
import { getCompetitionBySlug } from "@/server/competitions";
import { getPublicLeaderboard } from "@/server/leaderboard";
import { pendingHioCount, publicCompetitionsArchive, publicCompetitionView } from "@/server/public";

export async function LeaderboardView({ slug }: { slug: string }) {
  const c = (await getCompetitionBySlug(slug))!;
  const s = await getSettings();
  const [board, view, archive, pending] = await Promise.all([
    getPublicLeaderboard(c, s.leaderboard.publicTopN, s.leaderboard.showRoundsCount),
    publicCompetitionView(c),
    publicCompetitionsArchive(),
    pendingHioCount(c.id),
  ]);
  const statusLabel: Record<string, string> = {
    open: "Live",
    scheduled: "Opens soon",
    closed: "Closed — verifying",
    awaiting_verification: "Closed — verifying",
    finalised: "Final results",
    archived: "Final results",
  };
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={c.status === "open" ? "green" : c.status === "finalised" ? "gold" : "neutral"}>{statusLabel[c.status] ?? c.status}</Badge>
            {c.holeName && <span className="text-sm text-muted">{c.holeName}{c.holeDistanceYards ? ` · ${c.holeDistanceYards} yds` : ""}</span>}
          </div>
          <h1 className="mt-3 font-display text-4xl font-bold uppercase text-ink sm:text-5xl">{c.name}</h1>
          <p className="mt-1 text-muted">
            {formatLocal(c.startsAt, "ccc d LLL")} – {formatLocal(c.endsAt, "ccc d LLL, HH:mm")}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {c.status === "open" && (
            <Card className="px-5 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Closes in</div>
              <Countdown to={c.endsAt.toISOString()} className="font-display text-2xl font-bold text-pine" />
            </Card>
          )}
          {view.topPrize && (
            <Card className="px-5 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Weekly prize</div>
              <div className="font-display text-2xl font-bold text-gold">{view.topPrize}</div>
            </Card>
          )}
        </div>
      </div>
      {["closed", "awaiting_verification"].includes(c.status) && (
        <p className="mb-4 rounded-2xl bg-warn-50 px-4 py-3 text-sm text-[#6d3f06] ring-1 ring-warn/20">
          Entries have closed. Results are provisional until verified by our team{pending ? ` (${pending} hole-in-one claim${pending > 1 ? "s" : ""} under review)` : ""}.
        </p>
      )}
      <LiveLeaderboard initial={board} />
      <p className="mt-4 text-xs text-muted">
        Distances are measured to the millimetre; where two players look level at two decimal places, three are shown. Ties are resolved under the published rule: {c.tiePolicyText || "see rules"}.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        {view.canEnterOnline && <LinkButton href={`/enter?c=${c.slug}`}>Book a session</LinkButton>}
        <LinkButton href={`/competitions/${c.slug}`} variant="secondary">Rules & prizes</LinkButton>
      </div>
      {archive.length > 1 && (
        <section className="mt-14">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">Other weeks</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {archive.filter((a) => a.id !== c.id).slice(0, 16).map((a) => (
              <Link key={a.id} href={`/leaderboard/${a.slug}`} className="rounded-full bg-cream px-3.5 py-1.5 text-sm text-ink-soft ring-1 ring-line hover:text-pine">
                {a.name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
