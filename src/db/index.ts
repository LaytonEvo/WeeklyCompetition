import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
/** A transaction handle has the same query API as the db. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;

const globalForDb = globalThis as unknown as { __phPool?: Pool; __phDb?: DB };

export function getPool(): Pool {
  if (!globalForDb.__phPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__phPool = new Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    });
  }
  return globalForDb.__phPool;
}

export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    if (!globalForDb.__phDb) globalForDb.__phDb = drizzle(getPool(), { schema });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalForDb.__phDb as any)[prop];
  },
});

export { schema };
