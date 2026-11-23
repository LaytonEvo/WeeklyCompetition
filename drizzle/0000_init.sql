CREATE TYPE "public"."availability_kind" AS ENUM('opening_hours', 'competition_window');--> statement-breakpoint
CREATE TYPE "public"."block_kind" AS ENUM('fitting', 'maintenance', 'closed', 'private_event', 'other');--> statement-breakpoint
CREATE TYPE "public"."booking_source" AS ENUM('online', 'walk_in', 'staff');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('held', 'confirmed', 'checked_in', 'completed', 'no_show', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."competition_format" AS ENUM('closest_to_pin', 'longest_drive', 'putting_challenge');--> statement-breakpoint
CREATE TYPE "public"."competition_status" AS ENUM('draft', 'pending_approval', 'scheduled', 'open', 'closed', 'awaiting_verification', 'finalised', 'archived', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('terms', 'eligibility', 'privacy_notice', 'marketing_email', 'marketing_sms', 'publication');--> statement-breakpoint
CREATE TYPE "public"."display_name_style" AS ENUM('first_initial', 'full', 'initials', 'anonymous');--> statement-breakpoint
CREATE TYPE "public"."entry_mode" AS ENUM('paid', 'free');--> statement-breakpoint
CREATE TYPE "public"."fitting_enquiry_status" AS ENUM('new', 'contacted', 'booked', 'completed', 'lost');--> statement-breakpoint
CREATE TYPE "public"."funding_kind" AS ENUM('insurance', 'allocated_funds');--> statement-breakpoint
CREATE TYPE "public"."hio_status" AS ENUM('pending_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."legal_scope" AS ENUM('paid_entry', 'free_promotion');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('stripe', 'card_terminal', 'cash', 'complimentary', 'free_entry');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'failed', 'refunded', 'partially_refunded', 'complimentary', 'paid_in_store', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."preferred_hand" AS ENUM('right', 'left');--> statement-breakpoint
CREATE TYPE "public"."prize_kind" AS ENUM('weekly', 'jackpot');--> statement-breakpoint
CREATE TYPE "public"."prize_status" AS ENUM('provisional', 'verified', 'awaiting_claim', 'claimed', 'fulfilled', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."promotion_status" AS ENUM('draft', 'approved', 'active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."round_status" AS ENUM('booked', 'checked_in', 'in_progress', 'paused', 'completed', 'disqualified', 'cancelled', 'voided');--> statement-breakpoint
CREATE TYPE "public"."shot_source" AS ENUM('manual', 'integration');--> statement-breakpoint
CREATE TYPE "public"."shot_status" AS ENUM('active', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('super_admin', 'manager', 'staff', 'marketing');--> statement-breakpoint
CREATE TYPE "public"."subject_type" AS ENUM('user', 'customer');--> statement-breakpoint
CREATE TYPE "public"."tie_policy" AS ENUM('equal_rank_split', 'countback', 'playoff');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" varchar(16) NOT NULL,
	"actor_id" uuid,
	"actor_label" text,
	"action" varchar(96) NOT NULL,
	"entity_type" varchar(48) NOT NULL,
	"entity_id" varchar(64),
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"simulator_id" uuid NOT NULL,
	"kind" "availability_kind" NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" varchar(5) NOT NULL,
	"end_time" varchar(5) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocked_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"simulator_id" uuid NOT NULL,
	"kind" "block_kind" NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"recurring_weekday" smallint,
	"recurring_start" varchar(5),
	"recurring_end" varchar(5),
	"recurring_from" timestamp with time zone,
	"recurring_until" timestamp with time zone,
	"external_source" varchar(32),
	"external_id" varchar(255),
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"simulator_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"customer_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "booking_status" DEFAULT 'held' NOT NULL,
	"source" "booking_source" DEFAULT 'online' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"rounds_qty" smallint DEFAULT 1 NOT NULL,
	"checkin_code" varchar(16) NOT NULL,
	"override_by_user_id" uuid,
	"utm_source" varchar(128),
	"utm_medium" varchar(128),
	"utm_campaign" varchar(128),
	"referral_code" varchar(64),
	"checked_in_at" timestamp with time zone,
	"checked_in_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_checkin_code_unique" UNIQUE("checkin_code")
);
--> statement-breakpoint
CREATE TABLE "competition_rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_summary" text NOT NULL,
	"changed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"location_id" uuid NOT NULL,
	"simulator_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"auto_create_weekly" boolean DEFAULT false NOT NULL,
	"name_pattern" text DEFAULT 'Pin Hunters — Week {n}' NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid,
	"location_id" uuid NOT NULL,
	"simulator_id" uuid NOT NULL,
	"slug" varchar(96) NOT NULL,
	"name" text NOT NULL,
	"sequence" integer,
	"description" text DEFAULT '' NOT NULL,
	"format" "competition_format" DEFAULT 'closest_to_pin' NOT NULL,
	"status" "competition_status" DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"entry_mode" "entry_mode" DEFAULT 'free' NOT NULL,
	"entry_fee_pence" integer DEFAULT 0 NOT NULL,
	"shots_per_round" smallint DEFAULT 5 NOT NULL,
	"max_entrants" integer,
	"max_rounds_per_customer" integer,
	"require_on_green" boolean DEFAULT true NOT NULL,
	"hole_name" text DEFAULT '' NOT NULL,
	"hole_distance_yards" smallint,
	"simulator_settings" text DEFAULT '' NOT NULL,
	"eligibility" text DEFAULT '' NOT NULL,
	"tie_policy" "tie_policy" DEFAULT 'equal_rank_split' NOT NULL,
	"tie_policy_text" text DEFAULT '' NOT NULL,
	"rules_markdown" text DEFAULT '' NOT NULL,
	"terms_version" varchar(32) DEFAULT 'draft-0' NOT NULL,
	"promo_image_url" text,
	"show_rounds_count" boolean DEFAULT true NOT NULL,
	"jackpot_enabled" boolean DEFAULT false NOT NULL,
	"jackpot_amount_pence" integer DEFAULT 0 NOT NULL,
	"jackpot_max_winners" integer,
	"jackpot_max_per_player" integer DEFAULT 1 NOT NULL,
	"jackpot_max_liability_pence" integer,
	"jackpot_subsequent_qualify" boolean DEFAULT true NOT NULL,
	"hio_counts_for_weekly" boolean DEFAULT true NOT NULL,
	"jackpot_claim_days" smallint DEFAULT 30 NOT NULL,
	"jackpot_funding_id" uuid,
	"published_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"finalised_at" timestamp with time zone,
	"finalised_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"leaderboard_version" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "customer_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" "consent_type" NOT NULL,
	"granted" boolean NOT NULL,
	"notice_version" varchar(32) NOT NULL,
	"source" varchar(64) NOT NULL,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" varchar(255) NOT NULL,
	"mobile" varchar(20) NOT NULL,
	"handicap" varchar(8),
	"home_club" text,
	"preferred_hand" "preferred_hand",
	"display_name_style" "display_name_style" DEFAULT 'first_initial' NOT NULL,
	"marketing_email_consent" boolean DEFAULT false NOT NULL,
	"marketing_sms_consent" boolean DEFAULT false NOT NULL,
	"publication_consent" boolean DEFAULT false NOT NULL,
	"fitting_interest" boolean DEFAULT false NOT NULL,
	"acquisition_source" varchar(64),
	"utm_source" varchar(128),
	"utm_medium" varchar(128),
	"utm_campaign" varchar(128),
	"referral_code" varchar(64),
	"merged_into_id" uuid,
	"anonymised_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fitting_enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"competition_id" uuid,
	"source" varchar(64) NOT NULL,
	"status" "fitting_enquiry_status" DEFAULT 'new' NOT NULL,
	"booked_at" timestamp with time zone,
	"sale_value_pence" integer,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hio_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shot_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "hio_status" DEFAULT 'pending_review' NOT NULL,
	"witness_user_id" uuid NOT NULL,
	"second_witness_name" text,
	"staff_statement" text NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"decision_reason" text,
	"jackpot_eligible" boolean,
	"jackpot_ineligible_reason" text,
	"jackpot_amount_pence" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hio_claims_shot_id_unique" UNIQUE("shot_id")
);
--> statement-breakpoint
CREATE TABLE "jackpot_funding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "funding_kind" NOT NULL,
	"provider" text NOT NULL,
	"policy_reference" text,
	"coverage_limit_pence" integer NOT NULL,
	"per_event_limit_pence" integer,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"covered_format" text NOT NULL,
	"exclusions" text,
	"evidence_requirements" text,
	"simulator_coverage_confirmed" boolean DEFAULT false NOT NULL,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "legal_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "legal_scope" NOT NULL,
	"terms_version" varchar(32) NOT NULL,
	"reviewer_name" text NOT NULL,
	"reviewer_organisation" text,
	"notes" text,
	"recorded_by_user_id" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"address_lines" text DEFAULT '' NOT NULL,
	"postcode" varchar(16) DEFAULT '' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Europe/London' NOT NULL,
	"phone" varchar(32) DEFAULT '' NOT NULL,
	"email" varchar(255) DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "magic_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"redirect_to" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "magic_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"type" varchar(64) NOT NULL,
	"category" varchar(16) DEFAULT 'transactional' NOT NULL,
	"to_email" varchar(255) NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"body_html" text NOT NULL,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"provider" varchar(32),
	"provider_message_id" varchar(255),
	"dedupe_key" varchar(255) NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"competition_id" uuid NOT NULL,
	"booking_id" uuid,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"rounds_qty" smallint DEFAULT 1 NOT NULL,
	"amount_pence" integer NOT NULL,
	"fee_pence" integer,
	"refunded_pence" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'GBP' NOT NULL,
	"stripe_checkout_session_id" varchar(255),
	"stripe_payment_intent_id" varchar(255),
	"reference" text,
	"idempotency_key" varchar(128),
	"recorded_by_user_id" uuid,
	"authorisation_reason" text,
	"paid_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id"),
	CONSTRAINT "payments_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "prize_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" "prize_kind" NOT NULL,
	"rank" smallint,
	"distance_mm" integer,
	"round_id" uuid,
	"shot_id" uuid,
	"hio_claim_id" uuid,
	"prize_amount_pence" integer DEFAULT 0 NOT NULL,
	"prize_description" text DEFAULT '' NOT NULL,
	"split_ways" smallint DEFAULT 1 NOT NULL,
	"status" "prize_status" DEFAULT 'provisional' NOT NULL,
	"verified_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"notification_status" "notification_status",
	"claim_deadline" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"paid_amount_pence" integer,
	"payment_method" varchar(64),
	"payment_reference" text,
	"paid_at" timestamp with time zone,
	"paid_recorded_by_user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prize_awards_hio_claim_id_unique" UNIQUE("hio_claim_id")
);
--> statement-breakpoint
CREATE TABLE "prize_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"rank" smallint NOT NULL,
	"amount_pence" integer DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"code" varchar(64),
	"status" "promotion_status" DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_starts_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_pence" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"stripe_refund_id" varchar(255),
	"idempotency_key" varchar(128) NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_stripe_refund_id_unique" UNIQUE("stripe_refund_id"),
	CONSTRAINT "refunds_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"booking_id" uuid,
	"payment_id" uuid,
	"status" "round_status" DEFAULT 'booked' NOT NULL,
	"shots_allowed" smallint NOT NULL,
	"supervised_by_user_id" uuid,
	"checked_in_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"verified_by_user_id" uuid,
	"restart_of_round_id" uuid,
	"status_reason" text,
	"result_email_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"subject_type" "subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" varchar(64),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shot_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shot_id" uuid,
	"round_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" varchar(64) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"shot_number" smallint NOT NULL,
	"distance_mm" integer,
	"on_green" boolean NOT NULL,
	"valid" boolean NOT NULL,
	"is_hole_in_one" boolean DEFAULT false NOT NULL,
	"hio_status" "hio_status",
	"simulator_shot_id" varchar(128),
	"source" "shot_source" DEFAULT 'manual' NOT NULL,
	"status" "shot_status" DEFAULT 'active' NOT NULL,
	"supersedes_shot_id" uuid,
	"correction_reason" text,
	"recorded_by_user_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slot_capacity" smallint DEFAULT 1 NOT NULL,
	"slot_minutes" smallint DEFAULT 10 NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"unavailable_reason" text,
	"integration_provider" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"type" varchar(128) NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "tracking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(64) NOT NULL,
	"customer_id" uuid,
	"competition_id" uuid,
	"context" varchar(64),
	"utm_source" varchar(128),
	"utm_medium" varchar(128),
	"utm_campaign" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"role" "staff_role" DEFAULT 'staff' NOT NULL,
	"password_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_simulator_id_simulators_id_fk" FOREIGN KEY ("simulator_id") REFERENCES "public"."simulators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_periods" ADD CONSTRAINT "blocked_periods_simulator_id_simulators_id_fk" FOREIGN KEY ("simulator_id") REFERENCES "public"."simulators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_periods" ADD CONSTRAINT "blocked_periods_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_simulator_id_simulators_id_fk" FOREIGN KEY ("simulator_id") REFERENCES "public"."simulators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_override_by_user_id_users_id_fk" FOREIGN KEY ("override_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_checked_in_by_user_id_users_id_fk" FOREIGN KEY ("checked_in_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_rule_versions" ADD CONSTRAINT "competition_rule_versions_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_rule_versions" ADD CONSTRAINT "competition_rule_versions_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_templates" ADD CONSTRAINT "competition_templates_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_templates" ADD CONSTRAINT "competition_templates_simulator_id_simulators_id_fk" FOREIGN KEY ("simulator_id") REFERENCES "public"."simulators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_template_id_competition_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."competition_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_simulator_id_simulators_id_fk" FOREIGN KEY ("simulator_id") REFERENCES "public"."simulators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_jackpot_funding_id_jackpot_funding_id_fk" FOREIGN KEY ("jackpot_funding_id") REFERENCES "public"."jackpot_funding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_finalised_by_user_id_users_id_fk" FOREIGN KEY ("finalised_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitting_enquiries" ADD CONSTRAINT "fitting_enquiries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitting_enquiries" ADD CONSTRAINT "fitting_enquiries_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitting_enquiries" ADD CONSTRAINT "fitting_enquiries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hio_claims" ADD CONSTRAINT "hio_claims_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hio_claims" ADD CONSTRAINT "hio_claims_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hio_claims" ADD CONSTRAINT "hio_claims_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hio_claims" ADD CONSTRAINT "hio_claims_witness_user_id_users_id_fk" FOREIGN KEY ("witness_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hio_claims" ADD CONSTRAINT "hio_claims_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jackpot_funding" ADD CONSTRAINT "jackpot_funding_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_approvals" ADD CONSTRAINT "legal_approvals_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_approvals" ADD CONSTRAINT "legal_approvals_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_awards" ADD CONSTRAINT "prize_awards_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_awards" ADD CONSTRAINT "prize_awards_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_awards" ADD CONSTRAINT "prize_awards_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_awards" ADD CONSTRAINT "prize_awards_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_awards" ADD CONSTRAINT "prize_awards_hio_claim_id_hio_claims_id_fk" FOREIGN KEY ("hio_claim_id") REFERENCES "public"."hio_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_awards" ADD CONSTRAINT "prize_awards_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_awards" ADD CONSTRAINT "prize_awards_paid_recorded_by_user_id_users_id_fk" FOREIGN KEY ("paid_recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_definitions" ADD CONSTRAINT "prize_definitions_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_supervised_by_user_id_users_id_fk" FOREIGN KEY ("supervised_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_evidence" ADD CONSTRAINT "shot_evidence_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_evidence" ADD CONSTRAINT "shot_evidence_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_evidence" ADD CONSTRAINT "shot_evidence_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulators" ADD CONSTRAINT "simulators_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "availability_rules_sim_idx" ON "availability_rules" USING btree ("simulator_id","weekday");--> statement-breakpoint
CREATE INDEX "blocked_periods_sim_time_idx" ON "blocked_periods" USING btree ("simulator_id","starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "blocked_periods_external_uq" ON "blocked_periods" USING btree ("external_source","external_id");--> statement-breakpoint
CREATE INDEX "bookings_sim_time_idx" ON "bookings" USING btree ("simulator_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_customer_idx" ON "bookings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "bookings_competition_idx" ON "bookings" USING btree ("competition_id","status");--> statement-breakpoint
CREATE INDEX "competitions_status_idx" ON "competitions" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "competitions_location_idx" ON "competitions" USING btree ("location_id","starts_at");--> statement-breakpoint
CREATE INDEX "customer_consents_customer_idx" ON "customer_consents" USING btree ("customer_id","type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_email_active_uq" ON "customers" USING btree ("email") WHERE "customers"."merged_into_id" is null and "customers"."anonymised_at" is null;--> statement-breakpoint
CREATE INDEX "customers_mobile_idx" ON "customers" USING btree ("mobile");--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "customers" USING btree ("last_name","first_name");--> statement-breakpoint
CREATE INDEX "hio_claims_status_idx" ON "hio_claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "magic_links_email_idx" ON "magic_links" USING btree ("email");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payments_competition_idx" ON "payments" USING btree ("competition_id","status");--> statement-breakpoint
CREATE INDEX "payments_customer_idx" ON "payments" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prize_awards_weekly_uq" ON "prize_awards" USING btree ("competition_id","customer_id") WHERE "prize_awards"."kind" = 'weekly' and "prize_awards"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "prize_awards_competition_idx" ON "prize_awards" USING btree ("competition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prize_definitions_rank_uq" ON "prize_definitions" USING btree ("competition_id","rank");--> statement-breakpoint
CREATE INDEX "rounds_competition_idx" ON "rounds" USING btree ("competition_id","status");--> statement-breakpoint
CREATE INDEX "rounds_customer_idx" ON "rounds" USING btree ("customer_id","competition_id");--> statement-breakpoint
CREATE INDEX "sessions_subject_idx" ON "sessions" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shots_active_number_uq" ON "shots" USING btree ("round_id","shot_number") WHERE "shots"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "shots_sim_id_uq" ON "shots" USING btree ("simulator_shot_id");--> statement-breakpoint
CREATE INDEX "shots_round_idx" ON "shots" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "tracking_events_type_idx" ON "tracking_events" USING btree ("type","created_at");