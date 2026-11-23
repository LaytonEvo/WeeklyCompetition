import { sql } from "drizzle-orm";
import { db } from "@/db";
import { AppError } from "@/lib/errors";

/**
 * Fixed-window rate limiter backed by Postgres so it works across serverless
 * instances without extra infrastructure. Atomic upsert per key.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const result = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, count, window_starts_at) values (${key}, 1, now())
    on conflict (key) do update set
      count = case when rate_limits.window_starts_at < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
      window_starts_at = case when rate_limits.window_starts_at < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_starts_at end
    returning count
  `);
  const count = Number(result.rows[0]?.count ?? 0);
  if (count > limit) throw new AppError("Too many attempts. Please wait a few minutes and try again.", "rate_limited", 429);
}
