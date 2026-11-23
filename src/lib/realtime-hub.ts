import { Client } from "pg";
import { LEADERBOARD_CHANNEL } from "./realtime";

type Listener = (competitionId: string) => void;

/**
 * One shared LISTEN connection per server process, fanned out to every SSE
 * subscriber, so 50 open leaderboards cost one database connection, not 50.
 */
class Hub {
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private listeners = new Set<Listener>();

  async subscribe(fn: Listener): Promise<() => void> {
    this.listeners.add(fn);
    await this.ensure();
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.teardown();
    };
  }

  private async ensure() {
    if (this.client) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const c = new Client({ connectionString: process.env.DATABASE_URL });
      c.on("notification", (msg) => {
        if (msg.channel === LEADERBOARD_CHANNEL && msg.payload) for (const l of this.listeners) l(msg.payload);
      });
      c.on("error", () => this.teardown());
      c.on("end", () => {
        if (this.client === c) this.client = null;
      });
      await c.connect();
      await c.query(`LISTEN ${LEADERBOARD_CHANNEL}`);
      this.client = c;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private teardown() {
    const c = this.client;
    this.client = null;
    c?.end().catch(() => undefined);
  }
}

const g = globalThis as unknown as { __phHub?: Hub };
export const realtimeHub = (g.__phHub ??= new Hub());
