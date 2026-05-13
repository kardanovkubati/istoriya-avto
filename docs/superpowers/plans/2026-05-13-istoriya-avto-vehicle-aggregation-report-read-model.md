# Vehicle Aggregation And Report Read Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Milestone 2: turn one or more parsed `report_uploads` for the same VIN into one neutral vehicle preview and full report read model.

**Architecture:** Keep source parser output immutable in `report_uploads.raw_data.parseResult`, derive normalized vehicle observations from it, store all fact versions, detect conflicts explicitly, and rebuild a denormalized read snapshot per VIN. User-facing API responses expose only our summary and neutral metadata; they must not expose original report files, parser/source names, or third-party brand names as fact sources.

**Tech Stack:** Bun, TypeScript, Hono, Drizzle ORM, PostgreSQL, Zod, bun:test, existing `ParsedReport` contract from Milestone 1.

---

## Scope Decisions

- This milestone is backend-only unless a worker finds an API contract bug that requires a tiny frontend type update. Run `bun run --cwd apps/web build` only if frontend files change.
- Only `report_uploads.status = "parsed"` contributes to the public read model. `manual_review` and `rejected` uploads stay stored but do not affect aggregation until an admin flow exists.
- `vehicles` remains the VIN lookup and lightweight denormalized profile. New observation tables become the source of truth for merged facts.
- Source provenance stays internal as `reportUploadId`, `reportedAt`, parser metadata, and storage metadata. User-facing responses must not contain `sourceKind`, `parserVersion`, `originalObjectKey`, `Автотека`, `Авито`, `Auto.ru`, `Дром`, or `Drom`.
- The full report API in this milestone is a read-model endpoint only. Access/unlock enforcement is owned by Milestones 3 and 4.
- Auto.ru and Drom parsers are out of scope. The observation model must not hard-code Autoteka-specific field names beyond consuming the existing generic `ParsedReport` shape.
- Photos are not implemented in Milestone 2 because Milestone 1 parser does not extract them. Preview includes `photo: null` and the shape is ready for Milestone 3 listing snapshots.
- Original PDF retention remains unchanged: originals stay private and are not returned by vehicle report APIs.

## Target File Structure

```text
apps/api/src
├── app.ts
├── db
│   └── schema.ts
└── modules
    ├── uploads
    │   ├── report-upload-service.test.ts
    │   ├── report-upload-service.ts
    │   └── report-upload-repository.ts
    └── vehicles
        ├── conflict-detection.test.ts
        ├── conflict-detection.ts
        ├── drizzle-vehicle-report-repository.ts
        ├── fact-normalizer.test.ts
        ├── fact-normalizer.ts
        ├── report-read-model.test.ts
        ├── report-read-model.ts
        ├── routes.test.ts
        ├── routes.ts
        ├── transparency-score.test.ts
        ├── transparency-score.ts
        ├── vehicle-aggregation-service.test.ts
        ├── vehicle-aggregation-service.ts
        └── vehicle-report-repository.ts
```

## Data Model

Add these tables in `apps/api/src/db/schema.ts`:

- `vehicle_observations`: one normalized fact observation from one parsed upload.
- `vehicle_fact_conflicts`: current unresolved conflict snapshots per vehicle/fact.
- `vehicle_report_snapshots`: denormalized preview/full read model per vehicle.

Use text columns for fact kinds and keys to keep future parser support cheap, while validating values in TypeScript:

```ts
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
    reportUploadFactUnique: uniqueIndex("vehicle_observations_upload_fact_value_unique").on(
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
    vehicleConflictUnique: uniqueIndex("vehicle_fact_conflicts_vehicle_fact_unique").on(
      table.vehicleId,
      table.factKind,
      table.factKey
    )
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
    vehicleReportSnapshotUnique: uniqueIndex("vehicle_report_snapshots_vehicle_unique").on(
      table.vehicleId
    )
  })
);
```

Generate the migration only after schema tests and typecheck pass:

```bash
bun run --cwd apps/api db:generate
```

Expected: one new migration adding the three tables and indexes above.

## Public API Shape

Preview endpoint:

```http
GET /api/vehicles/:vin/preview
```

Success response:

```json
{
  "preview": {
    "vehicleId": "vehicle-1",
    "vinMasked": "XTA2109********99",
    "title": "LADA Granta",
    "make": "LADA",
    "model": "Granta",
    "year": 2021,
    "bodyType": "sedan",
    "color": "white",
    "engine": "1.6",
    "transmission": "manual",
    "driveType": "front",
    "photo": null,
    "lastListing": {
      "observedAt": "2026-04-15T00:00:00.000Z",
      "priceRub": 780000,
      "mileageKm": 42000,
      "city": "Москва"
    },
    "lastUpdatedAt": "2026-05-01T00:00:00.000Z"
  }
}
```

Full report endpoint:

```http
GET /api/vehicles/:vin/report
```

Success response:

```json
{
  "report": {
    "vehicleId": "vehicle-1",
    "vin": "XTA210990Y2765499",
    "generatedAt": "2026-05-13T10:00:00.000Z",
    "summary": {
      "historyBasisText": "История составлена на основе 2 загруженных отчетов. Последнее обновление: 01.05.2026.",
      "sourceUploadCount": 2,
      "lastUpdatedAt": "2026-05-01T00:00:00.000Z",
      "freshnessWarning": null,
      "transparency": {
        "kind": "score",
        "value": 4.4,
        "max": 5,
        "label": "История в целом прозрачна"
      }
    },
    "passport": {
      "vin": "XTA210990Y2765499",
      "make": "LADA",
      "model": "Granta",
      "year": 2021,
      "bodyType": "sedan",
      "color": "white",
      "engine": "1.6",
      "transmission": "manual",
      "driveType": "front"
    },
    "legalRisks": {
      "restrictions": { "status": "not_found", "checkedAt": "2026-05-01T00:00:00.000Z" },
      "pledge": { "status": "not_found", "checkedAt": "2026-05-01T00:00:00.000Z" },
      "wanted": { "status": "not_found", "checkedAt": "2026-05-01T00:00:00.000Z" }
    },
    "accidentsAndRepairs": {
      "accidents": { "status": "not_found", "checkedAt": "2026-05-01T00:00:00.000Z" },
      "repairCalculations": { "status": "not_found", "checkedAt": "2026-05-01T00:00:00.000Z" }
    },
    "commercialUse": {
      "taxi": { "status": "unknown", "checkedAt": null },
      "leasing": { "status": "unknown", "checkedAt": null }
    },
    "mileage": {
      "readings": [
        { "observedAt": "2026-04-15T00:00:00.000Z", "mileageKm": 42000, "context": "listing" }
      ],
      "hasRollbackSignals": false
    },
    "listings": [
      {
        "observedAt": "2026-04-15T00:00:00.000Z",
        "priceRub": 780000,
        "mileageKm": 42000,
        "city": "Москва"
      }
    ],
    "conflicts": [],
    "updateHistory": [
      { "reportedAt": "2026-05-01T00:00:00.000Z", "acceptedAt": "2026-05-13T10:00:00.000Z" }
    ]
  }
}
```

Not found response for both endpoints:

```json
{
  "error": {
    "code": "vehicle_report_not_found",
    "message": "Отчета по этому VIN пока нет."
  }
}
```

Invalid VIN response:

```json
{
  "error": {
    "code": "invalid_vin",
    "message": "Передайте корректный VIN."
  }
}
```

---

### Task 1: Define Vehicle Report Contracts And Leak Guard

**Files:**
- Create: `apps/api/src/modules/vehicles/report-read-model.ts`
- Create: `apps/api/src/modules/vehicles/report-read-model.test.ts`

- [ ] **Step 1: Write failing tests for public contracts and source-brand leak guard**

Create `apps/api/src/modules/vehicles/report-read-model.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { assertNoSourceBrandLeak, maskVinForPreview } from "./report-read-model";

describe("vehicle report read model helpers", () => {
  it("masks VIN for preview without exposing plate data", () => {
    expect(maskVinForPreview("XTA210990Y2765499")).toBe("XTA2109********99");
  });

  it("does not fail neutral user-facing responses", () => {
    expect(() =>
      assertNoSourceBrandLeak({
        summary: {
          historyBasisText:
            "История составлена на основе 2 загруженных отчетов. Последнее обновление: 01.05.2026."
        }
      })
    ).not.toThrow();
  });

  it("fails if a user-facing response contains third-party source names or internal source fields", () => {
    const unsafePayloads = [
      { sourceKind: "autoteka_pdf" },
      { parserVersion: "autoteka-v1" },
      { originalObjectKey: "report-originals/1.pdf" },
      { text: "Факт получен из Автотеки" },
      { text: "Источник: Авито" },
      { text: "Источник: Auto.ru" },
      { text: "Источник: Дром" },
      { text: "Источник: Drom" }
    ];

    for (const payload of unsafePayloads) {
      expect(() => assertNoSourceBrandLeak(payload)).toThrow("source_brand_leak");
    }
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test apps/api/src/modules/vehicles/report-read-model.test.ts
```

Expected: FAIL because `report-read-model.ts` does not exist.

- [ ] **Step 3: Implement contracts and helpers**

Create `apps/api/src/modules/vehicles/report-read-model.ts`:

```ts
export type RiskStatus = "found" | "not_found" | "unknown";

export type ReportRiskFact = {
  status: RiskStatus;
  checkedAt: string | null;
};

export type TransparencyScore =
  | {
      kind: "score";
      value: number;
      max: 5;
      label: "История в целом прозрачна" | "Есть вопросы" | "Много вопросов";
    }
  | {
      kind: "insufficient_data";
      message: "Недостаточно данных для оценки.";
      reasons: string[];
    };

export type VehicleListingReadModel = {
  observedAt: string | null;
  priceRub: number | null;
  mileageKm: number | null;
  city: string | null;
};

export type VehicleMileageReadingReadModel = {
  observedAt: string | null;
  mileageKm: number;
  context: string;
};

export type VehicleConflictReadModel = {
  factKind: string;
  factKey: string;
  severity: "info" | "warning" | "critical";
  message: string;
  values: Array<{
    value: unknown;
    observedAt: string | null;
    reportedAt: string | null;
    isLatest: boolean;
  }>;
};

export type VehiclePreviewReadModel = {
  vehicleId: string;
  vinMasked: string;
  title: string;
  make: string | null;
  model: string | null;
  year: number | null;
  bodyType: string | null;
  color: string | null;
  engine: string | null;
  transmission: string | null;
  driveType: string | null;
  photo: null;
  lastListing: VehicleListingReadModel | null;
  lastUpdatedAt: string | null;
};

export type VehicleFullReportReadModel = {
  vehicleId: string;
  vin: string;
  generatedAt: string;
  summary: {
    historyBasisText: string;
    sourceUploadCount: number;
    lastUpdatedAt: string | null;
    freshnessWarning: string | null;
    transparency: TransparencyScore;
  };
  passport: {
    vin: string;
    make: string | null;
    model: string | null;
    year: number | null;
    bodyType: string | null;
    color: string | null;
    engine: string | null;
    transmission: string | null;
    driveType: string | null;
  };
  legalRisks: {
    restrictions: ReportRiskFact;
    pledge: ReportRiskFact;
    wanted: ReportRiskFact;
  };
  accidentsAndRepairs: {
    accidents: ReportRiskFact;
    repairCalculations: ReportRiskFact;
  };
  commercialUse: {
    taxi: ReportRiskFact;
    leasing: ReportRiskFact;
  };
  mileage: {
    readings: VehicleMileageReadingReadModel[];
    hasRollbackSignals: boolean;
  };
  listings: VehicleListingReadModel[];
  conflicts: VehicleConflictReadModel[];
  updateHistory: Array<{
    reportedAt: string | null;
    acceptedAt: string;
  }>;
};

const SOURCE_LEAK_PATTERN =
  /(sourceKind|parserVersion|originalObjectKey|autoteka|автотек|авито|auto\.ru|дром|drom)/i;

export function maskVinForPreview(vin: string): string {
  return `${vin.slice(0, 7)}********${vin.slice(-2)}`;
}

export function assertNoSourceBrandLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (SOURCE_LEAK_PATTERN.test(serialized)) {
    throw new Error("source_brand_leak");
  }
}
```

