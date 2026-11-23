# Data model

Schema: `src/db/schema.ts`. Migrations: `drizzle/`. All timestamps are `timestamptz`. Money is integer pence and distances are integer millimetres.

## Entities

### Organisation and access
- **locations**: store sites (slug, address, timezone).
- **simulators**: bays per location. Holds `slot_minutes`, `slot_capacity`, an availability flag and a future `integration_provider`.
- **users**: staff accounts with a `role` (`super_admin | manager | staff | marketing`) and a scrypt password hash.
- **sessions**: hashed session tokens for staff (`user`) or customers (`customer`).
- **magic_links**: hashed, single-use, 20-minute customer sign-in tokens.
- **rate_limits**: fixed-window counters.

### Customers and consent
- **customers**: one person. Email is unique among live records (partial unique index excluding merged and anonymised rows). Mobile is normalised to E.164. Cached consent flags, display-name style, fitting interest, first-touch UTM/referral attribution, and `merged_into_id` / `anonymised_at` tombstones.
- **customer_consents**: append-only log of (type, granted, notice_version, source, recorded_by, time). Types: terms, eligibility, privacy_notice, marketing_email, marketing_sms, publication.
- **customer_notes**: staff notes.

### Configuration and governance
- **settings**: a single `app` JSON document validated by Zod (`src/lib/settings.ts`). Contains no secrets.
- **legal_approvals**: the launch gate (scope × terms_version, reviewer, recorded_by, revoked_at).
- **jackpot_funding**: insurance or ring-fenced funds. Holds limits, validity dates, covered format, exclusions and an explicit `simulator_coverage_confirmed`.
- **audit_logs**: append-only (actor, action, entity, before/after JSON, reason, IP).
- **job_runs**: reserved for idempotent one-off jobs.

### Availability
- **availability_rules**: weekly `opening_hours` and optional `competition_window` rows (ISO weekday, local `HH:mm`).
- **blocked_periods**: one-off (UTC instants) or weekly-recurring (weekday + local times, optional from/until) blocks. Kinds: fitting, maintenance, closed, private_event, other. `(external_source, external_id)` is unique for calendar sync.

### Competitions
- **competition_templates**: reusable `CompetitionConfig` JSON, a weekly auto-create flag, a name pattern and the next sequence number.
- **competitions**: the configuration snapshot actually used. Holds format, schedule, entry mode/fee, shots per round, limits, on-green rule, hole and simulator settings, tie policy plus published wording, rules markdown, terms version, jackpot configuration and funding link, lifecycle timestamps and `leaderboard_version`.
- **prize_definitions**: prize per finishing position.
- **competition_rule_versions**: immutable snapshots of material changes made after publication.
- **promotions**: future attachable offers (draft/approved/active). Not active unless approved.

Lifecycle: `draft → pending_approval → scheduled → open → closed ⇄ awaiting_verification → finalised → archived`, plus `cancelled`. Transitions are enforced in `TRANSITIONS` (`src/server/competitions.ts`).

### Bookings and money
- **bookings**: simulator time (`starts_at`/`ends_at` = slot length × rounds). Statuses: held, confirmed, checked_in, completed, no_show, cancelled, expired. Also holds the hold expiry, an 8-character check-in code (QR), source (online, walk_in, staff), UTM fields and override user.
- **payments**: one per purchase. Methods: stripe, card_terminal, cash, complimentary, free_entry. Statuses: pending, paid, failed, refunded, partially_refunded, complimentary, paid_in_store, cancelled, expired. Holds Stripe session and intent IDs (unique), an idempotency key, refunded pence and the recording user. No card data is stored.
- **refunds**: amount, reason, Stripe refund ID, idempotency key.
- **stripe_events**: processed webhook event IDs.

### Play
- **rounds**: one entry = one round. Links customer, competition, booking and payment. Statuses: booked, checked_in, in_progress, paused, completed, disqualified, cancelled, voided. Also holds supervising and verifying staff, timestamps, reason, and `restart_of_round_id` for simulator-failure replacements.
- **shots**: shot number, `distance_mm` (0 = hole-in-one, NULL = no result), on_green, valid, is_hole_in_one + `hio_status`, simulator shot ID, source, `status` (active | superseded), `supersedes_shot_id`, correction reason and recorder. Partial unique index on `(round_id, shot_number) WHERE status='active'`.
- **shot_evidence**: private storage key, content type, size, SHA-256 and uploader.
- **hio_claims**: one per shot. Holds the witness, statement, second witness, reviewer, decision, jackpot eligibility (with reason) and amount.

### Results
- **prize_awards**: winner records for kind `weekly | jackpot`. Holds rank, distance, the winning round and shot, amount, split ways, status (provisional → verified → awaiting_claim → claimed → fulfilled | expired | cancelled), approver, notification status, claim deadline, and payment details (amount, method, reference, date, recorder). Partial unique index: one non-cancelled weekly award per (competition, customer). `hio_claim_id` is unique.

### Communications and attribution
- **notifications**: transactional/marketing outbox with a unique `dedupe_key`, rendered HTML/text, provider ID, attempts and error.
- **tracking_events**: e.g. `fitting_cta_click` with context and UTM.
- **fitting_enquiries**: fitting pipeline per customer (status, booked_at, sale value) for attribution reporting.

## Relationships (simplified)

```
locations 1─* simulators 1─* availability_rules / blocked_periods
simulators 1─* competitions 1─* prize_definitions
competitions 1─* bookings *─1 customers
bookings 1─* payments 1─* refunds
payments 1─* rounds *─1 customers ; rounds 1─* shots 1─0..1 hio_claims
shots 1─* shot_evidence ; prize_awards → competition, customer, round, shot, hio_claim
customers 1─* customer_consents / customer_notes / fitting_enquiries / notifications
```

## Integrity rules

- Raw active shots in completed rounds are authoritative; standings are recomputed on read.
- Corrections never update a shot in place. The old row becomes `superseded` and a new row records the corrected values plus a reason. Changing a verified round needs manager permission and is audited.
- Merges re-point all child rows and keep a tombstone. Erasure anonymises personal fields, deletes notes and evidence files, and keeps results and financial records.
