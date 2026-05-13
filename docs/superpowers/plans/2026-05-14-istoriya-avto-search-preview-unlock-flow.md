# Search, Preview, And Unlock Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Milestone 3 so a user can submit a VIN, Russian plate, or listing URL, see safe candidate preview cards, and hit an unlock boundary without receiving the full report or spending points.

**Architecture:** Keep vehicle preview data anchored in the Milestone 2 `vehicle_report_snapshots` read model. Add a search orchestration layer that turns detected queries into candidate cards, add an Avito-only authless listing snapshot boundary, and put an access service in front of the full report route. Milestone 3 never mutates points, subscriptions, or ledger records.

**Tech Stack:** Bun, TypeScript, Hono, React, Vite, Drizzle ORM, PostgreSQL, Zod, `bun:test`, existing shared query detection.

---

## Scope Decisions

- Add `POST /api/search` for real search results. Keep `POST /api/search/detect` as the lightweight format detector used by tests and optional UI states.
- Search responses embed candidate preview cards. They do not expose the full VIN unless the user's own query was a VIN, and the UI still displays only `vinMasked`.
- Use the existing `/api/vehicles/:vin/preview` contract as the canonical preview shape for known VIN lookups. The search API should reuse the same repository/read-model code internally instead of doing an HTTP self-call. This avoids exposing a full VIN to the frontend for plate or URL candidates.
- `GET /api/vehicles/:vin/preview` stays publicly callable because it returns only preview-safe fields.
- `GET /api/vehicles/:vin/report` becomes access-gated. The default production access service denies full report access until Milestone 4 implements auth, subscriptions, points, and permanent VIN access.
- Add `POST /api/vehicles/:vin/unlock-intent` as the Milestone 3 boundary. It validates that a report preview exists and returns the unlock options and warning copy, but it does not create ledger entries, subscription spends, or `vehicle_accesses`.
- Russian plate search does not call any external lookup source in Milestone 3. It searches only internal `vehicle_identifiers` rows with `kind = "plate"`. Current parser data may produce no plate matches; the user receives the empty state and upload CTA.
- Authless Avito URL handling in Milestone 3: extract a stable listing identity from the URL, fetch only public/authless HTML, store the raw HTML privately with a 6-month retention object key, parse public JSON-LD and visible listing facts into a sanitized snapshot, and return a listing candidate. If no VIN can be extracted from public data, return a listing-only candidate with `reportStatus = "missing"` and upload CTA.
- Auto.ru and Drom URL search returns a recognized-but-not-captured empty state in Milestone 3. Do not implement Auto.ru or Drom parsers.
- Candidate preview may show photo, make/model/year, price, mileage, city, and masked VIN. It must not show a plate, report risk blocks, owners, accidents, restrictions, pledges, wanted status, repair calculations, taxi, leasing, or source brand labels for facts.
- User-facing report/search candidate responses must not say that a specific fact came from Avito, Autoteka, Auto.ru, or Drom. UI copy can say "данные объявления" or "загруженные отчеты".
- Do not store personal data from listings in normalized public data. The listing snapshot parser must not return seller names, phones, account names, addresses, or messages.
- No OCR, no report link ingestion, no real point spending, no auth, no subscription logic, no Drom parser, no Auto.ru parser in this milestone.

## Public API Contracts

### Search

```http
POST /api/search
content-type: application/json

{ "query": "XTA210990Y2765499" }
```

Success response with a known VIN:

```json
{
  "query": {
    "kind": "vin",
    "normalized": "XTA210990Y2765499"
  },
  "candidates": [
    {
      "id": "vehicle:vehicle-1",
      "kind": "vehicle",
      "match": "exact_vin",
      "reportStatus": "available",
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
      },
      "unlock": {
        "status": "locked",
        "canRequestUnlock": true,
        "warning": "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
      }
    }
  ],
  "emptyState": null
}
```

Success response when no report is available:

```json
{
  "query": {
    "kind": "plate",
    "normalized": "А123ВС777"
  },
  "candidates": [],
  "emptyState": {
    "code": "report_not_found",
    "title": "Отчета пока нет",
    "message": "Загрузите свой отчет, и он может дать 1 балл на будущий просмотр.",
    "action": {
      "kind": "upload_report",
      "label": "Загрузить отчет"
    }
  }
}
```

Avito URL with listing data but without a known VIN:

```json
{
  "query": {
    "kind": "listing_url",
    "normalized": "listing"
  },
  "candidates": [
    {
      "id": "listing:1234567890",
      "kind": "listing",
      "match": "listing_snapshot",
      "reportStatus": "missing",
      "preview": {
        "vehicleId": null,
        "vinMasked": null,
        "title": "LADA Granta, 2021",
        "make": "LADA",
        "model": "Granta",
        "year": 2021,
        "bodyType": null,
        "color": null,
        "engine": null,
        "transmission": null,
        "driveType": null,
        "photo": {
          "url": "https://static.example.test/photo.jpg",
          "alt": "Фото автомобиля"
        },
        "lastListing": {
          "observedAt": "2026-05-14T10:00:00.000Z",
          "priceRub": 780000,
          "mileageKm": 42000,
          "city": "Москва"
        },
        "lastUpdatedAt": "2026-05-14T10:00:00.000Z"
      },
      "unlock": {
        "status": "unavailable",
        "canRequestUnlock": false,
        "warning": "По этому объявлению отчета пока нет."
      }
    }
  ],
  "emptyState": null
}
```

Invalid request:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Поле query должно быть строкой."
  }
}
```

Unsupported or currently uncaptured URL:

```json
{
  "query": {
    "kind": "listing_url",
    "normalized": "listing"
  },
  "candidates": [],
  "emptyState": {
    "code": "listing_snapshot_unavailable",
    "title": "Не удалось получить данные объявления",
    "message": "Попробуйте поиск по VIN или загрузите отчет.",
    "action": {
      "kind": "upload_report",
      "label": "Загрузить отчет"
    }
  }
}
```

### Full Report Access Boundary

```http
GET /api/vehicles/XTA210990Y2765499/report
```

Default Milestone 3 response:

```json
{
  "error": {
    "code": "vehicle_report_locked",
    "message": "Полный отчет закрыт.",
    "unlock": {
      "status": "locked",
      "options": ["upload_report", "choose_plan"],
      "willSpendPoints": false,
      "warning": "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
    }
  }
}
```

Use HTTP `403` for this response. A dependency-injected granted access service in tests can still exercise the full report serialization path.

### Unlock Intent

```http
POST /api/vehicles/XTA210990Y2765499/unlock-intent
```

Success response:

```json
{
  "unlock": {
    "status": "locked",
    "vinMasked": "XTA2109********99",
    "options": ["upload_report", "choose_plan"],
    "willSpendPoints": false,
    "message": "Списание баллов и подписочных лимитов появится на следующем этапе.",
    "warning": "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
  }
}
```

## Target File Structure

```text
packages/shared/src
├── index.ts
├── search-query.test.ts
└── search-query.ts

apps/api/src
├── app.ts
├── app.test.ts
├── db/schema.ts
└── modules
    ├── access
    │   ├── report-access-service.test.ts
    │   └── report-access-service.ts
    ├── search
    │   ├── avito-listing-snapshot.test.ts
    │   ├── avito-listing-snapshot.ts
    │   ├── drizzle-search-repository.ts
    │   ├── listing-url.test.ts
    │   ├── listing-url.ts
    │   ├── routes.test.ts
    │   ├── routes.ts
    │   ├── search-contract.test.ts
    │   ├── search-contract.ts
    │   ├── search-repository.ts
    │   ├── search-service.test.ts
    │   └── search-service.ts
    └── vehicles
        ├── routes.test.ts
        └── routes.ts

apps/web/src
├── App.tsx
├── lib/api.ts
└── styles.css
```

## Data Model

Add a listing snapshot table in `apps/api/src/db/schema.ts`:

```ts
export const listingSnapshotStatus = pgEnum("listing_snapshot_status", [
  "captured",
  "unavailable",
  "manual_review"
]);

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
```

Generate the migration only after tests and typecheck for the backend pass:

```bash
bun run --cwd apps/api db:generate
```

Expected: one migration adding `listing_snapshot_status`, `listing_snapshots`, a unique identity index, and a vehicle index.

---

### Task 1: Define Search Candidate Contract And Leak Guard

**Files:**
- Create: `apps/api/src/modules/search/search-contract.ts`
- Create: `apps/api/src/modules/search/search-contract.test.ts`

- [ ] **Step 1: Write failing contract tests**

Create `apps/api/src/modules/search/search-contract.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { VehiclePreviewReadModel } from "../vehicles/report-read-model";
import {
  assertSafeSearchResponse,
  createEmptySearchResult,
  createListingCandidate,
  createVehicleCandidate
} from "./search-contract";

