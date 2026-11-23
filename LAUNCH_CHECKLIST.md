# Launch checklist

Nothing here has been done yet unless ticked. Paid entry must not go live until every **Blocker** is complete.

## Legal & compliance — Blockers
- [ ] Independent UK legal advice on the paid-entry format under the Gambling Act 2005 (skill vs chance, repeat entries, hole-in-one jackpot) and on CAP Code promotional rules. See the open questions in `docs/COMPETITION_RULES_DRAFT.md`.
- [ ] Final competition rules written from that advice; replace the draft rules on the template and each competition, and bump the **terms version**.
- [ ] Final website terms and privacy notice entered in Settings › Terms & privacy text (replacing the DRAFT text). Fill in the controller details and privacy contact.
- [ ] Refund and no-show policies confirmed (Settings › Booking & policies).
- [ ] Jackpot: written confirmation that insurance covers **simulator** hole-in-ones in this format, or ring-fenced funds ≥ maximum liability. Record it in Settings › Legal & launch gate › Jackpot funding.
- [ ] **Revoke the DEV seed approvals** if the production database was ever seeded (it shouldn't be). Record the real approval with the adviser's name and the exact terms version.
- [ ] Prize tax and payment method agreed with the accountant.
- [ ] Data protection: confirm lawful bases and retention periods; ICO registration fee paid; record of processing updated; staff briefed on subject access and erasure requests.
- [ ] Cookie position confirmed. Only essential cookies are used (sessions and first-party attribution); revisit if analytics are added.

## Infrastructure — Blockers
- [ ] Production Postgres (UK/EU) with automated backups and PITR; restore tested.
- [ ] `pnpm db:migrate` run; first Super Admin created with `pnpm admin:create`; location and simulator rows inserted.
- [ ] All environment variables set (DEPLOYMENT.md §1); `DEV_SHOW_MAGIC_LINKS` unset; strong `APP_SECRET` and `CRON_SECRET`.
- [ ] S3 bucket created (private, encrypted, lifecycle rule); evidence upload and view tested on staging.
- [ ] Email provider domain verified (SPF/DKIM/DMARC); booking confirmation, magic link and round summary received and rendered correctly.
- [ ] Cron running (check Admin overview after a deadline, or `/api/cron/tick` logs).
- [ ] Custom domain + HTTPS; `APP_URL` matches.
- [ ] Error monitoring and uptime alerts configured.

## Payments — Blockers for paid mode
- [ ] Stripe account verified for Evolution Golf; test-mode end-to-end test passed (book → pay → webhook confirms → email → refund).
- [ ] Live webhook endpoint created with the five events; live keys set; `STRIPE_LIVE_MODE_ALLOWED=true`.
- [ ] One real low-value live payment and refund performed by the owner.

## Operations
- [ ] Settings completed: brand, store address and phone, opening hours text, **fitting booking URL**, social links.
- [ ] Simulator availability: opening hours, competition windows, recurring fitting blocks.
- [ ] Weekly template configured (hole, simulator settings, prizes, jackpot, tie wording, rules, terms version) with auto-create on.
- [ ] Staff accounts created with the least privilege; staff trained on the counter tablet (ADMIN_GUIDE.md).
- [ ] Counter tablet: `/admin/live` bookmarked; camera permission granted for QR scanning (or staff told to type codes).
- [ ] Shop TV: `/tv` open full-screen, auto-start on boot, screen sleep disabled.
- [ ] First competition approved and published; public pages reviewed on mobile.
- [ ] Marketing QR codes and links generated from Admin › Marketing for each channel.

## Known limitations / future work
- Simulator auto-ingestion (TrackMan/Foresight) — interface only.
- External fitting calendar sync — adapter interface only.
- CRM/Klaviyo sync — CSV export only.
- Stripe fee sync for net reporting.
- Attachable promotions (`promotions` table) have no admin UI yet; none are active.
- SMS reminders are not implemented (email only).
