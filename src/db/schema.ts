/**
 * Pin Hunters database schema (PostgreSQL, Drizzle ORM).
 *
 * Conventions
 * - All money is stored as integer pence (`*_pence`).
 * - All distances are stored as integer millimetres (`distance_mm`).
 * - All timestamps are `timestamptz` (UTC instants). Wall-clock rules
 *   (opening hours, competition windows) are stored as local "HH:mm" strings
 *   and interpreted in the location's IANA timezone (Europe/London).
 * - Raw verified shots are the source of truth; leaderboards are derived.
 * - Score corrections never overwrite: a superseded shot keeps its row.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const staffRole = pgEnum("staff_role", ["super_admin", "manager", "staff", "marketing"]);
export const subjectType = pgEnum("subject_type", ["user", "customer"]);
export const consentType = pgEnum("consent_type", [
  "terms",
  "eligibility",
  "privacy_notice",
  "marketing_email",
  "marketing_sms",
  "publication",
]);
export const displayNameStyle = pgEnum("display_name_style", ["first_initial", "full", "initials", "anonymous"]);
export const preferredHand = pgEnum("preferred_hand", ["right", "left"]);

export const competitionFormat = pgEnum("competition_format", [
  "closest_to_pin",
  "longest_drive",
  "putting_challenge",
]);
export const competitionStatus = pgEnum("competition_status", [
  "draft",
  "pending_approval",
  "scheduled",
  "open",
  "closed",
  "awaiting_verification",
  "finalised",
  "archived",
  "cancelled",
]);
export const entryMode = pgEnum("entry_mode", ["paid", "free"]);
export const tiePolicy = pgEnum("tie_policy", ["equal_rank_split", "countback", "playoff"]);

export const bookingStatus = pgEnum("booking_status", [
  "held",
  "confirmed",
  "checked_in",
  "completed",
  "no_show",
  "cancelled",
  "expired",
]);
export const bookingSource = pgEnum("booking_source", ["online", "walk_in", "staff"]);
export const blockKind = pgEnum("block_kind", ["fitting", "maintenance", "closed", "private_event", "other"]);
export const availabilityKind = pgEnum("availability_kind", ["opening_hours", "competition_window"]);

export const paymentMethod = pgEnum("payment_method", [
  "stripe",
  "card_terminal",
  "cash",
  "complimentary",
  "free_entry",
]);
export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "paid",
  "failed",
  "refunded",
  "partially_refunded",
  "complimentary",
  "paid_in_store",
  "cancelled",
  "expired",
]);
export const refundStatus = pgEnum("refund_status", ["pending", "succeeded", "failed"]);

export const roundStatus = pgEnum("round_status", [
  "booked",
  "checked_in",
  "in_progress",
  "paused",
  "completed",
  "disqualified",
  "cancelled",
  "voided",
]);
export const shotStatus = pgEnum("shot_status", ["active", "superseded"]);
export const shotSource = pgEnum("shot_source", ["manual", "integration"]);
export const hioStatus = pgEnum("hio_status", ["pending_review", "approved", "rejected"]);

export const prizeKind = pgEnum("prize_kind", ["weekly", "jackpot"]);
export const prizeStatus = pgEnum("prize_status", [
  "provisional",
  "verified",
  "awaiting_claim",
  "claimed",
  "fulfilled",
  "expired",
  "cancelled",
]);
export const notificationStatus = pgEnum("notification_status", ["queued", "sent", "failed", "skipped"]);
export const fundingKind = pgEnum("funding_kind", ["insurance", "allocated_funds"]);
export const legalScope = pgEnum("legal_scope", ["paid_entry", "free_promotion"]);
export const promotionStatus = pgEnum("promotion_status", ["draft", "approved", "active", "ended"]);
export const fittingEnquiryStatus = pgEnum("fitting_enquiry_status", ["new", "contacted", "booked", "completed", "lost"]);

/* ------------------------------------------------------------------ */
/* Organisation                                                        */
/* ------------------------------------------------------------------ */

