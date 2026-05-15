# Full Report UI, Share, And PDF Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Milestone 5 so an entitled user can view the full consolidated VIN report, create a 7-day share link, and download a safe PDF export, while share recipients can view a noindex read-only report without auth, PDF download, or resharing.

**Architecture:** Keep `VehicleFullReportReadModel` as the source of truth and add a presentation layer that turns it into stable sections for API/UI/PDF/share. Add by-id full report access because unlock-by-candidate intentionally does not return full VIN before access. Implement share tokens as server-generated secrets stored only as hashes in `share_links`; share reads validate expiry before fetching report data. PDF export is generated from the same presentation model so report, share, and PDF stay consistent and source-brand leak guards remain centralized.

**Tech Stack:** Bun, TypeScript, Hono, Drizzle ORM, PostgreSQL, Zod, React, Vite, lucide-react, `bun:test`, existing access service and report read model.

---

## Scope Decisions

- Use the approved MVP design in `docs/superpowers/specs/2026-05-12-istoriya-avto-mvp-design.md`; no product logic changes.
- Full report UI follows the approved order:
  1. Summary and transparency score.
  2. Passport and identifiers.
  3. Legal risks: restrictions, pledge, wanted.
  4. Accidents and repair calculations.
  5. Mileage and discrepancies.
  6. Owners/registrations.
  7. Listings history with photos, prices, mileage.
  8. Commercial use: taxi, carsharing, leasing.
  9. Maintenance, insurance, diagnostics when data exists.
  10. Data discrepancies and quality.
  11. Report update history.
- Current read model does not yet contain owners/registrations, carsharing, maintenance, insurance, diagnostics, or real photos. Critical missing sections render `данных не найдено на дату обновления`; secondary empty sections are hidden.
- Full VIN can appear only in unlocked full report, share report, and PDF export. Preview remains masked and plate remains absent.
- Do not show source service names as sources of concrete facts. Keep existing `assertNoSourceBrandLeak` and add tests for report/share/PDF surfaces.
- Do not expose raw PDF/HTML/object keys, parser versions, or original report artifacts.
- Share links live exactly 7 days from creation, are token-based, require no auth to view, do not spend owner limits or points, cannot create nested share links, and cannot download PDF.
- PDF export is available only to the owner/user with report access, not to share recipients.
- Full report and share UI set `noindex,nofollow`. API responses also include `X-Robots-Tag: noindex, nofollow`.
- Complaints/support buttons are allowed as UI affordances, but backend complaint workflow belongs to Milestone 6 unless already trivial.

## Target File Structure

```text
apps/api/src
├── db/schema.ts
└── modules
    ├── access
    │   ├── drizzle-report-access-repository.ts
    │   └── report-access-repository.ts
    ├── reports
    │   ├── report-pdf.test.ts
    │   ├── report-pdf.ts
    │   ├── report-presentation.test.ts
    │   ├── report-presentation.ts
    │   ├── share-link-repository.ts
    │   ├── share-link-service.test.ts
    │   └── share-link-service.ts
    └── vehicles
        ├── routes.test.ts
        └── routes.ts

apps/web/src
├── App.tsx
├── lib/api.ts
└── styles.css
```

## API Contracts

### Full Report

```http
GET /api/vehicles/:vin/report
GET /api/vehicles/by-id/:vehicleId/report
```

Success:

```json
{
  "report": { "vehicleId": "vehicle-1", "vin": "XTA210990Y2765499" },
  "presentation": {
    "generatedAt": "2026-05-15T10:00:00.000Z",
    "noindex": true,
    "sections": [
      {
        "id": "summary",
        "title": "Сводка",
        "critical": true,
        "state": "ready",
        "items": [{ "label": "Оценка", "value": "4.4 / 5 · История в целом прозрачна" }]
      }
    ],
    "actions": { "canShare": true, "canDownloadPdf": true }
  }
}
```

Locked behavior stays unchanged: access is checked before `findFullReportByVin` or `findFullReportByVehicleId`.

### Share

