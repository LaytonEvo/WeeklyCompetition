import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** Apply migrations to the dedicated test database once per run. */
export default async function setup() {
  config({ path: ".env.test", override: true });
  const url = process.env.DATABASE_URL!;
  if (!url.includes("test")) throw new Error(`Refusing to run tests against non-test database: ${url}`);
  const pool = new Pool({ connectionString: url });
  await pool.query("drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;");
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
}
