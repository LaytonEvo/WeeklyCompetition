import { Flag, Target, Timer, Trophy } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { Alert, Card, Eyebrow, LinkButton } from "@/components/ui";
import { DRAFT_BANNER, DRAFT_RULES_MD } from "@/lib/legal-drafts";
import { getSettings } from "@/lib/settings";
import { formatLocal } from "@/lib/time";
import { getCompetitionBySlug, PUBLIC_STATUSES } from "@/server/competitions";
import { publicCompetitionView } from "@/server/public";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = await getCompetitionBySlug((await params).slug);
  return c ? { title: c.name, description: c.description || `Closest-to-the-pin challenge at Evolution Golf, Ringwood.` } : {};
}

export default async function CompetitionPage({ params }: { params: Promise<{ slug: string }> }) {
  const c = await getCompetitionBySlug((await params).slug);
  if (!c || !PUBLIC_STATUSES.includes(c.status)) notFound();
  const [view, s] = await Promise.all([publicCompetitionView(c), getSettings()]);
  const rules = c.rulesMarkdown || DRAFT_RULES_MD;
  const isDraftText = /DRAFT/i.test(rules);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Eyebrow>{s.brand.competitionName}</Eyebrow>
      <h1 className="mt-2 font-display text-5xl font-bold uppercase text-ink">{c.name}</h1>
      {c.description && <p className="mt-3 max-w-2xl text-lg text-ink-soft">{c.description}</p>}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5"><Timer className="size-5 text-green" /><div className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Runs</div><div className="mt-1 font-semibold">{formatLocal(c.startsAt, "ccc d LLL HH:mm")} – {formatLocal(c.endsAt, "ccc d LLL HH:mm")}</div></Card>
        <Card className="p-5"><Flag className="size-5 text-green" /><div className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Featured hole</div><div className="mt-1 font-semibold">{c.holeName || "TBC"}{c.holeDistanceYards ? ` · ${c.holeDistanceYards} yds` : ""}</div></Card>
        <Card className="p-5"><Target className="size-5 text-green" /><div className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Format</div><div className="mt-1 font-semibold">{c.shotsPerRound} shots per round{view.entryFee ? ` · ${view.entryFee}` : ""}</div></Card>
        <Card className="p-5"><Trophy className="size-5 text-gold" /><div className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Prizes</div><div className="mt-1 font-semibold">{view.prizes.length ? view.prizes.map((p) => `${ordinal(p.rank)}: ${p.label}`).join(" · ") : "To be confirmed"}{view.jackpot ? ` · Ace: ${view.jackpot}` : ""}</div></Card>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {view.canEnterOnline ? <LinkButton href={`/enter?c=${c.slug}`} size="lg">Enter the Challenge</LinkButton> : <span className="rounded-full bg-cream px-5 py-3 text-sm font-semibold text-muted ring-1 ring-line">{view.enterOnlineBlockedReason ?? "Entries closed"}</span>}
        <LinkButton href={`/leaderboard/${c.slug}`} variant="secondary" size="lg">Leaderboard</LinkButton>
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_320px]">
        <article>
          {isDraftText && <Alert tone="warn" title="Draft rules">{DRAFT_BANNER}</Alert>}
          <Markdown source={rules} />
        </article>
        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="font-semibold">Scoring at a glance</h2>
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">
              <li>Your single closest valid shot counts.</li>
              <li>{c.requireOnGreen ? "The ball must finish on the green." : "Shots finishing off the green also count."}</li>
              {c.maxRoundsPerCustomer && <li>Up to {c.maxRoundsPerCustomer} rounds per player.</li>}
              <li>Distances recorded to the millimetre.</li>
            </ul>
          </Card>
          <Card className="p-5">
            <h2 className="font-semibold">Ties</h2>
            <p className="mt-2 text-sm text-ink-soft">{c.tiePolicyText || "Tie procedure to be published before opening."}</p>
          </Card>
          {c.simulatorSettings && (
            <Card className="p-5">
              <h2 className="font-semibold">Simulator settings</h2>
              <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">{c.simulatorSettings}</p>
            </Card>
          )}
          {c.eligibility && (
            <Card className="p-5">
              <h2 className="font-semibold">Eligibility</h2>
              <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">{c.eligibility}</p>
            </Card>
          )}
          <p className="text-xs text-muted">Terms version {c.termsVersion}</p>
        </aside>
      </div>
    </div>
  );
}

function ordinal(n: number) {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}
