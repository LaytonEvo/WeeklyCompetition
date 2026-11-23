// Production-safe migration runner (no dev dependencies). Used as the
// pre-deploy command: `node scripts/migrate.mjs`.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined });
await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
await pool.end();
