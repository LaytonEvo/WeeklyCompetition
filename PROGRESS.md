# Build progress

## Phase 1 — Discovery & architecture ✅
- [x] Inspected the environment: empty workspace, no existing code to reuse. Node 22, pnpm, PostgreSQL 16 and Chromium available.
- [x] Architecture, schema, journeys and admin map → `docs/ARCHITECTURE.md`, `docs/DATABASE.md`

## Phase 2 — Design system & frontend ✅
- [x] Tokens (white base, dark green accents, gold for prizes), Inter + Barlow Condensed, accessible component kit
- [x] Home (hero, live competition card, top 10, how it works, winners, Hall of Fame, fitting promo)
- [x] Leaderboards (current/by week, search, live), competition rules page, winners archive, Hall of Fame, fitting page, terms and privacy (draft)
- [x] Booking flow (rounds → date/time calendar → registration → Stripe or free confirmation), booking page with QR, magic-link login, account (history, bookings, prizes, preferences, data export), share pages
- [x] Shop TV mode, embeddable top-10 widget, OG share images (square + story)

## Phase 3 — Database & backend ✅
- [x] Schema + migrations, sessions/RBAC, settings, launch gate, availability engine (GMT/BST-safe), concurrency-safe bookings, rounds/shots with append-only corrections, hole-in-one claims, competition lifecycle, scheduler

## Phase 4 — Payments & communications ✅ (needs credentials)
- [x] Stripe Checkout, verified idempotent webhooks, late-payment re-claim/auto-refund, refunds, in-store and complimentary payments, reconciliation
- [x] Email outbox with dedupe and retries; Resend/Postmark/log providers; all required message types
- [ ] Real Stripe test-mode and real email delivery runs — **blocked on credentials**

## Phase 5 — Admin platform ✅
- [x] Overview KPIs, live counter console (QR/code check-in, walk-in, keypad scoring, corrections, pause/restart, evidence, fitting flag), competitions (create/edit/lock rules/approve/clone/cancel/templates), availability, bookings, customers (profile, consents, notes, merge, erase, export), entries, hole-in-one review, winners & prizes, payments & refunds, reports + CSV, marketing (UTM/QR builder, consented export), settings, legal gate & funding, users, audit log
- [x] Role crawl: every admin route checked as Super Admin, Manager, Staff and Marketing — forbidden routes redirect correctly

## Phase 6 — Leaderboard & prize engine ✅
- [x] Derived standings, tie policies, prize splits/playoffs, SSE realtime, finalisation, prize fulfilment, jackpot liability enforcement

## Phase 7 — Testing ✅
- [x] Vitest 64/64, Playwright 13/13, typecheck, lint, production build

## Phase 8 — Deployment preparation ✅
- [x] `vercel.json` cron, `.env.example`, admin bootstrap script, DEPLOYMENT, TESTING, ADMIN_GUIDE, rules draft, LAUNCH_CHECKLIST
- [ ] Actual deployment — not performed (no hosting/database/Stripe/email credentials provided)