export const locations = pgTable("locations", {
  id: id(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: text("name").notNull(),
  addressLines: text("address_lines").notNull().default(""),
  postcode: varchar("postcode", { length: 16 }).notNull().default(""),
  timezone: varchar("timezone", { length: 64 }).notNull().default("Europe/London"),
  phone: varchar("phone", { length: 32 }).notNull().default(""),
  email: varchar("email", { length: 255 }).notNull().default(""),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const simulators = pgTable("simulators", {
  id: id(),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  name: text("name").notNull(),
  /** Number of simultaneous competition bookings this bay can host per slot. */
  slotCapacity: smallint("slot_capacity").notNull().default(1),
  slotMinutes: smallint("slot_minutes").notNull().default(10),
  available: boolean("available").notNull().default(true),
  unavailableReason: text("unavailable_reason"),
  /** Future: external shot-data provider (see src/lib/integrations/simulator). */
  integrationProvider: varchar("integration_provider", { length: 32 }),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Staff users & auth                                                  */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: id(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: text("name").notNull(),
  role: staffRole("role").notNull().default("staff"),
  passwordHash: text("password_hash"),
  /** 4-8 digit PIN hash for quick counter re-auth (optional). */
  active: boolean("active").notNull().default(true),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
    subjectType: subjectType("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    ip: varchar("ip", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_subject_idx").on(t.subjectType, t.subjectId)],
);

export const magicLinks = pgTable(
  "magic_links",
  {
    id: id(),
    email: varchar("email", { length: 255 }).notNull(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
    redirectTo: text("redirect_to"),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("magic_links_email_idx").on(t.email)],
);

export const rateLimits = pgTable("rate_limits", {
  key: varchar("key", { length: 255 }).primaryKey(),
  count: integer("count").notNull().default(0),
  windowStartsAt: ts("window_starts_at").notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

export const customers = pgTable(
  "customers",
  {
    id: id(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    /** Lower-cased, trimmed. Unique among non-merged, non-anonymised records. */
    email: varchar("email", { length: 255 }).notNull(),
    /** E.164 normalised UK mobile, e.g. +447700900123 */
    mobile: varchar("mobile", { length: 20 }).notNull(),
    handicap: varchar("handicap", { length: 8 }),
    homeClub: text("home_club"),
    preferredHand: preferredHand("preferred_hand"),
    displayNameStyle: displayNameStyle("display_name_style").notNull().default("first_initial"),
    /** Cached current consent state; the authoritative log is customer_consents. */
    marketingEmailConsent: boolean("marketing_email_consent").notNull().default(false),
    marketingSmsConsent: boolean("marketing_sms_consent").notNull().default(false),
    publicationConsent: boolean("publication_consent").notNull().default(false),
    fittingInterest: boolean("fitting_interest").notNull().default(false),
    /** First-touch acquisition attribution. */
    acquisitionSource: varchar("acquisition_source", { length: 64 }),
    utmSource: varchar("utm_source", { length: 128 }),
    utmMedium: varchar("utm_medium", { length: 128 }),
    utmCampaign: varchar("utm_campaign", { length: 128 }),
    referralCode: varchar("referral_code", { length: 64 }),
    mergedIntoId: uuid("merged_into_id"),
    anonymisedAt: ts("anonymised_at"),
    lastActivityAt: ts("last_activity_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("customers_email_active_uq")
      .on(t.email)
      .where(sql`${t.mergedIntoId} is null and ${t.anonymisedAt} is null`),
    index("customers_mobile_idx").on(t.mobile),
    index("customers_name_idx").on(t.lastName, t.firstName),
  ],
);

export const customerConsents = pgTable(
  "customer_consents",
  {
    id: id(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    type: consentType("type").notNull(),
    granted: boolean("granted").notNull(),
    noticeVersion: varchar("notice_version", { length: 32 }).notNull(),
    /** e.g. online_booking, walk_in_counter, account_preferences, unsubscribe_link */
    source: varchar("source", { length: 64 }).notNull(),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("customer_consents_customer_idx").on(t.customerId, t.type, t.createdAt)],
);

export const customerNotes = pgTable("customer_notes", {
  id: id(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  body: text("body").notNull(),
  authorUserId: uuid("author_user_id").notNull().references(() => users.id),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Settings, legal gate, funding                                       */
/* ------------------------------------------------------------------ */

export const settings = pgTable("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
  updatedAt: updatedAt(),
});

/**
 * Launch gate. A competition's entry mode may only be published / take money
 * while an un-revoked approval for its scope exists covering its terms version.
 */
export const legalApprovals = pgTable("legal_approvals", {
  id: id(),
  scope: legalScope("scope").notNull(),
  termsVersion: varchar("terms_version", { length: 32 }).notNull(),
  reviewerName: text("reviewer_name").notNull(),
  reviewerOrganisation: text("reviewer_organisation"),
  notes: text("notes"),
  recordedByUserId: uuid("recorded_by_user_id").notNull().references(() => users.id),
  approvedAt: ts("approved_at").notNull().defaultNow(),
  revokedAt: ts("revoked_at"),
  revokedByUserId: uuid("revoked_by_user_id").references(() => users.id),
  revokeReason: text("revoke_reason"),
});

export const jackpotFunding = pgTable("jackpot_funding", {
  id: id(),
  kind: fundingKind("kind").notNull(),
  provider: text("provider").notNull(),
  policyReference: text("policy_reference"),
  coverageLimitPence: integer("coverage_limit_pence").notNull(),
  perEventLimitPence: integer("per_event_limit_pence"),
  validFrom: ts("valid_from").notNull(),
  validTo: ts("valid_to").notNull(),
  coveredFormat: text("covered_format").notNull(),
  exclusions: text("exclusions"),
  evidenceRequirements: text("evidence_requirements"),
  /** Explicit confirmation that the cover/funding applies to SIMULATOR hole-in-ones. */
  simulatorCoverageConfirmed: boolean("simulator_coverage_confirmed").notNull().default(false),
  confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id),
  confirmedAt: ts("confirmed_at"),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: id(),
    simulatorId: uuid("simulator_id").notNull().references(() => simulators.id),
    kind: availabilityKind("kind").notNull(),
    /** ISO weekday 1=Monday .. 7=Sunday */
    weekday: smallint("weekday").notNull(),
    startTime: varchar("start_time", { length: 5 }).notNull(),
    endTime: varchar("end_time", { length: 5 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("availability_rules_sim_idx").on(t.simulatorId, t.weekday)],
);

export const blockedPeriods = pgTable(
  "blocked_periods",
  {
    id: id(),
    simulatorId: uuid("simulator_id").notNull().references(() => simulators.id),
    kind: blockKind("kind").notNull(),
    title: text("title").notNull(),
    /** One-off block (UTC instants). Null when recurring. */
    startsAt: ts("starts_at"),
    endsAt: ts("ends_at"),
    /** Weekly recurring block, local wall-clock. */
    recurringWeekday: smallint("recurring_weekday"),
    recurringStart: varchar("recurring_start", { length: 5 }),
    recurringEnd: varchar("recurring_end", { length: 5 }),
    recurringFrom: ts("recurring_from"),
    recurringUntil: ts("recurring_until"),
    /** Source when imported from an external calendar adapter. */
    externalSource: varchar("external_source", { length: 32 }),
    externalId: varchar("external_id", { length: 255 }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("blocked_periods_sim_time_idx").on(t.simulatorId, t.startsAt, t.endsAt),
    uniqueIndex("blocked_periods_external_uq").on(t.externalSource, t.externalId),
  ],
);

/* ------------------------------------------------------------------ */
/* Competitions                                                        */
/* ------------------------------------------------------------------ */

export type CompetitionConfig = {
  format: "closest_to_pin" | "longest_drive" | "putting_challenge";
  description: string;
  entryMode: "paid" | "free";
  entryFeePence: number;
  shotsPerRound: number;
  durationDays: number;
  startWeekday: number; // ISO 1-7
  startTime: string; // HH:mm local
  endTime: string; // HH:mm local on final day
  prizes: { rank: number; amountPence: number; description: string }[];
  jackpotEnabled: boolean;
  jackpotAmountPence: number;
  jackpotMaxWinners: number | null;
  jackpotMaxPerPlayer: number;
  jackpotMaxLiabilityPence: number | null;
  jackpotSubsequentQualify: boolean;
  hioCountsForWeekly: boolean;
  jackpotClaimDays: number;
  requireOnGreen: boolean;
  holeName: string;
  holeDistanceYards: number;
  simulatorSettings: string;
  eligibility: string;
  maxEntrants: number | null;
  maxRoundsPerCustomer: number | null;
  tiePolicy: "equal_rank_split" | "countback" | "playoff";
  tiePolicyText: string;
  rulesMarkdown: string;
  termsVersion: string;
  showRoundsCount: boolean;
};

export const competitionTemplates = pgTable("competition_templates", {
  id: id(),
  name: text("name").notNull(),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  simulatorId: uuid("simulator_id").notNull().references(() => simulators.id),
  config: jsonb("config").$type<CompetitionConfig>().notNull(),
  /** When true, the scheduler drafts next week's competition automatically. */
  autoCreateWeekly: boolean("auto_create_weekly").notNull().default(false),
  /** Name pattern; {n} = sequence number, {week} = ISO week label. */
  namePattern: text("name_pattern").notNull().default("Pin Hunters — Week {n}"),
  nextSequence: integer("next_sequence").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const competitions = pgTable(
  "competitions",
  {
    id: id(),
    templateId: uuid("template_id").references(() => competitionTemplates.id),
    locationId: uuid("location_id").notNull().references(() => locations.id),
    simulatorId: uuid("simulator_id").notNull().references(() => simulators.id),
    slug: varchar("slug", { length: 96 }).notNull().unique(),
    name: text("name").notNull(),
    sequence: integer("sequence"),
    description: text("description").notNull().default(""),
    format: competitionFormat("format").notNull().default("closest_to_pin"),
    status: competitionStatus("status").notNull().default("draft"),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    entryMode: entryMode("entry_mode").notNull().default("free"),
    entryFeePence: integer("entry_fee_pence").notNull().default(0),
    shotsPerRound: smallint("shots_per_round").notNull().default(5),
    maxEntrants: integer("max_entrants"),
    maxRoundsPerCustomer: integer("max_rounds_per_customer"),
    requireOnGreen: boolean("require_on_green").notNull().default(true),
    holeName: text("hole_name").notNull().default(""),
    holeDistanceYards: smallint("hole_distance_yards"),
    simulatorSettings: text("simulator_settings").notNull().default(""),
    eligibility: text("eligibility").notNull().default(""),
    tiePolicy: tiePolicy("tie_policy").notNull().default("equal_rank_split"),
    tiePolicyText: text("tie_policy_text").notNull().default(""),
    rulesMarkdown: text("rules_markdown").notNull().default(""),
    termsVersion: varchar("terms_version", { length: 32 }).notNull().default("draft-0"),
    promoImageUrl: text("promo_image_url"),
    showRoundsCount: boolean("show_rounds_count").notNull().default(true),
    // Jackpot
    jackpotEnabled: boolean("jackpot_enabled").notNull().default(false),
    jackpotAmountPence: integer("jackpot_amount_pence").notNull().default(0),
    jackpotMaxWinners: integer("jackpot_max_winners"),
    jackpotMaxPerPlayer: integer("jackpot_max_per_player").notNull().default(1),
    jackpotMaxLiabilityPence: integer("jackpot_max_liability_pence"),
    jackpotSubsequentQualify: boolean("jackpot_subsequent_qualify").notNull().default(true),
    hioCountsForWeekly: boolean("hio_counts_for_weekly").notNull().default(true),
    jackpotClaimDays: smallint("jackpot_claim_days").notNull().default(30),
    jackpotFundingId: uuid("jackpot_funding_id").references(() => jackpotFunding.id),
    // Lifecycle
    publishedAt: ts("published_at"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: ts("approved_at"),
    openedAt: ts("opened_at"),
    closedAt: ts("closed_at"),
    finalisedAt: ts("finalised_at"),
    finalisedByUserId: uuid("finalised_by_user_id").references(() => users.id),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    /** Bumped whenever ranked data changes; drives realtime updates & ETags. */
    leaderboardVersion: integer("leaderboard_version").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("competitions_status_idx").on(t.status, t.startsAt),
    index("competitions_location_idx").on(t.locationId, t.startsAt),
  ],
);

export const prizeDefinitions = pgTable(
  "prize_definitions",
  {
    id: id(),
    competitionId: uuid("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
    rank: smallint("rank").notNull(),
    amountPence: integer("amount_pence").notNull().default(0),
    description: text("description").notNull().default(""),
  },
  (t) => [uniqueIndex("prize_definitions_rank_uq").on(t.competitionId, t.rank)],
);

/** Immutable history of material changes after a competition opened. */
export const competitionRuleVersions = pgTable("competition_rule_versions", {
  id: id(),
  competitionId: uuid("competition_id").notNull().references(() => competitions.id),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  changeSummary: text("change_summary").notNull(),
  changedByUserId: uuid("changed_by_user_id").references(() => users.id),
  createdAt: createdAt(),
});

export const promotions = pgTable("promotions", {
  id: id(),
  competitionId: uuid("competition_id").references(() => competitions.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  code: varchar("code", { length: 64 }),
  status: promotionStatus("status").notNull().default("draft"),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
  approvedAt: ts("approved_at"),
  validFrom: ts("valid_from"),
  validTo: ts("valid_to"),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Bookings & payments                                                 */
/* ------------------------------------------------------------------ */

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    simulatorId: uuid("simulator_id").notNull().references(() => simulators.id),
    competitionId: uuid("competition_id").notNull().references(() => competitions.id),
    customerId: uuid("customer_id").references(() => customers.id),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    status: bookingStatus("status").notNull().default("held"),
    source: bookingSource("source").notNull().default("online"),
    holdExpiresAt: ts("hold_expires_at"),
    roundsQty: smallint("rounds_qty").notNull().default(1),
    /** Short human code shown on confirmation and encoded in QR. */
    checkinCode: varchar("checkin_code", { length: 16 }).notNull().unique(),
    overrideByUserId: uuid("override_by_user_id").references(() => users.id),
    utmSource: varchar("utm_source", { length: 128 }),
    utmMedium: varchar("utm_medium", { length: 128 }),
    utmCampaign: varchar("utm_campaign", { length: 128 }),
    referralCode: varchar("referral_code", { length: 64 }),
    checkedInAt: ts("checked_in_at"),
    checkedInByUserId: uuid("checked_in_by_user_id").references(() => users.id),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    reminderSentAt: ts("reminder_sent_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("bookings_sim_time_idx").on(t.simulatorId, t.startsAt),
    index("bookings_customer_idx").on(t.customerId),
    index("bookings_competition_idx").on(t.competitionId, t.status),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    customerId: uuid("customer_id").references(() => customers.id),
    competitionId: uuid("competition_id").notNull().references(() => competitions.id),
    bookingId: uuid("booking_id").references(() => bookings.id),
    method: paymentMethod("method").notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    roundsQty: smallint("rounds_qty").notNull().default(1),
    amountPence: integer("amount_pence").notNull(),
    feePence: integer("fee_pence"),
    refundedPence: integer("refunded_pence").notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("GBP"),
    stripeCheckoutSessionId: varchar("stripe_checkout_session_id", { length: 255 }).unique(),
    stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }).unique(),
    /** In-store transaction reference (terminal receipt no. etc). */
    reference: text("reference"),
    /** Client-generated key so double-clicks/retries create one payment. */
    idempotencyKey: varchar("idempotency_key", { length: 128 }).unique(),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id),
    authorisationReason: text("authorisation_reason"),
    paidAt: ts("paid_at"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payments_competition_idx").on(t.competitionId, t.status),
    index("payments_customer_idx").on(t.customerId),
  ],
);

export const refunds = pgTable("refunds", {
  id: id(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id),
  amountPence: integer("amount_pence").notNull(),
  reason: text("reason").notNull(),
  status: refundStatus("status").notNull().default("pending"),
  stripeRefundId: varchar("stripe_refund_id", { length: 255 }).unique(),
  idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull().unique(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: createdAt(),
});

/** Processed Stripe webhook events — guarantees idempotent processing. */
export const stripeEvents = pgTable("stripe_events", {
  id: varchar("id", { length: 255 }).primaryKey(),
  type: varchar("type", { length: 128 }).notNull(),
  processedAt: ts("processed_at").notNull().defaultNow(),
  payload: jsonb("payload"),
});

/* ------------------------------------------------------------------ */
/* Rounds & shots                                                      */
/* ------------------------------------------------------------------ */

export const rounds = pgTable(
  "rounds",
  {
    id: id(),
    competitionId: uuid("competition_id").notNull().references(() => competitions.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    bookingId: uuid("booking_id").references(() => bookings.id),
    paymentId: uuid("payment_id").references(() => payments.id),
    status: roundStatus("status").notNull().default("booked"),
    shotsAllowed: smallint("shots_allowed").notNull(),
    supervisedByUserId: uuid("supervised_by_user_id").references(() => users.id),
    checkedInAt: ts("checked_in_at"),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    verifiedByUserId: uuid("verified_by_user_id").references(() => users.id),
    /** Interrupted rounds: restart creates a new round referencing the voided one. */
    restartOfRoundId: uuid("restart_of_round_id"),
    statusReason: text("status_reason"),
    resultEmailSentAt: ts("result_email_sent_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("rounds_competition_idx").on(t.competitionId, t.status),
    index("rounds_customer_idx").on(t.customerId, t.competitionId),
  ],
);

export const shots = pgTable(
  "shots",
  {
    id: id(),
    roundId: uuid("round_id").notNull().references(() => rounds.id),
    shotNumber: smallint("shot_number").notNull(),
    /** Precise distance from the hole in millimetres. 0 for a hole-in-one. Null = no measurable result (e.g. missed). */
    distanceMm: integer("distance_mm"),
    onGreen: boolean("on_green").notNull(),
    valid: boolean("valid").notNull(),
    isHoleInOne: boolean("is_hole_in_one").notNull().default(false),
    hioStatus: hioStatus("hio_status"),
    simulatorShotId: varchar("simulator_shot_id", { length: 128 }),
    source: shotSource("source").notNull().default("manual"),
    status: shotStatus("status").notNull().default("active"),
    supersedesShotId: uuid("supersedes_shot_id"),
    correctionReason: text("correction_reason"),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id),
    recordedAt: ts("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shots_active_number_uq").on(t.roundId, t.shotNumber).where(sql`${t.status} = 'active'`),
    uniqueIndex("shots_sim_id_uq").on(t.simulatorShotId).where(sql`${t.status} = 'active'`),
    index("shots_round_idx").on(t.roundId),
  ],
);

export const shotEvidence = pgTable("shot_evidence", {
  id: id(),
  shotId: uuid("shot_id").references(() => shots.id),
  roundId: uuid("round_id").notNull().references(() => rounds.id),
  storageKey: text("storage_key").notNull(),
  contentType: varchar("content_type", { length: 64 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id),
  createdAt: createdAt(),
});

export const hioClaims = pgTable(
  "hio_claims",
  {
    id: id(),
    shotId: uuid("shot_id").notNull().references(() => shots.id).unique(),
    competitionId: uuid("competition_id").notNull().references(() => competitions.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    status: hioStatus("status").notNull().default("pending_review"),
    witnessUserId: uuid("witness_user_id").notNull().references(() => users.id),
    secondWitnessName: text("second_witness_name"),
    staffStatement: text("staff_statement").notNull(),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id),
    reviewedAt: ts("reviewed_at"),
    decisionReason: text("decision_reason"),
    jackpotEligible: boolean("jackpot_eligible"),
    jackpotIneligibleReason: text("jackpot_ineligible_reason"),
    jackpotAmountPence: integer("jackpot_amount_pence"),
    createdAt: createdAt(),
  },
  (t) => [index("hio_claims_status_idx").on(t.status)],
);

/* ------------------------------------------------------------------ */
/* Winners / prizes                                                    */
/* ------------------------------------------------------------------ */

export const prizeAwards = pgTable(
  "prize_awards",
  {
    id: id(),
    competitionId: uuid("competition_id").notNull().references(() => competitions.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    kind: prizeKind("kind").notNull(),
    rank: smallint("rank"),
    distanceMm: integer("distance_mm"),
    roundId: uuid("round_id").references(() => rounds.id),
    shotId: uuid("shot_id").references(() => shots.id),
    hioClaimId: uuid("hio_claim_id").references(() => hioClaims.id).unique(),
    prizeAmountPence: integer("prize_amount_pence").notNull().default(0),
    prizeDescription: text("prize_description").notNull().default(""),
    splitWays: smallint("split_ways").notNull().default(1),
    status: prizeStatus("status").notNull().default("provisional"),
    verifiedAt: ts("verified_at"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    notificationStatus: notificationStatus("notification_status"),
    claimDeadline: ts("claim_deadline"),
    claimedAt: ts("claimed_at"),
    paidAmountPence: integer("paid_amount_pence"),
    paymentMethod: varchar("payment_method", { length: 64 }),
    paymentReference: text("payment_reference"),
    paidAt: ts("paid_at"),
    paidRecordedByUserId: uuid("paid_recorded_by_user_id").references(() => users.id),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("prize_awards_weekly_uq")
      .on(t.competitionId, t.customerId)
      .where(sql`${t.kind} = 'weekly' and ${t.status} <> 'cancelled'`),
    index("prize_awards_competition_idx").on(t.competitionId),
  ],
);

/* ------------------------------------------------------------------ */
/* Communications, attribution, fittings, audit                        */
/* ------------------------------------------------------------------ */

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    customerId: uuid("customer_id").references(() => customers.id),
    type: varchar("type", { length: 64 }).notNull(),
    category: varchar("category", { length: 16 }).notNull().default("transactional"),
    toEmail: varchar("to_email", { length: 255 }).notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    bodyHtml: text("body_html").notNull(),
    status: notificationStatus("status").notNull().default("queued"),
    provider: varchar("provider", { length: 32 }),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    /** Prevents duplicate sends on retries, e.g. "booking_confirmation:<bookingId>". */
    dedupeKey: varchar("dedupe_key", { length: 255 }).notNull().unique(),
    attempts: smallint("attempts").notNull().default(0),
    error: text("error"),
    sentAt: ts("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_status_idx").on(t.status, t.createdAt)],
);

export const trackingEvents = pgTable(
  "tracking_events",
  {
    id: id(),
    type: varchar("type", { length: 64 }).notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    competitionId: uuid("competition_id").references(() => competitions.id),
    context: varchar("context", { length: 64 }),
    utmSource: varchar("utm_source", { length: 128 }),
    utmMedium: varchar("utm_medium", { length: 128 }),
    utmCampaign: varchar("utm_campaign", { length: 128 }),
    createdAt: createdAt(),
  },
  (t) => [index("tracking_events_type_idx").on(t.type, t.createdAt)],
);

export const fittingEnquiries = pgTable("fitting_enquiries", {
  id: id(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  competitionId: uuid("competition_id").references(() => competitions.id),
  source: varchar("source", { length: 64 }).notNull(),
  status: fittingEnquiryStatus("status").notNull().default("new"),
  bookedAt: ts("booked_at"),
  saleValuePence: integer("sale_value_pence"),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorType: varchar("actor_type", { length: 16 }).notNull(),
    actorId: uuid("actor_id"),
    actorLabel: text("actor_label"),
    action: varchar("action", { length: 96 }).notNull(),
    entityType: varchar("entity_type", { length: 48 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    ip: varchar("ip", { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);

export const jobRuns = pgTable("job_runs", {
  /** e.g. "close:<competitionId>" — unique key makes scheduled work idempotent. */
  key: varchar("key", { length: 255 }).primaryKey(),
  ranAt: ts("ran_at").notNull().defaultNow(),
  result: jsonb("result"),
});
