import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const DB = "postgres://postgres:postgres@localhost:5432/pinhunters_e2e";

/**
 * End-to-end tests run a real Next.js server against a dedicated e2e
 * database, seeded with fictional data by tests/e2e/global-setup.ts.
 */
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } }, testIgnore: /responsive\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: {
    command: `pnpm next dev --port ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: DB, APP_URL: `http://localhost:${PORT}`, EMAIL_PROVIDER: "log", DEV_SHOW_MAGIC_LINKS: "true", STRIPE_SECRET_KEY: "" },
  },
});
