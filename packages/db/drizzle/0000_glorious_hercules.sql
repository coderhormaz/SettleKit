CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"nonce" text NOT NULL,
	"message" text NOT NULL,
	"purpose" text NOT NULL,
	"merchant_id" uuid,
	"browser_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_challenges_nonce_unique" UNIQUE("nonce"),
	CONSTRAINT "challenge_purpose" CHECK ("wallet_challenges"."purpose" in ('login', 'settlement'))
);
--> statement-breakpoint
CREATE TABLE "outbox_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_jobs_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "job_status" CHECK ("outbox_jobs"."status" in ('pending','processing','completed','dead')),
	CONSTRAINT "job_budget" CHECK ("outbox_jobs"."attempts" >= 0 and "outbox_jobs"."max_attempts" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_wallet" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"website_origin" text DEFAULT '' NOT NULL,
	"settlement_wallet" text NOT NULL,
	"settlement_proven_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_owner_wallet_unique" UNIQUE("owner_wallet"),
	CONSTRAINT "owner_address" CHECK ("merchants"."owner_wallet" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "settlement_address" CHECK ("merchants"."settlement_wallet" ~ '^0x[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "monetary_precision_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"is_fixture" boolean DEFAULT true NOT NULL,
	CONSTRAINT "uint256_amount" CHECK ("monetary_precision_checks"."amount" >= 0 and "monetary_precision_checks"."amount" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935)
);
--> statement-breakpoint
CREATE TABLE "request_budgets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screening_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"decision" jsonb NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screening_sources" (
	"source_id" text PRIMARY KEY NOT NULL,
	"snapshot" jsonb,
	"health" jsonb NOT NULL,
	"fetched_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_challenges" ADD CONSTRAINT "wallet_challenges_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_decisions" ADD CONSTRAINT "screening_decisions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_sessions" ADD CONSTRAINT "merchant_sessions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_merchant_idx" ON "audit_events" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "challenge_expiry_idx" ON "wallet_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "outbox_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "jobs_merchant_idx" ON "outbox_jobs" USING btree ("merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "precision_id_idx" ON "monetary_precision_checks" USING btree ("id");--> statement-breakpoint
CREATE INDEX "decisions_merchant_idx" ON "screening_decisions" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_merchant_idx" ON "merchant_sessions" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "merchant_sessions" USING btree ("expires_at");