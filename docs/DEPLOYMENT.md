# Deployment

Recommended: **Vercel** for the app and a managed **PostgreSQL 16** in the UK/EU (Neon, Supabase, or AWS RDS eu-west-2), plus **Stripe**, **Resend** or **Postmark**, and an **S3-compatible private bucket** (AWS S3 eu-west-2 or Cloudflare R2). Any Node 22 host that can run `next start` works; the app has no Vercel-specific code except `vercel.json` cron.

> None of these services were provisioned or connected during development. Every step below is still to do.

## 1. Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string. Add `?sslmode=require` for managed DBs. Use a pooled URL on serverless. |
| `DATABASE_POOL_MAX` | | Default 10. Keep low on serverless (e.g. 3). |
| `APP_URL` | ✅ | Public base URL, e.g. `https://pinhunters.evolutiongolf.co.uk`. Used in emails, QR codes and Stripe redirects. |
| `APP_SECRET` | ✅ | ≥32 random characters (`openssl rand -hex 32`). Signs evidence URLs. |
| `CRON_SECRET` | ✅ | Protects `/api/cron/tick`. Vercel Cron sends it automatically as a Bearer token. |
| `STRIPE_SECRET_KEY` | for paid entry | `sk_test_…` until launch. A live key is refused unless `STRIPE_LIVE_MODE_ALLOWED=true`. |
| `STRIPE_WEBHOOK_SECRET` | for paid entry | `whsec_…` from the webhook endpoint. |
| `STRIPE_LIVE_MODE_ALLOWED` | | Set `true` only after the launch checklist is complete. |
| `EMAIL_PROVIDER` | ✅ | `resend`, `postmark`, or `log` (development only). |
| `EMAIL_FROM` | ✅ | e.g. `Pin Hunters <pinhunters@evolutiongolf.co.uk>` (verified domain). |
| `RESEND_API_KEY` / `POSTMARK_SERVER_TOKEN` | per provider | |
| `STORAGE_DRIVER` | ✅ | `s3` in production (serverless disks are ephemeral). |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT` | for s3 | Private bucket, no public access. `S3_ENDPOINT` only for R2/MinIO. |
| `DEV_SHOW_MAGIC_LINKS` | | Must be unset/`false` in production (the app refuses to start that code path otherwise). |

Secrets live in the host's environment settings, never in the database or the repository.

## 2. Database

```bash
DATABASE_URL=… pnpm db:migrate
```

Run migrations before each deploy (CI step or release command). **Do not run `pnpm db:seed` in production.** Create the first administrator:

```bash
DATABASE_URL=… pnpm admin:create --email owner@evolutiongolf.co.uk --name "Owner" --role super_admin
```

Then sign in at `/admin/login`, open **Settings** to set the brand, store and fitting URL, add staff under **Settings › Staff users**, and configure **Simulator availability**. Before the first competition you also need a `locations` row and a `simulators` row. The seed creates these for development; in production insert them once:

```sql
insert into locations (slug, name, address_lines) values ('ringwood', 'Evolution Golf Ringwood', 'Ringwood, Hampshire');
insert into simulators (location_id, name) select id, 'Simulator Bay' from locations where slug = 'ringwood';
```

Then create a weekly template (copy the seed's template configuration, or create a competition and use *Duplicate* each week).

## 3. Stripe (test mode first)

1. In the Stripe dashboard (test mode) copy the secret key into `STRIPE_SECRET_KEY`.
2. Developers › Webhooks › Add endpoint: `https://<APP_URL>/api/stripe/webhook`, with these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`. Put the signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Local testing:

   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

   Then pay with card `4242 4242 4242 4242`.
4. Verify end to end: book a paid session → pay → the booking page turns to "You're booked in" (set by the webhook) → the confirmation email is sent → the refund from Admin › Payments appears in Stripe.
5. **Live mode** only after the launch checklist: swap to live keys, create a live webhook endpoint, and set `STRIPE_LIVE_MODE_ALLOWED=true`.

Stripe fees are not yet synced into reports (shown as "unavailable"). This is a future enhancement via balance transactions.

## 4. Transactional email

Choose Resend or Postmark, verify the sending domain (SPF, DKIM, DMARC), and set the API key and `EMAIL_FROM`. Messages go through the `notifications` outbox with a dedupe key. Failed sends retry on each cron tick (up to 5 attempts). Marketing campaigns are not sent from this app; export the consented list instead.

## 5. Evidence storage

Create a private bucket with block-public-access enabled, default encryption, and a lifecycle rule matching the evidence retention setting (default 12 months). Give an IAM user only `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on that bucket. **The S3 driver is implemented but has not been tested against a real bucket. Upload one evidence image and view it from Hole-in-one claims before launch.**

## 6. Scheduler

`vercel.json` calls `/api/cron/tick` every 5 minutes (Vercel Pro; Hobby plans only allow daily crons). The tick expires holds (and their Stripe sessions), opens and closes competitions, drafts weekly competitions, sends reminders, marks no-shows, expires unclaimed prizes and retries emails. Every step is idempotent. Opening and closing are **also** enforced lazily whenever the console or public pages load, so deadlines hold even if the cron is late. On other hosts, call the endpoint with any scheduler:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<APP_URL>/api/cron/tick
```

## 7. Realtime

The SSE endpoint holds a streaming response for up to ~4.5 minutes (`maxDuration = 300`), then the browser reconnects. Each server instance uses one extra Postgres connection for `LISTEN`. With a pooled connection string, make sure the pooler supports `LISTEN` (session mode). Neon's pooled URLs do not — use the direct URL, or accept the built-in 30-second polling fallback.

## 8. Backups and recovery

- Enable automated daily backups and point-in-time recovery (≥7 days) on the database provider. Test a restore to a scratch database each quarter.
- Turn on bucket versioning for evidence.
- Results, payments and the audit log live in the database. Stripe and the email provider hold independent copies of payment and message history.
- Recovery: restore the database → redeploy the same git commit → run `pnpm db:migrate` → open `/admin/payments` to check reconciliation, comparing against the Stripe dashboard for the outage window.

## 9. Monitoring

- Uptime check on `/` and `/api/leaderboard/<current id>?versionOnly=1`.
- Error reporting: add Sentry (`@sentry/nextjs`) or the host's log drains. Server errors are logged with `[unexpected]`, `[webhook]` and `[round summary]` prefixes.
- Stripe dashboard: webhook delivery failures alert by email.
- Weekly: Admin › Payments › Reconciliation and the failed notifications count (`select count(*) from notifications where status='failed'`).

## 10. Staff onboarding

1. Super Admin creates each user (Settings › Staff users) with the least privilege needed and shares the initial password out of band. Ask them to change it.
2. Walk staff through `docs/ADMIN_GUIDE.md` on the counter tablet: check-in, walk-in, recording, correcting and finishing a round, a hole-in-one with evidence, restart.
3. Practise on a **staging** deployment with seeded data before the first live week.
