# Testing

## Running

```bash
createdb pinhunters_test
```

```bash
createdb pinhunters_e2e
```

```bash
pnpm test        # unit + integration (Vitest, real Postgres)
```

```bash
pnpm test:e2e    # browser journeys (Playwright, real Next.js server)
```

```bash
pnpm typecheck
```

```bash
pnpm lint
```

- **Integration tests** use `.env.test` (`DATABASE_URL=…/pinhunters_test`). The global setup drops and re-migrates that database and refuses any URL without "test" in it. Files run sequentially and each test truncates all tables.
- **E2E tests** start `next dev` on port 3100 against `pinhunters_e2e`. They migrate, run the fictional seed, and add a free-entry competition on a second bay (`scripts/e2e-setup.ts`). If Chromium isn't found, set `PW_CHROMIUM=/path/to/chromium`.

## Results at hand-over

The latest run of each suite passed: Vitest **64/64**, Playwright **13/13**, plus `tsc`, ESLint and `next build`.

## What is covered

| Area | Tests |
|---|---|
| Distance & money parsing/formatting, display precision without artificial ties | `unit/scoring.test.ts` |
| Qualification rules (valid, on-green, pending/approved/rejected hole-in-one) | `unit/scoring.test.ts` |
| Ranking, standard competition ranking, ties, countback, playoff flagging, multiple aces, 5,000-player board, empty board | `unit/scoring.test.ts` |
| Prize allocation incl. split pools, remainder pence, playoff ordering | `unit/scoring.test.ts` |
| Jackpot exposure/funding validation and eligibility caps | `unit/scoring.test.ts` |
| Europe/London conversion and both 2026 DST transitions | `unit/time.test.ts` |
| Mobile normalisation, public display names, CSV injection, role permissions, upload sniffing | `unit/time.test.ts` |
| **Journey B** walk-in → 5 shots → best valid shot on leaderboard, no contact data public | `integration/journeys.test.ts`, `e2e/journeys.spec.ts` |
| Idempotent walk-in and shot retries | `integration/journeys.test.ts` |
| Registration dedupe, never overwriting identity, separate unticked marketing consent | `integration/journeys.test.ts` |
| **Journey C** returning player, best-of-rounds, personal-best email, max rounds per player | `integration/journeys.test.ts` |
| Score corrections (supersede, reasons, manager-only after verification, audit), undo, restart after failure | `integration/journeys.test.ts` |
| **Journey D** hole-in-one: statement, evidence, four-eyes review, jackpot award, prize fulfilment details, winner caps | `integration/journeys.test.ts`, `e2e/journeys.spec.ts` |
| Jackpot publication blocked when exposure exceeds funding | `integration/journeys.test.ts` |
| **Journey E** deadline closure via scheduler, in-progress round completion, new rounds blocked, finalisation blocked then succeeds, idempotent, archive | `integration/journeys.test.ts` |
| Tie splitting at finalisation | `integration/journeys.test.ts` |
| Restricted/audited material changes after opening | `integration/journeys.test.ts` |
| Launch gate (scope + terms version) and online paid entry refused without Stripe | `integration/journeys.test.ts`, `e2e` |
| **Journey A (free mode)** online booking, attribution capture, confirmation email, QR page, staff check-in by code | `integration/journeys.test.ts`, `e2e/journeys.spec.ts` |
| Availability rules & staff override | `integration/journeys.test.ts` |
| **Double-booking**: 8 simultaneous checkouts for one slot → exactly 1 succeeds | `integration/payments.test.ts` |
| Hold expiry frees capacity; pending payments expire | `integration/payments.test.ts` |
| Stripe webhook signature verification; concurrent duplicate deliveries processed once; redirect alone never confirms | `integration/payments.test.ts` |
| Late payment after hold expiry (re-claim vs automatic refund), session expiry, async failure | `integration/payments.test.ts` |
| Refund idempotency, partial refunds, cancelling unplayed rounds; complimentary requires a reason | `integration/payments.test.ts` |
| Weekly template drafting is idempotent under concurrency and stays draft | `integration/operations.test.ts` |
| Merge duplicates, subject access export, erasure with anonymous results | `integration/operations.test.ts` |
| Email dedupe and HTML escaping | `integration/operations.test.ts` |
| Reports: gross vs refunds, "not profit" labelling, unavailable metrics | `integration/operations.test.ts` |
| Live SSE leaderboard update observed in a second browser tab | `e2e/journeys.spec.ts` |
| Magic-link sign-in to account history | `e2e/journeys.spec.ts` |
| Shop TV at 1920×1080, no private data, no overflow | `e2e/journeys.spec.ts` |
| Mobile (Pixel 7) layouts without horizontal overflow; mobile menu | `e2e/responsive.spec.ts` |
| Role-based access to every admin route (manual crawl as each role during build) | see PROGRESS.md |

## Not covered by automated tests (verify manually before launch)

- Real Stripe test-mode payments end to end (needs keys): checkout UI, webhook delivery and dashboard refunds.
- Real email delivery through Resend/Postmark and rendering in Gmail/Outlook.
- The S3 storage driver against a real bucket.
- QR scanning with a device camera (depends on BarcodeDetector support in the tablet's browser).
- A full week on the target TV hardware and browser.