- [ ] **Step 4: Run the contract tests**

Run:

```bash
bun test apps/api/src/modules/vehicles/report-read-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/vehicles/report-read-model.ts apps/api/src/modules/vehicles/report-read-model.test.ts
git commit -m "feat: define vehicle report read model contract"
```

---

### Task 2: Normalize Parsed Reports Into Vehicle Observations

**Files:**
- Create: `apps/api/src/modules/vehicles/fact-normalizer.ts`
- Create: `apps/api/src/modules/vehicles/fact-normalizer.test.ts`

- [ ] **Step 1: Write failing normalization tests**

Create `apps/api/src/modules/vehicles/fact-normalizer.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { ParsedReport } from "../parsing/report-parser";
import { normalizeParsedReportToObservations } from "./fact-normalizer";

const parsedReport: ParsedReport = {
  sourceKind: "autoteka_pdf",
  parserVersion: "autoteka-v1",
  status: "parsed",
  vin: "XTA210990Y2765499",
  generatedAt: "2026-05-01T00:00:00.000Z",
  vehicle: {
    vin: "XTA210990Y2765499",
    make: "LADA",
    model: "Granta",
    year: 2021,
    bodyType: "sedan",
    color: "white",
    engine: "1.6",
    transmission: "manual",
    driveType: "front"
  },
  listings: [
    {
      observedAt: "2026-04-15T00:00:00.000Z",
      priceRub: 780000,
      mileageKm: 42000,
      city: "Москва"
    }
  ],
  mileageReadings: [
    {
      observedAt: "2026-04-15T00:00:00.000Z",
      mileageKm: 42000,
      context: "listing"
    }
  ],
  riskFlags: {
    accidents: "not_found",
    repairCalculations: "not_found",
    restrictions: "not_found",
    pledge: "not_found",
    wanted: "not_found",
    taxi: "unknown",
    leasing: "unknown"
  },
  keyBlocks: ["vehicle_passport", "listings_or_mileage", "risk_checks"],
  warnings: [],
  qualityScore: 1
};

describe("normalizeParsedReportToObservations", () => {
  it("turns vehicle passport, listings, mileage, risk flags, and key blocks into observations", () => {
    const observations = normalizeParsedReportToObservations({
      vehicleId: "vehicle-1",
      reportUploadId: "upload-1",
      acceptedAt: "2026-05-13T10:00:00.000Z",
      parsedReport
    });

    expect(observations.map((observation) => `${observation.factKind}:${observation.factKey}`)).toEqual([
      "identifier:vin",
      "passport:make",
      "passport:model",
      "passport:year",
      "passport:bodyType",
      "passport:color",
      "passport:engine",
      "passport:transmission",
      "passport:driveType",
      "listing:listing",
      "mileage:mileage",
      "risk_flag:accidents",
      "risk_flag:repairCalculations",
      "risk_flag:restrictions",
      "risk_flag:pledge",
      "risk_flag:wanted",
      "risk_flag:taxi",
      "risk_flag:leasing",
      "quality_marker:vehicle_passport",
      "quality_marker:listings_or_mileage",
      "quality_marker:risk_checks"
    ]);
    expect(observations[0]).toMatchObject({
      vehicleId: "vehicle-1",
      reportUploadId: "upload-1",
      factKind: "identifier",
      factKey: "vin",
      observedAt: "2026-05-01T00:00:00.000Z",
      reportedAt: "2026-05-01T00:00:00.000Z",
      acceptedAt: "2026-05-13T10:00:00.000Z",
      qualityScore: 1
    });
    expect(observations.every((observation) => observation.valueHash.length === 64)).toBe(true);
  });

  it("omits null passport values and deduplicates identical mileage/listing observations", () => {
    const observations = normalizeParsedReportToObservations({
      vehicleId: "vehicle-1",
      reportUploadId: "upload-1",
      acceptedAt: "2026-05-13T10:00:00.000Z",
      parsedReport: {
        ...parsedReport,
        vehicle: { ...parsedReport.vehicle, color: null },
        listings: [parsedReport.listings[0]!, parsedReport.listings[0]!],
        mileageReadings: [parsedReport.mileageReadings[0]!, parsedReport.mileageReadings[0]!]
      }
    });

    expect(observations.some((observation) => observation.factKey === "color")).toBe(false);
    expect(observations.filter((observation) => observation.factKind === "listing")).toHaveLength(1);
    expect(observations.filter((observation) => observation.factKind === "mileage")).toHaveLength(1);
  });

  it("rejects non-parsed reports before normalization", () => {
    expect(() =>
      normalizeParsedReportToObservations({
        vehicleId: "vehicle-1",
        reportUploadId: "upload-1",
        acceptedAt: "2026-05-13T10:00:00.000Z",
        parsedReport: { ...parsedReport, status: "manual_review" }
      })
    ).toThrow("parsed_report_required");
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
bun test apps/api/src/modules/vehicles/fact-normalizer.test.ts
```

Expected: FAIL because the normalizer module does not exist.

- [ ] **Step 3: Implement observation normalizer**

Create `apps/api/src/modules/vehicles/fact-normalizer.ts`:

