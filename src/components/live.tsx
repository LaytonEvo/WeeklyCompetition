"use client";

import { Search, Trophy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicLeaderboard } from "@/server/leaderboard";
import { cn } from "./ui";

/**
 * Subscribe to leaderboard updates. Uses Server-Sent Events (pushed from
 * Postgres NOTIFY on commit) and refetches the JSON snapshot when the version
 * changes. If SSE is unavailable it falls back to a slow version poll.
 */
export function useLiveLeaderboard(initial: PublicLeaderboard, limit?: number) {
  const [board, setBoard] = useState(initial);
  const [connected, setConnected] = useState(false);
  const versionRef = useRef(initial.version);
  const id = initial.competition.id;

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const refresh = async () => {
      try {
        const res = await fetch(`/api/leaderboard/${id}${limit ? `?limit=${limit}` : ""}`, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as PublicLeaderboard;
        if (!cancelled) {
          versionRef.current = next.version;
          setBoard(next);
        }
      } catch {
        /* offline — keep last good data */
      }
    };
    const startPoll = () => {
      if (poll) return;
      poll = setInterval(async () => {
        try {
          const r = await fetch(`/api/leaderboard/${id}?versionOnly=1`, { cache: "no-store" });
          const { version } = (await r.json()) as { version: number };
          if (version !== versionRef.current) refresh();
        } catch {
          /* ignore */
        }
      }, 30_000);
    };
    if (typeof EventSource !== "undefined") {
      es = new EventSource(`/api/leaderboard/${id}/stream`);
      es.addEventListener("open", () => setConnected(true));
      es.addEventListener("version", (e) => {
        const v = Number((e as MessageEvent).data);
        if (v !== versionRef.current) refresh();
      });
      es.addEventListener("error", () => {
        setConnected(false);
        startPoll(); // EventSource auto-reconnects; poll covers the gap
      });
    } else startPoll();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      es?.close();
      if (poll) clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [id, limit]);

  return { board, connected };
}

export function Countdown({ to, className, closedText = "Closed" }: { to: string; className?: string; closedText?: string }) {
  const target = useMemo(() => new Date(to).getTime(), [to]);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span className={className}>&nbsp;</span>;
  const ms = target - now;
  if (ms <= 0) return <span className={className}>{closedText}</span>;
  const d = Math.floor(ms / 86400_000);
  const h = Math.floor((ms % 86400_000) / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const parts = d > 0 ? [`${d}d`, `${h}h`, `${String(m).padStart(2, "0")}m`] : [`${h}h`, `${String(m).padStart(2, "0")}m`, `${String(s).padStart(2, "0")}s`];
  return (
    <span className={cn("tabular", className)} role="timer" aria-label={`${d} days ${h} hours ${m} minutes remaining`}>
      {parts.join(" ")}
    </span>
  );
}

function useChangedKeys(rows: PublicLeaderboard["rows"]) {
  const prev = useRef<Map<string, string>>(new Map());
  const [changed, setChanged] = useState<Set<string>>(new Set());
  useEffect(() => {
    const next = new Map(rows.map((r) => [r.key, `${r.rank}:${r.bestMm}`]));
    if (prev.current.size) {
      const diff = new Set<string>();
      for (const [k, v] of next) if (prev.current.get(k) !== v) diff.add(k);
      setChanged(diff);
      const t = setTimeout(() => setChanged(new Set()), 2000);
      prev.current = next;
      return () => clearTimeout(t);
    }
    prev.current = next;
  }, [rows]);
  return changed;
}

export function LiveLeaderboard({ initial, limit, searchable = true, compact = false }: { initial: PublicLeaderboard; limit?: number; searchable?: boolean; compact?: boolean }) {
  const { board, connected } = useLiveLeaderboard(initial, limit);
  const [q, setQ] = useState("");
  const changed = useChangedKeys(board.rows);
  const rows = q.trim() ? board.rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase())) : board.rows;
  const showRounds = board.rows.some((r) => r.rounds !== null);
  const live = board.competition.status === "open";

  return (
    <div>
      {(searchable || !compact) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {searchable && (
            <label className="relative block w-full max-w-xs">
              <span className="sr-only">Search players</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a player"
                className="h-11 w-full rounded-full bg-white pl-10 pr-4 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-green"
              />
            </label>
          )}
          <div className="flex items-center gap-2 text-xs font-medium text-muted" aria-live="polite">
            {live ? (
              <>
                <span className={cn("size-2 rounded-full", connected ? "bg-green animate-pulse-soft" : "bg-zinc-300")} />
                {connected ? "Live" : "Reconnecting…"} · {board.entrants} {board.entrants === 1 ? "player" : "players"}
              </>
            ) : (
              <span>{board.entrants} players · {board.competition.status === "finalised" ? "Final results" : "Not live"}</span>
            )}
          </div>
        </div>
      )}
      {board.rows.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-cream/60 px-6 py-14 text-center">
          <Trophy className="mx-auto size-8 text-gold" />
          <p className="mt-3 font-semibold text-ink">No scores yet</p>
          <p className="mt-1 text-sm text-muted">Be the first name on the board this week.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] bg-white ring-1 ring-line shadow-[var(--shadow-card)]">
          <table className="w-full text-left">
            <caption className="sr-only">Leaderboard for {board.competition.name}</caption>
            <thead>
              <tr className="border-b border-line bg-cream/60 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                <th scope="col" className="w-16 py-3 pl-5 pr-2">Pos</th>
                <th scope="col" className="py-3 pr-2">Player</th>
                {showRounds && !compact && <th scope="col" className="hidden py-3 pr-2 text-right sm:table-cell">Rounds</th>}
                {!compact && <th scope="col" className="hidden py-3 pr-2 text-right md:table-cell">Set</th>}
                <th scope="col" className="py-3 pr-5 text-right">Best shot</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={cn("border-b border-line/60 last:border-0", changed.has(r.key) && "animate-flash", r.rank === 1 && "bg-gold-50/40")}>
                  <td className="py-3.5 pl-5 pr-2">
                    <span
                      className={cn(
                        "inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 font-display text-lg font-bold tabular",
                        r.rank === 1 ? "bg-gold text-white" : r.rank <= 3 ? "bg-pine text-white" : "text-ink-soft",
                      )}
                    >
                      {r.tied ? `T${r.rank}` : r.rank}
                    </span>
                  </td>
                  <td className="py-3.5 pr-2">
                    <span className="font-semibold text-ink">{r.name}</span>
                    {r.holeInOne && <span className="ml-2 rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Ace</span>}
                  </td>
                  {showRounds && !compact && <td className="hidden py-3.5 pr-2 text-right text-sm text-muted tabular sm:table-cell">{r.rounds}</td>}
                  {!compact && (
                    <td className="hidden py-3.5 pr-2 text-right text-sm text-muted md:table-cell">
                      {new Date(r.bestAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" })}
                    </td>
                  )}
                  <td className="py-3.5 pr-5 text-right font-display text-xl font-bold text-pine tabular">{r.best}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                    No players match “{q}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
