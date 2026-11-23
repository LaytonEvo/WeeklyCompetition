import { eq } from "drizzle-orm";
import { db } from "@/db";
import { competitions } from "@/db/schema";
import { realtimeHub } from "@/lib/realtime-hub";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Server-Sent Events stream of leaderboard versions. Commits that change a
 * leaderboard issue a Postgres NOTIFY (delivered only after commit); the
 * process-wide hub fans it out here, and clients refetch the ETag-cached
 * snapshot. Streams end after ~4.5 minutes and EventSource reconnects, which
 * keeps serverless durations bounded.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [c] = await db.select({ v: competitions.leaderboardVersion }).from(competitions).where(eq(competitions.id, id));
  if (!c) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  let cleanup: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (s: string) => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(s));
          } catch {
            closed = true;
          }
        }
      };
      const send = (event: string, data: string) => write(`event: ${event}\ndata: ${data}\n\n`);
      write("retry: 3000\n\n");
      send("version", String(c.v));

      let unsubscribe: () => void = () => undefined;
      try {
        unsubscribe = await realtimeHub.subscribe(async (competitionId) => {
          if (competitionId !== id) return;
          const [row] = await db.select({ v: competitions.leaderboardVersion }).from(competitions).where(eq(competitions.id, id));
          if (row) send("version", String(row.v));
        });
      } catch {
        send("error", "listen-failed");
      }
      const heartbeat = setInterval(() => write(": ping\n\n"), 25_000);
      const lifetime = setTimeout(() => cleanup(), 270_000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
