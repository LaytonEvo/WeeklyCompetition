import { ArrowRight, CalendarCheck, Crosshair, Flag, MapPin, Trophy, UserPlus } from "lucide-react";
import Link from "next/link";
import { Countdown, LiveLeaderboard } from "@/components/live";
import { Card, Eyebrow, LinkButton, buttonClass } from "@/components/ui";
import { formatLocal } from "@/lib/time";
import { getHomeData } from "@/server/public";
import { FittingPromo } from "@/components/fitting-promo";

export const dynamic = "force-dynamic";

const steps = [
  { icon: CalendarCheck, title: "Choose a session", text: "Pick an available simulator slot that fits around our fitting appointments — or just walk in." },
  { icon: UserPlus, title: "Register & enter", text: "Quick sign-up. No passwords — we email you a secure link for your history and results." },
  { icon: MapPin, title: "Take five shots", text: "Visit Evolution Golf in Ringwood and hit five shots at this week's featured hole." },
  { icon: Crosshair, title: "Best shot counts", text: "Staff verify your shots and your closest valid shot goes straight onto the live leaderboard." },
  { icon: Trophy, title: "Win the week", text: "Closest to the pin when the week closes takes the prize. Come back to improve your score." },
];

export default async function HomePage() {
  const { settings, view, board, roundsCount, winners, hallOfFame } = await getHomeData();
  const leader = board?.rows[0];
  const open = view?.status === "open";

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-line/70">
        <div className="contour pointer-events-none absolute -right-40 -top-40 size-[720px] opacity-70" aria-hidden />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:gap-14 lg:pb-24 lg:pt-20">
          <div className="animate-rise">
            <Eyebrow>{settings.brand.businessName} · Ringwood</Eyebrow>
            <h1 className="mt-4 font-display text-[clamp(3.5rem,10vw,7.5rem)] font-extrabold uppercase leading-[0.86] tracking-[-0.01em] text-pine">
              Pin
              <br />
              Hunters
            </h1>
            <p className="mt-6 max-w-xl font-display text-2xl font-semibold uppercase tracking-wide text-ink sm:text-3xl">{settings.brand.tagline}</p>
            <p className="mt-4 max-w-lg text-lg leading-relaxed text-ink-soft">
              Take on {settings.brand.businessName}&apos;s weekly closest-to-the-pin challenge at our Ringwood store.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {view?.canEnterOnline ? (
                <LinkButton href={`/enter?c=${view.slug}`} size="lg">
                  Enter the Challenge <ArrowRight className="size-4" />
                </LinkButton>
              ) : (
                <span className={buttonClass("secondary", "lg", "cursor-default")} aria-disabled>
                  {view?.enterOnlineBlockedReason ?? "Entries opening soon"}
                </span>
              )}
              <LinkButton href="/leaderboard" variant="secondary" size="lg">
                View Leaderboard
              </LinkButton>
            </div>
            {view && (
              <dl className="mt-10 grid max-w-xl grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
                {[
                  ["Entry", view.entryFee ?? "TBC"],
                  ["Shots", String(view.shotsPerRound)],
                  ["Weekly prize", view.topPrize ?? "TBC"],
                  ["Ace jackpot", view.jackpot ?? "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{k}</dt>
                    <dd className="mt-1 font-display text-3xl font-bold text-ink tabular">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {/* Live competition card */}
          <div className="animate-rise lg:pt-6" style={{ animationDelay: "120ms" }}>
            {view ? (
              <div className="bg-turf relative overflow-hidden rounded-[28px] p-6 text-white shadow-[var(--shadow-lift)] sm:p-8">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]">
                    {open ? <span className="size-2 rounded-full bg-[#5ee0a5] animate-pulse-soft" /> : null}
                    {open ? "Live now" : view.status === "scheduled" ? "Starts soon" : "Results"}
                  </span>
                  <span className="text-xs text-white/70">{board?.entrants ?? 0} players · {roundsCount} rounds</span>
                </div>
                <h2 className="mt-5 font-display text-3xl font-bold uppercase tracking-wide">{view.name}</h2>
                <div className="mt-1 flex items-center gap-2 text-sm text-white/75">
                  <Flag className="size-4 text-gold" />
                  {view.holeName || "Featured hole"}
                  {view.holeDistanceYards ? ` · ${view.holeDistanceYards} yds` : ""}
                </div>
                <div className="mt-8 grid grid-cols-2 gap-4">
                  <div className="rounded-2xl bg-white/8 p-4 ring-1 ring-white/10">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">Closest shot</div>
                    <div className="mt-1 font-display text-4xl font-bold tabular text-white">{leader?.best ?? "—"}</div>
                    <div className="mt-1 truncate text-sm text-gold">{leader ? `${leader.name}${leader.tied ? " (tied)" : ""}` : "No scores yet"}</div>
                  </div>
                  <div className="rounded-2xl bg-white/8 p-4 ring-1 ring-white/10">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">{open ? "Time remaining" : view.status === "scheduled" ? "Opens in" : "Closed"}</div>
                    <div className="mt-1 font-display text-4xl font-bold">
                      <Countdown to={open ? view.endsAt : view.startsAt} closedText="—" />
                    </div>
                    <div className="mt-1 text-sm text-white/70">{open ? `Closes ${formatLocal(new Date(view.endsAt), "ccc HH:mm")}` : formatLocal(new Date(view.startsAt), "ccc d LLL HH:mm")}</div>
                  </div>
                </div>
                {(view.topPrize || view.jackpot) && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-gold/15 p-4 ring-1 ring-gold/30">
                    <Trophy className="size-5 text-gold" />
                    <span className="text-sm">
                      {view.topPrize && <strong className="font-semibold">{view.topPrize} weekly prize</strong>}
                      {view.topPrize && view.jackpot && " · "}
                      {view.jackpot && <strong className="font-semibold text-gold">{view.jackpot} hole-in-one jackpot</strong>}
                    </span>
                  </div>
                )}
                <Link href={`/competitions/${view.slug}`} className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-white/85 hover:text-white">
                  Rules & prize details <ArrowRight className="size-4" />
                </Link>
              </div>
            ) : (
              <Card className="p-8">
                <Eyebrow>Coming soon</Eyebrow>
                <h2 className="mt-3 font-display text-3xl font-bold uppercase text-pine">The next challenge is being set up</h2>
                <p className="mt-2 text-muted">Check back shortly or ask in store for this week&apos;s featured hole.</p>
              </Card>
            )}
          </div>
        </div>
      </section>

      {/* LEADERBOARD */}
      {board && (
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <Eyebrow>This week</Eyebrow>
              <h2 className="mt-2 font-display text-4xl font-bold uppercase text-ink">Top 10</h2>
            </div>
            <LinkButton href="/leaderboard" variant="secondary">
              Full leaderboard <ArrowRight className="size-4" />
            </LinkButton>
          </div>
          <LiveLeaderboard initial={board} limit={10} searchable={false} />
        </section>
      )}

      {/* HOW IT WORKS */}
      <section className="border-y border-line/70 bg-cream">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-2 font-display text-4xl font-bold uppercase text-ink">Five steps to the top of the board</h2>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {steps.map((s, i) => (
              <li key={s.title} className="relative rounded-[var(--radius-card)] bg-white p-5 ring-1 ring-line/70">
                <div className="flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-full bg-green-50 text-green">
                    <s.icon className="size-5" />
                  </span>
                  <span className="font-display text-4xl font-bold text-line">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="mt-4 font-semibold text-ink">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
          {view && (
            <p className="mt-6 text-sm text-muted">
              {view.requireOnGreen ? "Shots must finish on the green to count. " : ""}Full details in the <Link href="/rules" className="font-medium text-green underline-offset-2 hover:underline">competition rules</Link>.
            </p>
          )}
        </div>
      </section>

      {/* WINNERS + HALL OF FAME */}
      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
        <div>
          <div className="flex items-end justify-between">
            <div>
              <Eyebrow>Recent winners</Eyebrow>
              <h2 className="mt-2 font-display text-3xl font-bold uppercase">Weekly champions</h2>
            </div>
            <Link href="/winners" className="text-sm font-semibold text-green hover:underline">All winners</Link>
          </div>
          <div className="mt-6 space-y-3">
            {winners.length === 0 && <p className="rounded-2xl bg-cream p-6 text-sm text-muted">Our first weekly champion will appear here.</p>}
            {winners.map((w) => (
              <Card key={w.awardId} className="flex items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-4">
                  <span className="flex size-11 items-center justify-center rounded-full bg-gold text-white"><Trophy className="size-5" /></span>
                  <div>
                    <div className="font-semibold">{w.name}{w.shared && <span className="ml-2 text-xs font-medium text-muted">(shared)</span>}</div>
                    <div className="text-sm text-muted">{w.competition}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-2xl font-bold text-pine tabular">{w.distance}</div>
                  {w.prize && <div className="text-xs font-semibold text-gold">{w.prize}</div>}
                </div>
              </Card>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-end justify-between">
            <div>
              <Eyebrow>Hall of Fame</Eyebrow>
              <h2 className="mt-2 font-display text-3xl font-bold uppercase">Legendary shots</h2>
            </div>
            <Link href="/hall-of-fame" className="text-sm font-semibold text-green hover:underline">View all</Link>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {hallOfFame.holeInOnes.slice(0, 2).map((h) => (
              <div key={h.claimId} className="rounded-[var(--radius-card)] bg-pine p-5 text-white">
                <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">Hole-in-one</div>
                <div className="mt-2 font-display text-2xl font-bold">{h.name}</div>
                <div className="mt-1 text-sm text-white/70">{h.competition}</div>
              </div>
            ))}
            {hallOfFame.closest.slice(0, 4).map((c, i) => (
              <Card key={i} className="p-5">
                <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">Closest · {c.competition}</div>
                <div className="mt-2 font-display text-3xl font-bold text-pine tabular">{c.distance}</div>
                <div className="text-sm text-ink-soft">{c.name}</div>
              </Card>
            ))}
            {hallOfFame.holeInOnes.length === 0 && hallOfFame.closest.length === 0 && (
              <p className="rounded-2xl bg-cream p-6 text-sm text-muted sm:col-span-2">Records will be set here once our first competitions are finalised.</p>
            )}
          </div>
        </div>
      </section>

      {/* FITTING */}
      <FittingPromo url={settings.links.fittingBookingUrl} business={settings.brand.businessName} context="home" competitionId={view?.id} />
    </>
  );
}