```http
POST /api/vehicles/by-id/:vehicleId/share-links
```

Requires user access to the vehicle report.

```json
{
  "share": {
    "token": "ia_sh_...",
    "url": "http://localhost:5173/#/share/ia_sh_...",
    "expiresAt": "2026-05-22T10:00:00.000Z"
  }
}
```

```http
GET /api/share/:token/report
```

Success has the same `report` and `presentation` shape, but:

```json
{
  "presentation": {
    "actions": { "canShare": false, "canDownloadPdf": false }
  }
}
```

Expired/revoked/unknown tokens return `404` with a neutral message.

### PDF

```http
GET /api/vehicles/by-id/:vehicleId/report.pdf
```

Requires user access. Returns `application/pdf`, `Content-Disposition: attachment`, `X-Robots-Tag: noindex, nofollow`. Share tokens do not expose a PDF endpoint.

---

## Task 1: Report Presentation Model

**Files:**
- Create: `apps/api/src/modules/reports/report-presentation.ts`
- Create: `apps/api/src/modules/reports/report-presentation.test.ts`
- Modify later consumers only after this task passes.

- [ ] **Step 1: Write the failing presentation tests**

Create `apps/api/src/modules/reports/report-presentation.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { VehicleFullReportReadModel } from "../vehicles/report-read-model";
import { buildReportPresentation } from "./report-presentation";

describe("report presentation", () => {
  it("builds full report sections in approved order", () => {
    const presentation = buildReportPresentation({
      report: fullReport(),
      mode: "owner"
    });

    expect(presentation.noindex).toBe(true);
    expect(presentation.actions).toEqual({ canShare: true, canDownloadPdf: true });
    expect(presentation.sections.map((section) => section.id)).toEqual([
      "summary",
      "passport",
      "legal_risks",
      "accidents_repairs",
      "mileage",
      "owners_registrations",
      "listings",
      "commercial_use",
      "data_quality",
      "update_history"
    ]);
  });

  it("renders critical empty sections with the approved empty text", () => {
    const report = fullReport({
      legalRisks: {
        restrictions: { status: "unknown", checkedAt: null },
        pledge: { status: "unknown", checkedAt: null },
        wanted: { status: "unknown", checkedAt: null }
      },
      accidentsAndRepairs: {
        accidents: { status: "unknown", checkedAt: null },
        repairCalculations: { status: "unknown", checkedAt: null }
      },
      mileage: { readings: [], hasRollbackSignals: false }
    });

    const presentation = buildReportPresentation({ report, mode: "owner" });

    expect(presentation.sections.find((section) => section.id === "legal_risks")).toMatchObject({
      state: "empty",
      emptyText: "данных не найдено на дату обновления"
    });
    expect(presentation.sections.find((section) => section.id === "accidents_repairs")).toMatchObject({
      state: "empty",
      emptyText: "данных не найдено на дату обновления"
    });
    expect(presentation.sections.find((section) => section.id === "mileage")).toMatchObject({
      state: "empty",
      emptyText: "данных не найдено на дату обновления"
    });
  });

  it("disables share and pdf actions for share mode", () => {
    const presentation = buildReportPresentation({ report: fullReport(), mode: "share" });

    expect(presentation.actions).toEqual({ canShare: false, canDownloadPdf: false });
  });
});

function fullReport(
  overrides: Partial<VehicleFullReportReadModel> = {}
): VehicleFullReportReadModel {
  const base: VehicleFullReportReadModel = {
    vehicleId: "vehicle-1",
    vin: "XTA210990Y2765499",
    generatedAt: "2026-05-15T10:00:00.000Z",
    summary: {
      historyBasisText:
        "История составлена на основе 2 загруженных отчетов. Последнее обновление: 01.05.2026.",
      sourceUploadCount: 2,
      lastUpdatedAt: "2026-05-01T00:00:00.000Z",
      freshnessWarning: null,
      transparency: { kind: "score", value: 4.4, max: 5, label: "История в целом прозрачна" }
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
      taxi: { status: "not_found", checkedAt: "2026-05-01T00:00:00.000Z" },
      leasing: { status: "unknown", checkedAt: null }
    },
    mileage: {
      readings: [{ observedAt: "2026-04-15T00:00:00.000Z", mileageKm: 42000, context: "listing" }],
      hasRollbackSignals: false
    },
    listings: [{ observedAt: "2026-04-15T00:00:00.000Z", priceRub: 780000, mileageKm: 42000, city: "Москва" }],
    conflicts: [],
    updateHistory: [{ reportedAt: "2026-05-01T00:00:00.000Z", acceptedAt: "2026-05-01T10:00:00.000Z" }]
  };

  return { ...base, ...overrides };
}
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test apps/api/src/modules/reports/report-presentation.test.ts
```

