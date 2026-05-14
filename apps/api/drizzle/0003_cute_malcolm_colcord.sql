CREATE TYPE "public"."guest_event_kind" AS ENUM('search_context', 'selected_unlock_vin');--> statement-breakpoint
CREATE TABLE "guest_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guest_session_id" uuid NOT NULL,
	"kind" "guest_event_kind" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transferred_to_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_point_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guest_session_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"report_upload_id" uuid,
	"report_fingerprint_id" uuid,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"transferred_to_user_id" uuid,
	"transferred_ledger_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ADD COLUMN "report_fingerprint_id" uuid;--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
UPDATE "point_ledger_entries" SET "idempotency_key" = 'legacy:' || "id"::text WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_events" ADD CONSTRAINT "guest_events_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_events" ADD CONSTRAINT "guest_events_transferred_to_user_id_users_id_fk" FOREIGN KEY ("transferred_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_point_grants" ADD CONSTRAINT "guest_point_grants_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_point_grants" ADD CONSTRAINT "guest_point_grants_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_point_grants" ADD CONSTRAINT "guest_point_grants_report_upload_id_report_uploads_id_fk" FOREIGN KEY ("report_upload_id") REFERENCES "public"."report_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_point_grants" ADD CONSTRAINT "guest_point_grants_report_fingerprint_id_report_fingerprints_id_fk" FOREIGN KEY ("report_fingerprint_id") REFERENCES "public"."report_fingerprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_point_grants" ADD CONSTRAINT "guest_point_grants_transferred_to_user_id_users_id_fk" FOREIGN KEY ("transferred_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_point_grants" ADD CONSTRAINT "guest_point_grants_transferred_ledger_entry_id_point_ledger_entries_id_fk" FOREIGN KEY ("transferred_ledger_entry_id") REFERENCES "public"."point_ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_events_session_kind_idx" ON "guest_events" USING btree ("guest_session_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_point_grants_upload_unique" ON "guest_point_grants" USING btree ("guest_session_id","report_upload_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_token_hash_unique" ON "user_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_report_fingerprint_id_report_fingerprints_id_fk" FOREIGN KEY ("report_fingerprint_id") REFERENCES "public"."report_fingerprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "point_ledger_entries_idempotency_unique" ON "point_ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "point_ledger_entries_user_vehicle_grant_unique" ON "point_ledger_entries" USING btree ("user_id","vehicle_id") WHERE "point_ledger_entries"."reason" = 'report_grant' AND "point_ledger_entries"."delta" > 0;--> statement-breakpoint
CREATE UNIQUE INDEX "point_ledger_entries_user_upload_grant_unique" ON "point_ledger_entries" USING btree ("user_id","report_upload_id") WHERE "point_ledger_entries"."reason" = 'report_grant' AND "point_ledger_entries"."delta" > 0;--> statement-breakpoint
CREATE UNIQUE INDEX "point_ledger_entries_user_fingerprint_grant_unique" ON "point_ledger_entries" USING btree ("user_id","report_fingerprint_id") WHERE "point_ledger_entries"."reason" = 'report_grant' AND "point_ledger_entries"."delta" > 0;
