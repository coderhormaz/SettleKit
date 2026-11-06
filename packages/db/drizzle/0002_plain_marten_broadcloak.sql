CREATE TABLE "chain_cursors" (
	"router" text PRIMARY KEY NOT NULL,
	"next_block" numeric NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"invoice_id" text NOT NULL,
	"merchant_wallet" text NOT NULL,
	"amount" numeric NOT NULL,
	"return_url" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"refund_hold" boolean DEFAULT false NOT NULL,
	"refund_amount" numeric DEFAULT '0' NOT NULL,
	"risk_state" text DEFAULT 'unchecked' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_sessions_reference_unique" UNIQUE("reference"),
	CONSTRAINT "checkout_sessions_invoice_id_unique" UNIQUE("invoice_id"),
	CONSTRAINT "checkout_amount_uint" CHECK ("checkout_sessions"."amount"=trunc("checkout_sessions"."amount") and "checkout_sessions"."amount">0 and "checkout_sessions"."amount"<=115792089237316195423570985008687907853269984665640564039457584007913129639935),
	CONSTRAINT "checkout_refund_uint" CHECK ("checkout_sessions"."refund_amount"=trunc("checkout_sessions"."refund_amount") and "checkout_sessions"."refund_amount">=0 and "checkout_sessions"."refund_amount"<="checkout_sessions"."amount"),
	CONSTRAINT "checkout_status" CHECK ("checkout_sessions"."status" in ('open','accepted','orphaned','review','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"state_version" integer NOT NULL,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_integrations" (
	"merchant_id" uuid PRIMARY KEY NOT NULL,
	"key_hash" text NOT NULL,
	"webhook_url" text NOT NULL,
	"order_api_url" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"order_read_secret" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_integrations_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "payer_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkout_id" uuid NOT NULL,
	"payer" text NOT NULL,
	"browser_hash" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkout_id" uuid NOT NULL,
	"payer" text NOT NULL,
	"router" text NOT NULL,
	"evidence" text NOT NULL,
	"epoch" numeric NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_authorizations_evidence_unique" UNIQUE("evidence")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkout_id" uuid NOT NULL,
	"authorization_id" uuid NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" numeric NOT NULL,
	"block_hash" text NOT NULL,
	"payer" text NOT NULL,
	"canonical" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_checkout_id_unique" UNIQUE("checkout_id")
);
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_integrations" ADD CONSTRAINT "merchant_integrations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_challenges" ADD CONSTRAINT "payer_challenges_checkout_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."checkout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_authorizations" ADD CONSTRAINT "payment_authorizations_checkout_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."checkout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_checkout_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."checkout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_authorization_id_payment_authorizations_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."payment_authorizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_idempotency_idx" ON "checkout_sessions" USING btree ("merchant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_order_idx" ON "checkout_sessions" USING btree ("merchant_id","order_id");--> statement-breakpoint
CREATE INDEX "checkout_merchant_idx" ON "checkout_sessions" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_payment_version_idx" ON "webhook_deliveries" USING btree ("payment_id","state_version");--> statement-breakpoint
CREATE INDEX "delivery_merchant_idx" ON "webhook_deliveries" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "payer_challenge_checkout_idx" ON "payer_challenges" USING btree ("checkout_id");--> statement-breakpoint
CREATE INDEX "authorization_checkout_idx" ON "payment_authorizations" USING btree ("checkout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_event_idx" ON "payments" USING btree ("tx_hash","log_index");