Expected: FAIL because `./report-presentation` does not exist.

- [ ] **Step 3: Implement the presentation model**

Create `apps/api/src/modules/reports/report-presentation.ts`:

```ts
import { assertNoSourceBrandLeak, type ReportRiskFact, type VehicleFullReportReadModel } from "../vehicles/report-read-model";

export type ReportPresentationMode = "owner" | "share";
export type ReportSectionId =
  | "summary"
  | "passport"
  | "legal_risks"
  | "accidents_repairs"
  | "mileage"
  | "owners_registrations"
  | "listings"
  | "commercial_use"
  | "maintenance"
  | "data_quality"
  | "update_history";

export type ReportPresentationItem = {
  label: string;
  value: string;
  tone?: "default" | "good" | "warning" | "danger";
  date?: string | null;
};

export type ReportPresentationSection = {
  id: ReportSectionId;
  title: string;
  critical: boolean;
  state: "ready" | "empty";
  emptyText?: "данных не найдено на дату обновления";
  items: ReportPresentationItem[];
};

export type ReportPresentation = {
  generatedAt: string;
  noindex: true;
  disclaimer: string;
  watermark: string;
  actions: { canShare: boolean; canDownloadPdf: boolean };
  sections: ReportPresentationSection[];
};

const CRITICAL_EMPTY_TEXT = "данных не найдено на дату обновления" as const;

export function buildReportPresentation(input: {
  report: VehicleFullReportReadModel;
  mode: ReportPresentationMode;
}): ReportPresentation {
  const presentation: ReportPresentation = {
    generatedAt: input.report.generatedAt,
    noindex: true,
    disclaimer:
      "Отчет является сводкой нормализованных фактов и не заменяет юридическую или техническую проверку автомобиля.",
    watermark: `История Авто · ${input.report.vehicleId} · ${formatDateTime(input.report.generatedAt)}`,
    actions: {
      canShare: input.mode === "owner",
      canDownloadPdf: input.mode === "owner"
    },
    sections: [
      summarySection(input.report),
      passportSection(input.report),
      legalRisksSection(input.report),
      accidentsRepairsSection(input.report),
      mileageSection(input.report),
      ownersRegistrationsSection(),
      listingsSection(input.report),
      commercialUseSection(input.report),
      maintenanceSection(),
      dataQualitySection(input.report),
      updateHistorySection(input.report)
    ].filter((section) => section.state === "ready" || section.critical)
  };

  assertNoSourceBrandLeak(presentation);
  return presentation;
}

function summarySection(report: VehicleFullReportReadModel): ReportPresentationSection {
  const transparency =
    report.summary.transparency.kind === "score"
      ? `${report.summary.transparency.value} / ${report.summary.transparency.max} · ${report.summary.transparency.label}`
      : report.summary.transparency.message;
  return ready("summary", "Сводка", true, [
    { label: "Оценка прозрачности", value: transparency },
    { label: "Основа истории", value: report.summary.historyBasisText },
    ...(report.summary.freshnessWarning ? [{ label: "Свежесть", value: report.summary.freshnessWarning, tone: "warning" as const }] : [])
  ]);
}

function passportSection(report: VehicleFullReportReadModel): ReportPresentationSection {
  return ready("passport", "Паспорт авто и идентификаторы", true, compactItems([
    ["VIN", report.passport.vin],
    ["Марка", report.passport.make],
    ["Модель", report.passport.model],
    ["Год", report.passport.year === null ? null : String(report.passport.year)],
    ["Кузов", report.passport.bodyType],
    ["Цвет", report.passport.color],
    ["Двигатель", report.passport.engine],
    ["КПП", report.passport.transmission],
    ["Привод", report.passport.driveType]
  ]));
}

function legalRisksSection(report: VehicleFullReportReadModel): ReportPresentationSection {
  return riskSection("legal_risks", "Юридические риски", true, [
    ["Ограничения", report.legalRisks.restrictions],
    ["Залог", report.legalRisks.pledge],
    ["Розыск", report.legalRisks.wanted]
  ]);
}

function accidentsRepairsSection(report: VehicleFullReportReadModel): ReportPresentationSection {
  return riskSection("accidents_repairs", "ДТП и расчеты ремонта", true, [
    ["ДТП", report.accidentsAndRepairs.accidents],
    ["Расчеты ремонта", report.accidentsAndRepairs.repairCalculations]
  ]);
}

function mileageSection(report: VehicleFullReportReadModel): ReportPresentationSection {
  const items = report.mileage.readings.map((reading) => ({
    label: reading.observedAt === null ? "Пробег" : `Пробег на ${formatDate(reading.observedAt)}`,
    value: `${formatNumber(reading.mileageKm)} км`,
    tone: report.mileage.hasRollbackSignals ? "warning" as const : "default" as const,
    date: reading.observedAt
  }));
  return section("mileage", "Пробеги и расхождения", true, items);
}

function ownersRegistrationsSection(): ReportPresentationSection {
  return empty("owners_registrations", "История владельцев и регистраций", true);
}

function listingsSection(report: VehicleFullReportReadModel): ReportPresentationSection {
  const items = report.listings.map((listing) => ({
    label: listing.observedAt === null ? "Объявление" : `Объявление от ${formatDate(listing.observedAt)}`,
    value: [listing.priceRub === null ? null : `${formatNumber(listing.priceRub)} ₽`, listing.mileageKm === null ? null : `${formatNumber(listing.mileageKm)} км`, listing.city].filter(Boolean).join(" · ") || "Данные объявления",
    date: listing.observedAt
  }));
  return section("listings", "История объявлений", false, items);
}

function commercialUseSection(report: VehicleFullReportReadModel): ReportPresentationSection {
  return riskSection("commercial_use", "Коммерческое использование", true, [
    ["Такси", report.commercialUse.taxi],
    ["Лизинг", report.commercialUse.leasing]
  ]);
}

function maintenanceSection(): ReportPresentationSection {
  return empty("maintenance", "ТО, страхование, диагностика", false);
}

function dataQualitySection(report: VehicleFullReportReadModel): ReportPresentationSection {
  const items = report.conflicts.map((conflict) => ({
    label: conflict.message,
    value: conflict.values.map((value) => String(value.value)).join(" / "),
    tone: conflict.severity === "critical" ? "danger" as const : "warning" as const
  }));
  return section("data_quality", "Расхождения и качество данных", true, items);
}

function updateHistorySection(report: VehicleFullReportReadModel): ReportPresentationSection {
  return section("update_history", "История обновлений отчета", true, report.updateHistory.map((update) => ({
    label: update.reportedAt === null ? "Отчет без даты формирования" : `Отчет от ${formatDate(update.reportedAt)}`,
    value: `Принят ${formatDateTime(update.acceptedAt)}`,
    date: update.acceptedAt
  })));
}

function riskSection(id: ReportSectionId, title: string, critical: boolean, risks: Array<[string, ReportRiskFact]>): ReportPresentationSection {
  const known = risks.filter(([, risk]) => risk.status !== "unknown");
  return section(id, title, critical, known.map(([label, risk]) => ({
    label,
    value: risk.status === "found" ? "найдено" : "не найдено",
    tone: risk.status === "found" ? "danger" : "good",
    date: risk.checkedAt
  })));
}

function compactItems(values: Array<[string, string | null]>): ReportPresentationItem[] {
  return values.flatMap(([label, value]) => value === null ? [] : [{ label, value }]);
}

function ready(id: ReportSectionId, title: string, critical: boolean, items: ReportPresentationItem[]): ReportPresentationSection {
  return { id, title, critical, state: "ready", items };
}

function empty(id: ReportSectionId, title: string, critical: boolean): ReportPresentationSection {
  return critical
    ? { id, title, critical, state: "empty", emptyText: CRITICAL_EMPTY_TEXT, items: [] }
    : { id, title, critical, state: "empty", items: [] };
}

function section(id: ReportSectionId, title: string, critical: boolean, items: ReportPresentationItem[]): ReportPresentationSection {
  return items.length > 0 ? ready(id, title, critical, items) : empty(id, title, critical);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC" }).format(date);
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC",
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}
```