```ts
import { createHash } from "node:crypto";
import type { ParsedReport } from "../parsing/report-parser";

export type VehicleFactKind =
  | "identifier"
  | "passport"
  | "listing"
  | "mileage"
  | "risk_flag"
  | "quality_marker";

export type NormalizedVehicleObservation = {
  id?: string;
  vehicleId: string;
  reportUploadId: string;
  factKind: VehicleFactKind;
  factKey: string;
  valueHash: string;
  value: Record<string, unknown>;
  observedAt: string | null;
  reportedAt: string | null;
  acceptedAt: string;
  qualityScore: number;
};

type NormalizeInput = {
  vehicleId: string;
  reportUploadId: string;
  acceptedAt: string;
  parsedReport: ParsedReport;
};

const PASSPORT_FIELDS = [
  "make",
  "model",
  "year",
  "bodyType",
  "color",
  "engine",
  "transmission",
  "driveType"
] as const;

const RISK_FIELDS = [
  "accidents",
  "repairCalculations",
  "restrictions",
  "pledge",
  "wanted",
  "taxi",
  "leasing"
] as const;

export function normalizeParsedReportToObservations(input: NormalizeInput): NormalizedVehicleObservation[] {
  const { parsedReport } = input;
  if (parsedReport.status !== "parsed" || parsedReport.vin === null) {
    throw new Error("parsed_report_required");
  }

  const reportedAt = parsedReport.generatedAt;
  const observations: NormalizedVehicleObservation[] = [
    createObservation(input, "identifier", "vin", { vin: parsedReport.vin }, reportedAt)
  ];

  for (const field of PASSPORT_FIELDS) {
    const value = parsedReport.vehicle[field];
    if (value === null) continue;
    observations.push(
      createObservation(input, "passport", field, { field, value }, reportedAt)
    );
  }

  for (const listing of parsedReport.listings) {
    observations.push(
      createObservation(input, "listing", "listing", { ...listing }, listing.observedAt)
    );
  }

  for (const reading of parsedReport.mileageReadings) {
    observations.push(
      createObservation(input, "mileage", "mileage", { ...reading }, reading.observedAt)
    );
  }

  for (const risk of RISK_FIELDS) {
    observations.push(
      createObservation(
        input,
        "risk_flag",
        risk,
        { risk, status: parsedReport.riskFlags[risk] },
        reportedAt
      )
    );
  }

  for (const keyBlock of parsedReport.keyBlocks) {
    observations.push(
      createObservation(input, "quality_marker", keyBlock, { keyBlock }, reportedAt)
    );
  }

  return deduplicateObservations(observations);
}

function createObservation(
  input: NormalizeInput,
  factKind: VehicleFactKind,
  factKey: string,
  value: Record<string, unknown>,
  observedAt: string | null
): NormalizedVehicleObservation {
  return {
    vehicleId: input.vehicleId,
    reportUploadId: input.reportUploadId,
    factKind,
    factKey,
    valueHash: hashValue({ factKind, factKey, value, observedAt }),
    value,
    observedAt,
    reportedAt: input.parsedReport.generatedAt,
    acceptedAt: input.acceptedAt,
    qualityScore: input.parsedReport.qualityScore
  };
}

function deduplicateObservations(
  observations: NormalizedVehicleObservation[]
): NormalizedVehicleObservation[] {
  const seen = new Set<string>();
  return observations.filter((observation) => {
    const key = `${observation.factKind}:${observation.factKey}:${observation.valueHash}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableJson(nestedValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
```

- [ ] **Step 4: Run normalizer tests**

Run:

```bash
bun test apps/api/src/modules/vehicles/fact-normalizer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/vehicles/fact-normalizer.ts apps/api/src/modules/vehicles/fact-normalizer.test.ts
git commit -m "feat: normalize parsed reports into vehicle observations"
```

---

### Task 3: Detect Conflicts From Observations

**Files:**
- Create: `apps/api/src/modules/vehicles/conflict-detection.ts`
- Create: `apps/api/src/modules/vehicles/conflict-detection.test.ts`

- [ ] **Step 1: Write failing conflict tests**

Create `apps/api/src/modules/vehicles/conflict-detection.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { NormalizedVehicleObservation } from "./fact-normalizer";
import { detectVehicleFactConflicts } from "./conflict-detection";

describe("detectVehicleFactConflicts", () => {
  it("stores conflicting passport values instead of silently choosing one", () => {
    const conflicts = detectVehicleFactConflicts([
      observation({
        id: "obs-1",
        factKind: "passport",
        factKey: "color",
        value: { field: "color", value: "white" },
        reportedAt: "2026-04-01T00:00:00.000Z"
      }),
      observation({
        id: "obs-2",
        factKind: "passport",
        factKey: "color",
        value: { field: "color", value: "black" },
        reportedAt: "2026-05-01T00:00:00.000Z"
      })
    ]);

    expect(conflicts).toEqual([
      {
        vehicleId: "vehicle-1",
        factKind: "passport",
        factKey: "color",
        severity: "warning",
        status: "open",
        values: [
          {
            observationIds: ["obs-2"],
            value: { field: "color", value: "black" },
            observedAt: "2026-05-01T00:00:00.000Z",
            reportedAt: "2026-05-01T00:00:00.000Z",
            isLatest: true
          },
          {
            observationIds: ["obs-1"],
            value: { field: "color", value: "white" },
            observedAt: "2026-04-01T00:00:00.000Z",
            reportedAt: "2026-04-01T00:00:00.000Z",
            isLatest: false
          }
        ]
      }
    ]);
  });

  it("detects mileage rollback signals as critical conflicts", () => {
    const conflicts = detectVehicleFactConflicts([
      observation({
        id: "obs-1",
        factKind: "mileage",
        factKey: "mileage",
        value: { observedAt: "2026-01-01T00:00:00.000Z", mileageKm: 70000, context: "listing" },
        observedAt: "2026-01-01T00:00:00.000Z"
      }),
      observation({
        id: "obs-2",
        factKind: "mileage",
        factKey: "mileage",
        value: { observedAt: "2026-02-01T00:00:00.000Z", mileageKm: 45000, context: "listing" },
        observedAt: "2026-02-01T00:00:00.000Z"
      })
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      factKind: "mileage",
      factKey: "mileage_rollback",
      severity: "critical",
      status: "open"
    });
  });

  it("does not create conflicts for repeated identical values", () => {
    const conflicts = detectVehicleFactConflicts([
      observation({
        id: "obs-1",
        factKind: "passport",
        factKey: "make",
        value: { field: "make", value: "LADA" }
      }),
      observation({
        id: "obs-2",
        factKind: "passport",
        factKey: "make",
        value: { field: "make", value: "LADA" }
      })
    ]);

    expect(conflicts).toEqual([]);
  });
});

function observation(
  overrides: Partial<NormalizedVehicleObservation>
): NormalizedVehicleObservation {
  return {
    id: "obs",
    vehicleId: "vehicle-1",
    reportUploadId: "upload-1",
    factKind: "passport",
    factKey: "make",
    valueHash: "hash",
    value: { field: "make", value: "LADA" },
    observedAt: overrides.reportedAt ?? "2026-05-01T00:00:00.000Z",
    reportedAt: "2026-05-01T00:00:00.000Z",
    acceptedAt: "2026-05-13T10:00:00.000Z",
    qualityScore: 1,
    ...overrides
  };
}
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
bun test apps/api/src/modules/vehicles/conflict-detection.test.ts
```

Expected: FAIL because conflict detection does not exist.

- [ ] **Step 3: Implement conflict detection**

Create `apps/api/src/modules/vehicles/conflict-detection.ts`:

```ts
import type { NormalizedVehicleObservation } from "./fact-normalizer";

export type VehicleFactConflictSnapshot = {
  vehicleId: string;
  factKind: string;
  factKey: string;
  severity: "info" | "warning" | "critical";
  status: "open";
  values: Array<{
    observationIds: string[];
    value: Record<string, unknown>;
    observedAt: string | null;
    reportedAt: string | null;
    isLatest: boolean;
  }>;
};

const CONFLICTED_PASSPORT_KEYS = new Set([
  "make",
  "model",
  "year",
  "bodyType",
  "color",
  "engine",
  "transmission",
  "driveType"
]);

export function detectVehicleFactConflicts(
  observations: NormalizedVehicleObservation[]
): VehicleFactConflictSnapshot[] {
  return [
    ...detectPassportConflicts(observations),
    ...detectRiskFlagConflicts(observations),
    ...detectMileageRollbackConflicts(observations)
  ];
}

function detectPassportConflicts(
  observations: NormalizedVehicleObservation[]
): VehicleFactConflictSnapshot[] {
  const byFact = groupBy(
    observations.filter(
      (observation) =>
        observation.factKind === "passport" && CONFLICTED_PASSPORT_KEYS.has(observation.factKey)
    ),
    (observation) => `${observation.vehicleId}:${observation.factKind}:${observation.factKey}`
  );

  return [...byFact.values()].flatMap((factObservations) => {
    const values = groupedConflictValues(factObservations);
    if (values.length <= 1) return [];

    const first = factObservations[0]!;
    return [
      {
        vehicleId: first.vehicleId,
        factKind: first.factKind,
        factKey: first.factKey,
        severity: "warning",
        status: "open",
        values
      }
    ];
  });
}

function detectRiskFlagConflicts(
  observations: NormalizedVehicleObservation[]
): VehicleFactConflictSnapshot[] {
  const byFact = groupBy(
    observations.filter((observation) => observation.factKind === "risk_flag"),
    (observation) => `${observation.vehicleId}:${observation.factKind}:${observation.factKey}`
  );

  return [...byFact.values()].flatMap((factObservations) => {
    const statuses = new Set(factObservations.map((observation) => observation.value.status));
    if (!(statuses.has("found") && statuses.has("not_found"))) return [];

    const first = factObservations[0]!;
    return [
      {
        vehicleId: first.vehicleId,
        factKind: first.factKind,
        factKey: first.factKey,
        severity: "warning",
        status: "open",
        values: groupedConflictValues(factObservations)
      }
    ];
  });
}

function detectMileageRollbackConflicts(
  observations: NormalizedVehicleObservation[]
): VehicleFactConflictSnapshot[] {
  const mileage = observations
    .filter((observation) => observation.factKind === "mileage")
    .filter((observation) => typeof observation.value.mileageKm === "number")
    .sort(compareByObservedThenReportedAsc);

  for (let index = 1; index < mileage.length; index += 1) {
    const previous = mileage[index - 1]!;
    const current = mileage[index]!;
    if ((current.value.mileageKm as number) < (previous.value.mileageKm as number)) {
      return [
        {
          vehicleId: current.vehicleId,
          factKind: "mileage",
          factKey: "mileage_rollback",
          severity: "critical",
          status: "open",
          values: groupedConflictValues([previous, current])
        }
      ];
    }
  }

  return [];
}

function groupedConflictValues(
  observations: NormalizedVehicleObservation[]
): VehicleFactConflictSnapshot["values"] {
  const grouped = groupBy(observations, (observation) => JSON.stringify(observation.value));
  const values = [...grouped.values()]
    .map((group) => {
      const latest = [...group].sort(compareByReportedThenObservedDesc)[0]!;
      return {
        observationIds: group.map((observation) => observation.id ?? observation.valueHash).sort(),
        value: latest.value,
        observedAt: latest.observedAt,
        reportedAt: latest.reportedAt,
        isLatest: false
      };
    })
    .sort(compareConflictValueDesc);

  return values.map((value, index) => ({ ...value, isLatest: index === 0 }));
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function compareByReportedThenObservedDesc(
  left: NormalizedVehicleObservation,
  right: NormalizedVehicleObservation
): number {
  return timestamp(right.reportedAt) - timestamp(left.reportedAt) || timestamp(right.observedAt) - timestamp(left.observedAt);
}

function compareByObservedThenReportedAsc(
  left: NormalizedVehicleObservation,
  right: NormalizedVehicleObservation
): number {
  return timestamp(left.observedAt) - timestamp(right.observedAt) || timestamp(left.reportedAt) - timestamp(right.reportedAt);
}

function compareConflictValueDesc(
  left: VehicleFactConflictSnapshot["values"][number],
  right: VehicleFactConflictSnapshot["values"][number]
): number {
  return timestamp(right.reportedAt) - timestamp(left.reportedAt) || timestamp(right.observedAt) - timestamp(left.observedAt);
}

function timestamp(value: string | null): number {
  if (value === null) return 0;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}
```

- [ ] **Step 4: Run conflict tests**

Run:

```bash
bun test apps/api/src/modules/vehicles/conflict-detection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/vehicles/conflict-detection.ts apps/api/src/modules/vehicles/conflict-detection.test.ts
git commit -m "feat: detect vehicle fact conflicts"
```

---

### Task 4: Implement Transparency Score

**Files:**
- Create: `apps/api/src/modules/vehicles/transparency-score.ts`
- Create: `apps/api/src/modules/vehicles/transparency-score.test.ts`

- [ ] **Step 1: Write failing score tests**

Create `apps/api/src/modules/vehicles/transparency-score.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { VehicleFactConflictSnapshot } from "./conflict-detection";
import { calculateTransparencyScore } from "./transparency-score";

describe("calculateTransparencyScore", () => {
  it("returns insufficient data without a fresh report", () => {
    expect(
      calculateTransparencyScore({
        now: new Date("2026-05-13T00:00:00.000Z"),
        vin: "XTA210990Y2765499",
        latestReportGeneratedAt: "2026-01-01T00:00:00.000Z",
        keyBlocks: ["vehicle_passport", "listings_or_mileage", "risk_checks"],
        sourceUploadCount: 1,
        riskStatuses: { accidents: "not_found", restrictions: "not_found" },
        conflicts: []
      })
    ).toEqual({
      kind: "insufficient_data",
      message: "Недостаточно данных для оценки.",
      reasons: ["latest_report_is_stale"]
    });
  });

  it("returns insufficient data without all three key blocks", () => {
    expect(
      calculateTransparencyScore({
        now: new Date("2026-05-13T00:00:00.000Z"),
        vin: "XTA210990Y2765499",
        latestReportGeneratedAt: "2026-05-01T00:00:00.000Z",
        keyBlocks: ["vehicle_passport", "risk_checks"],
        sourceUploadCount: 1,
        riskStatuses: { accidents: "not_found", restrictions: "not_found" },
        conflicts: []
      })
    ).toEqual({
      kind: "insufficient_data",
      message: "Недостаточно данных для оценки.",
      reasons: ["missing_key_blocks"]
    });
  });

  it("calculates a bounded score and label from risks and conflicts", () => {
    const result = calculateTransparencyScore({
      now: new Date("2026-05-13T00:00:00.000Z"),
      vin: "XTA210990Y2765499",
      latestReportGeneratedAt: "2026-05-01T00:00:00.000Z",
      keyBlocks: ["vehicle_passport", "listings_or_mileage", "risk_checks"],
      sourceUploadCount: 2,
      riskStatuses: { accidents: "found", restrictions: "not_found", pledge: "not_found" },
      conflicts: [
        conflict("passport", "color", "warning"),
        conflict("mileage", "mileage_rollback", "critical")
      ]
    });

    expect(result).toEqual({
      kind: "score",
      value: 3.4,
      max: 5,
      label: "Есть вопросы"
    });
  });
});

function conflict(
  factKind: string,
  factKey: string,
  severity: "info" | "warning" | "critical"
): VehicleFactConflictSnapshot {
  return {
    vehicleId: "vehicle-1",
    factKind,
    factKey,
    severity,
    status: "open",
    values: []
  };
}
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
bun test apps/api/src/modules/vehicles/transparency-score.test.ts
```

Expected: FAIL because scoring does not exist.

- [ ] **Step 3: Implement scoring**

Create `apps/api/src/modules/vehicles/transparency-score.ts`:

```ts
import type { ParsedReport } from "../parsing/report-parser";
import type { VehicleFactConflictSnapshot } from "./conflict-detection";
import type { RiskStatus, TransparencyScore } from "./report-read-model";

type CalculateTransparencyScoreInput = {
  now: Date;
  vin: string | null;
  latestReportGeneratedAt: string | null;
  keyBlocks: ParsedReport["keyBlocks"];
  sourceUploadCount: number;
  riskStatuses: Partial<Record<keyof ParsedReport["riskFlags"], RiskStatus>>;
  conflicts: VehicleFactConflictSnapshot[];
};

const REQUIRED_KEY_BLOCKS: ParsedReport["keyBlocks"] = [
  "vehicle_passport",
  "listings_or_mileage",
  "risk_checks"
];

export function calculateTransparencyScore(
  input: CalculateTransparencyScoreInput
): TransparencyScore {
  const insufficientReasons: string[] = [];

  if (input.vin === null) insufficientReasons.push("missing_vin");
  if (input.latestReportGeneratedAt === null || reportAgeDays(input.latestReportGeneratedAt, input.now) > 90) {
    insufficientReasons.push("latest_report_is_stale");
  }
  if (!REQUIRED_KEY_BLOCKS.every((block) => input.keyBlocks.includes(block))) {
    insufficientReasons.push("missing_key_blocks");
  }

  if (insufficientReasons.length > 0) {
    return {
      kind: "insufficient_data",
      message: "Недостаточно данных для оценки.",
      reasons: insufficientReasons
    };
  }

  let score = 5;
  const age = reportAgeDays(input.latestReportGeneratedAt, input.now);
  if (age > 30) score -= 0.3;
  if (input.sourceUploadCount > 1) score += 0.2;

  const foundRisks = Object.values(input.riskStatuses).filter((status) => status === "found").length;
  score -= Math.min(foundRisks * 0.5, 1.5);

  for (const conflict of input.conflicts) {
    if (conflict.severity === "critical") score -= 0.7;
    if (conflict.severity === "warning") score -= 0.4;
    if (conflict.severity === "info") score -= 0.1;
  }

  const value = Math.max(1, Math.min(5, Math.round(score * 10) / 10));

  return {
    kind: "score",
    value,
    max: 5,
    label: value >= 4 ? "История в целом прозрачна" : value >= 2.8 ? "Есть вопросы" : "Много вопросов"
  };
}

function reportAgeDays(generatedAt: string | null, now: Date): number {
  if (generatedAt === null) return Number.POSITIVE_INFINITY;
  const date = new Date(generatedAt);
  if (!Number.isFinite(date.getTime())) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}
```

- [ ] **Step 4: Run score tests**

Run:

```bash
bun test apps/api/src/modules/vehicles/transparency-score.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/vehicles/transparency-score.ts apps/api/src/modules/vehicles/transparency-score.test.ts
git commit -m "feat: calculate vehicle history transparency score"
```

---

### Task 5: Build Preview And Full Report Read Models

**Files:**
- Modify: `apps/api/src/modules/vehicles/report-read-model.ts`
- Modify: `apps/api/src/modules/vehicles/report-read-model.test.ts`

- [ ] **Step 1: Add failing read-model builder tests**

Extend the top-level imports in `apps/api/src/modules/vehicles/report-read-model.test.ts`:

```ts
import type { VehicleFactConflictSnapshot } from "./conflict-detection";
import type { NormalizedVehicleObservation } from "./fact-normalizer";
import { buildVehicleReadModels } from "./report-read-model";
```

Then append this `describe` block to the same file:

```ts

describe("buildVehicleReadModels", () => {
  it("builds preview and full report without source brands", () => {
    const result = buildVehicleReadModels({
      now: new Date("2026-05-13T10:00:00.000Z"),
      vehicle: { id: "vehicle-1", vin: "XTA210990Y2765499" },
      observations: [
        observation("identifier", "vin", { vin: "XTA210990Y2765499" }),
        observation("passport", "make", { field: "make", value: "LADA" }),
        observation("passport", "model", { field: "model", value: "Granta" }),
        observation("passport", "year", { field: "year", value: 2021 }),
        observation("listing", "listing", {
          observedAt: "2026-04-15T00:00:00.000Z",
          priceRub: 780000,
          mileageKm: 42000,
          city: "Москва"
        }),
        observation("mileage", "mileage", {
          observedAt: "2026-04-15T00:00:00.000Z",
          mileageKm: 42000,
          context: "listing"
        }),
        observation("risk_flag", "accidents", { risk: "accidents", status: "not_found" }),
        observation("risk_flag", "repairCalculations", {
          risk: "repairCalculations",
          status: "not_found"
        }),
        observation("risk_flag", "restrictions", { risk: "restrictions", status: "not_found" }),
        observation("risk_flag", "pledge", { risk: "pledge", status: "not_found" }),
        observation("risk_flag", "wanted", { risk: "wanted", status: "not_found" }),
        observation("risk_flag", "taxi", { risk: "taxi", status: "unknown" }),
        observation("risk_flag", "leasing", { risk: "leasing", status: "unknown" }),
        observation("quality_marker", "vehicle_passport", { keyBlock: "vehicle_passport" }),
        observation("quality_marker", "listings_or_mileage", { keyBlock: "listings_or_mileage" }),
        observation("quality_marker", "risk_checks", { keyBlock: "risk_checks" })
      ],
      conflicts: []
    });

    expect(result.preview).toMatchObject({
      vehicleId: "vehicle-1",
      vinMasked: "XTA2109********99",
      title: "LADA Granta",
      make: "LADA",
      model: "Granta",
      year: 2021,
      photo: null,
      lastListing: {
        observedAt: "2026-04-15T00:00:00.000Z",
        priceRub: 780000,
        mileageKm: 42000,
        city: "Москва"
      },
      lastUpdatedAt: "2026-05-01T00:00:00.000Z"
    });
    expect(result.report.summary.historyBasisText).toBe(
      "История составлена на основе 1 загруженного отчета. Последнее обновление: 01.05.2026."
    );
    expect(result.report.summary.transparency.kind).toBe("score");
    expect(result.report.legalRisks.restrictions.status).toBe("not_found");
    expect(result.report.mileage.hasRollbackSignals).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/autoteka|автотек|авито|auto\.ru|дром|drom|sourceKind|parserVersion/i);
  });

  it("includes conflicts in the full report", () => {
    const conflict: VehicleFactConflictSnapshot = {
      vehicleId: "vehicle-1",
      factKind: "passport",
      factKey: "color",
      severity: "warning",
      status: "open",
      values: [
        {
          observationIds: ["obs-1"],
          value: { field: "color", value: "black" },
          observedAt: "2026-05-01T00:00:00.000Z",
          reportedAt: "2026-05-01T00:00:00.000Z",
          isLatest: true
        },
        {
          observationIds: ["obs-2"],
          value: { field: "color", value: "white" },
          observedAt: "2026-04-01T00:00:00.000Z",
          reportedAt: "2026-04-01T00:00:00.000Z",
          isLatest: false
        }
      ]
    };

    const result = buildVehicleReadModels({
      now: new Date("2026-05-13T10:00:00.000Z"),
      vehicle: { id: "vehicle-1", vin: "XTA210990Y2765499" },
      observations: [
        observation("identifier", "vin", { vin: "XTA210990Y2765499" }),
        observation("quality_marker", "vehicle_passport", { keyBlock: "vehicle_passport" }),
        observation("quality_marker", "listings_or_mileage", { keyBlock: "listings_or_mileage" }),
        observation("quality_marker", "risk_checks", { keyBlock: "risk_checks" })
      ],
      conflicts: [conflict]
    });

    expect(result.report.conflicts).toEqual([
      {
        factKind: "passport",
        factKey: "color",
        severity: "warning",
        message: "Есть противоречия в поле color.",
        values: [
          {
            value: { field: "color", value: "black" },
            observedAt: "2026-05-01T00:00:00.000Z",
            reportedAt: "2026-05-01T00:00:00.000Z",
            isLatest: true
          },
          {
            value: { field: "color", value: "white" },
            observedAt: "2026-04-01T00:00:00.000Z",
            reportedAt: "2026-04-01T00:00:00.000Z",
            isLatest: false
          }
        ]
      }
    ]);
  });
});

function observation(
  factKind: NormalizedVehicleObservation["factKind"],
  factKey: string,
  value: Record<string, unknown>
): NormalizedVehicleObservation {
  return {
    id: `${factKind}-${factKey}`,
    vehicleId: "vehicle-1",
    reportUploadId: "upload-1",
    factKind,
    factKey,
    valueHash: `${factKind}-${factKey}-hash`,
    value,
    observedAt: value.observedAt as string | null ?? "2026-05-01T00:00:00.000Z",
    reportedAt: "2026-05-01T00:00:00.000Z",
    acceptedAt: "2026-05-13T10:00:00.000Z",
    qualityScore: 1
  };
}
```

- [ ] **Step 2: Run the failing builder tests**

Run:

```bash
bun test apps/api/src/modules/vehicles/report-read-model.test.ts
```

Expected: FAIL because `buildVehicleReadModels` is not implemented.

- [ ] **Step 3: Implement read-model builder**

Modify `apps/api/src/modules/vehicles/report-read-model.ts` to export `buildVehicleReadModels(input)`. Implement these rules:

```ts
import type { VehicleFactConflictSnapshot } from "./conflict-detection";
import type { NormalizedVehicleObservation } from "./fact-normalizer";
import { calculateTransparencyScore } from "./transparency-score";

export type BuildVehicleReadModelsInput = {
  now: Date;
  vehicle: { id: string; vin: string };
  observations: NormalizedVehicleObservation[];
  conflicts: VehicleFactConflictSnapshot[];
};

export type BuildVehicleReadModelsResult = {
  preview: VehiclePreviewReadModel;
  report: VehicleFullReportReadModel;
};

export function buildVehicleReadModels(input: BuildVehicleReadModelsInput): BuildVehicleReadModelsResult {
  const passport = selectPassport(input.observations, input.vehicle.vin);
  const listings = selectListings(input.observations);
  const mileageReadings = selectMileageReadings(input.observations);
  const risks = selectRisks(input.observations);
  const sourceUploadCount = new Set(input.observations.map((observation) => observation.reportUploadId)).size;
  const latestReportGeneratedAt = latestIso(input.observations.map((observation) => observation.reportedAt));
  const keyBlocks = input.observations
    .filter((observation) => observation.factKind === "quality_marker")
    .map((observation) => observation.factKey) as Array<"vehicle_passport" | "listings_or_mileage" | "risk_checks">;

  const preview: VehiclePreviewReadModel = {
    vehicleId: input.vehicle.id,
    vinMasked: maskVinForPreview(input.vehicle.vin),
    title: [passport.make, passport.model].filter(Boolean).join(" ") || "Автомобиль",
    make: passport.make,
    model: passport.model,
    year: passport.year,
    bodyType: passport.bodyType,
    color: passport.color,
    engine: passport.engine,
    transmission: passport.transmission,
    driveType: passport.driveType,
    photo: null,
    lastListing: listings[0] ?? null,
    lastUpdatedAt: latestReportGeneratedAt
  };

  const report: VehicleFullReportReadModel = {
    vehicleId: input.vehicle.id,
    vin: input.vehicle.vin,
    generatedAt: input.now.toISOString(),
    summary: {
      historyBasisText: historyBasisText(sourceUploadCount, latestReportGeneratedAt),
      sourceUploadCount,
      lastUpdatedAt: latestReportGeneratedAt,
      freshnessWarning: freshnessWarning(latestReportGeneratedAt, input.now),
      transparency: calculateTransparencyScore({
        now: input.now,
        vin: input.vehicle.vin,
        latestReportGeneratedAt,
        keyBlocks,
        sourceUploadCount,
        riskStatuses: Object.fromEntries(Object.entries(risks).map(([key, value]) => [key, value.status])),
        conflicts: input.conflicts
      })
    },
    passport,
    legalRisks: {
      restrictions: risks.restrictions,
      pledge: risks.pledge,
      wanted: risks.wanted
    },
    accidentsAndRepairs: {
      accidents: risks.accidents,
      repairCalculations: risks.repairCalculations
    },
    commercialUse: {
      taxi: risks.taxi,
      leasing: risks.leasing
    },
    mileage: {
      readings: mileageReadings,
      hasRollbackSignals: input.conflicts.some((conflict) => conflict.factKey === "mileage_rollback")
    },
    listings,
    conflicts: input.conflicts.map(toConflictReadModel),
    updateHistory: selectUpdateHistory(input.observations)
  };

  assertNoSourceBrandLeak({ preview, report });
  return { preview, report };
}
```

Complete helper functions in the same file:

- `selectPassport()` picks the value with newest `reportedAt`, then newest `observedAt`.
- `selectListings()` sorts newest `observedAt` first.
- `selectMileageReadings()` sorts oldest `observedAt` first.
- `selectRisks()` returns all seven risks and defaults missing values to `{ status: "unknown", checkedAt: null }`.
- `historyBasisText()` returns the exact Russian text from the tests and handles plural forms:
  - `1 загруженного отчета`
  - `2 загруженных отчетов`
  - `5 загруженных отчетов`
- `freshnessWarning()` returns `null` for reports up to 90 days old, otherwise `Данные могли измениться после даты последнего отчета.`
- `toConflictReadModel()` drops internal `observationIds` and returns `Есть противоречия в поле ${factKey}.`

- [ ] **Step 4: Run builder tests**

Run:

```bash
bun test apps/api/src/modules/vehicles/report-read-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Review Gate 1**

Run:

```bash
bun test apps/api/src/modules/vehicles
bun run --cwd apps/api typecheck
```

Expected: PASS. If typecheck fails because helper return types are too broad, tighten local types instead of casting whole responses to `any`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/vehicles/report-read-model.ts apps/api/src/modules/vehicles/report-read-model.test.ts
git commit -m "feat: build vehicle preview and report read models"
```

---

### Task 6: Add Vehicle Observation Schema

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Generated: `apps/api/drizzle/0001_*.sql`
- Generated: `apps/api/drizzle/meta/_journal.json`
- Generated: `apps/api/drizzle/meta/0001_snapshot.json`

- [ ] **Step 1: Add schema tables**

Modify `apps/api/src/db/schema.ts` with the `vehicleObservations`, `vehicleFactConflicts`, and `vehicleReportSnapshots` definitions from the Data Model section.

- [ ] **Step 2: Typecheck schema**

Run:

```bash
bun run --cwd apps/api typecheck
```

Expected: PASS.

- [ ] **Step 3: Generate migration**

Run:

```bash
bun run --cwd apps/api db:generate
```

Expected: a new migration file under `apps/api/drizzle/` and updated Drizzle metadata.

- [ ] **Step 4: Inspect migration**

Run:

```bash
sed -n '1,260p' apps/api/drizzle/0001_*.sql
```

Expected: migration creates only `vehicle_observations`, `vehicle_fact_conflicts`, `vehicle_report_snapshots`, their foreign keys, and indexes. It must not drop existing Milestone 1 tables or alter points/access tables.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle
git commit -m "feat: add vehicle observation read model schema"
```

---

### Task 7: Implement Vehicle Report Repository

**Files:**
- Create: `apps/api/src/modules/vehicles/vehicle-report-repository.ts`
- Create: `apps/api/src/modules/vehicles/drizzle-vehicle-report-repository.ts`

- [ ] **Step 1: Define repository contract**

Create `apps/api/src/modules/vehicles/vehicle-report-repository.ts`:

```ts
import type { VehicleFactConflictSnapshot } from "./conflict-detection";
import type { NormalizedVehicleObservation } from "./fact-normalizer";
import type { VehicleFullReportReadModel, VehiclePreviewReadModel } from "./report-read-model";

export type VehicleLookupRecord = {
  id: string;
  vin: string;
};

export type StoredVehicleObservation = NormalizedVehicleObservation & {
  id: string;
};

export type SaveVehicleReportSnapshotInput = {
  vehicleId: string;
  preview: VehiclePreviewReadModel;
  report: VehicleFullReportReadModel;
  sourceUploadCount: number;
  latestReportGeneratedAt: Date | null;
  rebuiltAt: Date;
};

export interface VehicleReportRepository {
  findVehicleByVin(vin: string): Promise<VehicleLookupRecord | null>;
  replaceObservationsForUpload(input: {
    reportUploadId: string;
    observations: NormalizedVehicleObservation[];
  }): Promise<void>;
  listObservationsForVehicle(vehicleId: string): Promise<StoredVehicleObservation[]>;
  replaceConflictsForVehicle(input: {
    vehicleId: string;
    conflicts: VehicleFactConflictSnapshot[];
  }): Promise<void>;
  saveReportSnapshot(input: SaveVehicleReportSnapshotInput): Promise<void>;
  findPreviewByVin(vin: string): Promise<VehiclePreviewReadModel | null>;
  findFullReportByVin(vin: string): Promise<VehicleFullReportReadModel | null>;
}
```

- [ ] **Step 2: Implement Drizzle repository**

Create `apps/api/src/modules/vehicles/drizzle-vehicle-report-repository.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
  vehicleFactConflicts,
  vehicleObservations,
  vehicleReportSnapshots,
  vehicles
} from "../../db/schema";
import type { VehicleFactConflictSnapshot } from "./conflict-detection";
import type { NormalizedVehicleObservation } from "./fact-normalizer";
import type { VehicleFullReportReadModel, VehiclePreviewReadModel } from "./report-read-model";
import type {
  SaveVehicleReportSnapshotInput,
  StoredVehicleObservation,
  VehicleLookupRecord,
  VehicleReportRepository
} from "./vehicle-report-repository";

export class DrizzleVehicleReportRepository implements VehicleReportRepository {
  async findVehicleByVin(vin: string): Promise<VehicleLookupRecord | null> {
    const [vehicle] = await db
      .select({ id: vehicles.id, vin: vehicles.vin })
      .from(vehicles)
      .where(eq(vehicles.vin, vin))
      .limit(1);

    return vehicle ?? null;
  }

  async replaceObservationsForUpload(input: {
    reportUploadId: string;
    observations: NormalizedVehicleObservation[];
  }): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(vehicleObservations)
        .where(eq(vehicleObservations.reportUploadId, input.reportUploadId));

      if (input.observations.length === 0) return;

      await tx.insert(vehicleObservations).values(
        input.observations.map((observation) => ({
          vehicleId: observation.vehicleId,
          reportUploadId: observation.reportUploadId,
          factKind: observation.factKind,
          factKey: observation.factKey,
          valueHash: observation.valueHash,
          value: observation.value,
          observedAt: parseDate(observation.observedAt),
          reportedAt: parseDate(observation.reportedAt),
          acceptedAt: parseDate(observation.acceptedAt) ?? new Date(),
          qualityScore: observation.qualityScore.toFixed(2)
        }))
      );
    });
  }

  async listObservationsForVehicle(vehicleId: string): Promise<StoredVehicleObservation[]> {
    const rows = await db
      .select()
      .from(vehicleObservations)
      .where(eq(vehicleObservations.vehicleId, vehicleId));

    return rows.map((row) => ({
      id: row.id,
      vehicleId: row.vehicleId,
      reportUploadId: row.reportUploadId,
      factKind: row.factKind as StoredVehicleObservation["factKind"],
      factKey: row.factKey,
      valueHash: row.valueHash,
      value: row.value,
      observedAt: row.observedAt?.toISOString() ?? null,
      reportedAt: row.reportedAt?.toISOString() ?? null,
      acceptedAt: row.acceptedAt.toISOString(),
      qualityScore: Number(row.qualityScore ?? 0)
    }));
  }

  async replaceConflictsForVehicle(input: {
    vehicleId: string;
    conflicts: VehicleFactConflictSnapshot[];
  }): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(vehicleFactConflicts)
        .where(and(eq(vehicleFactConflicts.vehicleId, input.vehicleId), eq(vehicleFactConflicts.status, "open")));

      if (input.conflicts.length === 0) return;

      await tx.insert(vehicleFactConflicts).values(
        input.conflicts.map((conflict) => ({
          vehicleId: conflict.vehicleId,
          factKind: conflict.factKind,
          factKey: conflict.factKey,
          severity: conflict.severity,
          status: conflict.status,
          values: conflict.values
        }))
      );
    });
  }

  async saveReportSnapshot(input: SaveVehicleReportSnapshotInput): Promise<void> {
    await db
      .insert(vehicleReportSnapshots)
      .values({
        vehicleId: input.vehicleId,
        previewData: input.preview as unknown as Record<string, unknown>,
        reportData: input.report as unknown as Record<string, unknown>,
        sourceUploadCount: input.sourceUploadCount,
        latestReportGeneratedAt: input.latestReportGeneratedAt,
        rebuiltAt: input.rebuiltAt
      })
      .onConflictDoUpdate({
        target: vehicleReportSnapshots.vehicleId,
        set: {
          previewData: input.preview as unknown as Record<string, unknown>,
          reportData: input.report as unknown as Record<string, unknown>,
          sourceUploadCount: input.sourceUploadCount,
          latestReportGeneratedAt: input.latestReportGeneratedAt,
          rebuiltAt: input.rebuiltAt,
          updatedAt: input.rebuiltAt
        }
      });
  }

  async findPreviewByVin(vin: string): Promise<VehiclePreviewReadModel | null> {
    const [row] = await db
      .select({ previewData: vehicleReportSnapshots.previewData })
      .from(vehicleReportSnapshots)
      .innerJoin(vehicles, eq(vehicleReportSnapshots.vehicleId, vehicles.id))
      .where(eq(vehicles.vin, vin))
      .limit(1);

    return (row?.previewData as VehiclePreviewReadModel | undefined) ?? null;
  }

  async findFullReportByVin(vin: string): Promise<VehicleFullReportReadModel | null> {
    const [row] = await db
      .select({ reportData: vehicleReportSnapshots.reportData })
      .from(vehicleReportSnapshots)
      .innerJoin(vehicles, eq(vehicleReportSnapshots.vehicleId, vehicles.id))
      .where(eq(vehicles.vin, vin))
      .limit(1);

    return (row?.reportData as VehicleFullReportReadModel | undefined) ?? null;
  }
}

function parseDate(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
```

- [ ] **Step 3: Typecheck repository**

Run:

```bash
bun run --cwd apps/api typecheck
```

Expected: PASS. If Drizzle transaction typing differs, keep the transaction and adjust imports/types to match the installed Drizzle version.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/vehicles/vehicle-report-repository.ts apps/api/src/modules/vehicles/drizzle-vehicle-report-repository.ts
git commit -m "feat: persist vehicle report observations"
```

---

### Task 8: Implement Vehicle Aggregation Service

**Files:**
- Create: `apps/api/src/modules/vehicles/vehicle-aggregation-service.ts`
- Create: `apps/api/src/modules/vehicles/vehicle-aggregation-service.test.ts`

- [ ] **Step 1: Write failing aggregation service tests**

Create `apps/api/src/modules/vehicles/vehicle-aggregation-service.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { ParsedReport } from "../parsing/report-parser";
import type { VehicleReportRepository, StoredVehicleObservation, SaveVehicleReportSnapshotInput } from "./vehicle-report-repository";
import { VehicleAggregationService } from "./vehicle-aggregation-service";
import type { VehicleFactConflictSnapshot } from "./conflict-detection";
import type { NormalizedVehicleObservation } from "./fact-normalizer";

describe("VehicleAggregationService", () => {
  it("normalizes a parsed upload, stores observations, stores conflicts, and saves a read snapshot", async () => {
    const repository = new FakeVehicleReportRepository();
    const service = new VehicleAggregationService({
      repository,
      now: () => new Date("2026-05-13T10:00:00.000Z")
    });

    await service.rebuildFromParsedUpload({
      vehicleId: "vehicle-1",
      reportUploadId: "upload-1",
      acceptedAt: new Date("2026-05-13T09:00:00.000Z"),
      parsedReport: parsedReport()
    });

    expect(repository.replacedUploadIds).toEqual(["upload-1"]);
    expect(repository.observations).toHaveLength(21);
    expect(repository.savedConflicts).toEqual([]);
    expect(repository.savedSnapshot?.vehicleId).toBe("vehicle-1");
    expect(repository.savedSnapshot?.preview.vinMasked).toBe("XTA2109********99");
    expect(repository.savedSnapshot?.report.summary.sourceUploadCount).toBe(1);
  });

  it("keeps conflicts when later uploads disagree with earlier facts", async () => {
    const repository = new FakeVehicleReportRepository();
    const service = new VehicleAggregationService({
      repository,
      now: () => new Date("2026-05-13T10:00:00.000Z")
    });

    await service.rebuildFromParsedUpload({
      vehicleId: "vehicle-1",
      reportUploadId: "upload-1",
      acceptedAt: new Date("2026-05-13T09:00:00.000Z"),
      parsedReport: parsedReport({ color: "white", generatedAt: "2026-04-01T00:00:00.000Z" })
    });
    await service.rebuildFromParsedUpload({
      vehicleId: "vehicle-1",
      reportUploadId: "upload-2",
      acceptedAt: new Date("2026-05-13T09:30:00.000Z"),
      parsedReport: parsedReport({ color: "black", generatedAt: "2026-05-01T00:00:00.000Z" })
    });

    expect(repository.savedConflicts).toHaveLength(1);
    expect(repository.savedConflicts[0]).toMatchObject({
      factKind: "passport",
      factKey: "color",
      severity: "warning"
    });
    expect(repository.savedSnapshot?.report.conflicts).toHaveLength(1);
    expect(repository.savedSnapshot?.report.passport.color).toBe("black");
  });
});

function parsedReport(
  overrides: { color?: string; generatedAt?: string } = {}
): ParsedReport {
  const generatedAt = overrides.generatedAt ?? "2026-05-01T00:00:00.000Z";
  return {
    sourceKind: "autoteka_pdf",
    parserVersion: "autoteka-v1",
    status: "parsed",
    vin: "XTA210990Y2765499",
    generatedAt,
    vehicle: {
      vin: "XTA210990Y2765499",
      make: "LADA",
      model: "Granta",
      year: 2021,
      bodyType: "sedan",
      color: overrides.color ?? "white",
      engine: "1.6",
      transmission: "manual",
      driveType: "front"
    },
    listings: [
      {
        observedAt: "2026-04-15T00:00:00.000Z",
        priceRub: 780000,
        mileageKm: 42000,
        city: "Москва"
      }
    ],
    mileageReadings: [
      {
        observedAt: "2026-04-15T00:00:00.000Z",
        mileageKm: 42000,
        context: "listing"
      }
    ],
    riskFlags: {
      accidents: "not_found",
      repairCalculations: "not_found",
      restrictions: "not_found",
      pledge: "not_found",
      wanted: "not_found",
      taxi: "unknown",
      leasing: "unknown"
    },
    keyBlocks: ["vehicle_passport", "listings_or_mileage", "risk_checks"],
    warnings: [],
    qualityScore: 1
  };
}

class FakeVehicleReportRepository implements VehicleReportRepository {
  observations: StoredVehicleObservation[] = [];
  replacedUploadIds: string[] = [];
  savedConflicts: VehicleFactConflictSnapshot[] = [];
  savedSnapshot: SaveVehicleReportSnapshotInput | null = null;

  async findVehicleByVin() {
    return { id: "vehicle-1", vin: "XTA210990Y2765499" };
  }

  async replaceObservationsForUpload(input: {
    reportUploadId: string;
    observations: NormalizedVehicleObservation[];
  }): Promise<void> {
    this.replacedUploadIds.push(input.reportUploadId);
    this.observations = this.observations.filter(
      (observation) => observation.reportUploadId !== input.reportUploadId
    );
    this.observations.push(
      ...input.observations.map((observation, index) => ({
        ...observation,
        id: `${input.reportUploadId}-obs-${index}`
      }))
    );
  }

  async listObservationsForVehicle(vehicleId: string): Promise<StoredVehicleObservation[]> {
    return this.observations.filter((observation) => observation.vehicleId === vehicleId);
  }

  async replaceConflictsForVehicle(input: {
    vehicleId: string;
    conflicts: VehicleFactConflictSnapshot[];
  }): Promise<void> {
    this.savedConflicts = input.conflicts;
  }

  async saveReportSnapshot(input: SaveVehicleReportSnapshotInput): Promise<void> {
    this.savedSnapshot = input;
  }

  async findPreviewByVin() {
    return this.savedSnapshot?.preview ?? null;
  }

  async findFullReportByVin() {
    return this.savedSnapshot?.report ?? null;
  }
}
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
bun test apps/api/src/modules/vehicles/vehicle-aggregation-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement aggregation service**

Create `apps/api/src/modules/vehicles/vehicle-aggregation-service.ts`:

```ts
import type { ParsedReport } from "../parsing/report-parser";
import { detectVehicleFactConflicts } from "./conflict-detection";
import { normalizeParsedReportToObservations } from "./fact-normalizer";
import { buildVehicleReadModels } from "./report-read-model";
import type { VehicleReportRepository } from "./vehicle-report-repository";

export type VehicleAggregationServiceOptions = {
  repository: VehicleReportRepository;
  now?: () => Date;
};

export type RebuildFromParsedUploadInput = {
  vehicleId: string;
  reportUploadId: string;
  acceptedAt: Date;
  parsedReport: ParsedReport;
};

export class VehicleAggregationService {
  private readonly repository: VehicleReportRepository;
  private readonly now: () => Date;

  constructor(options: VehicleAggregationServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
  }

  async rebuildFromParsedUpload(input: RebuildFromParsedUploadInput): Promise<void> {
    if (input.parsedReport.status !== "parsed" || input.parsedReport.vin === null) {
      throw new Error("parsed_report_required");
    }

    const observations = normalizeParsedReportToObservations({
      vehicleId: input.vehicleId,
      reportUploadId: input.reportUploadId,
      acceptedAt: input.acceptedAt.toISOString(),
      parsedReport: input.parsedReport
    });

    await this.repository.replaceObservationsForUpload({
      reportUploadId: input.reportUploadId,
      observations
    });

    const allObservations = await this.repository.listObservationsForVehicle(input.vehicleId);
    const conflicts = detectVehicleFactConflicts(allObservations);
    const readModels = buildVehicleReadModels({
      now: this.now(),
      vehicle: { id: input.vehicleId, vin: input.parsedReport.vin },
      observations: allObservations,
      conflicts
    });

    await this.repository.replaceConflictsForVehicle({
      vehicleId: input.vehicleId,
      conflicts
    });
    await this.repository.saveReportSnapshot({
      vehicleId: input.vehicleId,
      preview: readModels.preview,
      report: readModels.report,
      sourceUploadCount: readModels.report.summary.sourceUploadCount,
      latestReportGeneratedAt: parseDate(readModels.report.summary.lastUpdatedAt),
      rebuiltAt: this.now()
    });
  }
}

function parseDate(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
```

- [ ] **Step 4: Run aggregation service tests**

Run:

```bash
bun test apps/api/src/modules/vehicles/vehicle-aggregation-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Review Gate 2**

Run:

```bash
bun test apps/api/src/modules/vehicles
bun run --cwd apps/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/vehicles/vehicle-aggregation-service.ts apps/api/src/modules/vehicles/vehicle-aggregation-service.test.ts
git commit -m "feat: rebuild vehicle report snapshots"
```

---

### Task 9: Rebuild Vehicle Report After Parsed Uploads

**Files:**
- Modify: `apps/api/src/modules/uploads/report-upload-service.ts`
- Modify: `apps/api/src/modules/uploads/report-upload-service.test.ts`
- Modify: `apps/api/src/modules/uploads/report-upload-repository.ts`
- Modify: `apps/api/src/modules/uploads/routes.ts`

- [ ] **Step 1: Extend upload service dependency contract**

Modify `ReportUploadServiceOptions` in `apps/api/src/modules/uploads/report-upload-service.ts`:

```ts
export interface VehicleReportRebuilder {
  rebuildFromParsedUpload(input: {
    vehicleId: string;
    reportUploadId: string;
    acceptedAt: Date;
    parsedReport: ParsedReport;
  }): Promise<void>;
}

export type ReportUploadServiceOptions = {
  storage: ObjectStorage;
  repository: ReportUploadRepository;
  vehicleReportRebuilder?: VehicleReportRebuilder;
  extractor?: ReportTextExtractor;
  parser?: ReportParser;
  now?: () => Date;
  originalRetentionDays: number;
};
```

Store `this.vehicleReportRebuilder = options.vehicleReportRebuilder ?? null`.

- [ ] **Step 2: Write failing upload integration tests**

Add to `apps/api/src/modules/uploads/report-upload-service.test.ts`:

```ts
it("rebuilds the vehicle report read model after a parsed upload is created", async () => {
  const repository = new FakeReportUploadRepository();
  const rebuilder = new FakeVehicleReportRebuilder();
  const service = createService({
    repository,
    extractor: new FakeExtractor({
      text: REPORT_TEXT,
      pageCount: 2,
      hasExtractableText: true,
      errorCode: null
    }),
    parser: new FakeParser(parsedReport()),
    vehicleReportRebuilder: rebuilder
  });

  await service.ingestPdf({
    userId: "user-1",
    guestSessionId: "guest-1",
    bytes: PDF_BYTES,
    originalFileName: "autoteka.pdf"
  });

  expect(rebuilder.calls).toEqual([
    {
      vehicleId: "vehicle-1",
      reportUploadId: "upload-1",
      acceptedAt: NOW,
      parsedReport: parsedReport()
    }
  ]);
});

it("does not rebuild the public read model for manual-review uploads", async () => {
  const repository = new FakeReportUploadRepository({ automaticGrantCount: 3 });
  const rebuilder = new FakeVehicleReportRebuilder();
  const service = createService({
    repository,
    extractor: new FakeExtractor({
      text: REPORT_TEXT,
      pageCount: 2,
      hasExtractableText: true,
      errorCode: null
    }),
    parser: new FakeParser(parsedReport()),
    vehicleReportRebuilder: rebuilder
  });

  await service.ingestPdf({
    userId: "user-1",
    guestSessionId: "guest-1",
    bytes: PDF_BYTES,
    originalFileName: "autoteka.pdf"
  });

  expect(rebuilder.calls).toEqual([]);
});
```

Update test helper signature:

```ts
function createService(input: {
  repository: ReportUploadRepository;
  extractor: FakeExtractor;
  parser: FakeParser;
  vehicleReportRebuilder?: FakeVehicleReportRebuilder;
}): ReportUploadService {
  return new ReportUploadService({
    storage: new FakeStorage(),
    extractor: input.extractor,
    parser: input.parser,
    repository: input.repository,
    vehicleReportRebuilder: input.vehicleReportRebuilder,
    now: () => new Date(NOW),
    originalRetentionDays: 30
  });
}
```

Add fake rebuilder:

```ts
class FakeVehicleReportRebuilder {
  calls: Array<{
    vehicleId: string;
    reportUploadId: string;
    acceptedAt: Date;
    parsedReport: ParsedReport;
  }> = [];

  async rebuildFromParsedUpload(input: {
    vehicleId: string;
    reportUploadId: string;
    acceptedAt: Date;
    parsedReport: ParsedReport;
  }): Promise<void> {
    this.calls.push(input);
  }
}
```

- [ ] **Step 3: Run failing upload tests**

Run:

```bash
bun test apps/api/src/modules/uploads/report-upload-service.test.ts
```

Expected: FAIL because upload service does not call the rebuilder yet.

- [ ] **Step 4: Call rebuilder after successful parsed upload creation**

In `ReportUploadService.ingestPdf()`, immediately after `repository.createReportUpload()`:

```ts
if (status === "parsed" && vehicle !== null && trustedVin !== null) {
  await this.vehicleReportRebuilder?.rebuildFromParsedUpload({
    vehicleId: vehicle.id,
    reportUploadId: upload.id,
    acceptedAt: now,
    parsedReport
  });
}
```

Keep this after upload creation so observation rows can reference a real `report_upload_id`.

- [ ] **Step 5: Wire real rebuilder in upload routes**

Modify `apps/api/src/modules/uploads/routes.ts`:

```ts
import { DrizzleVehicleReportRepository } from "../vehicles/drizzle-vehicle-report-repository";
import { VehicleAggregationService } from "../vehicles/vehicle-aggregation-service";

const vehicleReportRebuilder = new VehicleAggregationService({
  repository: new DrizzleVehicleReportRepository()
});

const reportUploadService = new ReportUploadService({
  storage: new LocalObjectStorage({ rootDir: env.REPORT_STORAGE_LOCAL_DIR }),
  repository: new DrizzleReportUploadRepository(),
  vehicleReportRebuilder,
  extractor: { extractText: extractPdfText },
  parser: { parse: parseAutotekaReport },
  originalRetentionDays: env.REPORT_ORIGINAL_RETENTION_DAYS
});
```

- [ ] **Step 6: Run upload tests**

Run:

```bash
bun test apps/api/src/modules/uploads/report-upload-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run focused API tests**

Run:

```bash
bun test apps/api/src/modules/uploads apps/api/src/modules/vehicles
bun run --cwd apps/api typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/uploads/report-upload-service.ts apps/api/src/modules/uploads/report-upload-service.test.ts apps/api/src/modules/uploads/routes.ts
git commit -m "feat: rebuild vehicle report after upload ingestion"
```

---

### Task 10: Add Vehicle Preview And Full Report Routes

**Files:**
- Create: `apps/api/src/modules/vehicles/routes.ts`
- Create: `apps/api/src/modules/vehicles/routes.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `apps/api/src/modules/vehicles/routes.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { createVehicleRoutes, type VehicleRoutesDependencies } from "./routes";
import type { VehicleFullReportReadModel, VehiclePreviewReadModel } from "./report-read-model";

describe("vehicle routes", () => {
  it("returns preview by VIN", async () => {
    const routes = createVehicleRoutes(createDependencies());

    const response = await routes.request("/XTA210990Y2765499/preview");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preview: preview() });
  });

  it("returns full report by VIN without source brands", async () => {
    const routes = createVehicleRoutes(createDependencies());

    const response = await routes.request("/XTA210990Y2765499/report");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ report: report() });
    expect(JSON.stringify(body)).not.toMatch(/autoteka|автотек|авито|auto\.ru|дром|drom|sourceKind|parserVersion/i);
  });

  it("rejects invalid VINs", async () => {
    const routes = createVehicleRoutes(createDependencies());

    const response = await routes.request("/not-a-vin/report");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_vin",
        message: "Передайте корректный VIN."
      }
    });
  });

  it("returns a neutral not-found error", async () => {
    const routes = createVehicleRoutes(
      createDependencies({
        findPreviewByVin: async () => null,
        findFullReportByVin: async () => null
      })
    );

    const response = await routes.request("/XTA210990Y2765499/preview");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "vehicle_report_not_found",
        message: "Отчета по этому VIN пока нет."
      }
    });
  });
});

