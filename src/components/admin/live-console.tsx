"use client";

import {
  AlertTriangle, Camera, Check, ChevronRight, CircleDot, Delete, Flag, Loader2, Pause, Play, Plus, QrCode, RotateCcw, ScanLine, Search, Sparkles, Undo2, Upload, UserPlus, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  addWalkIn, beginRound, changeRoundStatus, checkIn, checkInCode, findCustomers, finishRound, fixShot, flagFittingInterest, getConsole, noShow, restart, saveShot, uploadEvidence,
} from "@/app/admin/actions/live";
import type { ConsoleRound } from "@/server/console";
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Select, Textarea, cn } from "../ui";

type State = Awaited<ReturnType<typeof import("@/server/console").consoleState>>;
type Me = { role: string; canComplimentary: boolean; canOverride: boolean };

function parseMetres(s: string): number | null {
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return Number(w) * 1000 + Number(f.padEnd(3, "0"));
}
const fmt = (mm: number) => `${Math.floor(Math.round(mm / 10) / 100)}.${String(Math.round(mm / 10) % 100).padStart(2, "0")} m`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function LiveConsole({ initial, me }: { initial: State; me: Me }) {
  const [state, setState] = useState(initial);
  const [selected, setSelected] = useState<string | null>(initial.rounds.find((r) => r.status === "in_progress")?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const [scan, setScan] = useState(false);
  const [code, setCode] = useState("");
  const [busy, start] = useTransition();
  const [online, setOnline] = useState(true);

  const refresh = useCallback(async () => {
    const res = await getConsole().catch(() => null);
    if (!res) return setOnline(false);
    setOnline(true);
    if (res.ok) setState(res.data);
  }, []);
  useEffect(() => {
    const t = setInterval(refresh, 15_000);
    const on = () => { setOnline(true); refresh(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { clearInterval(t); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [refresh]);

  /** Run a server action, surface errors, refresh state. Returns the action result. */
  const act = useCallback(
    async <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, success?: string) => {
      setError(null);
      setNotice(null);
      let res;
      try {
        res = await fn();
      } catch {
        setOnline(false);
        setError("Connection problem — nothing was lost. Check the connection and press the button again (it's safe to retry).");
        return null;
      }
      if (!res.ok) setError(res.error);
      else if (success) setNotice(success);
      await refresh();
      return res.ok ? res.data : null;
    },
    [refresh],
  );

  const live = state.rounds.filter((r) => r.status !== "completed");
  const done = state.rounds.filter((r) => r.status === "completed");
  const current = state.rounds.find((r) => r.id === selected) ?? null;

  const submitCode = (c: string) =>
    start(async () => {
      const data = await act(() => checkInCode(c), "Checked in.");
      if (data?.roundIds[0]) setSelected(data.roundIds[0]);
      setCode("");
    });

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col">
      {/* Top bar */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-line bg-white/95 px-4 py-3 backdrop-blur">
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) submitCode(code.trim());
          }}
        >
          <label className="relative min-w-0 flex-1 sm:max-w-xs">
            <span className="sr-only">Booking code</span>
            <QrCode className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" />
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Booking code" className="h-12 w-full rounded-full bg-cream pl-11 pr-4 font-mono text-base tracking-widest ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-green" autoComplete="off" />
          </label>
          <Button type="submit" size="lg" variant="secondary" disabled={busy || !code.trim()}>Check in</Button>
          <Button type="button" size="lg" variant="secondary" onClick={() => setScan(true)} aria-label="Scan QR code"><ScanLine className="size-5" /></Button>
        </form>
        <Button size="lg" onClick={() => setWalkIn(true)}><UserPlus className="size-5" /> Add walk-in entry</Button>
        {!online && <Badge tone="danger">Offline — retry when back</Badge>}
      </div>

      {(error || notice) && (
        <div className="px-4 pt-3">
          {error && <Alert tone="danger">{error}</Alert>}
          {notice && !error && <Alert tone="green">{notice}</Alert>}
        </div>
      )}

      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[320px_1fr]">
        {/* Left rail */}
        <div className="space-y-4">
          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted">On the simulator</h2>
            {live.length === 0 && <p className="rounded-2xl bg-cream px-4 py-5 text-sm text-muted">No live rounds. Check in a booking or add a walk-in.</p>}
            <div className="space-y-2">
              {live.map((r) => (
                <RoundTile key={r.id} r={r} active={r.id === selected} onClick={() => setSelected(r.id)} />
              ))}
            </div>
          </section>
          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Today&apos;s bookings</h2>
            {state.bookings.length === 0 && <p className="px-1 text-sm text-muted">No bookings today.</p>}
            {state.bookings.some((b) => b.status === "completed") && (
              <p className="mb-1.5 px-1 text-xs text-muted">{state.bookings.filter((b) => b.status === "completed").length} completed booking(s) hidden</p>
            )}
            <ul className="space-y-1.5">
              {state.bookings.filter((b) => b.status !== "completed").map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 rounded-2xl bg-white px-3 py-2.5 ring-1 ring-line/80">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold"><span className="tabular">{time(b.startsAt)}</span><span className="truncate">{b.customer}</span></div>
                    <div className="text-xs text-muted">{b.roundsQty} round{b.roundsQty > 1 ? "s" : ""} · {b.source.replaceAll("_", "-")} · {b.payment?.replaceAll("_", " ") ?? "—"} · <span className="font-mono">{b.code}</span></div>
                  </div>
                  {["confirmed", "no_show"].includes(b.status) ? (
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" onClick={() => start(async () => { await act(() => checkIn(b.id), "Checked in."); })}>Check in</Button>
                      {b.status === "confirmed" && new Date(b.startsAt) < new Date() && (
                        <Button size="sm" variant="ghost" onClick={() => start(async () => { await act(() => noShow(b.id), "Marked as no-show. Their paid rounds remain available."); })}>No-show</Button>
                      )}
                    </div>
                  ) : (
                    <Badge tone={b.status === "checked_in" ? "green" : b.status === "completed" ? "neutral" : "warn"}>{b.status.replaceAll("_", " ")}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {done.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Completed today</h2>
              <div className="space-y-2">{done.map((r) => <RoundTile key={r.id} r={r} active={r.id === selected} onClick={() => setSelected(r.id)} />)}</div>
            </section>
          )}
        </div>

        {/* Main panel */}
        <div>
          {current ? (
            <ScoringPanel key={current.id} r={current} act={act} me={me} onSelect={setSelected} />
          ) : (
            <Card className="flex h-full min-h-80 flex-col items-center justify-center p-10 text-center">
              <CircleDot className="size-10 text-green" />
              <h2 className="mt-4 text-xl font-semibold">Select a round to score</h2>
              <p className="mt-1 max-w-sm text-sm text-muted">Check in a booking by code or QR, choose a live round on the left, or add a walk-in entry.</p>
            </Card>
          )}
        </div>
      </div>

      {walkIn && <WalkInDrawer state={state} me={me} onClose={() => setWalkIn(false)} act={act} onCreated={(id) => { setSelected(id); setWalkIn(false); }} />}
      {scan && <Scanner onClose={() => setScan(false)} onCode={(c) => { setScan(false); submitCode(c); }} />}
    </div>
  );
}

function RoundTile({ r, active, onClick }: { r: ConsoleRound; active: boolean; onClick: () => void }) {
  const remaining = r.shotsAllowed - r.shots.length;
  return (
    <button onClick={onClick} className={cn("flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left ring-1 transition", active ? "bg-pine text-white ring-pine" : "bg-white ring-line hover:ring-green")}>
      <div className="min-w-0">
        <div className="truncate font-semibold">{r.customer.name}</div>
        <div className={cn("text-xs", active ? "text-white/75" : "text-muted")}>
          {r.status === "checked_in" ? "Ready to start" : r.status === "paused" ? "Paused" : r.status === "completed" ? "Completed" : `${remaining} shot${remaining === 1 ? "" : "s"} left`} · {r.competition.name}
        </div>
      </div>
      <div className="text-right">
        <div className={cn("font-display text-xl font-bold tabular", active ? "text-white" : "text-pine")}>{r.best?.label ?? "—"}</div>
        <ChevronRight className={cn("ml-auto size-4", active ? "text-white/60" : "text-muted")} />
      </div>
    </button>
  );
}

type Act = <T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, success?: string) => Promise<T | null>;

function ScoringPanel({ r, act, me, onSelect }: { r: ConsoleRound; act: Act; me: Me; onSelect: (id: string) => void }) {
  const [busy, start] = useTransition();
  const [value, setValue] = useState("");
  const [onGreen, setOnGreen] = useState(true);
  const [valid, setValid] = useState(true);
  const [noResult, setNoResult] = useState(false);
  const [hio, setHio] = useState(false);
  const [statement, setStatement] = useState("");
  const [witness, setWitness] = useState("");
  const [correcting, setCorrecting] = useState<ConsoleRound["shots"][number] | null>(null);
  const [prompt, setPrompt] = useState<null | "finish" | "pause" | "restart" | "disqualify">(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [evidenceShot, setEvidenceShot] = useState<string | null>(null);

  const nextN = r.shots.length + 1;
  const canRecord = r.status === "in_progress" && nextN <= r.shotsAllowed;
  const mm = parseMetres(value);
  const ready = hio ? statement.trim().length > 3 : noResult || (mm !== null && mm > 0);

  const reset = () => { setValue(""); setOnGreen(true); setValid(true); setNoResult(false); setHio(false); setStatement(""); setWitness(""); };
  const press = (k: string) => {
    if (k === "del") return setValue((v) => v.slice(0, -1));
    if (k === "." && value.includes(".")) return;
    const next = value === "" && k === "." ? "0." : value + k;
    if (/^\d{0,3}(\.\d{0,3})?$/.test(next)) setValue(next);
  };
  const submit = () =>
    start(async () => {
      const ok = await act(() =>
        saveShot(r.id, {
          shotNumber: nextN,
          distanceMm: hio ? 0 : noResult ? null : mm,
          onGreen: hio ? true : onGreen,
          valid: hio ? true : noResult ? false : valid,
          isHoleInOne: hio,
          hioStatement: hio ? statement : undefined,
          hioSecondWitness: hio ? witness : undefined,
        }),
      );
      if (ok) reset();
    });

  useEffect(() => {
    if (!canRecord || hio) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (/^[0-9.]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("del");
      else if (e.key === "Enter" && ready) submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });


  const upload = (file: File) =>
    start(async () => {
      const fd = new FormData();
      fd.set("roundId", r.id);
      if (evidenceShot) fd.set("shotId", evidenceShot);
      fd.set("file", file);
      await act(() => uploadEvidence(fd), "Evidence saved.");
      setEvidenceShot(null);
    });

  const statusTone = { checked_in: "blue", in_progress: "green", paused: "warn", completed: "neutral" } as const;
  const pendingHio = r.shots.find((s) => s.hio && s.hioStatus === "pending_review");

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-5">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={statusTone[r.status as keyof typeof statusTone] ?? "neutral"}>{r.status.replaceAll("_", " ")}</Badge>
            <span className="text-sm text-muted">{r.competition.name}</span>
          </div>
          <h2 className="mt-1.5 text-2xl font-bold text-ink">{r.customer.name}</h2>
          <div className="text-sm text-muted">Leaderboard name: {r.customer.display}{r.competition.requireOnGreen ? " · must finish on the green" : ""}</div>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Shots remaining</div>
            <div className="font-display text-4xl font-bold tabular">{Math.max(0, r.shotsAllowed - r.shots.length)}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Current best</div>
            <div className="font-display text-4xl font-bold text-pine tabular">{r.best?.label ?? "—"}</div>
          </div>
        </div>
      </div>

      {r.status === "checked_in" && (
        <div className="p-6">
          <Button size="xl" className="w-full" disabled={busy} onClick={() => start(async () => { await act(() => beginRound(r.id)); })}>
            <Play className="size-6" /> Start round ({r.shotsAllowed} shots)
          </Button>
        </div>
      )}

      <div className="grid gap-6 p-6 xl:grid-cols-[1fr_380px]">
        {/* Shot table */}
        <div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="py-2 pr-2">Shot</th><th className="py-2 pr-2">Distance</th><th className="py-2 pr-2">Status</th><th className="py-2 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: r.shotsAllowed }, (_, i) => {
                const s = r.shots.find((x) => x.n === i + 1);
                const counts = s && s.valid && (s.onGreen || !r.competition.requireOnGreen) && !s.hio;
                const isBest = s && r.best?.shotNumber === s.n;
                return (
                  <tr key={i} className={cn("border-b border-line/60", isBest && "bg-gold-50/60", !s && i + 1 === nextN && r.status === "in_progress" && "bg-green-50/60")}>
                    <td className="py-3 pr-2 font-display text-xl font-bold text-muted">{i + 1}</td>
                    <td className="py-3 pr-2 font-display text-2xl font-bold tabular">{s ? s.label : <span className="text-line">—</span>}</td>
                    <td className="py-3 pr-2 text-sm">
                      {!s ? <span className="text-muted">{i + 1 === nextN && r.status === "in_progress" ? "Next" : "Not taken"}</span>
                        : s.hio ? <Badge tone="gold">Ace · {s.hioStatus?.replaceAll("_", " ")}</Badge>
                        : !s.valid ? <Badge tone="danger">Invalid</Badge>
                        : !s.onGreen ? <Badge tone="warn">Off green{r.competition.requireOnGreen ? " — doesn't count" : ""}</Badge>
                        : <Badge tone="green">{counts ? "Valid" : "Recorded"}</Badge>}
                      {s?.corrected && <span className="ml-1 text-xs text-muted">(corrected)</span>}
                      {isBest && <span className="ml-1 text-xs font-semibold text-gold">Best</span>}
                    </td>
                    <td className="py-3 text-right">
                      {s && ["in_progress", "paused", "completed"].includes(r.status) && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => { setEvidenceShot(s.id); fileRef.current?.click(); }} title="Attach evidence"><Camera className="size-4" />{s.evidence > 0 && <span className="text-xs">{s.evidence}</span>}</Button>
                          {(r.status !== "completed" || me.role === "manager" || me.role === "super_admin") && <Button size="sm" variant="ghost" onClick={() => setCorrecting(s)}>Correct</Button>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {r.history > 0 && <p className="mt-2 text-xs text-muted">{r.history} earlier value{r.history > 1 ? "s" : ""} kept in the audit history.</p>}
          {pendingHio && (
            <Alert tone="gold" className="mt-4" title="Hole-in-one claim pending">
              Attach the simulator screenshot (camera icon) now. A manager who did not witness the shot must approve it before it counts or any jackpot is paid.
            </Alert>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            {r.status === "in_progress" && (
              <>
                <Button size="lg" disabled={busy} onClick={() => (r.shots.length >= r.shotsAllowed ? start(async () => { await act(() => finishRound(r.id), "Round verified — the leaderboard has updated."); }) : setPrompt("finish"))}>
                  <Check className="size-5" /> {r.shots.length >= r.shotsAllowed ? "Complete & verify round" : "Finish early…"}
                </Button>
                <Button size="lg" variant="secondary" onClick={() => setPrompt("pause")}><Pause className="size-5" /> Pause</Button>
              </>
            )}
            {r.status === "paused" && (
              <Button size="lg" onClick={() => start(async () => { await act(() => changeRoundStatus(r.id, "in_progress", "")); })}><Play className="size-5" /> Resume</Button>
            )}
            {["in_progress", "paused"].includes(r.status) && (
              <Button size="lg" variant="secondary" onClick={() => setPrompt("restart")}><RotateCcw className="size-5" /> Simulator problem — restart</Button>
            )}
            {["in_progress", "paused", "completed"].includes(r.status) && (
              <Button size="lg" variant="ghost" onClick={() => { setEvidenceShot(null); fileRef.current?.click(); }}><Upload className="size-5" /> Round evidence{r.roundEvidence ? ` (${r.roundEvidence})` : ""}</Button>
            )}
            {(me.role === "manager" || me.role === "super_admin") && ["in_progress", "paused", "completed"].includes(r.status) && (
              <Button size="lg" variant="ghost" className="text-danger" onClick={() => setPrompt("disqualify")}>Disqualify…</Button>
            )}
          </div>
          {r.status === "completed" && (
            <div className="mt-6 rounded-2xl bg-cream p-5 ring-1 ring-line">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">Round verified{r.best ? ` — best ${r.best.label}` : ""}</div>
                  <div className="text-sm text-muted">Result emailed to the player. Mention club fitting if they&apos;re interested.</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={r.customer.fittingInterest || busy} onClick={() => start(async () => { await act(() => flagFittingInterest(r.customer.id, r.competition.id), "Fitting interest recorded."); })}>
                    <Flag className="size-4" /> {r.customer.fittingInterest ? "Fitting interest noted" : "Interested in a fitting"}
                  </Button>
                  <a className="inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold text-green hover:bg-green-50" href={`/share/result/${r.id}`} target="_blank">Share card</a>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Entry pad */}
        {canRecord && (
          <div className="rounded-[var(--radius-card)] bg-cream/70 p-4 ring-1 ring-line">
            <div className="mb-3 flex items-baseline justify-between">
              <div className="text-sm font-semibold">Record shot {nextN}</div>
              <div className="text-xs text-muted">metres from the hole</div>
            </div>
            {!hio ? (
              <>
                <div className={cn("mb-3 flex h-20 items-center justify-end rounded-2xl bg-white px-5 font-display text-5xl font-bold tabular ring-1", noResult ? "text-muted line-through ring-line" : "ring-green/40")} aria-live="polite">
                  {noResult ? "No result" : value || <span className="text-line">0.00</span>}<span className="ml-2 text-2xl text-muted">m</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "del"].map((k) => (
                    <button key={k} type="button" disabled={noResult} onClick={() => press(k)} className="flex h-16 items-center justify-center rounded-2xl bg-white font-display text-3xl font-bold ring-1 ring-line active:bg-green-50 disabled:opacity-40" aria-label={k === "del" ? "Delete" : k}>
                      {k === "del" ? <Delete className="size-6" /> : k}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Toggle on={onGreen} onClick={() => setOnGreen(!onGreen)} label="On the green" />
                  <Toggle on={valid} onClick={() => setValid(!valid)} label="Valid shot" />
                  <Toggle on={noResult} onClick={() => setNoResult(!noResult)} label="No result / missed" danger />
                  <Toggle on={false} onClick={() => setHio(true)} label="Hole-in-one!" gold icon={<Sparkles className="size-4" />} />
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <Alert tone="gold" title="Potential hole-in-one">This creates a claim for manager verification. It will not count until approved. Capture a screenshot of the simulator now.</Alert>
                <Field label="What did you witness?" htmlFor="stmt"><Textarea id="stmt" value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="e.g. Ball landed front edge and rolled in; simulator showed HOLE IN ONE" /></Field>
                <Field label="Second witness (optional)" htmlFor="w2"><Input id="w2" value={witness} onChange={(e) => setWitness(e.target.value)} /></Field>
                <Button variant="ghost" onClick={() => setHio(false)}>Cancel — not a hole-in-one</Button>
              </div>
            )}
            <Button size="xl" className="mt-3 w-full" disabled={!ready || busy} onClick={submit} variant={hio ? "gold" : "primary"}>
              {busy ? <Loader2 className="size-6 animate-spin" /> : <Plus className="size-6" />} Record shot {nextN}{!hio && !noResult && mm ? ` · ${fmt(mm)}` : ""}
            </Button>
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      {correcting && <CorrectionDialog shot={correcting} isLast={correcting.n === r.shots.length && r.status !== "completed"} verified={r.status === "completed"} onClose={() => setCorrecting(null)} act={act} />}
      {prompt && (
        <ReasonDialog
          title={{ finish: "Finish round early", pause: "Pause round", restart: "Void & restart round", disqualify: "Disqualify round" }[prompt]}
          description={{
            finish: `Only ${r.shots.length} of ${r.shotsAllowed} shots recorded. Remaining shots will be forfeited.`,
            pause: "Use for short interruptions. The round can be resumed.",
            restart: "For simulator failures. This round is voided (kept for audit) and a fresh replacement round is issued against the same payment.",
            disqualify: "The round will not count. The player is notified by staff.",
          }[prompt]}
          danger={prompt === "disqualify" || prompt === "restart"}
          onClose={() => setPrompt(null)}
          onConfirm={async (reason) => {
            if (prompt === "finish") await act(() => finishRound(r.id, reason), "Round verified.");
            if (prompt === "pause") await act(() => changeRoundStatus(r.id, "paused", reason));
            if (prompt === "disqualify") await act(() => changeRoundStatus(r.id, "disqualified", reason));
            if (prompt === "restart") {
              const d = await act(() => restart(r.id, reason), "Replacement round issued.");
              if (d?.roundId) onSelect(d.roundId);
            }
            setPrompt(null);
          }}
        />
      )}
    </Card>
  );
}

function Toggle({ on, onClick, label, danger, gold, icon }: { on: boolean; onClick: () => void; label: string; danger?: boolean; gold?: boolean; icon?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={cn("flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold ring-1 transition", on ? (danger ? "bg-danger text-white ring-danger" : "bg-pine text-white ring-pine") : gold ? "bg-gold-50 text-[#7d5f26] ring-gold/40" : "bg-white text-ink-soft ring-line")}>
      {icon ?? (on ? <Check className="size-4" /> : <X className="size-4 opacity-40" />)} {label}
    </button>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal aria-label={title} onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white p-6 shadow-[var(--shadow-lift)] sm:rounded-[28px]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-cream" aria-label="Close"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ReasonDialog({ title, description, danger, onClose, onConfirm }: { title: string; description: string; danger?: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, start] = useTransition();
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-muted">{description}</p>
      <Field label="Reason (recorded in the audit log)" htmlFor="reason" className="mt-4"><Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} disabled={!reason.trim() || busy} onClick={() => start(() => onConfirm(reason))}>{busy ? "Saving…" : "Confirm"}</Button>
      </div>
    </Modal>
  );
}

function CorrectionDialog({ shot, isLast, verified, onClose, act }: { shot: ConsoleRound["shots"][number]; isLast: boolean; verified: boolean; onClose: () => void; act: Act }) {
  const [metres, setMetres] = useState(shot.distanceMm !== null && !shot.hio ? (shot.distanceMm / 1000).toFixed(2) : "");
  const [onGreen, setOnGreen] = useState(shot.onGreen);
  const [valid, setValid] = useState(shot.valid);
  const [reason, setReason] = useState("");
  const [busy, start] = useTransition();
  const mm = parseMetres(metres);
  return (
    <Modal title={`Correct shot ${shot.n}`} onClose={onClose}>
      {verified && <Alert tone="warn" className="mb-4">This round is already verified. Your correction is recorded against your name and the leaderboard will update.</Alert>}
      <p className="mb-4 text-sm text-muted">Currently recorded: <strong className="text-ink">{shot.label}</strong>. The original value is never deleted.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Distance (m)" htmlFor="cm"><Input id="cm" inputMode="decimal" value={metres} onChange={(e) => setMetres(e.target.value)} /></Field>
        <div className="flex flex-col justify-end gap-2">
          <Checkbox label="On the green" checked={onGreen} onChange={(e) => setOnGreen(e.target.checked)} />
          <Checkbox label="Valid shot" checked={valid} onChange={(e) => setValid(e.target.checked)} />
        </div>
      </div>
      <Field label="Reason for correction" htmlFor="cr" className="mt-4"><Textarea id="cr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Typed 1.43 instead of 1.34" /></Field>
      <div className="mt-5 flex flex-wrap justify-between gap-2">
        {isLast ? (
          <Button variant="ghost" disabled={!reason.trim() || busy} onClick={() => start(async () => { await act(() => fixShot(shot.id, { remove: true }, reason), "Shot removed."); onClose(); })}>
            <Undo2 className="size-4" /> Undo this shot
          </Button>
        ) : <span />}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!reason.trim() || busy || (valid && (mm === null || mm === 0))} onClick={() => start(async () => { await act(() => fixShot(shot.id, { distanceMm: mm, onGreen, valid }, reason), "Correction saved."); onClose(); })}>Save correction</Button>
        </div>
      </div>
    </Modal>
  );
}

type Found = { id: string; name: string; display: string; email: string; mobile: string; entitlements: { roundId: string; competition: string; status: string }[] };

function WalkInDrawer({ state, me, onClose, act, onCreated }: { state: State; me: Me; onClose: () => void; act: Act; onCreated: (roundId: string) => void }) {
  const openComps = state.competitions.filter((c) => c.status === "open");
  const [compId, setCompId] = useState(openComps[0]?.id ?? "");
  const comp = openComps.find((c) => c.id === compId);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [picked, setPicked] = useState<Found | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [qty, setQty] = useState(1);
  const [method, setMethod] = useState<"card_terminal" | "cash" | "complimentary" | "free_entry">(comp?.entryMode === "free" ? "free_entry" : "card_terminal");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [busy, start] = useTransition();
  const [key] = useState(uuid);
  const [nc, setNc] = useState({ firstName: "", lastName: "", email: "", mobile: "", acceptTerms: false, confirmEligibility: false, marketingEmail: false });

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const res = await findCustomers(q);
      if (res.ok) setResults(res.data);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const amount = comp && (method === "card_terminal" || method === "cash") ? comp.entryFeePence * qty : 0;
  const canSubmit = comp && (picked || (isNew && nc.firstName && nc.lastName && nc.email && nc.mobile && nc.acceptTerms && nc.confirmEligibility)) && (method !== "complimentary" || reason.trim());

  const create = () =>
    start(async () => {
      const d = await act(
        () =>
          addWalkIn({
            competitionId: compId,
            customerId: picked?.id,
            newCustomer: isNew ? nc : undefined,
            roundsQty: qty,
            method,
            amountPence: amount,
            reference: reference || undefined,
            authorisationReason: reason || undefined,
            overrideAvailability: override,
            idempotencyKey: key,
          }),
        "Entry created and checked in.",
      );
      if (d?.roundIds[0]) onCreated(d.roundIds[0]);
    });

  if (!openComps.length) return <Modal title="Add walk-in entry" onClose={onClose}><Alert tone="warn">No competition is open right now.</Alert></Modal>;

  return (
    <Modal title="Add walk-in entry" onClose={onClose}>
      <div className="space-y-5">
        {openComps.length > 1 && (
          <Field label="Competition" htmlFor="wc"><Select id="wc" value={compId} onChange={(e) => { setCompId(e.target.value); setMethod(openComps.find((c) => c.id === e.target.value)?.entryMode === "free" ? "free_entry" : "card_terminal"); }}>{openComps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        )}
        {/* 1. Customer */}
        {!picked && !isNew && (
          <div>
            <div className="mb-1.5 text-sm font-medium">1. Find the customer</div>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or mobile" className="h-14 w-full rounded-2xl bg-white pl-11 pr-4 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-green" />
            </label>
            <ul className="mt-2 divide-y divide-line rounded-2xl ring-1 ring-line empty:hidden">
              {(q.trim().length < 2 ? [] : results).map((c) => (
                <li key={c.id}>
                  <button className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-cream" onClick={() => setPicked(c)}>
                    <span><span className="font-semibold">{c.name}</span><span className="block text-xs text-muted">{c.email} · {c.mobile}</span></span>
                    {c.entitlements.length > 0 && <Badge tone="gold">{c.entitlements.length} unused round{c.entitlements.length > 1 ? "s" : ""}</Badge>}
                  </button>
                </li>
              ))}
            </ul>
            <Button variant="secondary" className="mt-3 w-full" size="lg" onClick={() => setIsNew(true)}><UserPlus className="size-5" /> New customer</Button>
          </div>
        )}
        {picked && (
          <div className="rounded-2xl bg-cream p-4 ring-1 ring-line">
            <div className="flex items-center justify-between">
              <div><div className="font-semibold">{picked.name}</div><div className="text-xs text-muted">{picked.email}</div></div>
              <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>Change</Button>
            </div>
            {picked.entitlements.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="text-sm font-medium">Already has unused rounds — no new payment needed:</div>
                {picked.entitlements.map((e) => (
                  <Button key={e.roundId} variant="gold" className="w-full" onClick={() => onCreated(e.roundId)}>Use existing round · {e.competition}</Button>
                ))}
                <div className="pt-1 text-xs text-muted">Or buy a new entry below.</div>
              </div>
            )}
          </div>
        )}
        {isNew && (
          <div className="space-y-3">
            <div className="flex items-center justify-between"><div className="text-sm font-medium">1. New customer</div><Button size="sm" variant="ghost" onClick={() => setIsNew(false)}>Search instead</Button></div>
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="First name" value={nc.firstName} onChange={(e) => setNc({ ...nc, firstName: e.target.value })} aria-label="First name" />
              <Input placeholder="Last name" value={nc.lastName} onChange={(e) => setNc({ ...nc, lastName: e.target.value })} aria-label="Last name" />
              <Input placeholder="Email" type="email" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} aria-label="Email" className="col-span-2" />
              <Input placeholder="Mobile (07…)" type="tel" value={nc.mobile} onChange={(e) => setNc({ ...nc, mobile: e.target.value })} aria-label="Mobile" className="col-span-2" />
            </div>
            <Checkbox label="Customer has read and accepts the competition rules" checked={nc.acceptTerms} onChange={(e) => setNc({ ...nc, acceptTerms: e.target.checked })} />
            <Checkbox label="Customer confirms they are eligible (age and rules)" checked={nc.confirmEligibility} onChange={(e) => setNc({ ...nc, confirmEligibility: e.target.checked })} />
            <Checkbox label="Customer asked to receive marketing emails" description="Only tick if the customer said yes — never by default." checked={nc.marketingEmail} onChange={(e) => setNc({ ...nc, marketingEmail: e.target.checked })} />
          </div>
        )}

        {/* 2. Entry & payment */}
        {(picked || isNew) && comp && (
          <div className="space-y-3 border-t border-line pt-4">
            <div className="text-sm font-medium">2. Entry & payment</div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Rounds</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={qty <= 1} onClick={() => setQty(qty - 1)}>−</Button>
                <span className="w-6 text-center font-display text-2xl font-bold">{qty}</span>
                <Button size="sm" variant="secondary" onClick={() => setQty(qty + 1)}>+</Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(comp.entryMode === "free" ? (["free_entry"] as const) : (["card_terminal", "cash"] as const)).map((m) => (
                <Toggle key={m} on={method === m} onClick={() => setMethod(m)} label={{ card_terminal: "Card (terminal)", cash: "Cash", free_entry: "Free entry", complimentary: "" }[m]} />
              ))}
              {me.canComplimentary && <Toggle on={method === "complimentary"} onClick={() => setMethod("complimentary")} label="Complimentary" gold />}
            </div>
            {(method === "card_terminal" || method === "cash") && (
              <>
                <div className="flex items-center justify-between rounded-xl bg-cream px-4 py-3"><span className="text-sm">Take payment</span><span className="font-display text-2xl font-bold">£{(amount / 100).toFixed(2)}</span></div>
                <Input placeholder={method === "card_terminal" ? "Terminal receipt / auth code" : "Till receipt number (optional)"} value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Payment reference" />
              </>
            )}
            {method === "complimentary" && <Input placeholder="Reason for complimentary entry" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Complimentary reason" />}
            {me.canOverride && <Checkbox label="Override simulator availability (manager)" description="Use only when the bay is genuinely free." checked={override} onChange={(e) => setOverride(e.target.checked)} />}
            <Button size="xl" className="w-full" disabled={!canSubmit || busy} onClick={create}>
              {busy ? <Loader2 className="size-6 animate-spin" /> : <Check className="size-6" />} Create entry & check in
            </Button>
            <p className="text-center text-xs text-muted">Uses the current free simulator slot. Safe to press again if the connection drops.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** QR scanning via the BarcodeDetector API where available (Chrome/Android, Safari 17+ partial). */
function Scanner({ onClose, onCode }: { onClose: () => void; onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const supported = useMemo(() => typeof window !== "undefined" && "BarcodeDetector" in window, []);
  useEffect(() => {
    if (!supported) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
        const loop = async () => {
          if (stopped || !video.current) return;
          const codes = await detector.detect(video.current).catch(() => []);
          if (codes[0]?.rawValue) return onCode(String(codes[0].rawValue).trim());
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch {
        setErr("Camera unavailable. Type the booking code instead.");
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [supported, onCode]);
  return (
    <Modal title="Scan booking QR" onClose={onClose}>
      {!supported || err ? (
        <Alert tone="warn"><AlertTriangle className="mr-1 inline size-4" />{err ?? "QR scanning isn't supported in this browser. Type the 8-character booking code instead."}</Alert>
      ) : (
        <video ref={video} className="aspect-square w-full rounded-2xl bg-ink object-cover" muted playsInline />
      )}
    </Modal>
  );
}
