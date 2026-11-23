"use client";

import { Flag, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import type { PublicLeaderboard } from "@/server/leaderboard";
import { Countdown, useLiveLeaderboard } from "./live";
import { cn } from "./ui";

type View = { name: string; holeName: string; holeDistanceYards: number | null; endsAt: string; startsAt: string; status: string; topPrize: string | null; jackpot: string | null; shotsPerRound: number; entryFee: string | null };
type Panel = "board" | "prize" | "jackpot" | "time" | "hole";

export function TvDisplay({ initial, view, rotateSeconds, business, siteUrl }: { initial: PublicLeaderboard; view: View; rotateSeconds: number; business: string; siteUrl: string }) {
  const { board, connected } = useLiveLeaderboard(initial, 10);
  const panels: Panel[] = ["board", ...(view.topPrize ? (["prize"] as Panel[]) : []), "board", ...(view.jackpot ? (["jackpot"] as Panel[]) : []), "board", "time", "board", "hole"];
  const [i, setI] = useState(0);
  const [clock, setClock] = useState("");
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % panels.length), rotateSeconds * 1000);
    return () => clearInterval(t);
  }, [panels.length, rotateSeconds]);
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }));
    tick();
    const t = setInterval(tick, 10_000);
    // Reload every 30 minutes so the screen picks up next week's competition without staff action.
    const r = setTimeout(() => window.location.reload(), 30 * 60_000);
    return () => {
      clearInterval(t);
      clearTimeout(r);
    };
  }, []);
  const panel = panels[i];
  const leader = board.rows[0];
  const open = view.status === "open";

  return (
    <div className="bg-turf flex h-dvh w-full flex-col overflow-hidden text-white" style={{ fontSize: "clamp(12px, 1.05vw, 28px)" }}>
      <header className="flex items-center justify-between px-[3em] pt-[2em]">
        <div>
          <div className="text-[1em] font-bold uppercase tracking-[0.3em] text-gold">{business}</div>
          <div className="font-display text-[4.2em] font-extrabold uppercase leading-none tracking-wide">Pin Hunters</div>
        </div>
        <div className="text-right">
          <div className="font-display text-[2.2em] font-bold uppercase">{view.name}</div>
          <div className="flex items-center justify-end gap-[0.6em] text-[1.1em] text-white/70">
            <span className={cn("inline-block size-[0.7em] rounded-full", open && connected ? "bg-[#5ee0a5] animate-pulse-soft" : "bg-white/30")} />
            {open ? "Live" : view.status === "scheduled" ? "Opens soon" : "Closed"} · {board.entrants} players · {clock}
          </div>
        </div>
      </header>

      <main className="relative flex-1 px-[3em] py-[2em]">
        <div key={`${panel}-${i}`} className="animate-rise h-full">
          {panel === "board" && (
            board.rows.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <Trophy className="size-[6em] text-gold" />
                <div className="mt-[0.6em] font-display text-[5em] font-bold uppercase">Be the first on the board</div>
                <div className="text-[1.8em] text-white/70">Ask at the counter to take your five shots</div>
              </div>
            ) : (
              <div className="grid h-full grid-cols-2 gap-x-[2.5em] gap-y-[0.8em] content-start">
                {board.rows.slice(0, 10).map((r) => (
                  <div key={r.key} className={cn("flex items-center gap-[1em] rounded-[1em] px-[1.4em] py-[0.9em]", r.rank === 1 ? "bg-gold/25 ring-2 ring-gold/60" : "bg-white/[0.07]")}>
                    <span className={cn("flex size-[2.6em] shrink-0 items-center justify-center rounded-full font-display text-[1.6em] font-bold tabular", r.rank === 1 ? "bg-gold text-white" : r.rank <= 3 ? "bg-white text-pine" : "bg-white/10")}>{r.tied ? `T${r.rank}` : r.rank}</span>
                    <span className="min-w-0 flex-1 truncate text-[2em] font-semibold">{r.name}{r.holeInOne && <span className="ml-[0.4em] rounded-full bg-gold px-[0.5em] py-[0.1em] align-middle text-[0.5em] font-bold uppercase tracking-widest">Ace</span>}</span>
                    <span className="font-display text-[2.8em] font-bold tabular">{r.best}</span>
                  </div>
                ))}
              </div>
            )
          )}
          {panel === "prize" && (
            <Center kicker="This week's prize" big={view.topPrize ?? ""} sub={leader ? `${leader.name} leads with ${leader.best}` : "No leader yet — could it be you?"} />
          )}
          {panel === "jackpot" && <Center kicker="Hole-in-one jackpot" big={view.jackpot ?? ""} sub="Verified holes-in-one only · see rules" gold />}
          {panel === "time" && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="text-[2em] font-bold uppercase tracking-[0.3em] text-gold">{open ? "Time remaining" : view.status === "scheduled" ? "Opens in" : "Competition closed"}</div>
              <Countdown to={open ? view.endsAt : view.startsAt} className="mt-[0.2em] font-display text-[11em] font-bold leading-none" closedText="Results soon" />
              <div className="mt-[0.4em] text-[1.8em] text-white/70">{view.shotsPerRound} shots{view.entryFee ? ` · ${view.entryFee} per round` : ""} · ask at the counter</div>
            </div>
          )}
          {panel === "hole" && (
            <div className="flex h-full items-center justify-center gap-[4em]">
              <svg viewBox="0 0 200 200" className="size-[24em]" aria-hidden>
                <circle cx="100" cy="100" r="92" fill="#0b5a3c" />
                <circle cx="100" cy="100" r="70" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
                <circle cx="100" cy="100" r="45" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="2" />
                <circle cx="100" cy="100" r="22" fill="none" stroke="#b2893f" strokeWidth="3" />
                <circle cx="100" cy="100" r="5" fill="#001a10" />
                <path d="M100 100V30" stroke="#fff" strokeWidth="3" />
                <path d="M100 31l36 12-36 12z" fill="#b2893f" />
              </svg>
              <div>
                <div className="text-[2em] font-bold uppercase tracking-[0.3em] text-gold"><Flag className="mr-[0.3em] inline size-[1em]" />Featured hole</div>
                <div className="mt-[0.2em] font-display text-[7em] font-bold uppercase leading-none">{view.holeName || "This week's hole"}</div>
                {view.holeDistanceYards && <div className="mt-[0.3em] font-display text-[4em] font-bold text-white/80">{view.holeDistanceYards} yards</div>}
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="flex items-center justify-between border-t border-white/10 px-[3em] py-[1.2em] text-[1.3em] text-white/70">
        <span>Five shots. One leaderboard. One weekly winner.</span>
        <span className="font-semibold text-white">{siteUrl.replace(/^https?:\/\//, "")}</span>
      </footer>
      <div className="h-[0.35em] bg-white/10">
        <div key={i} className="h-full bg-gold" style={{ animation: `tvbar ${rotateSeconds}s linear` }} />
      </div>
      <style>{`@keyframes tvbar { from { width: 0 } to { width: 100% } }`}</style>
    </div>
  );
}

function Center({ kicker, big, sub, gold }: { kicker: string; big: string; sub: string; gold?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="text-[2em] font-bold uppercase tracking-[0.3em] text-gold">{kicker}</div>
      <div className={cn("font-display text-[16em] font-extrabold leading-none tabular", gold && "text-gold")}>{big}</div>
      <div className="mt-[0.4em] text-[2em] text-white/75">{sub}</div>
    </div>
  );
}
