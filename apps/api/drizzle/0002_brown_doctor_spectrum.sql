CREATE TYPE "public"."listing_snapshot_status" AS ENUM('captured', 'unavailable', 'manual_review');--> statement-breakpoint
CREATE TABLE "listing_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_kind" text NOT NULL,
	"listing_id" text NOT NULL,
	"canonical_url" text NOT NULL,
	"vehicle_id" uuid,
	"status" "listing_snapshot_status" NOT NULL,
	"original_object_key" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"original_expires_at" timestamp with time zone,
	"normalized_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_snapshots" ADD CONSTRAINT "listing_snapshots_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listing_snapshots_identity_unique" ON "listing_snapshots" USING btree ("source_kind","listing_id");--> statement-breakpoint
CREATE INDEX "listing_snapshots_vehicle_idx" ON "listing_snapshots" USING btree ("vehicle_id");