const preview: VehiclePreviewReadModel = {
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

describe("search result contract", () => {
  it("creates a locked vehicle candidate from a safe vehicle preview", () => {
    const candidate = createVehicleCandidate({
      match: "exact_vin",
      preview
    });

    expect(candidate).toEqual({
      id: "vehicle:vehicle-1",
      kind: "vehicle",
      match: "exact_vin",
      reportStatus: "available",
      preview,
      unlock: {
        status: "locked",
        canRequestUnlock: true,
        warning:
          "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
      }
    });
  });

  it("creates a listing-only candidate without exposing a plate or source label", () => {
    const candidate = createListingCandidate({
      sourceKind: "avito",
      listingId: "1234567890",
      observedAt: "2026-05-14T10:00:00.000Z",
      vehicleId: null,
      reportAvailable: false,
      snapshot: {
        vin: null,
        title: "LADA Granta, 2021",
        make: "LADA",
        model: "Granta",
        year: 2021,
        bodyType: null,
        color: null,
        engine: null,
        transmission: null,
        driveType: null,
        priceRub: 780000,
        mileageKm: 42000,
        city: "Москва",
        photos: [{ url: "https://static.example.test/photo.jpg", alt: "Фото автомобиля" }]
      }
    });

    expect(candidate.preview.vinMasked).toBeNull();
    expect(JSON.stringify(candidate)).not.toMatch(/plate|госномер|source|avito|авито/i);
    expect(candidate.reportStatus).toBe("missing");
    expect(candidate.unlock.canRequestUnlock).toBe(false);
  });

  it("returns a neutral empty state for missing reports", () => {
    expect(
      createEmptySearchResult({
        query: { kind: "vin", normalized: "XTA210990Y2765499" },
        code: "report_not_found"
      })
    ).toEqual({
      query: { kind: "vin", normalized: "XTA210990Y2765499" },
      candidates: [],
      emptyState: {
        code: "report_not_found",
        title: "Отчета пока нет",
        message: "Загрузите свой отчет, и он может дать 1 балл на будущий просмотр.",
        action: {
          kind: "upload_report",
          label: "Загрузить отчет"
        }
      }
    });
  });

  it("blocks source brand labels and internal source fields in search candidates", () => {
    const unsafePayloads = [
      { candidate: { sourceKind: "avito" } },
      { candidate: { originalObjectKey: "listing-originals/1.html" } },
      { candidate: { text: "Цена из Авито" } },
      { candidate: { text: "Источник: Auto.ru" } },
      { candidate: { text: "Источник: Дром" } }
    ];

    for (const payload of unsafePayloads) {
      expect(() => assertSafeSearchResponse(payload)).toThrow("search_response_leak");
    }
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
bun test apps/api/src/modules/search/search-contract.test.ts
```

Expected: FAIL because `search-contract.ts` does not exist.

- [ ] **Step 3: Implement the contract helpers**

Create `apps/api/src/modules/search/search-contract.ts` with these exported types and helpers:

```ts
import type { VehiclePreviewReadModel } from "../vehicles/report-read-model";
import { maskVinForPreview } from "../vehicles/report-read-model";

export type SearchQuerySummary = {
  kind: "vin" | "plate" | "listing_url" | "unknown";
  normalized: string;
};

export type SearchEmptyStateCode =
  | "report_not_found"
  | "listing_snapshot_unavailable"
  | "unsupported_query";

export type SearchEmptyState = {
  code: SearchEmptyStateCode;
  title: string;
  message: string;
  action: {
    kind: "upload_report";
    label: "Загрузить отчет";
  };
};

export type CandidatePreviewPhoto = {
  url: string;
  alt: string | null;
};

export type SearchCandidatePreview = Omit<VehiclePreviewReadModel, "photo"> & {
  photo: CandidatePreviewPhoto | null;
};

export type SearchCandidate = {
  id: string;
  kind: "vehicle" | "listing";
  match: "exact_vin" | "internal_plate" | "listing_snapshot";
  reportStatus: "available" | "missing";
  preview: SearchCandidatePreview;
  unlock: {
    status: "locked" | "unavailable";
    canRequestUnlock: boolean;
    warning: string;
  };
};

export type SearchResult = {
  query: SearchQuerySummary;
  candidates: SearchCandidate[];
  emptyState: SearchEmptyState | null;
};

export type ListingSnapshotPublicData = {
  vin: string | null;
  title: string;
  make: string | null;
  model: string | null;
  year: number | null;
  bodyType: string | null;
  color: string | null;
  engine: string | null;
  transmission: string | null;
  driveType: string | null;
  priceRub: number | null;
  mileageKm: number | null;
  city: string | null;
  photos: CandidatePreviewPhoto[];
};

const WRONG_CANDIDATE_WARNING =
  "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается.";

const SEARCH_LEAK_PATTERNS = [
  /(sourceKind|source_kind|parserVersion|parser_version|originalObjectKey|original_object_key)/,
  /(^|[^A-Za-z0-9_])avito($|[^A-Za-z0-9_])/i,
  /(^|[^\p{L}\p{N}_])авито($|[^\p{L}\p{N}_])/iu,
  /(autoteka|автотек|auto\.ru|авто\.ру)/i,
  /(^|[^\p{L}\p{N}_])дром($|[^\p{L}\p{N}_])/iu,
  /(^|[^A-Za-z0-9_])drom($|[^A-Za-z0-9_])/i
] as const;

export function createVehicleCandidate(input: {
  match: "exact_vin" | "internal_plate" | "listing_snapshot";
  preview: VehiclePreviewReadModel;
}): SearchCandidate {
  return {
    id: `vehicle:${input.preview.vehicleId}`,
    kind: "vehicle",
    match: input.match,
    reportStatus: "available",
    preview: input.preview,
    unlock: {
      status: "locked",
      canRequestUnlock: true,
      warning: WRONG_CANDIDATE_WARNING
    }
  };
}

export function createListingCandidate(input: {
  sourceKind: "avito";
  listingId: string;
  observedAt: string;
  vehicleId: string | null;
  reportAvailable: boolean;
  snapshot: ListingSnapshotPublicData;
}): SearchCandidate {
  const snapshot = input.snapshot;
  return {
    id: `listing:${input.listingId}`,
    kind: "listing",
    match: "listing_snapshot",
    reportStatus: input.reportAvailable ? "available" : "missing",
    preview: {
      vehicleId: input.vehicleId,
      vinMasked: snapshot.vin === null ? null : maskVinForPreview(snapshot.vin),
      title: snapshot.title || "Автомобиль из объявления",
      make: snapshot.make,
      model: snapshot.model,
      year: snapshot.year,
      bodyType: snapshot.bodyType,
      color: snapshot.color,
      engine: snapshot.engine,
      transmission: snapshot.transmission,
      driveType: snapshot.driveType,
      photo: snapshot.photos[0] ?? null,
      lastListing: {
        observedAt: input.observedAt,
        priceRub: snapshot.priceRub,
        mileageKm: snapshot.mileageKm,
        city: snapshot.city
      },
      lastUpdatedAt: input.observedAt
    },
    unlock: {
      status: input.reportAvailable ? "locked" : "unavailable",
      canRequestUnlock: input.reportAvailable,
      warning:
        input.reportAvailable ? WRONG_CANDIDATE_WARNING : "По этому объявлению отчета пока нет."
    }
  };
}

export function createEmptySearchResult(input: {
  query: SearchQuerySummary;
  code: SearchEmptyStateCode;
}): SearchResult {
  return {
    query: input.query,
    candidates: [],
    emptyState: emptyStateForCode(input.code)
  };
}

export function emptyStateForCode(code: SearchEmptyStateCode): SearchEmptyState {
  if (code === "listing_snapshot_unavailable") {
    return {
      code,
      title: "Не удалось получить данные объявления",
      message: "Попробуйте поиск по VIN или загрузите отчет.",
      action: { kind: "upload_report", label: "Загрузить отчет" }
    };
  }

  if (code === "unsupported_query") {
    return {
      code,
      title: "Запрос не распознан",
      message: "Введите VIN, госномер или публичную ссылку объявления.",
      action: { kind: "upload_report", label: "Загрузить отчет" }
    };
  }

  return {
    code,
    title: "Отчета пока нет",
    message: "Загрузите свой отчет, и он может дать 1 балл на будущий просмотр.",
    action: { kind: "upload_report", label: "Загрузить отчет" }
  };
}

export function assertSafeSearchResponse(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (SEARCH_LEAK_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error("search_response_leak");
  }
}
```

- [ ] **Step 4: Run the contract test and verify it passes**

Run:

```bash
bun test apps/api/src/modules/search/search-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/search/search-contract.ts apps/api/src/modules/search/search-contract.test.ts
git commit -m "feat: define search candidate contract"
```

### Task 2: Parse Listing URLs And Avito Authless Snapshots

**Files:**
- Create: `apps/api/src/modules/search/listing-url.ts`
- Create: `apps/api/src/modules/search/listing-url.test.ts`
- Create: `apps/api/src/modules/search/avito-listing-snapshot.ts`
- Create: `apps/api/src/modules/search/avito-listing-snapshot.test.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add the HTML parser dependency**

Modify `apps/api/package.json` dependencies:

```json
"node-html-parser": "latest"
```

- [ ] **Step 2: Write failing listing URL tests**

Create `apps/api/src/modules/search/listing-url.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { parseSupportedListingUrl } from "./listing-url";

describe("parseSupportedListingUrl", () => {
  it("extracts an Avito listing identity and strips tracking query params", () => {
    expect(
      parseSupportedListingUrl(
        "https://www.avito.ru/moskva/avtomobili/lada_granta_2021_1234567890?context=abc"
      )
    ).toEqual({
      kind: "avito",
      listingId: "1234567890",
      canonicalUrl:
        "https://www.avito.ru/moskva/avtomobili/lada_granta_2021_1234567890"
    });
  });

  it("recognizes Auto.ru and Drom as not captured in Milestone 3", () => {
    expect(parseSupportedListingUrl("https://auto.ru/cars/used/sale/test/123/")).toEqual({
      kind: "recognized_uncaptured",
      family: "auto_ru"
    });
    expect(parseSupportedListingUrl("https://auto.drom.ru/ulan-ude/isuzu/d-max/322002530.html")).toEqual({
      kind: "recognized_uncaptured",
      family: "drom"
    });
  });

  it("rejects unsupported URLs and malformed Avito URLs", () => {
    expect(parseSupportedListingUrl("https://example.com/car/1")).toEqual({
      kind: "unsupported"
    });
    expect(parseSupportedListingUrl("https://www.avito.ru/moskva/avtomobili/no-id")).toEqual({
      kind: "unsupported"
    });
  });
});
```

- [ ] **Step 3: Implement listing URL parsing**

Create `apps/api/src/modules/search/listing-url.ts`:

```ts
export type ListingUrlIdentity =
  | {
      kind: "avito";
      listingId: string;
      canonicalUrl: string;
    }
  | {
      kind: "recognized_uncaptured";
      family: "auto_ru" | "drom";
    }
  | {
      kind: "unsupported";
    };

const AVITO_HOSTS = new Set(["avito.ru", "www.avito.ru"]);
const AUTO_RU_HOSTS = new Set(["auto.ru", "www.auto.ru"]);
const DROM_HOSTS = new Set(["drom.ru", "www.drom.ru", "auto.drom.ru"]);

export function parseSupportedListingUrl(value: string): ListingUrlIdentity {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { kind: "unsupported" };
  }

  const host = url.host.toLowerCase();
  if (AUTO_RU_HOSTS.has(host)) return { kind: "recognized_uncaptured", family: "auto_ru" };
  if (DROM_HOSTS.has(host)) return { kind: "recognized_uncaptured", family: "drom" };

  if (!AVITO_HOSTS.has(host)) return { kind: "unsupported" };

  const listingId = url.pathname.match(/_(\d{6,})(?:\/)?$/)?.[1] ?? null;
  if (listingId === null) return { kind: "unsupported" };

  return {
    kind: "avito",
    listingId,
    canonicalUrl: `${url.origin}${url.pathname.replace(/\/$/, "")}`
  };
}
```

- [ ] **Step 4: Run listing URL tests**

Run:

```bash
bun test apps/api/src/modules/search/listing-url.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing Avito snapshot parser tests**

Create `apps/api/src/modules/search/avito-listing-snapshot.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { parseAvitoListingSnapshotHtml } from "./avito-listing-snapshot";

describe("parseAvitoListingSnapshotHtml", () => {
  it("extracts public vehicle facts from JSON-LD without personal data", () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "LADA Granta, 2021",
            "image": ["https://static.example.test/photo.jpg"],
            "description": "Пробег 42 000 км. VIN XTA210990Y2765499. Телефон +7 900 123-45-67",
            "offers": { "@type": "Offer", "price": "780000", "priceCurrency": "RUB" }
          }
          </script>
        </head>
        <body>
          <span data-marker="item-view/item-address">Москва</span>
        </body>
      </html>
    `;

    expect(parseAvitoListingSnapshotHtml(html)).toEqual({
      status: "captured",
      data: {
        vin: "XTA210990Y2765499",
        title: "LADA Granta, 2021",
        make: "LADA",
        model: "Granta",
        year: 2021,
        bodyType: null,
        color: null,
        engine: null,
        transmission: null,
        driveType: null,
        priceRub: 780000,
        mileageKm: 42000,
        city: "Москва",
        photos: [{ url: "https://static.example.test/photo.jpg", alt: "Фото автомобиля" }]
      }
    });
    expect(JSON.stringify(parseAvitoListingSnapshotHtml(html))).not.toMatch(/\+7|900|123-45-67|Телефон/);
  });

  it("returns unavailable when the page has no public structured listing data", () => {
    expect(parseAvitoListingSnapshotHtml("<html><title>login</title></html>")).toEqual({
      status: "unavailable",
      reason: "structured_data_missing"
    });
  });
});
```

- [ ] **Step 6: Implement Avito snapshot parsing**

Create `apps/api/src/modules/search/avito-listing-snapshot.ts`:

```ts
import { parse } from "node-html-parser";
import { detectSearchQuery } from "@istoriya-avto/shared";
import type { ListingSnapshotPublicData } from "./search-contract";

export type AvitoListingSnapshotParseResult =
  | {
      status: "captured";
      data: ListingSnapshotPublicData;
    }
  | {
      status: "unavailable";
      reason: "structured_data_missing" | "invalid_structured_data";
    };

export function parseAvitoListingSnapshotHtml(html: string): AvitoListingSnapshotParseResult {
  const root = parse(html);
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');
  const records = scripts.flatMap((script) => parseJsonRecords(script.textContent));
  const product = records.find((record) => record["@type"] === "Product" || record["@type"] === "Vehicle");

  if (product === undefined) {
    return { status: "unavailable", reason: "structured_data_missing" };
  }

  const title = stringOrNull(product.name) ?? "Автомобиль из объявления";
  const description = stringOrNull(product.description) ?? "";
  const priceRub = numberOrNull(objectOrNull(product.offers)?.price);
  const photos = arrayFromUnknown(product.image)
    .map(stringOrNull)
    .filter((url): url is string => url !== null)
    .slice(0, 6)
    .map((url) => ({ url, alt: "Фото автомобиля" }));
  const city =
    root.querySelector('[data-marker="item-view/item-address"]')?.textContent.trim() || null;
  const vin = extractVin(`${title} ${description}`);
  const mileageKm = extractMileageKm(`${title} ${description}`);
  const year = extractYear(title);
  const titleParts = title.split(/[,\s]+/).filter(Boolean);

  return {
    status: "captured",
    data: {
      vin,
      title,
      make: titleParts[0] ?? null,
      model: titleParts[1] ?? null,
      year,
      bodyType: null,
      color: null,
      engine: null,
      transmission: null,
      driveType: null,
      priceRub,
      mileageKm,
      city,
      photos
    }
  };
}

function parseJsonRecords(value: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(value.trim()) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(isRecord);
    }
    if (isRecord(parsed) && Array.isArray(parsed["@graph"])) {
      return parsed["@graph"].filter(isRecord);
    }
    return isRecord(parsed) ? [parsed] : [];
  } catch {
    return [];
  }
}

function extractVin(value: string): string | null {
  const match = value.toUpperCase().match(/[A-HJ-NPR-Z0-9]{17}/);
  if (match === null) return null;
  const detected = detectSearchQuery(match[0]);
  return detected.kind === "vin" ? detected.normalized : null;
}

function extractMileageKm(value: string): number | null {
  const match = value.match(/пробег\s+(\d[\d\s]{1,10})\s*км/i);
  if (match === null) return null;
  return numberOrNull(match[1].replace(/\s+/g, ""));
}

function extractYear(value: string): number | null {
  const match = value.match(/\b(19\d{2}|20\d{2})\b/);
  if (match === null) return null;
  const year = Number(match[1]);
  return year >= 1950 && year <= 2035 ? year : null;
}

function numberOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function arrayFromUnknown(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 7: Run Avito snapshot tests**

Run:

```bash
bun test apps/api/src/modules/search/avito-listing-snapshot.test.ts
```

Expected: PASS.

- [ ] **Step 8: Install dependency and commit**

Run:

```bash
bun install
```

Expected: `bun.lock` changes to include `node-html-parser`.

Commit:

```bash
git add apps/api/package.json bun.lock apps/api/src/modules/search/listing-url.ts apps/api/src/modules/search/listing-url.test.ts apps/api/src/modules/search/avito-listing-snapshot.ts apps/api/src/modules/search/avito-listing-snapshot.test.ts
git commit -m "feat: parse authless listing snapshots"
```

### Task 3: Add Search Repository And Listing Snapshot Storage

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/modules/search/search-repository.ts`
- Create: `apps/api/src/modules/search/drizzle-search-repository.ts`

- [ ] **Step 1: Add schema definitions**

Modify `apps/api/src/db/schema.ts` exactly as described in the Data Model section:

```ts
export const listingSnapshotStatus = pgEnum("listing_snapshot_status", [
  "captured",
  "unavailable",
  "manual_review"
]);
```

Add `listingSnapshots` after `vehicleReportSnapshots` so the table sits near vehicle read-model storage.

- [ ] **Step 2: Define repository interface**

Create `apps/api/src/modules/search/search-repository.ts`:

```ts
import type { VehiclePreviewReadModel } from "../vehicles/report-read-model";
import type { ListingSnapshotPublicData } from "./search-contract";

export type StoredListingSnapshot = {
  id: string;
  sourceKind: "avito";
  listingId: string;
  canonicalUrl: string;
  vehicleId: string | null;
  status: "captured" | "unavailable" | "manual_review";
  originalObjectKey: string | null;
  fetchedAt: string;
  originalExpiresAt: string | null;
  normalizedData: ListingSnapshotPublicData | null;
};

export type SaveListingSnapshotInput = {
  sourceKind: "avito";
  listingId: string;
  canonicalUrl: string;
  vehicleId: string | null;
  status: "captured" | "unavailable" | "manual_review";
  originalObjectKey: string | null;
  fetchedAt: Date;
  originalExpiresAt: Date | null;
  normalizedData: ListingSnapshotPublicData | null;
};

export interface SearchRepository {
  findPreviewByVin(vin: string): Promise<VehiclePreviewReadModel | null>;
  findPreviewsByIdentifier(input: {
    kind: "plate";
    value: string;
    limit: number;
  }): Promise<VehiclePreviewReadModel[]>;
  findListingSnapshot(input: {
    sourceKind: "avito";
    listingId: string;
  }): Promise<StoredListingSnapshot | null>;
  saveListingSnapshot(input: SaveListingSnapshotInput): Promise<StoredListingSnapshot>;
}
```

- [ ] **Step 3: Implement Drizzle repository**

Create `apps/api/src/modules/search/drizzle-search-repository.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
  listingSnapshots,
  vehicleIdentifiers,
  vehicleReportSnapshots,
  vehicles
} from "../../db/schema";
import type { VehiclePreviewReadModel } from "../vehicles/report-read-model";
import type { ListingSnapshotPublicData } from "./search-contract";
import type {
  SaveListingSnapshotInput,
  SearchRepository,
  StoredListingSnapshot
} from "./search-repository";

export class DrizzleSearchRepository implements SearchRepository {
  async findPreviewByVin(vin: string): Promise<VehiclePreviewReadModel | null> {
    const [snapshot] = await db
      .select({ previewData: vehicleReportSnapshots.previewData })
      .from(vehicleReportSnapshots)
      .innerJoin(vehicles, eq(vehicleReportSnapshots.vehicleId, vehicles.id))
      .where(eq(vehicles.vin, vin))
      .limit(1);

    return (snapshot?.previewData as VehiclePreviewReadModel | undefined) ?? null;
  }

  async findPreviewsByIdentifier(input: {
    kind: "plate";
    value: string;
    limit: number;
  }): Promise<VehiclePreviewReadModel[]> {
    const rows = await db
      .select({ previewData: vehicleReportSnapshots.previewData })
      .from(vehicleIdentifiers)
      .innerJoin(vehicleReportSnapshots, eq(vehicleIdentifiers.vehicleId, vehicleReportSnapshots.vehicleId))
      .where(and(eq(vehicleIdentifiers.kind, input.kind), eq(vehicleIdentifiers.value, input.value)))
      .limit(input.limit);

    return rows.map((row) => row.previewData as VehiclePreviewReadModel);
  }

  async findListingSnapshot(input: {
    sourceKind: "avito";
    listingId: string;
  }): Promise<StoredListingSnapshot | null> {
    const [snapshot] = await db
      .select()
      .from(listingSnapshots)
      .where(
        and(
          eq(listingSnapshots.sourceKind, input.sourceKind),
          eq(listingSnapshots.listingId, input.listingId)
        )
      )
      .limit(1);

    return snapshot === undefined ? null : mapListingSnapshot(snapshot);
  }

  async saveListingSnapshot(input: SaveListingSnapshotInput): Promise<StoredListingSnapshot> {
    const values = {
      sourceKind: input.sourceKind,
      listingId: input.listingId,
      canonicalUrl: input.canonicalUrl,
      vehicleId: input.vehicleId,
      status: input.status,
      originalObjectKey: input.originalObjectKey,
      fetchedAt: input.fetchedAt,
      originalExpiresAt: input.originalExpiresAt,
      normalizedData: (input.normalizedData ?? {}) as Record<string, unknown>,
      updatedAt: input.fetchedAt
    };

    const [snapshot] = await db
      .insert(listingSnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: [listingSnapshots.sourceKind, listingSnapshots.listingId],
        set: values
      })
      .returning();

    if (snapshot === undefined) throw new Error("listing_snapshot_save_failed");
    return mapListingSnapshot(snapshot);
  }
}

function mapListingSnapshot(row: typeof listingSnapshots.$inferSelect): StoredListingSnapshot {
  const normalizedData =
    row.status === "captured"
      ? (row.normalizedData as ListingSnapshotPublicData)
      : null;

  return {
    id: row.id,
    sourceKind: row.sourceKind as "avito",
    listingId: row.listingId,
    canonicalUrl: row.canonicalUrl,
    vehicleId: row.vehicleId,
    status: row.status as StoredListingSnapshot["status"],
    originalObjectKey: row.originalObjectKey,
    fetchedAt: row.fetchedAt.toISOString(),
    originalExpiresAt: row.originalExpiresAt?.toISOString() ?? null,
    normalizedData
  };
}
```

- [ ] **Step 4: Typecheck backend**

Run:

```bash
bun run --cwd apps/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit schema and repository**

```bash
git add apps/api/src/db/schema.ts apps/api/src/modules/search/search-repository.ts apps/api/src/modules/search/drizzle-search-repository.ts
git commit -m "feat: store listing snapshots for search"
```

### Task 4: Implement Search Service And POST /api/search

**Files:**
- Create: `apps/api/src/modules/search/search-service.ts`
- Create: `apps/api/src/modules/search/search-service.test.ts`
- Modify: `apps/api/src/modules/search/routes.ts`
- Create: `apps/api/src/modules/search/routes.test.ts`
- Modify: `apps/api/src/app.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `apps/api/src/modules/search/search-service.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { ObjectStorage } from "../storage/object-storage";
import type { VehiclePreviewReadModel } from "../vehicles/report-read-model";
import { SearchService } from "./search-service";
import type { SearchRepository, StoredListingSnapshot } from "./search-repository";

const VALID_VIN = "XTA210990Y2765499";

describe("SearchService", () => {
  it("returns a locked candidate for an exact VIN with an existing preview", async () => {
    const service = createService();

    const result = await service.search({ query: VALID_VIN });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.match).toBe("exact_vin");
    expect(result.candidates[0]?.preview.vinMasked).toBe("XTA2109********99");
    expect(result.candidates[0]?.unlock.canRequestUnlock).toBe(true);
    expect(result.emptyState).toBeNull();
  });

  it("returns the upload empty state for a VIN without a preview", async () => {
    const service = createService({
      repository: fakeRepository({ preview: null })
    });

    const result = await service.search({ query: VALID_VIN });

    expect(result.candidates).toEqual([]);
    expect(result.emptyState?.code).toBe("report_not_found");
  });

  it("searches plates only in internal identifiers and does not call listing fetch", async () => {
    const calls: string[] = [];
    const service = createService({
      repository: fakeRepository({
        platePreviews: [],
        onFindPreviewsByIdentifier: () => calls.push("plate")
      }),
      fetchListingHtml: async () => {
        calls.push("fetch");
        return "<html></html>";
      }
    });

    const result = await service.search({ query: "А123ВС777" });

    expect(calls).toEqual(["plate"]);
    expect(result.emptyState?.code).toBe("report_not_found");
  });

  it("returns a listing-only candidate for an Avito URL with no public VIN", async () => {
    const service = createService({
      fetchListingHtml: async () => `
        <script type="application/ld+json">
        {"@type":"Product","name":"LADA Granta, 2021","description":"Пробег 42 000 км","offers":{"price":"780000"}}
        </script>
      `
    });

    const result = await service.search({
      query: "https://www.avito.ru/moskva/avtomobili/lada_granta_2021_1234567890"
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.kind).toBe("listing");
    expect(result.candidates[0]?.reportStatus).toBe("missing");
    expect(result.candidates[0]?.preview.vinMasked).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/госномер|source|Авито|avito/i);
  });

  it("uses a cached listing snapshot before fetching the URL again", async () => {
    const calls: string[] = [];
    const service = createService({
      repository: fakeRepository({
        listingSnapshot: storedListingSnapshot()
      }),
      fetchListingHtml: async () => {
        calls.push("fetch");
        return "<html></html>";
      }
    });

    const result = await service.search({
      query: "https://www.avito.ru/moskva/avtomobili/lada_granta_2021_1234567890"
    });

    expect(calls).toEqual([]);
    expect(result.candidates[0]?.preview.title).toBe("LADA Granta, 2021");
  });

  it("returns a neutral empty state for Auto.ru and Drom URLs in Milestone 3", async () => {
    const service = createService();

    for (const query of [
      "https://auto.ru/cars/used/sale/test/123/",
      "https://auto.drom.ru/ulan-ude/isuzu/d-max/322002530.html"
    ]) {
      const result = await service.search({ query });
      expect(result.candidates).toEqual([]);
      expect(result.emptyState?.code).toBe("listing_snapshot_unavailable");
    }
  });
});

function createService(overrides: {
  repository?: SearchRepository;
  storage?: ObjectStorage;
  fetchListingHtml?: (url: string) => Promise<string>;
  now?: () => Date;
} = {}): SearchService {
  return new SearchService({
    repository: overrides.repository ?? fakeRepository(),
    storage: overrides.storage ?? fakeStorage(),
    fetchListingHtml: overrides.fetchListingHtml ?? (async () => "<html></html>"),
    now: overrides.now ?? (() => new Date("2026-05-14T10:00:00.000Z")),
    originalRetentionDays: 180
  });
}

function fakeRepository(input: {
  preview?: VehiclePreviewReadModel | null;
  platePreviews?: VehiclePreviewReadModel[];
  listingSnapshot?: StoredListingSnapshot | null;
  onFindPreviewsByIdentifier?: () => void;
} = {}): SearchRepository {
  return {
    async findPreviewByVin() {
      return input.preview === undefined ? preview() : input.preview;
    },
    async findPreviewsByIdentifier() {
      input.onFindPreviewsByIdentifier?.();
      return input.platePreviews ?? [];
    },
    async findListingSnapshot() {
      return input.listingSnapshot ?? null;
    },
    async saveListingSnapshot(snapshotInput) {
      return {
        id: "snapshot-1",
        sourceKind: snapshotInput.sourceKind,
        listingId: snapshotInput.listingId,
        canonicalUrl: snapshotInput.canonicalUrl,
        vehicleId: snapshotInput.vehicleId,
        status: snapshotInput.status,
        originalObjectKey: snapshotInput.originalObjectKey,
        fetchedAt: snapshotInput.fetchedAt.toISOString(),
        originalExpiresAt: snapshotInput.originalExpiresAt?.toISOString() ?? null,
        normalizedData: snapshotInput.normalizedData
      };
    }
  };
}

function fakeStorage(): ObjectStorage {
  return {
    async putObject() {
      return {
        key: "listing-originals/snapshot.html",
        sha256: "sha256",
        sizeBytes: 100,
        contentType: "text/html",
        expiresAt: new Date("2026-11-10T10:00:00.000Z")
      };
    }
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

function storedListingSnapshot(): StoredListingSnapshot {
  return {
    id: "snapshot-1",
    sourceKind: "avito",
    listingId: "1234567890",
    canonicalUrl: "https://www.avito.ru/moskva/avtomobili/lada_granta_2021_1234567890",
    vehicleId: null,
    status: "captured",
    originalObjectKey: "listing-originals/snapshot.html",
    fetchedAt: "2026-05-14T10:00:00.000Z",
    originalExpiresAt: "2026-11-10T10:00:00.000Z",
    normalizedData: {
      vin: null,
      title: "LADA Granta, 2021",
      make: "LADA",
      model: "Granta",
      year: 2021,
      bodyType: null,
      color: null,
      engine: null,
      transmission: null,
      driveType: null,
      priceRub: 780000,
      mileageKm: 42000,
      city: "Москва",
      photos: []
    }
  };
}
```

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```bash
bun test apps/api/src/modules/search/search-service.test.ts
```

Expected: FAIL because `search-service.ts` does not exist.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/modules/search/search-service.ts`:

```ts
import { detectSearchQuery } from "@istoriya-avto/shared";
import type { ObjectStorage } from "../storage/object-storage";
import { parseAvitoListingSnapshotHtml } from "./avito-listing-snapshot";
import { parseSupportedListingUrl } from "./listing-url";
import {
  assertSafeSearchResponse,
  createEmptySearchResult,
  createListingCandidate,
  createVehicleCandidate,
  type SearchResult,
  type SearchQuerySummary
} from "./search-contract";
import type { SearchRepository } from "./search-repository";

export type SearchServiceOptions = {
  repository: SearchRepository;
  storage: ObjectStorage;
  fetchListingHtml?: (url: string) => Promise<string>;
  now?: () => Date;
  originalRetentionDays: number;
};

export class SearchService {
  private readonly repository: SearchRepository;
  private readonly storage: ObjectStorage;
  private readonly fetchListingHtml: (url: string) => Promise<string>;
  private readonly now: () => Date;
  private readonly originalRetentionDays: number;

  constructor(options: SearchServiceOptions) {
    this.repository = options.repository;
    this.storage = options.storage;
    this.fetchListingHtml = options.fetchListingHtml ?? defaultFetchListingHtml;
    this.now = options.now ?? (() => new Date());
    this.originalRetentionDays = options.originalRetentionDays;
  }

  async search(input: { query: string }): Promise<SearchResult> {
    const detected = detectSearchQuery(input.query);

    if (detected.kind === "vin") return this.searchVin(detected.normalized);
    if (detected.kind === "plate") return this.searchPlate(detected.normalized);
    if (detected.kind === "listing_url") return this.searchListingUrl(detected.normalized);

    return createEmptySearchResult({
      query: { kind: "unknown", normalized: "" },
      code: "unsupported_query"
    });
  }

  private async searchVin(vin: string): Promise<SearchResult> {
    const query: SearchQuerySummary = { kind: "vin", normalized: vin };
    const preview = await this.repository.findPreviewByVin(vin);
    if (preview === null) return createEmptySearchResult({ query, code: "report_not_found" });

    return safe({
      query,
      candidates: [createVehicleCandidate({ match: "exact_vin", preview })],
      emptyState: null
    });
  }

  private async searchPlate(plate: string): Promise<SearchResult> {
    const query: SearchQuerySummary = { kind: "plate", normalized: plate };
    const previews = await this.repository.findPreviewsByIdentifier({
      kind: "plate",
      value: plate,
      limit: 5
    });

    if (previews.length === 0) return createEmptySearchResult({ query, code: "report_not_found" });

    return safe({
      query,
      candidates: previews.map((preview) =>
        createVehicleCandidate({ match: "internal_plate", preview })
      ),
      emptyState: null
    });
  }

  private async searchListingUrl(url: string): Promise<SearchResult> {
    const query: SearchQuerySummary = { kind: "listing_url", normalized: "listing" };
    const identity = parseSupportedListingUrl(url);

    if (identity.kind !== "avito") {
      return createEmptySearchResult({ query, code: "listing_snapshot_unavailable" });
    }

    const cached = await this.repository.findListingSnapshot({
      sourceKind: "avito",
      listingId: identity.listingId
    });
    if (cached?.status === "captured" && cached.normalizedData !== null) {
      const cachedPreview =
        cached.normalizedData.vin === null
          ? null
          : await this.repository.findPreviewByVin(cached.normalizedData.vin);

      return safe({
        query,
        candidates: [
          createListingCandidate({
            sourceKind: "avito",
            listingId: identity.listingId,
            observedAt: cached.fetchedAt,
            vehicleId: cachedPreview?.vehicleId ?? null,
            reportAvailable: cachedPreview !== null,
            snapshot: cached.normalizedData
          })
        ],
        emptyState: null
      });
    }

    const now = this.now();
    const html = await this.fetchListingHtml(identity.canonicalUrl).catch(() => null);
    if (html === null) {
      await this.repository.saveListingSnapshot({
        sourceKind: "avito",
        listingId: identity.listingId,
        canonicalUrl: identity.canonicalUrl,
        vehicleId: null,
        status: "unavailable",
        originalObjectKey: null,
        fetchedAt: now,
        originalExpiresAt: null,
        normalizedData: null
      });
      return createEmptySearchResult({ query, code: "listing_snapshot_unavailable" });
    }

    const storedObject = await this.storage.putObject({
      namespace: "listing-originals",
      bytes: new TextEncoder().encode(html),
      contentType: "text/html; charset=utf-8",
      originalFileName: `${identity.listingId}.html`,
      expiresAt: addDays(now, this.originalRetentionDays)
    });
    const parsed = parseAvitoListingSnapshotHtml(html);

    if (parsed.status !== "captured") {
      await this.repository.saveListingSnapshot({
        sourceKind: "avito",
        listingId: identity.listingId,
        canonicalUrl: identity.canonicalUrl,
        vehicleId: null,
        status: "unavailable",
        originalObjectKey: storedObject.key,
        fetchedAt: now,
        originalExpiresAt: storedObject.expiresAt,
        normalizedData: null
      });
      return createEmptySearchResult({ query, code: "listing_snapshot_unavailable" });
    }

    const linkedPreview =
      parsed.data.vin === null ? null : await this.repository.findPreviewByVin(parsed.data.vin);
    const vehicleId = linkedPreview?.vehicleId ?? null;
    const snapshot = await this.repository.saveListingSnapshot({
      sourceKind: "avito",
      listingId: identity.listingId,
      canonicalUrl: identity.canonicalUrl,
      vehicleId,
      status: "captured",
      originalObjectKey: storedObject.key,
      fetchedAt: now,
      originalExpiresAt: storedObject.expiresAt,
      normalizedData: parsed.data
    });

    if (snapshot.normalizedData === null) {
      return createEmptySearchResult({ query, code: "listing_snapshot_unavailable" });
    }

    return safe({
      query,
      candidates: [
        createListingCandidate({
          sourceKind: "avito",
          listingId: identity.listingId,
          observedAt: snapshot.fetchedAt,
          vehicleId: snapshot.vehicleId,
          reportAvailable: linkedPreview !== null,
          snapshot: snapshot.normalizedData
        })
      ],
      emptyState: null
    });
  }
}

function safe(result: SearchResult): SearchResult {
  assertSafeSearchResponse(result);
  return result;
}

async function defaultFetchListingHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "IstoriyaAvtoBot/0.1"
    },
    redirect: "follow"
  });
  if (!response.ok) throw new Error("listing_fetch_failed");
  return response.text();
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
bun test apps/api/src/modules/search/search-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing route tests**

Create `apps/api/src/modules/search/routes.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { createSearchRoutes } from "./routes";
import type { SearchResult } from "./search-contract";

describe("search routes", () => {
  it("returns search candidates from the search service", async () => {
    const routes = createSearchRoutes({
      search: async () => result()
    });

    const response = await routes.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "XTA210990Y2765499" })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result());
  });

  it("rejects invalid payloads", async () => {
    const routes = createSearchRoutes({
      search: async () => result()
    });

    const response = await routes.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: 123 })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_request",
        message: "Поле query должно быть строкой."
      }
    });
  });
});

function result(): SearchResult {
  return {
    query: { kind: "vin", normalized: "XTA210990Y2765499" },
    candidates: [],
    emptyState: {
      code: "report_not_found",
      title: "Отчета пока нет",
      message: "Загрузите свой отчет, и он может дать 1 балл на будущий просмотр.",
      action: { kind: "upload_report", label: "Загрузить отчет" }
    }
  };
}
```

- [ ] **Step 6: Update `routes.ts`**

Modify `apps/api/src/modules/search/routes.ts` so it exports dependency-injected routes and keeps `/detect`:

```ts
import { detectSearchQuery } from "@istoriya-avto/shared";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { env } from "../../env";
import { LocalObjectStorage } from "../storage/local-object-storage";
import { DrizzleSearchRepository } from "./drizzle-search-repository";
import type { SearchResult } from "./search-contract";
import { SearchService } from "./search-service";

const searchQuerySchema = z.object({
  query: z.string()
});

export type SearchRoutesDependencies = {
  search(input: { query: string }): Promise<SearchResult>;
};

export function createSearchRoutes(dependencies: SearchRoutesDependencies): Hono {
  const routes = new Hono();

  routes.post("/", async (context) => {
    const body = await context.req.json().catch(() => null);
    const parsed = searchQuerySchema.safeParse(body);
    if (!parsed.success) return invalidRequest(context);

    return context.json(await dependencies.search({ query: parsed.data.query }));
  });

  routes.post("/detect", async (context) => {
    const body = await context.req.json().catch(() => null);
    const parsed = searchQuerySchema.safeParse(body);
    if (!parsed.success) return invalidRequest(context);

    return context.json({
      query: detectSearchQuery(parsed.data.query)
    });
  });

  return routes;
}

const searchService = new SearchService({
  repository: new DrizzleSearchRepository(),
  storage: new LocalObjectStorage({ rootDir: env.REPORT_STORAGE_LOCAL_DIR }),
  originalRetentionDays: env.REPORT_ORIGINAL_RETENTION_DAYS
});

export const searchRoutes = createSearchRoutes({
  search: (input) => searchService.search(input)
});

function invalidRequest(context: Context) {
  return context.json(
    {
      error: {
        code: "invalid_request",
        message: "Поле query должно быть строкой."
      }
    },
    400
  );
}
```

- [ ] **Step 7: Run route tests**

Run:

```bash
bun test apps/api/src/modules/search/routes.test.ts apps/api/src/app.test.ts
```

Expected: PASS after updating `apps/api/src/app.test.ts` to include a `POST /api/search` smoke test.

Add this app test:

```ts
it("exposes search results route", async () => {
  const response = await app.request("/api/search", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ query: "not a useful query" })
  });

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.candidates).toEqual([]);
  expect(body.emptyState.code).toBe("unsupported_query");
});
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/search/search-service.ts apps/api/src/modules/search/search-service.test.ts apps/api/src/modules/search/routes.ts apps/api/src/modules/search/routes.test.ts apps/api/src/app.test.ts
git commit -m "feat: add search results API"
```

### Task 5: Add Full Report Access Boundary And Unlock Intent

**Files:**
- Create: `apps/api/src/modules/access/report-access-service.ts`
- Create: `apps/api/src/modules/access/report-access-service.test.ts`
- Modify: `apps/api/src/modules/vehicles/routes.ts`
- Modify: `apps/api/src/modules/vehicles/routes.test.ts`

- [ ] **Step 1: Write failing access service tests**

Create `apps/api/src/modules/access/report-access-service.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { createLockedReportAccessService } from "./report-access-service";

describe("report access service", () => {
  it("denies full report access in Milestone 3 without mutating ledger state", async () => {
    const service = createLockedReportAccessService();

    await expect(
      service.canViewFullReport({ vin: "XTA210990Y2765499", userId: null, guestSessionId: null })
    ).resolves.toEqual({
      status: "locked",
      options: ["upload_report", "choose_plan"],
      willSpendPoints: false,
      warning:
        "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
    });
  });
});
```

- [ ] **Step 2: Implement access service**

Create `apps/api/src/modules/access/report-access-service.ts`:

```ts
export type ReportAccessDecision =
  | {
      status: "granted";
      method: "already_opened" | "test_override";
    }
  | {
      status: "locked";
      options: ["upload_report", "choose_plan"];
      willSpendPoints: false;
      warning: string;
    };

export interface ReportAccessService {
  canViewFullReport(input: {
    vin: string;
    userId: string | null;
    guestSessionId: string | null;
  }): Promise<ReportAccessDecision>;
}

const WRONG_CANDIDATE_WARNING =
  "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается.";

export function createLockedReportAccessService(): ReportAccessService {
  return {
    async canViewFullReport() {
      return {
        status: "locked",
        options: ["upload_report", "choose_plan"],
        willSpendPoints: false,
        warning: WRONG_CANDIDATE_WARNING
      };
    }
  };
}
```

- [ ] **Step 3: Run access service tests**

Run:

```bash
bun test apps/api/src/modules/access/report-access-service.test.ts
```

Expected: PASS.

- [ ] **Step 4: Update vehicle route tests first**

Modify `apps/api/src/modules/vehicles/routes.test.ts`:

```ts
it("locks full report by default before repository lookup", async () => {
  const dependencies = createDependencies();
  const routes = createVehicleRoutes(dependencies);

  const response = await routes.request(`/${VALID_VIN}/report`);

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: {
      code: "vehicle_report_locked",
      message: "Полный отчет закрыт.",
      unlock: {
        status: "locked",
        options: ["upload_report", "choose_plan"],
        willSpendPoints: false,
        warning:
          "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
      }
    }
  });
  expect(dependencies.reportCalls).toEqual([]);
});
```

Add a separate granted-access test:

```ts
it("returns full report only when access service grants access", async () => {
  const dependencies = createDependencies({
    accessService: {
      async canViewFullReport() {
        return { status: "granted", method: "test_override" };
      }
    }
  });
  const routes = createVehicleRoutes(dependencies);

  const response = await routes.request(`/${VALID_VIN}/report`);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ report: fullReportReadModel() });
  expect(dependencies.reportCalls).toEqual([VALID_VIN]);
});
```

Add unlock intent test:

```ts
it("returns unlock intent without revealing full report", async () => {
  const dependencies = createDependencies();
  const routes = createVehicleRoutes(dependencies);

  const response = await routes.request(`/${VALID_VIN}/unlock-intent`, {
    method: "POST"
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    unlock: {
      status: "locked",
      vinMasked: "XTA2109********99",
      options: ["upload_report", "choose_plan"],
      willSpendPoints: false,
      message: "Списание баллов и подписочных лимитов появится на следующем этапе.",
      warning:
        "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
    }
  });
  expect(dependencies.previewCalls).toEqual([VALID_VIN]);
  expect(dependencies.reportCalls).toEqual([]);
});
```

Update `createDependencies` to accept `accessService` and default to `createLockedReportAccessService()`.

- [ ] **Step 5: Update vehicle routes**

Modify `apps/api/src/modules/vehicles/routes.ts`:

```ts
import {
  createLockedReportAccessService,
  type ReportAccessDecision,
  type ReportAccessService
} from "../access/report-access-service";
```

Extend dependencies:

```ts
export type VehicleRoutesDependencies = {
  findPreviewByVin(vin: string): Promise<VehiclePreviewReadModel | null>;
  findFullReportByVin(vin: string): Promise<VehicleFullReportReadModel | null>;
  accessService: ReportAccessService;
};
```

Gate the report route before repository lookup:

```ts
routes.get("/:vin/report", async (context) => {
  const vin = parseVin(context.req.param("vin"));
  if (vin === null) return invalidVin(context);

  const access = await dependencies.accessService.canViewFullReport({
    vin,
    userId: null,
    guestSessionId: null
  });
  if (access.status !== "granted") return lockedReport(context, access);

  const report = await dependencies.findFullReportByVin(vin);
  if (report === null) return vehicleReportNotFound(context);

  assertNoSourceBrandLeak(report);
  return context.json({ report });
});
```

Add unlock intent route:

```ts
routes.post("/:vin/unlock-intent", async (context) => {
  const vin = parseVin(context.req.param("vin"));
  if (vin === null) return invalidVin(context);

  const preview = await dependencies.findPreviewByVin(vin);
  if (preview === null) return vehicleReportNotFound(context);

  return context.json({
    unlock: {
      status: "locked",
      vinMasked: preview.vinMasked,
      options: ["upload_report", "choose_plan"],
      willSpendPoints: false,
      message: "Списание баллов и подписочных лимитов появится на следующем этапе.",
      warning:
        "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
    }
  });
});
```

Add locked response helper:

```ts
function lockedReport(context: Context, access: Extract<ReportAccessDecision, { status: "locked" }>) {
  return context.json(
    {
      error: {
        code: "vehicle_report_locked",
        message: "Полный отчет закрыт.",
        unlock: access
      }
    },
    403
  );
}
```

Wire production default:

```ts
export const vehicleRoutes = createVehicleRoutes({
  findPreviewByVin: (vin) => vehicleReportRepository.findPreviewByVin(vin),
  findFullReportByVin: (vin) => vehicleReportRepository.findFullReportByVin(vin),
  accessService: createLockedReportAccessService()
});
```

- [ ] **Step 6: Run vehicle route tests**

Run:

```bash
bun test apps/api/src/modules/vehicles/routes.test.ts apps/api/src/modules/access/report-access-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/access/report-access-service.ts apps/api/src/modules/access/report-access-service.test.ts apps/api/src/modules/vehicles/routes.ts apps/api/src/modules/vehicles/routes.test.ts
git commit -m "feat: gate full reports behind unlock boundary"
```

### Task 6: Build Frontend Results, Preview Cards, Empty State, And Unlock UI

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Update frontend API client types**

Modify `apps/web/src/lib/api.ts` to add:

```ts
export type SearchResultResponse = {
  query: {
    kind: "vin" | "plate" | "listing_url" | "unknown";
    normalized: string;
  };
  candidates: Array<{
    id: string;
    kind: "vehicle" | "listing";
    match: "exact_vin" | "internal_plate" | "listing_snapshot";
    reportStatus: "available" | "missing";
    preview: {
      vehicleId: string | null;
      vinMasked: string | null;
      title: string;
      make: string | null;
      model: string | null;
      year: number | null;
      bodyType: string | null;
      color: string | null;
      engine: string | null;
      transmission: string | null;
      driveType: string | null;
      photo: { url: string; alt: string | null } | null;
      lastListing: {
        observedAt: string | null;
        priceRub: number | null;
        mileageKm: number | null;
        city: string | null;
      } | null;
      lastUpdatedAt: string | null;
    };
    unlock: {
      status: "locked" | "unavailable";
      canRequestUnlock: boolean;
      warning: string;
    };
  }>;
  emptyState: {
    code: "report_not_found" | "listing_snapshot_unavailable" | "unsupported_query";
    title: string;
    message: string;
    action: {
      kind: "upload_report";
      label: string;
    };
  } | null;
};

export type UnlockIntentResponse = {
  unlock: {
    status: "locked";
    vinMasked: string;
    options: Array<"upload_report" | "choose_plan">;
    willSpendPoints: false;
    message: string;
    warning: string;
  };
};

export async function searchVehicles(query: string): Promise<SearchResultResponse> {
  const response = await fetch(`${API_BASE_URL}/api/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query })
  });

  if (!response.ok) throw new Error("Не удалось выполнить поиск.");
  return response.json() as Promise<SearchResultResponse>;
}

