CREATE TABLE "merchant_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_api_keys_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "api_key_scopes" CHECK (jsonb_typeof("merchant_api_keys"."scopes")='array' and jsonb_array_length("merchant_api_keys"."scopes") between 1 and 2 and "merchant_api_keys"."scopes" <@ '["checkout:create","payment:read"]'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "internal_collection_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"link_id" uuid,
	"invoice_id" uuid,
	"checkout_id" uuid,
	"amount" numeric NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_source" CHECK (("internal_collection_orders"."link_id" is null) <> ("internal_collection_orders"."invoice_id" is null)),
	CONSTRAINT "collection_state" CHECK ("internal_collection_orders"."state" in ('pending','fulfilled','cancelled','review')),
	CONSTRAINT "collection_amount_uint" CHECK ("internal_collection_orders"."amount"=trunc("internal_collection_orders"."amount") and "internal_collection_orders"."amount">0 and "internal_collection_orders"."amount"<=115792089237316195423570985008687907853269984665640564039457584007913129639935)
);
--> statement-breakpoint
CREATE TABLE "merchant_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_replay_budget" (
	"delivery_id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_at" timestamp with time zone,
	CONSTRAINT "replay_count_cap" CHECK ("delivery_replay_budget"."count" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "merchant_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"amount" numeric NOT NULL,
	"contact_id" uuid,
	"contact_snapshot" jsonb,
	"due_date" date,
	"notes" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_invoices_reference_unique" UNIQUE("reference"),
	CONSTRAINT "invoice_state" CHECK ("merchant_invoices"."state" in ('open','void')),
	CONSTRAINT "invoice_amount_uint" CHECK ("merchant_invoices"."amount"=trunc("merchant_invoices"."amount") and "merchant_invoices"."amount">0 and "merchant_invoices"."amount"<=115792089237316195423570985008687907853269984665640564039457584007913129639935)
);
--> statement-breakpoint
CREATE TABLE "merchant_settings" (
	"merchant_id" uuid PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"amount" numeric NOT NULL,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_links_reference_unique" UNIQUE("reference"),
	CONSTRAINT "link_amount_uint" CHECK ("payment_links"."amount"=trunc("payment_links"."amount") and "payment_links"."amount">0 and "payment_links"."amount"<=115792089237316195423570985008687907853269984665640564039457584007913129639935)
);
--> statement-breakpoint
CREATE TABLE "payment_review_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_test_status" CHECK ("webhook_tests"."status" in ('processing','delivered','failed'))
);
--> statement-breakpoint
CREATE TABLE "arkiv_mappings" (
	"event_id" text PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"entity_key" text,
	"expires_at_block" numeric,
	"transaction_hash" text,
	"error_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"evidence" text NOT NULL,
	"epoch" numeric NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_authorizations_evidence_unique" UNIQUE("evidence")
);
--> statement-breakpoint
CREATE TABLE "refund_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"intent_id" uuid,
	"refund_id" text NOT NULL,
	"amount" numeric NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" numeric NOT NULL,
	"block_hash" text NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"canonical" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_event_uint" CHECK ("refund_events"."amount"=trunc("refund_events"."amount") and "refund_events"."amount">0 and "refund_events"."amount"<=115792089237316195423570985008687907853269984665640564039457584007913129639935)
);
--> statement-breakpoint
CREATE TABLE "refund_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"refund_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"amount" numeric NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"submitted_tx_hash" text,
	"reason_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_intents_refund_id_unique" UNIQUE("refund_id"),
	CONSTRAINT "refund_intent_uint" CHECK ("refund_intents"."amount"=trunc("refund_intents"."amount") and "refund_intents"."amount">0 and "refund_intents"."amount"<=115792089237316195423570985008687907853269984665640564039457584007913129639935),
	CONSTRAINT "refund_intent_status" CHECK ("refund_intents"."status" in ('requested','authorized','submitted','confirmed','cancel_pending','cancelled','failed','expired','review'))
);
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "mode" text DEFAULT 'store' NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "collection_order_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "block_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merchant_api_keys" ADD CONSTRAINT "merchant_api_keys_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_collection_orders" ADD CONSTRAINT "internal_collection_orders_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_collection_orders" ADD CONSTRAINT "internal_collection_orders_link_id_payment_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."payment_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_collection_orders" ADD CONSTRAINT "internal_collection_orders_invoice_id_merchant_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."merchant_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_collection_orders" ADD CONSTRAINT "internal_collection_orders_checkout_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."checkout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_contacts" ADD CONSTRAINT "merchant_contacts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_replay_budget" ADD CONSTRAINT "delivery_replay_budget_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_replay_budget" ADD CONSTRAINT "delivery_replay_budget_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_invoices" ADD CONSTRAINT "merchant_invoices_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_invoices" ADD CONSTRAINT "merchant_invoices_contact_id_merchant_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."merchant_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_settings" ADD CONSTRAINT "merchant_settings_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_review_notes" ADD CONSTRAINT "payment_review_notes_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_review_notes" ADD CONSTRAINT "payment_review_notes_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_tests" ADD CONSTRAINT "webhook_tests_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arkiv_mappings" ADD CONSTRAINT "arkiv_mappings_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_authorizations" ADD CONSTRAINT "refund_authorizations_intent_id_refund_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."refund_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_events" ADD CONSTRAINT "refund_events_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_events" ADD CONSTRAINT "refund_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_events" ADD CONSTRAINT "refund_events_intent_id_refund_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."refund_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_intents" ADD CONSTRAINT "refund_intents_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_intents" ADD CONSTRAINT "refund_intents_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_merchant_idx" ON "merchant_api_keys" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "collection_merchant_created_idx" ON "internal_collection_orders" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "collection_link_idx" ON "internal_collection_orders" USING btree ("link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_invoice_idx" ON "internal_collection_orders" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_checkout_idx" ON "internal_collection_orders" USING btree ("checkout_id");--> statement-breakpoint
CREATE INDEX "contacts_merchant_created_idx" ON "merchant_contacts" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "replay_budget_merchant_idx" ON "delivery_replay_budget" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "invoices_merchant_created_idx" ON "merchant_invoices" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "invoices_contact_idx" ON "merchant_invoices" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "links_merchant_created_idx" ON "payment_links" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "review_notes_payment_idx" ON "payment_review_notes" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "review_notes_merchant_idx" ON "payment_review_notes" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_tests_merchant_idx" ON "webhook_tests" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "arkiv_merchant_idx" ON "arkiv_mappings" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "arkiv_expiry_idx" ON "arkiv_mappings" USING btree ("status","expires_at_block");--> statement-breakpoint
CREATE INDEX "refund_authorization_intent_idx" ON "refund_authorizations" USING btree ("intent_id","deadline");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_source_event_idx" ON "refund_events" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "refund_merchant_date_idx" ON "refund_events" USING btree ("merchant_id","block_time");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_idempotency_idx" ON "refund_intents" USING btree ("merchant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "refund_payment_idx" ON "refund_intents" USING btree ("payment_id","created_at");