- [ ] **Step 4: Run the presentation tests**

Run:

```bash
bun test apps/api/src/modules/reports/report-presentation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reports/report-presentation.ts apps/api/src/modules/reports/report-presentation.test.ts
git commit -m "feat: add full report presentation model"
```

## Task 2: Full Report By Vehicle Id And Noindex Headers

**Files:**
- Modify: `apps/api/src/modules/vehicles/vehicle-report-repository.ts`
- Modify: `apps/api/src/modules/vehicles/drizzle-vehicle-report-repository.ts`
- Modify: `apps/api/src/modules/vehicles/routes.ts`
- Modify: `apps/api/src/modules/vehicles/routes.test.ts`

- [ ] **Step 1: Write route tests for by-id full report and noindex**

Add tests to `apps/api/src/modules/vehicles/routes.test.ts`:

```ts
it("returns full report by vehicleId only after access grant", async () => {
  const accessService = new FakeAccessService();
  accessService.reportByVehicleIdResult = { status: "granted", method: "test_override", vehicleId: VALID_VEHICLE_ID };
  const dependencies = createDependencies({ accessService: accessService as unknown as ReportAccessService });
  const routes = createTestApp(dependencies, userIdentity());

  const response = await routes.request(`/api/vehicles/by-id/${VALID_VEHICLE_ID}/report`);

  expect(response.status).toBe(200);
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(await response.json()).toMatchObject({
    report: { vehicleId: "vehicle-1", vin: VALID_VIN },
    presentation: { noindex: true, actions: { canShare: true, canDownloadPdf: true } }
  });
  expect(dependencies.reportByVehicleIdCalls).toEqual([VALID_VEHICLE_ID]);
});

it("locks by-id full report before repository lookup", async () => {
  const dependencies = createDependencies();
  const routes = createTestApp(dependencies, guestIdentity());

  const response = await routes.request(`/api/vehicles/by-id/${VALID_VEHICLE_ID}/report`);

  expect(response.status).toBe(401);
  expect(dependencies.reportByVehicleIdCalls).toEqual([]);
});
```

