import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const authProvider = pgEnum("auth_provider", ["phone", "telegram", "max"]);
export const uploadStatus = pgEnum("upload_status", [
  "received",
  "parsed",
  "manual_review",
  "rejected"
]);
export const pointLedgerReason = pgEnum("point_ledger_reason", [
  "report_grant",
  "report_access_spend",
  "admin_adjustment",
  "fraud_reversal"
]);
export const guestEventKind = pgEnum("guest_event_kind", [
  "search_context",
  "selected_unlock_vin"
]);
export const subscriptionStatus = pgEnum("subscription_status", [
  "active",
  "canceled",
  "expired",
  "payment_failed"
]);
export const complaintStatus = pgEnum("complaint_status", [
  "open",
  "in_review",
  "resolved",
  "rejected"
]);
export const listingSnapshotStatus = pgEnum("listing_snapshot_status", [
  "captured",
  "unavailable",
  "manual_review"
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  primaryContactProvider: authProvider("primary_contact_provider"),
  emailForReceipts: text("email_for_receipts"),
  pointsBalance: integer("points_balance").notNull().default(0),
  ...timestamps
});

export const authIdentities = pgTable(
  "auth_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    provider: authProvider("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    displayName: text("display_name"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps
  },
  (table) => ({
    providerUserUnique: uniqueIndex("auth_identities_provider_user_unique").on(
      table.provider,
      table.providerUserId
    ),
    userProviderUnique: uniqueIndex("auth_identities_user_provider_unique").on(
      table.userId,
      table.provider
    )
  })
);

export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => ({
    userSessionTokenUnique: uniqueIndex("user_sessions_token_hash_unique").on(table.tokenHash),
    userSessionUserIdx: index("user_sessions_user_idx").on(table.userId)
  })
);

export const guestSessions = pgTable(
  "guest_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedByUserId: uuid("claimed_by_user_id").references(() => users.id),
    ...timestamps
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("guest_sessions_token_hash_unique").on(table.tokenHash)
  })
);

export const guestEvents = pgTable(
  "guest_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guestSessionId: uuid("guest_session_id").notNull().references(() => guestSessions.id),
    kind: guestEventKind("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    transferredToUserId: uuid("transferred_to_user_id").references(() => users.id),
    ...timestamps
  },
  (table) => ({
    guestEventsSessionKindIdx: index("guest_events_session_kind_idx").on(
      table.guestSessionId,
      table.kind
    )
  })
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vin: text("vin").notNull(),
    make: text("make"),
    model: text("model"),
    year: integer("year"),
    bodyType: text("body_type"),
    color: text("color"),
    engine: text("engine"),
    transmission: text("transmission"),
    driveType: text("drive_type"),
    extraData: jsonb("extra_data").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps
  },
  (table) => ({
    vinUnique: uniqueIndex("vehicles_vin_unique").on(table.vin)
  })
);

export const vehicleIdentifiers = pgTable(
  "vehicle_identifiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => ({
    identifierLookup: index("vehicle_identifiers_lookup_idx").on(table.kind, table.value)
  })
);

export const reportFingerprints = pgTable(
  "report_fingerprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fingerprint: text("fingerprint").notNull(),
    automaticGrantCount: integer("automatic_grant_count").notNull().default(0),
    ...timestamps
  },
  (table) => ({
    fingerprintUnique: uniqueIndex("report_fingerprints_fingerprint_unique").on(table.fingerprint)
  })
);

export const reportUploads = pgTable(
  "report_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id),
    guestSessionId: uuid("guest_session_id").references(() => guestSessions.id),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id),
    reportFingerprintId: uuid("report_fingerprint_id").references(() => reportFingerprints.id),
    status: uploadStatus("status").notNull().default("received"),
    sourceKind: text("source_kind").notNull(),
    originalObjectKey: text("original_object_key"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    parserVersion: text("parser_version"),
    parseQualityScore: numeric("parse_quality_score", { precision: 5, scale: 2 }),
    rawData: jsonb("raw_data").$type<Record<string, unknown>>().notNull().default({}),
    reviewReason: text("review_reason"),
    ...timestamps
  },
  (table) => ({
    uploadVehicleIdx: index("report_uploads_vehicle_idx").on(table.vehicleId),
    uploadUserIdx: index("report_uploads_user_idx").on(table.userId)
  })
);

export const vehicleObservations = pgTable(
  "vehicle_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
    reportUploadId: uuid("report_upload_id").notNull().references(() => reportUploads.id),
    factKind: text("fact_kind").notNull(),
    factKey: text("fact_key").notNull(),
    valueHash: text("value_hash").notNull(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    qualityScore: numeric("quality_score", { precision: 5, scale: 2 }),
    ...timestamps
  },
  (table) => ({
    vehicleFactIdx: index("vehicle_observations_vehicle_fact_idx").on(
      table.vehicleId,
      table.factKind,
      table.factKey
    ),
    uploadFactValueUnique: uniqueIndex("vehicle_observations_upload_fact_value_unique").on(
      table.reportUploadId,
      table.factKind,
      table.factKey,
      table.valueHash
    )
  })
);

export const vehicleFactConflicts = pgTable(
  "vehicle_fact_conflicts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
    factKind: text("fact_kind").notNull(),
    factKey: text("fact_key").notNull(),
    severity: text("severity").notNull(),
    status: text("status").notNull().default("open"),
    values: jsonb("values").$type<Record<string, unknown>[]>().notNull().default([]),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps
  },
  (table) => ({
    vehicleFactUnique: uniqueIndex("vehicle_fact_conflicts_vehicle_fact_unique")
      .on(table.vehicleId, table.factKind, table.factKey)
      .where(sql`${table.status} = 'open'`)
  })
);

