import { execSync } from "node:child_process";

export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: "postgres://postgres:postgres@localhost:5432/pinhunters_e2e", NODE_ENV: "development" as const };
  execSync("pnpm drizzle-kit migrate", { env, stdio: "inherit" });
  execSync("pnpm db:seed", { env, stdio: "inherit" });
  execSync("pnpm tsx --tsconfig tsconfig.json scripts/e2e-setup.ts", { env, stdio: "inherit" });
}
