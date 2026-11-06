CREATE TABLE "arkiv_writer_leases" (
	"writer" text PRIMARY KEY NOT NULL,
	"lease_token" uuid NOT NULL,
	"lease_until" timestamp with time zone NOT NULL
);