export const vehicleReportSnapshots = pgTable(
  "vehicle_report_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
    previewData: jsonb("preview_data").$type<Record<string, unknown>>().notNull(),
    reportData: jsonb("report_data").$type<Record<string, unknown>>().notNull(),
    sourceUploadCount: integer("source_upload_count").notNull(),
    latestReportGeneratedAt: timestamp("latest_report_generated_at", { withTimezone: true }),
    rebuiltAt: timestamp("rebuilt_at", { withTimezone: true }).notNull(),
    ...timestamps
  },
  (table) => ({
    vehicleUnique: uniqueIndex("vehicle_report_snapshots_vehicle_unique").on(table.vehicleId)
  })
);

export const listingSnapshots = pgTable(
  "listing_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceKind: text("source_kind").notNull(),
    listingId: text("listing_id").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id),
    status: listingSnapshotStatus("status").notNull(),
    originalObjectKey: text("original_object_key"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    originalExpiresAt: timestamp("original_expires_at", { withTimezone: true }),
    normalizedData: jsonb("normalized_data").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps
  },
  (table) => ({
    listingIdentityUnique: uniqueIndex("listing_snapshots_identity_unique").on(
      table.sourceKind,
      table.listingId
    ),
    listingVehicleIdx: index("listing_snapshots_vehicle_idx").on(table.vehicleId)
  })
);

export const pointLedgerEntries = pgTable(
  "point_ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id),
    reportUploadId: uuid("report_upload_id").references(() => reportUploads.id),
    reportFingerprintId: uuid("report_fingerprint_id").references(() => reportFingerprints.id),
    delta: integer("delta").notNull(),
    reason: pointLedgerReason("reason").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    note: text("note"),
    ...timestamps
  },
  (table) => ({
    pointUserIdx: index("point_ledger_entries_user_idx").on(table.userId),
    pointIdempotencyUnique: uniqueIndex("point_ledger_entries_idempotency_unique").on(
      table.idempotencyKey
    ),
    pointUserVehicleGrantUnique: uniqueIndex("point_ledger_entries_user_vehicle_grant_unique")
      .on(table.userId, table.vehicleId)
      .where(sql`${table.reason} = 'report_grant' AND ${table.delta} > 0`),
    pointUserUploadGrantUnique: uniqueIndex("point_ledger_entries_user_upload_grant_unique")
      .on(table.userId, table.reportUploadId)
      .where(sql`${table.reason} = 'report_grant' AND ${table.delta} > 0`),
    pointUserFingerprintGrantUnique: uniqueIndex(
      "point_ledger_entries_user_fingerprint_grant_unique"
    )
      .on(table.userId, table.reportFingerprintId)
      .where(sql`${table.reason} = 'report_grant' AND ${table.delta} > 0`)
  })
);

export const guestPointGrants = pgTable(
  "guest_point_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guestSessionId: uuid("guest_session_id").notNull().references(() => guestSessions.id),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id),
    reportUploadId: uuid("report_upload_id").references(() => reportUploads.id),
    reportFingerprintId: uuid("report_fingerprint_id").references(() => reportFingerprints.id),
    points: integer("points").notNull(),
    reason: text("reason").notNull(),
    transferredToUserId: uuid("transferred_to_user_id").references(() => users.id),
    transferredLedgerEntryId: uuid("transferred_ledger_entry_id").references(
      () => pointLedgerEntries.id
    ),
    ...timestamps
  },
  (table) => ({
    guestPointGrantUploadUnique: uniqueIndex("guest_point_grants_upload_unique").on(
      table.guestSessionId,
      table.reportUploadId
    )
  })
);

export const vehicleAccesses = pgTable(
  "vehicle_accesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
    accessMethod: text("access_method").notNull(),
    firstAccessedAt: timestamp("first_accessed_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps
  },
  (table) => ({
    userVehicleUnique: uniqueIndex("vehicle_accesses_user_vehicle_unique").on(
      table.userId,
      table.vehicleId
    )
  })
);

export const subscriptionPlans = pgTable(
  "subscription_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    priceRub: integer("price_rub").notNull(),
    reportsPerPeriod: integer("reports_per_period").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps
  },
  (table) => ({
    codeUnique: uniqueIndex("subscription_plans_code_unique").on(table.code)
  })
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    planId: uuid("plan_id").notNull().references(() => subscriptionPlans.id),
    status: subscriptionStatus("status").notNull(),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    remainingReports: integer("remaining_reports").notNull(),
    autoRenew: boolean("auto_renew").notNull().default(true),
    provider: text("provider").notNull(),
    providerSubscriptionId: text("provider_subscription_id"),
    ...timestamps
  },
  (table) => ({
    subscriptionUserIdx: index("subscriptions_user_idx").on(table.userId)
  })
);

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => ({
    shareTokenUnique: uniqueIndex("share_links_token_hash_unique").on(table.tokenHash)
  })
);

export const supportTickets = pgTable("support_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  channel: text("channel").notNull(),
  status: complaintStatus("status").notNull().default("open"),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  ...timestamps
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    auditEntityIdx: index("audit_events_entity_idx").on(table.entityType, table.entityId)
  })
);