Extend the local fake/dependency helpers with `findFullReportByVehicleId`, `reportByVehicleIdCalls`, and `FakeAccessService.canViewFullReportByVehicleId`.

- [ ] **Step 2: Run failing route tests**

```bash
bun test apps/api/src/modules/vehicles/routes.test.ts
```

Expected: FAIL because by-id report support is missing.

- [ ] **Step 3: Add repository method**

Update `apps/api/src/modules/vehicles/vehicle-report-repository.ts`:

```ts
findFullReportByVehicleId(vehicleId: string): Promise<VehicleFullReportReadModel | null>;
```

Update `apps/api/src/modules/vehicles/drizzle-vehicle-report-repository.ts` with a lookup on `vehicle_report_snapshots.vehicleId` returning `reportData`.

- [ ] **Step 4: Add route**

In `apps/api/src/modules/vehicles/routes.ts`, add `findFullReportByVehicleId` to dependencies and implement:

```ts
routes.get("/by-id/:vehicleId/report", async (context) => {
  const vehicleId = parseVehicleId(context.req.param("vehicleId"));
  if (vehicleId === null) return invalidVehicleId(context);

  const identity = getRequestIdentity(context);
  const access = await dependencies.accessService.canViewFullReportByVehicleId({
    vehicleId,
    userId: identity.kind === "user" ? identity.userId : null,
    guestSessionId: identity.kind === "guest" ? identity.guestSessionId : null
  });
  if (access.status !== "granted") return lockedReport(context, access);

  const report = await dependencies.findFullReportByVehicleId(vehicleId);
  if (report === null) return vehicleReportNotFound(context);

  assertNoSourceBrandLeak(report);
  context.header("X-Robots-Tag", "noindex, nofollow");
  return context.json({ report, presentation: buildReportPresentation({ report, mode: "owner" }) });
});
```

