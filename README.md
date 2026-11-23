# Pin Hunters — Evolution Golf

**Five shots. One leaderboard. One weekly winner.**

The competition platform for Evolution Golf's weekly closest-to-the-pin challenge on the in-store simulator in Ringwood. It covers the public site and live leaderboard, online booking around fitting appointments, the counter console staff use to score rounds, hole-in-one verification, winner finalisation, prize fulfilment, reporting and GDPR tooling.

> ⚠️ **Launch gate.** Paid entry, payment collection and public cash-prize claims are disabled until a Super Admin records independent legal approval for the competition's entry mode and terms version (Admin › Settings › Legal & launch gate). All rules and terms in this repository are **drafts for legal review**. See [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md).

## Documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technical architecture, key decisions, extending to new competition formats |
| [DATABASE.md](docs/DATABASE.md) | Data model and relationships |
| [ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) | How staff and managers operate the platform day to day |
| [COMPETITION_RULES_DRAFT.md](docs/COMPETITION_RULES_DRAFT.md) | Proposed rules — **for legal review** |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Environment variables, hosting, Stripe, email, storage, backups, monitoring |
| [TESTING.md](docs/TESTING.md) | What is tested and how to run it |
| [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) | Everything outstanding before going live |
| [PROGRESS.md](PROGRESS.md) | Build checklist and status |

## Stack

Next.js 16 (App Router, React 19, TypeScript) · Tailwind CSS 4 · PostgreSQL 16 with Drizzle ORM · Stripe Checkout and verified webhooks · Resend or Postmark email (log mode in development) · Server-Sent Events backed by Postgres `LISTEN/NOTIFY` for the live leaderboard · Vitest and Playwright.

## Run it locally

Prerequisites: Node 22+, pnpm 10+, PostgreSQL 16.

```bash
pnpm install
```

```bash
cp .env.example .env   # then set DATABASE_URL and a 32+ char APP_SECRET
```

```bash
createdb pinhunters
```

```bash
pnpm db:migrate
```

```bash
pnpm db:seed           # FICTIONAL development data only — refuses to run in production
```

```bash
pnpm dev
```

Then open:

- Public site: http://localhost:3000
- Shop TV screen: http://localhost:3000/tv
- Staff console: http://localhost:3000/admin, signing in as `manager@evolutiongolf.test` / `pinhunters-dev`. Other seeded roles: `admin@`, `staff@`, `marketing@`.

The seed creates last week's competition (finalised, with winners), this week's competition (open, live leaderboard, one pending hole-in-one claim) and next week's draft. It also records **placeholder** legal approvals so the full flow can be exercised locally. Those approvals are labelled "DEVELOPMENT SEED — NOT A REAL LEGAL REVIEW".

In development, email runs in log mode: messages are stored in the `notifications` table and printed to the console, and the sign-in page shows magic links on screen (`DEV_SHOW_MAGIC_LINKS=true`).

To try paid online entry, add Stripe **test** keys (see DEPLOYMENT.md) and forward webhooks:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm typecheck` / `pnpm lint` | Static checks |
| `pnpm test` | Unit + integration tests (needs the `pinhunters_test` database) |
| `pnpm test:e2e` | Playwright browser tests (needs the `pinhunters_e2e` database) |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle migrations |
| `pnpm db:seed` | Fictional development data |
| `pnpm admin:create --email … --name … --role super_admin` | Create the first real administrator |

## What is and isn't connected

| Area | Status |
|---|---|
| Competitions, booking, scoring, leaderboard, TV, prizes, reports, GDPR tools | Implemented and tested |
| Stripe Checkout + webhooks | Implemented. Webhook processing is tested with signed synthetic events. **Not yet run against a real Stripe test account** — needs keys. |
| Email (Resend/Postmark) | Implemented. Tested in log mode only — needs an API key and a verified sending domain. |
| Evidence storage | Local disk (development) is tested. The S3 driver is implemented but **untested** — needs a bucket. |
| Simulator data (TrackMan/Foresight etc.) | **Not connected.** Interface only; staff enter shots manually. |
| External fitting calendar | **Not connected.** Adapter interface and idempotent sync function only. |
| CRM / Klaviyo | **Not connected.** Consented-audience CSV export plus adapter interface. |
