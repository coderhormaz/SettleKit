CREATE TABLE "recovery_budgets" (
	"payment_id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_at" timestamp with time zone,
	CONSTRAINT "recovery_count" CHECK ("recovery_budgets"."count" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "recovery_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stable_key" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"state_version" integer NOT NULL,
	"actor" text NOT NULL,
	"status" text NOT NULL,
	"reason_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_intents_stable_key_unique" UNIQUE("stable_key"),
	CONSTRAINT "recovery_status" CHECK ("recovery_intents"."status" in ('scheduled','noop','refused'))
);
--> statement-breakpoint
ALTER TABLE "refund_events" ADD COLUMN "checked_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "recovery_budgets" ADD CONSTRAINT "recovery_budgets_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_budgets" ADD CONSTRAINT "recovery_budgets_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_intents" ADD CONSTRAINT "recovery_intents_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_intents" ADD CONSTRAINT "recovery_intents_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_intents" ADD CONSTRAINT "recovery_intents_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recovery_merchant_idx" ON "recovery_intents" USING btree ("merchant_id","created_at");