Also add the same `presentation` and `X-Robots-Tag` to the existing `GET /:vin/report`.

- [ ] **Step 5: Add access service support**

Add a `canViewFullReportByVehicleId` method to `ReportAccessService` that resolves vehicle access using `vehicleId` without requiring VIN in the route. Reuse existing repository access checks.

- [ ] **Step 6: Run tests**

```bash
bun test apps/api/src/modules/access/report-access-service.test.ts apps/api/src/modules/vehicles/routes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/access apps/api/src/modules/vehicles
git commit -m "feat: expose full report by vehicle id"
```

## Task 3: Share Link Service And Routes

**Files:**
- Create: `apps/api/src/modules/reports/share-link-repository.ts`
- Create: `apps/api/src/modules/reports/share-link-service.ts`
- Create: `apps/api/src/modules/reports/share-link-service.test.ts`
- Modify: `apps/api/src/modules/access/drizzle-report-access-repository.ts`
- Modify: `apps/api/src/modules/access/report-access-repository.ts`
- Modify: `apps/api/src/modules/vehicles/routes.ts`
- Modify: `apps/api/src/modules/vehicles/routes.test.ts`

- [ ] **Step 1: Write share service tests**

Create tests covering:

```ts
it("creates a 7 day token and stores only its hash", async () => {
  const service = new ShareLinkService({ repository, now: () => new Date("2026-05-15T10:00:00.000Z"), tokenFactory: () => "ia_sh_test" });
  const share = await service.create({ ownerUserId: "user-1", vehicleId: "vehicle-1" });

  expect(share.token).toBe("ia_sh_test");
  expect(share.expiresAt).toBe("2026-05-22T10:00:00.000Z");
  expect(repository.created[0]).toMatchObject({ ownerUserId: "user-1", vehicleId: "vehicle-1" });
  expect(repository.created[0]?.tokenHash).not.toBe("ia_sh_test");
});

it("returns null for expired tokens before report lookup", async () => {
  const service = new ShareLinkService({ repository, now: () => new Date("2026-05-23T10:00:00.000Z"), tokenFactory: () => "unused" });
  repository.nextLookup = { vehicleId: "vehicle-1", ownerUserId: "user-1", expiresAt: "2026-05-22T10:00:00.000Z", revokedAt: null };

  await expect(service.resolve("ia_sh_test")).resolves.toBeNull();
});
```

- [ ] **Step 2: Implement service**

Use Bun crypto hashing:

```ts
const encoder = new TextEncoder();
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
```

`ShareLinkService.create` returns raw token once. `resolve` hashes inbound token and returns active share metadata or `null`.

- [ ] **Step 3: Add routes**

Add:

```http
POST /api/vehicles/by-id/:vehicleId/share-links
GET /api/share/:token/report
```

Creation route requires `identity.kind === "user"` and `canViewFullReportByVehicleId` granted. Resolve route must validate token before report lookup and return share-mode presentation.

- [ ] **Step 4: Add audit events**

On successful share view, insert an audit event:

```ts
{
  eventType: "share_viewed",
  entityType: "share_link",
  entityId: share.id,
  metadata: { vehicleId: share.vehicleId }
}
```

