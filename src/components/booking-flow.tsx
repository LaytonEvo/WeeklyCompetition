"use client";

import { ArrowLeft, Check, Loader2, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { submitEntry } from "@/app/actions/public";
import { Alert, Button, Card, Checkbox, Field, Input, Select, cn } from "./ui";

type Comp = { id: string; slug: string; name: string; entryFee: string | null; entryFeePence: number; entryMode: "paid" | "free"; shotsPerRound: number; holeName: string };
type Day = { date: string; label: string; closed: boolean; slots: { startsAt: string; status: "available" | "full" | "unavailable"; time: string }[] };

export function BookingFlow({ competitions, initialSlug, maxRounds, termsVersion, minAge, refundPolicy }: { competitions: Comp[]; initialSlug?: string; maxRounds: number; termsVersion: string; minAge: number; refundPolicy: string }) {
  const [compId, setCompId] = useState(() => competitions.find((c) => c.slug === initialSlug)?.id ?? competitions[0]?.id);
  const comp = competitions.find((c) => c.id === compId)!;
  const [rounds, setRounds] = useState(1);
  const [days, setDays] = useState<Day[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [key] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()));

  const load = useCallback(async () => {
    setDays(null);
    const res = await fetch(`/api/slots?competitionId=${compId}&rounds=${rounds}`, { cache: "no-store" });
    const data = (await res.json()) as { days: Day[] };
    setDays(data.days);
    setDay((d) => (d && data.days.some((x) => x.date === d) ? d : (data.days.find((x) => x.slots.some((s) => s.status === "available"))?.date ?? data.days[0]?.date ?? null)));
    setSlot(null);
  }, [compId, rounds]);
  useEffect(() => {
    load();
  }, [load]);

  const activeDay = useMemo(() => days?.find((d) => d.date === day), [days, day]);
  const total = comp.entryMode === "paid" ? `£${((comp.entryFeePence * rounds) / 100).toFixed(2)}` : "Free";

  const submit = (form: FormData) => {
    setError(null);
    start(async () => {
      const res = await submitEntry({
        competitionId: compId,
        startsAt: slot!,
        roundsQty: rounds,
        idempotencyKey: key,
        firstName: String(form.get("firstName") ?? ""),
        lastName: String(form.get("lastName") ?? ""),
        email: String(form.get("email") ?? ""),
        mobile: String(form.get("mobile") ?? ""),
        handicap: String(form.get("handicap") ?? ""),
        homeClub: String(form.get("homeClub") ?? ""),
        preferredHand: String(form.get("preferredHand") ?? ""),
        acceptTerms: form.get("acceptTerms") === "on",
        confirmEligibility: form.get("confirmEligibility") === "on",
        marketingEmail: form.get("marketingEmail") === "on",
        publication: form.get("publication") === "on",
      });
      if (res.ok) window.location.href = res.redirectTo;
      else {
        setError(res.error);
        if (/taken|available|offered/i.test(res.error)) {
          setStep(1);
          load();
        }
      }
    });
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div>
        <ol className="mb-6 flex items-center gap-3 text-sm font-medium" aria-label="Progress">
          {["Choose a session", "Your details"].map((label, i) => (
            <li key={label} className={cn("flex items-center gap-2", step === i + 1 ? "text-pine" : "text-muted")}>
              <span className={cn("flex size-7 items-center justify-center rounded-full text-xs font-bold", step > i + 1 ? "bg-green text-white" : step === i + 1 ? "bg-pine text-white" : "bg-zinc-100")}>{step > i + 1 ? <Check className="size-4" /> : i + 1}</span>
              {label}
              {i === 0 && <span className="mx-1 h-px w-8 bg-line" />}
            </li>
          ))}
        </ol>
        {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

        {step === 1 && (
          <Card className="p-5 sm:p-6">
            {competitions.length > 1 && (
              <Field label="Competition" htmlFor="comp" className="mb-5">
                <Select id="comp" value={compId} onChange={(e) => setCompId(e.target.value)}>
                  {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            )}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Rounds</div>
                <div className="text-xs text-muted">Each round is {comp.shotsPerRound} shots. Your best shot counts.</div>
              </div>
              <div className="flex items-center gap-1 rounded-full p-1 ring-1 ring-line">
                <button type="button" aria-label="Fewer rounds" className="flex size-10 items-center justify-center rounded-full hover:bg-cream disabled:opacity-40" disabled={rounds <= 1} onClick={() => setRounds((r) => r - 1)}><Minus className="size-4" /></button>
                <span className="w-8 text-center font-display text-2xl font-bold tabular" aria-live="polite">{rounds}</span>
                <button type="button" aria-label="More rounds" className="flex size-10 items-center justify-center rounded-full hover:bg-cream disabled:opacity-40" disabled={rounds >= maxRounds} onClick={() => setRounds((r) => r + 1)}><Plus className="size-4" /></button>
              </div>
            </div>

            <div className="text-sm font-medium">Date</div>
            {!days ? (
              <div className="flex items-center gap-2 py-10 text-sm text-muted"><Loader2 className="size-4 animate-spin" /> Checking simulator availability…</div>
            ) : days.length === 0 ? (
              <p className="py-8 text-sm text-muted">There are no sessions left to book online for this competition. You can still try walking in — ask at the counter.</p>
            ) : (
              <>
                <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-2" role="listbox" aria-label="Choose a date">
                  {days.map((d) => {
                    const free = d.slots.filter((s) => s.status === "available").length;
                    return (
                      <button
                        key={d.date}
                        type="button"
                        role="option"
                        aria-selected={day === d.date}
                        onClick={() => { setDay(d.date); setSlot(null); }}
                        className={cn(
                          "flex min-w-[84px] flex-col items-center rounded-2xl px-3 py-3 text-center ring-1 transition",
                          day === d.date ? "bg-pine text-white ring-pine" : "bg-white ring-line hover:ring-ink/25",
                          free === 0 && day !== d.date && "opacity-50",
                        )}
                      >
                        <span className="text-xs font-semibold uppercase tracking-wider">{d.label.split(" ")[0]}</span>
                        <span className="font-display text-2xl font-bold">{d.label.split(" ")[1]}</span>
                        <span className={cn("text-[11px]", day === d.date ? "text-white/80" : "text-muted")}>{d.closed ? "Closed" : free ? `${free} free` : "Full"}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-5 text-sm font-medium">Time</div>
                {activeDay && activeDay.slots.length === 0 ? (
                  <p className="py-6 text-sm text-muted">{activeDay.closed ? "The simulator isn't available for the competition on this day." : "No times left on this day."}</p>
                ) : (
                  <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5" role="listbox" aria-label="Choose a time">
                    {activeDay?.slots.map((s) => (
                      <button
                        key={s.startsAt}
                        type="button"
                        role="option"
                        aria-selected={slot === s.startsAt}
                        disabled={s.status !== "available"}
                        onClick={() => setSlot(s.startsAt)}
                        className={cn(
                          "h-12 rounded-xl text-sm font-semibold tabular ring-1 transition",
                          s.status !== "available" ? "cursor-not-allowed bg-zinc-50 text-zinc-400 ring-zinc-100 line-through decoration-zinc-300" : slot === s.startsAt ? "bg-pine text-white ring-pine" : "bg-white ring-line hover:ring-green",
                        )}
                        title={s.status === "full" ? "Fully booked" : s.status === "unavailable" ? "Unavailable" : undefined}
                      >
                        {s.time}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted">
                  <span className="flex items-center gap-1.5"><span className="size-3 rounded bg-white ring-1 ring-line" /> Available</span>
                  <span className="flex items-center gap-1.5"><span className="size-3 rounded bg-zinc-100" /> Booked / unavailable (fittings & other bookings)</span>
                </div>
              </>
            )}
            <div className="mt-6 flex justify-end">
              <Button size="lg" disabled={!slot} onClick={() => setStep(2)}>Continue</Button>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card className="p-5 sm:p-6">
            <button type="button" onClick={() => setStep(1)} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-green hover:underline"><ArrowLeft className="size-4" /> Change session</button>
            <form action={submit} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" htmlFor="firstName"><Input id="firstName" name="firstName" required autoComplete="given-name" maxLength={60} /></Field>
                <Field label="Last name" htmlFor="lastName"><Input id="lastName" name="lastName" required autoComplete="family-name" maxLength={60} /></Field>
                <Field label="Email" htmlFor="email" hint="For your confirmation and results."><Input id="email" name="email" type="email" required autoComplete="email" /></Field>
                <Field label="Mobile" htmlFor="mobile" hint="Only used about your booking or a prize."><Input id="mobile" name="mobile" type="tel" required autoComplete="tel" placeholder="07…" /></Field>
              </div>
              <details className="rounded-2xl bg-cream/60 p-4 ring-1 ring-line/70">
                <summary className="cursor-pointer text-sm font-medium">Optional: golf details</summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <Field label="Handicap" htmlFor="handicap"><Input id="handicap" name="handicap" inputMode="decimal" placeholder="e.g. 14.2" /></Field>
                  <Field label="Home club" htmlFor="homeClub"><Input id="homeClub" name="homeClub" /></Field>
                  <Field label="Plays" htmlFor="preferredHand">
                    <Select id="preferredHand" name="preferredHand" defaultValue=""><option value="">—</option><option value="right">Right-handed</option><option value="left">Left-handed</option></Select>
                  </Field>
                </div>
              </details>
              <div className="space-y-2 border-t border-line pt-5">
                <Checkbox name="acceptTerms" required label={<>I accept the <Link href={`/competitions/${comp.slug}`} target="_blank" className="text-green underline">competition rules</Link> and <Link href="/terms" target="_blank" className="text-green underline">terms</Link> (v{termsVersion}).</>} />
                <Checkbox name="confirmEligibility" required label={`I confirm I am ${minAge}+ and eligible to enter.`} />
                <Checkbox name="marketingEmail" label="Email me Evolution Golf news and offers" description="Optional. Separate from your entry — unsubscribe any time." />
                <Checkbox name="publication" label="You may publish my full name if I win" description="Optional. Otherwise we show your first name and initial." />
                <p className="pt-1 text-xs text-muted">We use your details to run the competition. See our <Link href="/privacy" target="_blank" className="underline">privacy notice</Link>.</p>
              </div>
              <Button type="submit" size="xl" className="w-full" disabled={pending}>
                {pending ? <><Loader2 className="size-5 animate-spin" /> Reserving your session…</> : comp.entryMode === "paid" ? `Continue to secure payment · ${total}` : "Confirm my free entry"}
              </Button>
              {comp.entryMode === "paid" && <p className="text-center text-xs text-muted">Your slot is held for a few minutes while you pay. Payments are processed securely by Stripe.</p>}
            </form>
          </Card>
        )}
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Card className="overflow-hidden">
          <div className="bg-turf px-5 py-5 text-white">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">Your entry</div>
            <div className="mt-1 font-display text-2xl font-bold uppercase">{comp.name}</div>
            {comp.holeName && <div className="text-sm text-white/75">{comp.holeName}</div>}
          </div>
          <dl className="divide-y divide-line text-sm">
            <div className="flex justify-between px-5 py-3"><dt className="text-muted">Rounds</dt><dd className="font-semibold">{rounds} × {comp.shotsPerRound} shots</dd></div>
            <div className="flex justify-between px-5 py-3"><dt className="text-muted">Session</dt><dd className="font-semibold">{slot ? new Date(slot).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "—"}</dd></div>
            <div className="flex justify-between px-5 py-3"><dt className="text-muted">Total</dt><dd className="font-display text-xl font-bold text-pine">{total}</dd></div>
          </dl>
          <p className="border-t border-line px-5 py-4 text-xs leading-relaxed text-muted">{refundPolicy}</p>
        </Card>
      </aside>
    </div>
  );
}