function createDependencies(
  overrides: Partial<VehicleRoutesDependencies> = {}
): VehicleRoutesDependencies {
  return {
    findPreviewByVin: overrides.findPreviewByVin ?? (async () => preview()),
    findFullReportByVin: overrides.findFullReportByVin ?? (async () => report())
  };
}

function preview(): VehiclePreviewReadModel {
  return {
    vehicleId: "vehicle-1",
    vinMasked: "XTA2109********99",
    title: "LADA Granta",
    make: "LADA",
    model: "Granta",
    year: 2021,
    bodyType: "sedan",
    color: "white",
    engine: "1.6",
    transmission: "manual",
    driveType: "front",
    photo: null,
    lastListing: {
      observedAt: "2026-04-15T00:00:00.000Z",
      priceRub: 780000,
      mileageKm: 42000,
      city: "Москва"
    },
    lastUpdatedAt: "2026-05-01T00:00:00.000Z"
  };
}

function report(): VehicleFullReportReadModel {
  return {
    vehicleId: "vehicle-1",
    vin: "XTA210990Y2765499",
    generatedAt: "2026-05-13T10:00:00.000Z",
    summary: {
      historyBasisText:
        "История составлена на основе 1 загруженного отчета. Последнее обновление: 01.05.2026.",
      sourceUploadCount: 1,
      lastUpdatedAt: "2026-05-01T00:00:00.000Z",
      freshnessWarning: null,
      transparency: {
        kind: "score",
        value: 5,
        max: 5,
        label: "История в целом прозрачна"
      }
    },
    passport: {
      vin: "XTA210990Y2765499",
      make: "LADA",
      model: "Granta",
      year: 2021,
      bodyType: "sedan",
      color: "white",
      engine: "1.6",
      transmission: "manual",
      driveType: "front"
    },
    legalRisks: {
      restrictions: { status: "not_found", checkedAt: "2026-05-01T00:00:00.000Z" },
      pledge: { status: "not_found", checkedAt: "2026-05-01T00:00:00.000Z" },
      wanted: { status: "not_found", checkedAt: "2026-05-01T00:00:00.000Z" }
    },
    accidentsAndRepairs: {
      accidents: { status: "not_found", checkedAt: "2026-05-01T00:00:00.000Z" },
      repairCalculations: { status: "not_found", checkedAt: "2026-05-01T00:00:00.000Z" }
    },
    commercialUse: {
      taxi: { status: "unknown", checkedAt: null },
      leasing: { status: "unknown", checkedAt: null }
    },
    mileage: {
      readings: [
        { observedAt: "2026-04-15T00:00:00.000Z", mileageKm: 42000, context: "listing" }
      ],
      hasRollbackSignals: false
    },
    listings: [
      {
        observedAt: "2026-04-15T00:00:00.000Z",
        priceRub: 780000,
        mileageKm: 42000,
        city: "Москва"
      }
    ],
    conflicts: [],
    updateHistory: [
      { reportedAt: "2026-05-01T00:00:00.000Z", acceptedAt: "2026-05-13T10:00:00.000Z" }
    ]
  };
}
```

- [ ] **Step 2: Run failing route tests**

Run:

```bash
bun test apps/api/src/modules/vehicles/routes.test.ts
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement vehicle routes**