Do not include IP, user agent, or token in this metadata in Milestone 5.

- [ ] **Step 5: Run tests**

```bash
bun test apps/api/src/modules/reports/share-link-service.test.ts apps/api/src/modules/vehicles/routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/reports apps/api/src/modules/vehicles apps/api/src/modules/access
git commit -m "feat: add report share links"
```

## Task 4: PDF Export

**Files:**
- Create: `apps/api/src/modules/reports/report-pdf.ts`
- Create: `apps/api/src/modules/reports/report-pdf.test.ts`
- Modify: `apps/api/src/modules/vehicles/routes.ts`
- Modify: `apps/api/src/modules/vehicles/routes.test.ts`

- [ ] **Step 1: Write PDF tests**

Create `apps/api/src/modules/reports/report-pdf.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { buildReportPresentation } from "./report-presentation";
import { renderReportPdf } from "./report-pdf";

describe("report pdf", () => {
  it("renders a valid PDF without source brands", () => {
    const bytes = renderReportPdf({
      title: "LADA Granta",
      presentation: buildReportPresentation({ report: fullReport(), mode: "owner" })
    });
    const text = new TextDecoder().decode(bytes);

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("Istoriya Avto");
    expect(text).not.toContain("Автотека");
    expect(text).not.toContain("sourceKind");
  });
});
```

- [ ] **Step 2: Implement a minimal PDF renderer**

Implement a deterministic text PDF using escaped WinAnsi-safe transliteration for structural text and include report values that are ASCII-safe. This is acceptable for MVP verification; rich Cyrillic PDF typography can be improved later with an embedded font.

```ts
export function renderReportPdf(input: { title: string; presentation: ReportPresentation }): Uint8Array {
  const lines = [
    "Istoriya Avto",
    input.title,
    input.presentation.watermark,
    input.presentation.disclaimer,
    ...input.presentation.sections.flatMap((section) => [
      section.title,
      ...(section.state === "empty" ? [section.emptyText ?? "No data"] : section.items.map((item) => `${item.label}: ${item.value}`))
    ])
  ].map(toPdfSafeText);
  return buildSimplePdf(lines);
}
```

