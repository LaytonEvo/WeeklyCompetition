# Architecture

## Overview

```
Browser (public, customer, staff tablet, shop TV)
   │  React Server Components + Server Actions (CSRF-protected by Next's origin check)
   │  Client components: booking calendar, live console, live leaderboard (SSE)
   ▼
Next.js 16 App Router (Node runtime)
   ├─ src/app/(site)        public site, booking, account, share pages
   ├─ src/app/admin         staff platform (role-gated layout + per-page checks)
   ├─ src/app/api           webhook, cron, SSE stream, JSON snapshots, slots, OG images, evidence
   ├─ src/app/actions       public server actions
   ├─ src/app/admin/actions staff server actions (every one calls requireStaffAction(permission))
   ├─ src/server/*          business services — framework-free, tested directly
   ├─ src/lib/*             scoring engine, auth/session, settings, storage, email, time, money
   └─ src/db/schema.ts      Drizzle schema → drizzle/*.sql migrations
   ▼
PostgreSQL 16 (source of truth, advisory locks, LISTEN/NOTIFY, rate limits)
External: Stripe (Checkout + webhooks), Resend/Postmark, S3-compatible storage (optional)
```

## Key decisions

| Decision | Reason |
|---|---|
| **Next.js 16 without Cache Components** (`cacheComponents` off) | Almost every page reads live DB data or a session. The classic dynamic model is simpler and less error-prone than wrapping every read in `<Suspense>`/`use cache`. |
| **Drizzle + `pg`** rather than Prisma | Pure JS, no engine binaries, first-class SQL for ranking/reporting queries, transactions and advisory locks. |
| **Services in `src/server` take an explicit `Actor`** | Business logic never reads cookies, so it is unit/integration testable and every write is attributable in the audit log. |
| **Custom auth: DB sessions + magic links (customers) + scrypt passwords (staff)** | No third-party auth dependency. Session tokens are stored as SHA-256 hashes; cookies are `httpOnly`, `SameSite=Lax`, `Secure` in production. Staff and customer sessions use separate cookies so a counter tablet can't leak into customer context. Magic-link tokens are single-use, expire after 20 minutes, and are only consumed on POST, so email link scanners can't burn them. |
| **Leaderboards are derived, never stored** | Raw active shots in completed rounds are the source of truth. `competitions.leaderboard_version` is just a change counter used for realtime fan-out and ETags. |
| **Realtime = SSE + Postgres NOTIFY** | `bumpLeaderboard()` issues `pg_notify` inside the writing transaction, so it is delivered only on commit. One shared `LISTEN` connection per server process fans out to all SSE clients. Streams self-close after ~4.5 minutes and `EventSource` reconnects. Clients fall back to a 30-second version poll if SSE fails. No third-party realtime service. |
| **Concurrency** | All capacity decisions for a simulator are serialised with `pg_advisory_xact_lock(hashtext('sim:<id>'))`. Jackpot approvals use a per-competition lock. Template drafting uses a per-template lock. Tests race 8 concurrent checkouts for one slot. |
| **Idempotency everywhere money or scores move** | `stripe_events` primary key (event processed in the same transaction as its effects), `payments.idempotency_key`, `refunds.idempotency_key` + Stripe idempotency keys, `notifications.dedupe_key`, `(round, shot_number)` partial unique index with identical-retry detection, partial unique index preventing two weekly awards per player per competition. |
| **Money in pence, distance in millimetres** | Integers only. Metres are parsed with string arithmetic. Display precision rises to 3 dp when 2 dp would make different results look tied. |
| **Europe/London wall-clock rules** | Opening hours, windows and competition times are stored as local `HH:mm` and converted with Luxon per date, so GMT/BST changes keep "Sunday 18:00" at 18:00. Tested across both 2026 transitions. |
| **Launch gate in the data model** | `legal_approvals(scope, terms_version)`. Publication, opening, online entry, walk-in entry and public prize/price display all check it. Revocation immediately stops opening and payment. |

## Request flows

**Online paid entry:** `/enter` → `submitEntry` (server action, rate-limited) → transaction: find/create customer + consent log, hold slot under the simulator lock, pending payment → Stripe Checkout Session (idempotency key = payment id) → customer pays → **webhook** (`/api/stripe/webhook`, signature verified) → transaction: record event, mark paid, confirm the booking (re-claiming the slot if the hold lapsed, otherwise flagging an automatic refund), create rounds → after commit: confirmation email / refund. The browser redirect only shows status; it never confirms payment.

**Counter round:** `/admin/live` → `addWalkIn` (one transaction: customer, checked-in booking, in-store payment or authorised free entry, rounds) → `beginRound` → `saveShot` ×5 (idempotent per shot number) → `finishRound` (verifies; bumps the leaderboard; emails the result summary).

**Deadline:** `/api/cron/tick` *and* lazy checks on hot paths call `applyDueTransitions()` to open or close competitions on time. A round started before the deadline may finish after it; new rounds cannot start.

## Security controls

Server-side authorisation on every action and admin route (`src/lib/permissions.ts`). Zod validation on all inputs. Postgres-backed rate limiting on login, magic links and online entry. Server Actions with Next's built-in origin/CSRF protection. Stripe webhook signature verification. Evidence uploads are validated by magic bytes and size, stored privately (`0600` locally, SSE-encrypted on S3), and served only to signed-in staff via 5-minute HMAC-signed URLs. Security headers come from `next.config.ts`. CSV export neutralises spreadsheet formula injection. Email HTML escapes user content. Public projections (`getPublicLeaderboard`, share cards) never include contact data or internal customer IDs.

## Extending: new competition formats

The customer, booking, payment, round, prize and winner systems only deal in an abstract integer score plus a direction. To add, for example, longest drive:

1. Implement a `ScoringStrategy` in `src/lib/scoring/strategies.ts`: `direction`, `qualifyingScore(shot, rules)` and `formatScore`. `longestDrive` already exists as a worked example.
2. Set `FORMAT_AVAILABILITY.longest_drive = true` and enable the option in `components/admin/competition-form.tsx`.
3. If the metric isn't a distance (e.g. putting strokes), add a generic `score_value` column to `shots` and map it in the strategy. Ranking (`computeStandings`), tie policies and prize allocation (`allocatePrizes`) work unchanged.
4. Adjust the live-console entry pad labels for the metric.

Multi-location: `locations` and `simulators` are already first-class. Competitions, templates and availability are per simulator. `/tv?location=<slug>` selects a location.

## Integration boundaries (not connected)

- `src/lib/integrations/calendar.ts`: `CalendarAdapter` plus an idempotent `syncCalendar()` that upserts fitting blocks keyed by `(external_source, external_id)`.
- `src/lib/integrations/simulator.ts`: `SimulatorProvider` for TrackMan, Foresight and similar. Ingested shots must go through `recordShot()`.
- `src/lib/integrations/crm.ts`: CRM/Klaviyo adapter contract (consented contacts only; propagate withdrawals).