Create `apps/api/src/modules/vehicles/routes.ts`:

```ts
import { detectSearchQuery } from "@istoriya-avto/shared";
import { Hono } from "hono";
import { DrizzleVehicleReportRepository } from "./drizzle-vehicle-report-repository";
import {
  assertNoSourceBrandLeak,
  type VehicleFullReportReadModel,
  type VehiclePreviewReadModel
} from "./report-read-model";

export type VehicleRoutesDependencies = {
  findPreviewByVin(vin: string): Promise<VehiclePreviewReadModel | null>;
  findFullReportByVin(vin: string): Promise<VehicleFullReportReadModel | null>;
};

export function createVehicleRoutes(dependencies: VehicleRoutesDependencies): Hono {
  const routes = new Hono();

  routes.get("/:vin/preview", async (context) => {
    const vin = parseVin(context.req.param("vin"));
    if (vin === null) return invalidVin(context);

    const preview = await dependencies.findPreviewByVin(vin);
    if (preview === null) return reportNotFound(context);

    assertNoSourceBrandLeak(preview);
    return context.json({ preview });
  });

  routes.get("/:vin/report", async (context) => {
    const vin = parseVin(context.req.param("vin"));
    if (vin === null) return invalidVin(context);

    const report = await dependencies.findFullReportByVin(vin);
    if (report === null) return reportNotFound(context);

    assertNoSourceBrandLeak(report);
    return context.json({ report });
  });

  return routes;
}

const repository = new DrizzleVehicleReportRepository();

export const vehicleRoutes = createVehicleRoutes({
  findPreviewByVin: (vin) => repository.findPreviewByVin(vin),
  findFullReportByVin: (vin) => repository.findFullReportByVin(vin)
});

function parseVin(value: string): string | null {
  const detection = detectSearchQuery(value);
  return detection.kind === "vin" ? detection.normalized : null;
}

function invalidVin(context: Parameters<Parameters<Hono["get"]>[1]>[0]) {
  return context.json(
    {
      error: {
        code: "invalid_vin",
        message: "Передайте корректный VIN."
      }
    },
    400
  );
}

function reportNotFound(context: Parameters<Parameters<Hono["get"]>[1]>[0]) {
  return context.json(
    {
      error: {
        code: "vehicle_report_not_found",
        message: "Отчета по этому VIN пока нет."
      }
    },
    404
  );
}
```

