CREATE TABLE "vehicle_fact_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"fact_kind" text NOT NULL,
	"fact_key" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"report_upload_id" uuid NOT NULL,
	"fact_kind" text NOT NULL,
	"fact_key" text NOT NULL,
	"value_hash" text NOT NULL,
	"value" jsonb NOT NULL,
	"observed_at" timestamp with time zone,
	"reported_at" timestamp with time zone,
	"accepted_at" timestamp with time zone NOT NULL,
	"quality_score" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_report_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"preview_data" jsonb NOT NULL,
	"report_data" jsonb NOT NULL,
	"source_upload_count" integer NOT NULL,
	"latest_report_generated_at" timestamp with time zone,
	"rebuilt_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle_fact_conflicts" ADD CONSTRAINT "vehicle_fact_conflicts_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_observations" ADD CONSTRAINT "vehicle_observations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_observations" ADD CONSTRAINT "vehicle_observations_report_upload_id_report_uploads_id_fk" FOREIGN KEY ("report_upload_id") REFERENCES "public"."report_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_report_snapshots" ADD CONSTRAINT "vehicle_report_snapshots_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_fact_conflicts_vehicle_fact_unique" ON "vehicle_fact_conflicts" USING btree ("vehicle_id","fact_kind","fact_key") WHERE "vehicle_fact_conflicts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "vehicle_observations_vehicle_fact_idx" ON "vehicle_observations" USING btree ("vehicle_id","fact_kind","fact_key");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_observations_upload_fact_value_unique" ON "vehicle_observations" USING btree ("report_upload_id","fact_kind","fact_key","value_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_report_snapshots_vehicle_unique" ON "vehicle_report_snapshots" USING btree ("vehicle_id");