Escape `\`, `(`, and `)` in PDF strings. Keep this module dependency-free.

- [ ] **Step 3: Add owner-only PDF route**

Add:

```http
GET /api/vehicles/by-id/:vehicleId/report.pdf
```

It must check user identity and access before report lookup, return `401/403/404` like full report, and set:

```ts
context.header("Content-Type", "application/pdf");
context.header("Content-Disposition", `attachment; filename="istoriya-avto-${vehicleId}.pdf"`);
context.header("X-Robots-Tag", "noindex, nofollow");
return context.body(pdfBytes);
```

- [ ] **Step 4: Run tests**

```bash
bun test apps/api/src/modules/reports/report-pdf.test.ts apps/api/src/modules/vehicles/routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reports apps/api/src/modules/vehicles
git commit -m "feat: add full report pdf export"
```

## Task 5: Web API Client Contracts

**Files:**
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Add types and client methods**

Add `VehicleFullReportResponse`, `ReportPresentation`, `fetchFullReportByVehicleId`, `createShareLink`, `fetchSharedReport`, and `downloadReportPdfUrl`.

```ts
export async function fetchFullReportByVehicleId(vehicleId: string): Promise<VehicleFullReportResponse> {
  const response = await fetch(`${API_BASE_URL}/api/vehicles/by-id/${encodeURIComponent(vehicleId)}/report`, {
    method: "GET",
    credentials: "include"
  });
  if (!response.ok) throw new Error("Не удалось загрузить полный отчет.");
  return response.json() as Promise<VehicleFullReportResponse>;
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run --cwd apps/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat: add full report web api client"
```

## Task 6: Full Report Owner UI

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Add report state and open report after unlock**

After successful unlock, call `fetchFullReportByVehicleId(unlockResult.access.vehicleId)` and render a full report screen. Preserve search state so the user can return.

States:

```ts
type ReportViewState =
  | { status: "closed" }
  | { status: "loading"; vehicleId: string }
  | { status: "ready"; vehicleId: string; data: VehicleFullReportResponse; mode: "owner" }
  | { status: "error"; vehicleId: string; message: string };
```

- [ ] **Step 2: Render sections**

Create local components:

```tsx
function FullReportScreen({ data, onBack, onShare, onDownloadPdf }: Props) {
  return (
    <section className="report-screen" aria-labelledby="full-report-title">
      <div className="report-toolbar">
        <button type="button" onClick={onBack}>Назад</button>
        {data.presentation.actions.canShare && <button type="button" onClick={onShare}>Создать ссылку</button>}
        {data.presentation.actions.canDownloadPdf && <button type="button" onClick={onDownloadPdf}>PDF</button>}
      </div>
      <h1 id="full-report-title">{reportTitle(data.report)}</h1>
      {data.presentation.sections.map((section) => <ReportSection key={section.id} section={section} />)}
    </section>
  );
}
```

Use compact operational UI, not a marketing landing page. Critical empty sections show the exact empty text.

- [ ] **Step 3: Set noindex on report view**

When `reportView.status === "ready"`, update/create:

```ts
document.querySelector('meta[name="robots"]')?.setAttribute("content", "noindex,nofollow");
```

- [ ] **Step 4: Build web**

```bash
bun run --cwd apps/web build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "feat: add full report owner UI"
```

## Task 7: Share UI

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Add hash route for share token**

On app load, parse `#/share/:token`. If present, fetch `GET /api/share/:token/report` and render share mode. Do not fetch account context before share view unless needed for topbar copy.

- [ ] **Step 2: Add create/copy share link action**

Owner full report calls `createShareLink(vehicleId)`, then shows URL and expiry. The UI must not create share links from share mode.

- [ ] **Step 3: Verify share mode restrictions**

Share mode must hide PDF and share buttons because `presentation.actions` is `{ canShare: false, canDownloadPdf: false }`.

- [ ] **Step 4: Build web**

```bash
bun run --cwd apps/web build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "feat: add report share UI"
```

## Task 8: Leak Guards, Noindex, And Final Verification

**Files:**
- Modify: `apps/api/src/modules/vehicles/routes.test.ts`
- Modify: `apps/api/src/modules/reports/report-presentation.test.ts`
- Modify: `apps/api/src/modules/reports/share-link-service.test.ts`
- Modify: `apps/api/src/modules/reports/report-pdf.test.ts`

- [ ] **Step 1: Add route leak tests**

Assert serialized owner report, share report, and PDF text do not contain:

```ts
["sourceKind", "parserVersion", "originalObjectKey", "Автотека", "Auto.ru", "Drom", "Авито"]
```

- [ ] **Step 2: Add noindex tests**

Assert:

```ts
expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
```

for owner full report, share report, and PDF export.

- [ ] **Step 3: Run required verification**

```bash
bun run test
bun run typecheck
bun run --cwd apps/web build
bun run --cwd apps/api db:generate
```

Expected:

- tests pass;
- typecheck passes;
- web build passes;
- db generate either creates the share/audit migration or reports no schema changes.

- [ ] **Step 4: Commit final fixes**

```bash
git add apps/api apps/web docs/superpowers/plans/2026-05-15-istoriya-avto-full-report-share-pdf-export.md
git commit -m "test: harden full report share and pdf guards"
```

---

## Review Gates

- Full report never loads repository data until access is granted.
- By-id report route does not leak full VIN unless access is granted.
- Share token is stored only as a hash and expires after 7 days.
- Share view cannot download PDF or create another share link.
- PDF route is owner/user-only.
- Full report/share/PDF contain no third-party source brands as fact sources.
- No raw artifact keys, parser versions, or source kind fields appear in user-facing responses.
- Full report and share surfaces are `noindex,nofollow`.
- Current read model gaps are rendered according to product rules: critical empty sections explicit, secondary empty sections hidden.