If the Hono context helper type is awkward under strict TypeScript, import `type Context` from `hono` and type `invalidVin(context: Context)` and `reportNotFound(context: Context)`.

- [ ] **Step 4: Mount routes in app**

Modify `apps/api/src/app.ts`:

```ts
import { vehicleRoutes } from "./modules/vehicles/routes";

app.route("/api/vehicles", vehicleRoutes);
```

- [ ] **Step 5: Add app-level route smoke tests**

Append to `apps/api/src/app.test.ts`:

```ts
it("exposes vehicle report routes", async () => {
  const response = await app.request("/api/vehicles/not-a-vin/preview");

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: {
      code: "invalid_vin",
      message: "Передайте корректный VIN."
    }
  });
});
```

- [ ] **Step 6: Run route tests**

Run:

```bash
bun test apps/api/src/modules/vehicles/routes.test.ts apps/api/src/app.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/vehicles/routes.ts apps/api/src/modules/vehicles/routes.test.ts apps/api/src/app.ts apps/api/src/app.test.ts
git commit -m "feat: expose vehicle preview and report API"
```

---

### Task 11: End-To-End Read Model Regression Tests

**Files:**
- Create: `apps/api/src/modules/vehicles/report-read-model.integration.test.ts`

- [ ] **Step 1: Write integration-style pure test for multiple uploads**