export async function createUnlockIntent(vin: string): Promise<UnlockIntentResponse> {
  const response = await fetch(`${API_BASE_URL}/api/vehicles/${encodeURIComponent(vin)}/unlock-intent`, {
    method: "POST"
  });

  if (!response.ok) throw new Error("Не удалось подготовить открытие отчета.");
  return response.json() as Promise<UnlockIntentResponse>;
}
```

Keep `detectSearchQuery` for the existing detection smoke route until the UI no longer needs it.

- [ ] **Step 2: Replace submit flow with search results**

Modify `apps/web/src/App.tsx`:

- Import `CarFront`, `Gauge`, `LockKeyhole`, `MapPin`, `ReceiptText`, `Upload`, `WalletCards` from `lucide-react`.
- Replace `DetectionState` with:

```ts
type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: SearchResultResponse }
  | { status: "error"; message: string };

type UnlockState =
  | { status: "idle" }
  | { status: "loading"; candidateId: string }
  | { status: "success"; candidateId: string; message: string; warning: string }
  | { status: "error"; candidateId: string; message: string };
```

- `handleSubmit` must call `searchVehicles(trimmedQuery)` and set `searchState`.
- Render a results section under the input:

```tsx
{searchState.status === "success" && (
  <section className="results-section" aria-labelledby="results-title">
    <div className="results-heading">
      <span>{searchState.data.query.kind === "vin" ? "VIN" : searchState.data.query.kind === "plate" ? "Госномер" : "Ссылка"}</span>
      <h2 id="results-title">Найденные варианты</h2>
    </div>

    {searchState.data.candidates.length > 0 ? (
      <div className="candidate-list">
        {searchState.data.candidates.map((candidate) => (
          <article className="candidate-card" key={candidate.id}>
            <div className="candidate-photo">
              {candidate.preview.photo ? (
                <img src={candidate.preview.photo.url} alt={candidate.preview.photo.alt ?? "Фото автомобиля"} />
              ) : (
                <CarFront aria-hidden="true" size={34} />
              )}
            </div>
            <div className="candidate-body">
              <div className="candidate-title-row">
                <h3>{candidate.preview.title}</h3>
                <span>{candidate.reportStatus === "available" ? "Отчет есть" : "Отчета нет"}</span>
              </div>
              <div className="candidate-facts" aria-label="Данные превью">
                {candidate.preview.year !== null && <span>{candidate.preview.year}</span>}
                {candidate.preview.lastListing?.priceRub !== null && candidate.preview.lastListing?.priceRub !== undefined && (
                  <span>{formatRub(candidate.preview.lastListing.priceRub)}</span>
                )}
                {candidate.preview.lastListing?.mileageKm !== null && candidate.preview.lastListing?.mileageKm !== undefined && (
                  <span><Gauge aria-hidden="true" size={15} />{formatKm(candidate.preview.lastListing.mileageKm)}</span>
                )}
                {candidate.preview.lastListing?.city && (
                  <span><MapPin aria-hidden="true" size={15} />{candidate.preview.lastListing.city}</span>
                )}
                {candidate.preview.vinMasked && <span>{candidate.preview.vinMasked}</span>}
              </div>
              <p className="candidate-warning">{candidate.unlock.warning}</p>
              <button
                className="unlock-button"
                type="button"
                disabled={!candidate.unlock.canRequestUnlock || unlockState.status === "loading"}
                onClick={() => handleUnlock(candidate)}
              >
                <LockKeyhole aria-hidden="true" size={17} />
                <span>{candidate.unlock.canRequestUnlock ? "Открыть отчет" : "Загрузить отчет"}</span>
              </button>
              {unlockState.status === "success" && unlockState.candidateId === candidate.id && (
                <div className="unlock-panel">
                  <WalletCards aria-hidden="true" size={18} />
                  <p>{unlockState.message}</p>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    ) : (
      <EmptyState state={searchState.data.emptyState} />
    )}
  </section>
)}
```

- Add helper functions inside `App.tsx`:

```ts
function formatRub(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value) + " ₽";
}

function formatKm(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value) + " км";
}
```

- `handleUnlock` should only call `createUnlockIntent(trimmedQuery.toUpperCase())` when the detected result query kind is `vin`. For plate and listing candidates, Milestone 3 should show the same boundary text locally because the frontend does not receive the full VIN:

```ts
async function handleUnlock(candidate: SearchResultResponse["candidates"][number]) {
  if (!candidate.unlock.canRequestUnlock) return;

  setUnlockState({ status: "loading", candidateId: candidate.id });
  try {
    if (searchState.status === "success" && searchState.data.query.kind === "vin") {
      const data = await createUnlockIntent(searchState.data.query.normalized);
      setUnlockState({
        status: "success",
        candidateId: candidate.id,
        message: data.unlock.message,
        warning: data.unlock.warning
      });
      return;
    }

    setUnlockState({
      status: "success",
      candidateId: candidate.id,
      message: "Списание баллов и подписочных лимитов появится на следующем этапе.",
      warning: candidate.unlock.warning
    });
  } catch (error) {
    setUnlockState({
      status: "error",
      candidateId: candidate.id,
      message: error instanceof Error ? error.message : "Не удалось подготовить открытие отчета."
    });
  }
}
```

- Remove the status copy that says `Источник: ${detected.host}`. The UI must not label facts by a third-party source.

- [ ] **Step 3: Add empty state component**

Add this function in `App.tsx`:

```tsx
function EmptyState({ state }: { state: SearchResultResponse["emptyState"] }) {
  return (
    <div className="empty-state">
      <ReceiptText aria-hidden="true" size={24} />
      <div>
        <h3>{state?.title ?? "Отчета пока нет"}</h3>
        <p>{state?.message ?? "Загрузите отчет, и он может дать 1 балл на будущий просмотр."}</p>
      </div>
      <button type="button">
        <Upload aria-hidden="true" size={17} />
        <span>{state?.action.label ?? "Загрузить отчет"}</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Add responsive styles**

Modify `apps/web/src/styles.css` to add result card styles after `.status-panel`:

```css
.results-section {
  display: grid;
  gap: 14px;
  margin: 18px 0;
}

.results-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 12px;
}

.results-heading span {
  color: var(--accent-dark);
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0;
}

.results-heading h2 {
  color: var(--ink);
  font-size: 24px;
  line-height: 1.15;
}

.candidate-list {
  display: grid;
  gap: 12px;
}

.candidate-card {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 14px;
  padding: 12px;
  border: 1px solid rgba(20, 33, 29, 0.12);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: 0 10px 28px rgba(42, 35, 24, 0.08);
}

.candidate-photo {
  display: grid;
  place-items: center;
  width: 96px;
  height: 96px;
  overflow: hidden;
  border-radius: 8px;
  background: #e5efe9;
  color: var(--accent-dark);
}

.candidate-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.candidate-body {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.candidate-title-row {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 10px;
}

.candidate-title-row h3 {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: 18px;
  line-height: 1.2;
}

.candidate-title-row span {
  flex: 0 0 auto;
  padding: 4px 8px;
  border-radius: 999px;
  background: #e5efe9;
  color: var(--accent-dark);
  font-size: 12px;
  font-weight: 800;
}

.candidate-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.candidate-facts span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  padding: 0 8px;
  border: 1px solid rgba(20, 33, 29, 0.1);
  border-radius: 999px;
  background: rgba(255, 250, 241, 0.78);
}

.candidate-warning {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.45;
}

.unlock-button,
.empty-state button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: fit-content;
  min-height: 40px;
  padding: 0 13px;
  border: 0;
  border-radius: 8px;
  background: var(--accent);
  color: #ffffff;
  font-size: 14px;
  font-weight: 800;
}

.unlock-button:disabled {
  opacity: 0.5;
}

.unlock-panel {
  display: flex;
  gap: 9px;
  align-items: start;
  padding: 10px;
  border-radius: 8px;
  background: #fff4df;
  color: var(--warning);
  font-size: 13px;
  line-height: 1.4;
}

.empty-state {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 16px;
  border: 1px solid rgba(20, 33, 29, 0.12);
  border-radius: 8px;
  background: var(--panel);
}

.empty-state > svg {
  width: 42px;
  height: 42px;
  padding: 9px;
  border-radius: 8px;
  background: #e5efe9;
  color: var(--accent-dark);
}

.empty-state h3 {
  margin: 0 0 4px;
  color: var(--ink);
  font-size: 18px;
}

.empty-state p {
  color: var(--muted);
  font-size: 14px;
  line-height: 1.45;
}
```

Add mobile refinements:

```css
@media (max-width: 560px) {
  .candidate-card {
    grid-template-columns: 82px minmax(0, 1fr);
  }

  .candidate-photo {
    width: 82px;
    height: 82px;
  }

  .candidate-title-row {
    display: grid;
  }

  .empty-state {
    grid-template-columns: 42px minmax(0, 1fr);
  }

  .empty-state button {
    grid-column: 1 / -1;
    width: 100%;
  }
}
```

- [ ] **Step 5: Build the frontend**

Run:

```bash
bun run --cwd apps/web build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "feat: show search preview cards"
```

### Task 7: End-To-End Verification, Migration Generation, And Review Gates

**Files:**
- Generated migration under `apps/api/drizzle/` or the repo's existing Drizzle migrations directory.
- No source file edits unless verification finds a bug.

- [ ] **Step 1: Run all tests**

Run:

```bash
bun run test
```

Expected: all shared and API tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: shared, API, and web typechecks pass.

- [ ] **Step 3: Build frontend**

Run:

```bash
bun run --cwd apps/web build
```

Expected: production Vite build succeeds.

- [ ] **Step 4: Generate DB migration**

Run:

```bash
bun run --cwd apps/api db:generate
```

Expected: one migration for `listing_snapshot_status` and `listing_snapshots`. Inspect the generated SQL and confirm it does not modify existing Milestone 1 or Milestone 2 tables except by adding the new table and enum.

- [ ] **Step 5: Check for accidental source-brand fact labels in user-facing code**

Run:

```bash
rg -n "Источник:|sourceKind|originalObjectKey|parserVersion|Цена из|Пробег из" apps/api/src/modules/search apps/web/src
```

Expected: no user-facing source-label copy. Internal type names may appear only in backend leak-guard tests and repository code, not in serialized search candidates or frontend copy.

- [ ] **Step 6: Browser smoke test**

Start API and web dev servers in separate terminals:

```bash
bun run dev:api
bun run dev:web
```

Open the web app and verify:

- VIN search with a known seeded/dev VIN shows a candidate preview card.
- Unknown VIN shows the "Отчета пока нет" empty state.
- Plate search shows candidates only if an internal `vehicle_identifiers` row exists; otherwise it shows the upload empty state.
- Avito URL with an authless fixture or reachable page shows a listing candidate or neutral snapshot unavailable empty state.
- Candidate cards show no plate.
- Candidate cards show masked VIN only.
- Clicking "Открыть отчет" shows the Milestone 3 unlock boundary and does not open the full report.
- Direct `GET /api/vehicles/:vin/report` returns `403 vehicle_report_locked` without the report body.

- [ ] **Step 7: Review gates before implementation is called complete**

Confirm these gates in the implementation PR/session notes:

- Search API covers VIN, internal plate, Avito listing URL, recognized uncaptured Auto.ru/Drom URL, unsupported URL, and unknown text.
- Existing `/api/vehicles/:vin/preview` still returns preview-only data.
- Full report route is inaccessible without a granted access decision.
- Unlock intent performs no ledger, subscription, access, or balance mutation.
- Search and report responses do not identify third-party services as sources of concrete facts.
- No personal data from listing HTML is returned in normalized candidate previews.
- `manual_review` uploads remain excluded from aggregation by the existing Milestone 2 path.

- [ ] **Step 8: Commit migration and any verification fixes**

```bash
git add apps/api/drizzle apps/api/src apps/web/src package.json apps/api/package.json bun.lock
git commit -m "chore: verify milestone 3 search flow"
```

Use the actual migration directory path if it differs from `apps/api/drizzle`.

## Plan Self-Review

- Spec coverage: The plan covers Search API by VIN/plate/listing URL, existing preview read model reuse, plate behavior before external lookup sources, authless Avito URL handling, candidate preview cards, preview privacy rules, empty state, frontend results flow, unlock boundary, full report lockout, no concrete fact source branding, tests-first steps, and review gates.
- Placeholder scan: No task relies on "TBD", "TODO", or unspecified error handling. Auto.ru and Drom behavior is explicitly recognized-but-uncaptured for Milestone 3.
- Type consistency: `SearchResult`, `SearchCandidate`, `ListingSnapshotPublicData`, `SearchRepository`, `ReportAccessService`, and route response shapes are named consistently across tasks.
- Scope check: Auth, ledger mutation, subscriptions, permanent vehicle accesses, OCR, report-link ingestion, Auto.ru parser, and Drom parser remain out of scope and are reserved for later milestones.
