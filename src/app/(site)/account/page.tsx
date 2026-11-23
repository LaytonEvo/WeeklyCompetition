import { Download, Share2, Trophy } from "lucide-react";
import Link from "next/link";
import { cancelMyBooking, logoutCustomer, updatePreferences } from "@/app/actions/public";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Card, CardHeader, Checkbox, EmptyState, Field, LinkButton, PageHeader, Select, Stat } from "@/components/ui";
import { requireCustomerPage } from "@/lib/auth/session";
import { formatMm } from "@/lib/distance";
import { formatPence } from "@/lib/money";
import { formatLocal } from "@/lib/time";
import { accountOverview } from "@/server/account";

export const dynamic = "force-dynamic";
export const metadata = { title: "My account", robots: { index: false } };

const prizeTone = { provisional: "neutral", verified: "green", awaiting_claim: "gold", claimed: "blue", fulfilled: "green", expired: "neutral", cancelled: "danger" } as const;

export default async function AccountPage() {
  const me = await requireCustomerPage();
  const { me: c, upcoming, history, prizes, stats } = await accountOverview(me.id);
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow="My Pin Hunters"
        title={`Hi ${c.firstName}`}
        actions={
          <form action={logoutCustomer}>
            <SubmitButton variant="secondary" pendingText="Signing out…">Sign out</SubmitButton>
          </form>
        }
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Personal best" value={stats.personalBest !== null ? formatMm(stats.personalBest) : "—"} tone="green" />
        <Stat label="Rounds" value={stats.rounds} />
        <Stat label="Shots" value={stats.shots} />
        <Stat label="Competitions" value={stats.competitions} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Upcoming sessions" action={<LinkButton href="/enter" size="sm">Book</LinkButton>} />
            {upcoming.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">No upcoming sessions.</p>
            ) : (
              <ul className="divide-y divide-line">
                {upcoming.map(({ b, c: comp }) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div>
                      <div className="font-semibold">{formatLocal(b.startsAt, "cccc d LLL, HH:mm")}</div>
                      <div className="text-sm text-muted">{comp.name} · {b.roundsQty} round{b.roundsQty > 1 ? "s" : ""} · code <span className="font-mono">{b.checkinCode}</span></div>
                    </div>
                    <div className="flex items-center gap-2">
                      <LinkButton href={`/booking/${b.checkinCode}`} variant="secondary" size="sm">QR code</LinkButton>
                      {b.status === "confirmed" && (
                        <ActionForm action={cancelMyBooking}>
                          <input type="hidden" name="bookingId" value={b.id} />
                          <SubmitButton variant="ghost" size="sm" confirm="Cancel this booking?">Cancel</SubmitButton>
                        </ActionForm>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Competition history" />
            {history.length === 0 ? (
              <div className="p-5"><EmptyState title="No rounds yet">Your results will appear here after your first round.</EmptyState></div>
            ) : (
              <ul className="divide-y divide-line">
                {history.map((h) => (
                  <li key={h.competition.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/leaderboard/${h.competition.slug}`} className="font-semibold hover:text-pine">{h.competition.name}</Link>
                      <div className="flex items-center gap-3">
                        {h.position && <Badge tone={h.position.rank <= 3 ? "gold" : "neutral"}>{h.position.tied ? "T" : ""}{h.position.rank} of {h.position.of}</Badge>}
                        <span className="font-display text-xl font-bold text-pine tabular">{h.best !== null ? formatMm(h.best) : "—"}</span>
                      </div>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {h.rounds.map(({ round, shots, best }) => (
                        <div key={round.id} className="flex flex-wrap items-center gap-2 text-sm text-muted">
                          <span className="w-24">{formatLocal(round.startedAt ?? round.createdAt, "ccc d LLL")}</span>
                          {shots.length ? shots.map((s) => <span key={s.id} className={`rounded-md px-1.5 py-0.5 tabular ${s.valid && (s.onGreen || !h.competition.requireOnGreen) ? "bg-green-50 text-pine" : "bg-zinc-100 line-through"}`}>{s.isHoleInOne ? "ACE" : s.distanceMm !== null ? formatMm(s.distanceMm) : "—"}</span>) : <span className="italic">{round.status.replace("_", " ")}</span>}
                          {best !== null && round.status === "completed" && (
                            <a href={`/share/result/${round.id}?format=story`} className="ml-auto inline-flex items-center gap-1 text-green hover:underline"><Share2 className="size-3.5" /> Share card</a>
                          )}
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Prizes" />
            {prizes.length === 0 ? (
              <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted"><Trophy className="size-4 text-gold" /> No prizes yet — keep hunting.</p>
            ) : (
              <ul className="divide-y divide-line">
                {prizes.map(({ a, c: comp }) => (
                  <li key={a.id} className="px-5 py-4 text-sm">
                    <div className="flex justify-between"><span className="font-semibold">{a.kind === "jackpot" ? "Hole-in-one jackpot" : `Position ${a.rank}`}</span><Badge tone={prizeTone[a.status]}>{a.status.replace("_", " ")}</Badge></div>
                    <div className="mt-1 text-muted">{comp.name} · {a.prizeAmountPence ? formatPence(a.prizeAmountPence) : a.prizeDescription}</div>
                    {a.status === "awaiting_claim" && a.claimDeadline && <div className="mt-1 text-xs text-gold">Claim by {formatLocal(a.claimDeadline, "d LLL yyyy")}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Preferences" description="Marketing is separate from your entry and always optional." />
            <div className="p-5">
              <ActionForm action={updatePreferences}>
                <Field label="Name on leaderboards" htmlFor="dns">
                  <Select id="dns" name="displayNameStyle" defaultValue={c.displayNameStyle}>
                    <option value="first_initial">{c.firstName} {c.lastName.charAt(0)}.</option>
                    <option value="initials">{c.firstName.charAt(0)}.{c.lastName.charAt(0)}.</option>
                    <option value="anonymous">Anonymous</option>
                    <option value="full">Full name (requires publication consent)</option>
                  </Select>
                </Field>
                <Checkbox name="marketingEmail" defaultChecked={c.marketingEmailConsent} label="Evolution Golf news and offers by email" />
                <Checkbox name="publication" defaultChecked={c.publicationConsent} label="Publish my full name if I win" />
                <SubmitButton>Save preferences</SubmitButton>
              </ActionForm>
            </div>
          </Card>
          <Card className="p-5 text-sm">
            <h2 className="font-semibold">Your data</h2>
            <p className="mt-1 text-muted">Download everything we hold about you. To correct or erase your data, contact the store — erasure keeps anonymised results so past leaderboards stay accurate.</p>
            <a href="/account/export" className="mt-3 inline-flex items-center gap-1.5 font-semibold text-green hover:underline"><Download className="size-4" /> Download my data (JSON)</a>
          </Card>
        </div>
      </div>
    </div>
  );
}