Create `apps/api/src/modules/vehicles/report-read-model.integration.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { ParsedReport } from "../parsing/report-parser";
import { detectVehicleFactConflicts } from "./conflict-detection";
import { normalizeParsedReportToObservations } from "./fact-normalizer";
import { buildVehicleReadModels } from "./report-read-model";

describe("vehicle report read model integration", () => {
  it("merges multiple parsed uploads by VIN and surfaces conflicts without source names", () => {
    const observations = [
      ...normalizeParsedReportToObservations({
        vehicleId: "vehicle-1",
        reportUploadId: "upload-1",
        acceptedAt: "2026-05-13T09:00:00.000Z",
        parsedReport: parsedReport({
          generatedAt: "2026-04-01T00:00:00.000Z",
          color: "white",
          mileageKm: 50000
        })
      }),
      ...normalizeParsedReportToObservations({
        vehicleId: "vehicle-1",
        reportUploadId: "upload-2",
        acceptedAt: "2026-05-13T10:00:00.000Z",
        parsedReport: parsedReport({
          generatedAt: "2026-05-01T00:00:00.000Z",
          color: "black",
          mileageKm: 45000
        })
      })
    ].map((observation, index) => ({ ...observation, id: `obs-${index}` }));

    const conflicts = detectVehicleFactConflicts(observations);
    const result = buildVehicleReadModels({
      now: new Date("2026-05-13T10:30:00.000Z"),
      vehicle: { id: "vehicle-1", vin: "XTA210990Y2765499" },
      observations,
      conflicts
    });

    expect(result.report.summary.sourceUploadCount).toBe(2);
    expect(result.report.passport.color).toBe("black");
    expect(result.report.conflicts.map((conflict) => conflict.factKey)).toEqual([
      "color",
      "mileage_rollback"
    ]);
    expect(result.report.summary.transparency.kind).toBe("score");
    expect(JSON.stringify(result)).not.toMatch(/autoteka|автотек|авито|auto\.ru|дром|drom|sourceKind|parserVersion/i);
  });
});

function parsedReport(input: {
  generatedAt: string;
  color: string;
  mileageKm: number;
}): ParsedReport {
  return {
    sourceKind: "autoteka_pdf",
    parserVersion: "autoteka-v1",
    status: "parsed",
    vin: "XTA210990Y2765499",
    generatedAt: input.generatedAt,
    vehicle: {
      vin: "XTA210990Y2765499",
      make: "LADA",
      model: "Granta",
      year: 2021,
      bodyType: "sedan",
      color: input.color,
      engine: "1.6",
      transmission: "manual",
      driveType: "front"
    },
    listings: [
      {
        observedAt: input.generatedAt,
        priceRub: 780000,
        mileageKm: input.mileageKm,
        city: "Москва"
      }
    ],
    mileageReadings: [
      {
        observedAt: input.generatedAt,
        mileageKm: input.mileageKm,
        context: "listing"
      }
    ],
    riskFlags: {
      accidents: "not_found",
      repairCalculations: "not_found",
      restrictions: "not_found",
      pledge: "not_found",
      wanted: "not_found",
      taxi: "unknown",
      leasing: "unknown"
    },
    keyBlocks: ["vehicle_passport", "listings_or_mileage", "risk_checks"],
    warnings: [],
    qualityScore: 1
  };
}
```

- [ ] **Step 2: Run integration-style test**

Run:

```bash
bun test apps/api/src/modules/vehicles/report-read-model.integration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full backend tests**

Run:

```bash
bun run test
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/vehicles/report-read-model.integration.test.ts
git commit -m "test: cover multi-upload vehicle report aggregation"
```

---

### Task 12: Final Verification And Roadmap Update

**Files:**
- Modify: `docs/mvp_roadmap.md`

- [ ] **Step 1: Update roadmap status**

After all implementation tasks pass, update the Milestone 2 section in `docs/mvp_roadmap.md`:

```md
## Milestone 2: Vehicle Aggregation And Report Read Model

Статус: готов на `master` YYYY-MM-DD.

Цель: из одного или нескольких `report_upload` строится один сводный отчет по VIN.
```

Add a short "Готово" list under the section:

```md
Готово:

- Observation model поверх `report_uploads.raw_data.parseResult`.
- Нормализация фактов по VIN из parsed uploads.
- Merge/aggregation service с rebuild snapshot после успешной загрузки.
- Хранение конфликтов фактов без молчаливого затирания.
- Preview и full report API.
- Базовая оценка прозрачности истории.
- Source-brand leak guard для пользовательского report response.
```

- [ ] **Step 2: Run required verification**

Run:

```bash
bun run test
bun run typecheck
bun run --cwd apps/api db:generate
```

Expected:

- `bun run test`: PASS.
- `bun run typecheck`: PASS.
- `bun run --cwd apps/api db:generate`: no schema changes after committed migration.

Do not run `bun run --cwd apps/web build` unless frontend files changed. If frontend files changed, run it and require PASS.

- [ ] **Step 3: Inspect git diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only Milestone 2 files, generated Drizzle migration metadata, and roadmap changes are present. Existing untracked `docs/marketing/` must remain untouched unless the user explicitly asks.

- [ ] **Step 4: Review Gate 3**

Before finalizing implementation, request a code review using `superpowers:requesting-code-review` or a review subagent. The review prompt must explicitly ask for:

- source-brand leaks in API responses;
- silent fact overwrites;
- manual-review uploads accidentally entering aggregation;
- schema migration drift;
- missing tests around conflicts and stale-data transparency score.

- [ ] **Step 5: Commit roadmap update**

```bash
git add docs/mvp_roadmap.md
git commit -m "docs: update roadmap after milestone 2"
```

---

## Execution Order And Review Gates

1. Tasks 1-5: pure domain/read-model work. Review Gate 1 must pass before schema changes.
2. Tasks 6-8: persistence and aggregation service. Review Gate 2 must pass before upload wiring.
3. Tasks 9-11: ingestion wiring, API routes, regression coverage.
4. Task 12: verification, review, roadmap update.

Every task should be run tests-first:

1. Write or extend the failing test.
2. Run the focused command and confirm it fails for the expected reason.
3. Implement the smallest change that makes it pass.
4. Run the focused command again.
5. Commit the task before moving to the next task.

Final required checks before claiming Milestone 2 implementation is ready:

```bash
bun run test
bun run typecheck
bun run --cwd apps/api db:generate
```

Run this only if frontend files changed:

```bash
bun run --cwd apps/web build
```

## Plan Self-Review

- Spec coverage: the plan covers vehicle observations, fact normalization, merge by VIN, conflict storage, read model, transparency score, preview/full API, source-brand exclusion, tests-first execution, and review gates.
- Scope check: the plan avoids auth/unlock, frontend report UI, Auto.ru/Drom parsers, OCR, admin conflict resolution, and photos because they belong to later milestones.
- Placeholder scan: no task depends on unspecified files or open-ended behavior; each task names files, commands, and expected outcomes.
- Type consistency: observation, conflict, repository, service, and route contracts use the same `vehicleId`, `reportUploadId`, `observedAt`, `reportedAt`, `acceptedAt`, `preview`, and `report` names across tasks.
