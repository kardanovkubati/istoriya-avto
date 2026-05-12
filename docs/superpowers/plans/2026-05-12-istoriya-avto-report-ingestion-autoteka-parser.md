# Report Ingestion And Autoteka Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Milestone 1: accept text PDF vehicle-history reports, store the original privately, extract text without OCR, parse the first Autoteka report shape, create `report_upload`, and evaluate the existing points policy from the parse result.

**Architecture:** Keep the API monolith small and testable by separating pure parsing, fingerprinting, PDF extraction, storage, ingestion orchestration, and HTTP routing. Parser and points mapping must be deterministic unit-tested code; storage and database writes are behind narrow interfaces so upload service tests do not require PostgreSQL.

**Tech Stack:** Bun, TypeScript, Hono, Drizzle ORM, PostgreSQL, Zod, bun:test, `pdfjs-dist` for text-layer extraction, local filesystem storage with an S3-compatible interface shape.

---

## Scope Decisions

- This plan implements PDF upload ingestion only. Authless report links stay outside this milestone, but `sourceKind` and parser interfaces remain ready for additional sources.
- OCR is explicitly out of scope. PDFs with no extractable text are accepted only as `manual_review`.
- No original third-party report is returned to regular users. The API response returns neutral upload status and parsed vehicle identifiers, not a user-facing third-party report.
- The plan does not mutate `users.points_balance` and does not create real point ledger entries. It evaluates `evaluateReportForPoints()` and stores the decision in `report_uploads.raw_data.pointsEvaluation` so Milestone 4 can turn approved decisions into ledger transactions.
- The existing schema is sufficient for Milestone 1. Original file metadata, retention date, parser warnings, normalized parse result, and points evaluation are stored inside `report_uploads.raw_data`.
- Original PDFs are stored under a private storage key and retention metadata is set to 180 days. A purge job is not part of this milestone.

## Target File Structure

```text
apps/api/src
├── app.ts
├── env.ts
├── modules
│   ├── parsing
│   │   ├── report-fingerprint.test.ts
│   │   ├── report-fingerprint.ts
│   │   ├── report-parser.ts
│   │   └── autoteka
│   │       ├── __fixtures__
│   │       │   ├── clean-report.golden.json
│   │       │   ├── clean-report.txt
│   │       │   ├── partial-report.golden.json
│   │       │   ├── partial-report.txt
│   │       │   ├── risky-report.golden.json
│   │       │   └── risky-report.txt
│   │       ├── autoteka-parser.test.ts
│   │       └── autoteka-parser.ts
│   ├── pdf
│   │   ├── pdf-text-extractor.test.ts
│   │   ├── pdf-text-extractor.ts
│   │   └── text-pdf-fixture.ts
│   ├── storage
│   │   ├── local-object-storage.test.ts
│   │   ├── local-object-storage.ts
│   │   └── object-storage.ts
│   └── uploads
│       ├── points-evaluation.test.ts
│       ├── points-evaluation.ts
│       ├── report-upload-repository.ts
│       ├── report-upload-service.test.ts
│       ├── report-upload-service.ts
│       ├── routes.test.ts
│       └── routes.ts
```

## Data Contracts

Use these types as the shared contracts between parser, upload service, and route:

```ts
export type ReportSourceKind = "autoteka_pdf";

export type ParseWarningCode =
  | "unsupported_report_source"
  | "missing_vin"
  | "multiple_vins_found"
  | "missing_generated_at"
  | "future_generated_at"
  | "insufficient_key_blocks"
  | "empty_pdf_text"
  | "suspicious_report_structure";

export type ParsedVehiclePassport = {
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  bodyType: string | null;
  color: string | null;
  engine: string | null;
  transmission: string | null;
  driveType: string | null;
};

export type ParsedReport = {
  sourceKind: ReportSourceKind;
  parserVersion: string;
  status: "parsed" | "manual_review";
  vin: string | null;
  generatedAt: string | null;
  vehicle: ParsedVehiclePassport;
  listings: Array<{
    observedAt: string | null;
    priceRub: number | null;
    mileageKm: number | null;
    city: string | null;
  }>;
  mileageReadings: Array<{
    observedAt: string | null;
    mileageKm: number;
    context: string;
  }>;
  riskFlags: {
    accidents: "found" | "not_found" | "unknown";
    repairCalculations: "found" | "not_found" | "unknown";
    restrictions: "found" | "not_found" | "unknown";
    pledge: "found" | "not_found" | "unknown";
    wanted: "found" | "not_found" | "unknown";
    taxi: "found" | "not_found" | "unknown";
    leasing: "found" | "not_found" | "unknown";
  };
  keyBlocks: Array<"vehicle_passport" | "listings_or_mileage" | "risk_checks">;
  warnings: Array<{ code: ParseWarningCode; message: string }>;
  qualityScore: number;
};
```

---

### Task 1: Add Upload Runtime Configuration

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/env.ts`
- Modify: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Add PDF extraction dependency**

Add `pdfjs-dist` to `apps/api/package.json` dependencies:

```json
{
  "dependencies": {
    "@istoriya-avto/shared": "workspace:*",
    "dotenv": "latest",
    "drizzle-orm": "latest",
    "hono": "latest",
    "pdfjs-dist": "latest",
    "postgres": "latest",
    "zod": "latest"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
bun install
```

Expected: lockfile updates and `pdfjs-dist` is available to `apps/api`.

- [ ] **Step 3: Extend environment parsing**

Update `apps/api/src/env.ts` so upload limits and local storage are configurable:

```ts
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url().default("postgresql://postgres:postgres@localhost:5432/istoriya_avto"),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:5173"),
  PUBLIC_API_URL: z.string().url().default("http://localhost:3001"),
  REPORT_STORAGE_DRIVER: z.enum(["local"]).default("local"),
  REPORT_STORAGE_LOCAL_DIR: z.string().min(1).default(".local/report-uploads"),
  REPORT_ORIGINAL_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  MAX_REPORT_UPLOAD_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024)
});
```

- [ ] **Step 4: Document local env values**

Add to `.env.example`:

```dotenv
REPORT_STORAGE_DRIVER=local
REPORT_STORAGE_LOCAL_DIR=.local/report-uploads
REPORT_ORIGINAL_RETENTION_DAYS=180
MAX_REPORT_UPLOAD_BYTES=20971520
```

- [ ] **Step 5: Keep private local artifacts out of git**

Add to `.gitignore`:

```gitignore
.local
fixtures/private
```

- [ ] **Step 6: Verify env and package changes**

Run:

```bash
bun run --cwd apps/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json apps/api/src/env.ts .env.example .gitignore bun.lock
git commit -m "chore: configure report upload runtime"
```

---

### Task 2: Define Parser Contracts And Fingerprinting

**Files:**
- Create: `apps/api/src/modules/parsing/report-parser.ts`
- Create: `apps/api/src/modules/parsing/report-fingerprint.ts`
- Create: `apps/api/src/modules/parsing/report-fingerprint.test.ts`

- [ ] **Step 1: Write report parser contract**

Create `apps/api/src/modules/parsing/report-parser.ts` with the data contracts from this plan. Export `ReportSourceKind`, `ParseWarningCode`, `ParsedVehiclePassport`, and `ParsedReport`.

- [ ] **Step 2: Write failing fingerprint tests**

Create `apps/api/src/modules/parsing/report-fingerprint.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { createReportFingerprint, normalizeReportTextForFingerprint } from "./report-fingerprint";

describe("report fingerprint", () => {
  it("ignores whitespace-only differences", () => {
    const first = createReportFingerprint({
      sourceKind: "autoteka_pdf",
      extractedText: "VIN: XTA210990Y2765499\nДата отчета: 01.05.2026"
    });
    const second = createReportFingerprint({
      sourceKind: "autoteka_pdf",
      extractedText: " VIN:   XTA210990Y2765499 \r\n\r\n Дата отчета: 01.05.2026 "
    });

    expect(first).toBe(second);
  });

  it("changes when meaningful report text changes", () => {
    const first = createReportFingerprint({
      sourceKind: "autoteka_pdf",
      extractedText: "VIN: XTA210990Y2765499 Дата отчета: 01.05.2026 Пробег: 42000 км"
    });
    const second = createReportFingerprint({
      sourceKind: "autoteka_pdf",
      extractedText: "VIN: XTA210990Y2765499 Дата отчета: 01.05.2026 Пробег: 43000 км"
    });

    expect(first).not.toBe(second);
  });

  it("normalizes casing and invisible separators", () => {
    expect(normalizeReportTextForFingerprint("  ViN:\u00a0xta210990y2765499  ")).toBe(
      "vin: xta210990y2765499"
    );
  });
});
```

- [ ] **Step 3: Run the failing test**

Run:

```bash
bun test apps/api/src/modules/parsing/report-fingerprint.test.ts
```

Expected: FAIL because `report-fingerprint.ts` does not exist.

- [ ] **Step 4: Implement fingerprinting**

Create `apps/api/src/modules/parsing/report-fingerprint.ts`:

```ts
import { createHash } from "node:crypto";
import type { ReportSourceKind } from "./report-parser";

export type CreateReportFingerprintInput = {
  sourceKind: ReportSourceKind;
  extractedText: string;
};

export function createReportFingerprint(input: CreateReportFingerprintInput): string {
  const normalizedText = normalizeReportTextForFingerprint(input.extractedText);
  return createHash("sha256")
    .update(`${input.sourceKind}:text-v1:${normalizedText}`, "utf8")
    .digest("hex");
}

export function normalizeReportTextForFingerprint(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
```

- [ ] **Step 5: Verify fingerprint tests**

Run:

```bash
bun test apps/api/src/modules/parsing/report-fingerprint.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/parsing/report-parser.ts apps/api/src/modules/parsing/report-fingerprint.ts apps/api/src/modules/parsing/report-fingerprint.test.ts
git commit -m "feat: add report parser contracts and fingerprinting"
```

---

### Task 3: Add Local Object Storage Abstraction

**Files:**
- Create: `apps/api/src/modules/storage/object-storage.ts`
- Create: `apps/api/src/modules/storage/local-object-storage.ts`
- Create: `apps/api/src/modules/storage/local-object-storage.test.ts`

- [ ] **Step 1: Write failing storage tests**

Create `apps/api/src/modules/storage/local-object-storage.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";
import { LocalObjectStorage } from "./local-object-storage";

describe("LocalObjectStorage", () => {
  it("stores bytes under a generated private key with metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "istoriya-storage-"));

    try {
      const storage = new LocalObjectStorage({ rootDir: dir });
      const expiresAt = new Date("2026-11-08T12:00:00.000Z");
      const result = await storage.putObject({
        namespace: "report-originals",
        bytes: new Uint8Array([37, 80, 68, 70]),
        contentType: "application/pdf",
        originalFileName: "report.pdf",
        expiresAt
      });

      expect(result.key).toMatch(/^report-originals\/\d{4}\/\d{2}\/[a-f0-9-]+\.pdf$/);
      expect(result.sizeBytes).toBe(4);
      expect(result.contentType).toBe("application/pdf");
      expect(result.expiresAt.toISOString()).toBe(expiresAt.toISOString());
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);

      const storedBytes = await readFile(join(dir, result.key));
      expect([...storedBytes]).toEqual([37, 80, 68, 70]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the failing storage test**

Run:

```bash
bun test apps/api/src/modules/storage/local-object-storage.test.ts
```

Expected: FAIL because storage files do not exist.

- [ ] **Step 3: Define storage interface**

Create `apps/api/src/modules/storage/object-storage.ts`:

```ts
export type PutObjectInput = {
  namespace: string;
  bytes: Uint8Array;
  contentType: string;
  originalFileName: string;
  expiresAt: Date;
};

export type StoredObject = {
  key: string;
  sizeBytes: number;
  contentType: string;
  sha256: string;
  expiresAt: Date;
};

export interface ObjectStorage {
  putObject(input: PutObjectInput): Promise<StoredObject>;
}
```

- [ ] **Step 4: Implement local storage**

Create `apps/api/src/modules/storage/local-object-storage.ts`:

```ts
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { ObjectStorage, PutObjectInput, StoredObject } from "./object-storage";

export type LocalObjectStorageOptions = {
  rootDir: string;
};

export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly options: LocalObjectStorageOptions) {}

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const extension = normalizeExtension(input.originalFileName);
    const now = new Date();
    const key = `${input.namespace}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}${extension}`;
    const targetPath = join(this.options.rootDir, key);

    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, input.bytes);

    return {
      key,
      sizeBytes: input.bytes.byteLength,
      contentType: input.contentType,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      expiresAt: input.expiresAt
    };
  }
}

function normalizeExtension(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  return extension === ".pdf" ? ".pdf" : ".bin";
}
```

- [ ] **Step 5: Verify storage test**

Run:

```bash
bun test apps/api/src/modules/storage/local-object-storage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/storage/object-storage.ts apps/api/src/modules/storage/local-object-storage.ts apps/api/src/modules/storage/local-object-storage.test.ts
git commit -m "feat: add private report object storage"
```

---

### Task 4: Extract Text From Text-Layer PDFs

**Files:**
- Create: `apps/api/src/modules/pdf/pdf-text-extractor.ts`
- Create: `apps/api/src/modules/pdf/pdf-text-extractor.test.ts`
- Create: `apps/api/src/modules/pdf/text-pdf-fixture.ts`

- [ ] **Step 1: Add a small text PDF fixture as base64**

Create `apps/api/src/modules/pdf/text-pdf-fixture.ts`:

```ts
export const TEXT_PDF_BASE64 =
  "JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwvTGVuZ3RoIDMgMCBSPj4Kc3RyZWFtCkJUCi9GMSAxMiBUZgoxMDAgNzAwIFRkCihWSU46IFhUQTIxMDk5MFkyNzY1NDk5KSBUagooRGF0ZTogMDEuMDUuMjAyNikgVGoKRVQKZW5kc3RyZWFtCmVuZG9iagozIDAgb2JqCjYyCmVuZG9iago0IDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYT4+CmVuZG9iagoxIDAgb2JqCjw8L1R5cGUvUGFnZS9QYXJlbnQgNSAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxIDQgMCBSPj4+Pi9NZWRpYUJveFswIDAgNjEyIDc5Ml0vQ29udGVudHMgMiAwIFI+PgplbmRvYmoKNSAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMSAwIFJdL0NvdW50IDE+PgplbmRvYmoKNiAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgNSAwIFI+PgplbmRvYmoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAyMjQ3IDAwMDAwIG4gCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDEyNiAwMDAwMCBuIAowMDAwMDAwMTQ1IDAwMDAwIG4gCjAwMDAwMDIzNTYgMDAwMDAgbiAKMDAwMDAwMjQxMyAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgNy9Sb290IDYgMCBSPj4Kc3RhcnR4cmVmCjI0NjIKJSVFT0YK";
```

- [ ] **Step 2: Write failing PDF extraction tests**

Create `apps/api/src/modules/pdf/pdf-text-extractor.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { extractPdfText } from "./pdf-text-extractor";
import { TEXT_PDF_BASE64 } from "./text-pdf-fixture";

describe("extractPdfText", () => {
  it("extracts text from a text-layer PDF without OCR", async () => {
    const bytes = Uint8Array.from(Buffer.from(TEXT_PDF_BASE64, "base64"));
    const result = await extractPdfText(bytes);

    expect(result.pageCount).toBe(1);
    expect(result.hasExtractableText).toBe(true);
    expect(result.text).toContain("VIN: XTA210990Y2765499");
    expect(result.text).toContain("Date: 01.05.2026");
  });

  it("marks non-PDF bytes as extraction failure", async () => {
    const result = await extractPdfText(new TextEncoder().encode("not a pdf"));

    expect(result.hasExtractableText).toBe(false);
    expect(result.text).toBe("");
    expect(result.errorCode).toBe("pdf_parse_failed");
  });
});
```

- [ ] **Step 3: Run the failing PDF tests**

Run:

```bash
bun test apps/api/src/modules/pdf/pdf-text-extractor.test.ts
```

Expected: FAIL because `pdf-text-extractor.ts` does not exist.

- [ ] **Step 4: Implement PDF text extraction**

Create `apps/api/src/modules/pdf/pdf-text-extractor.ts`:

```ts
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type PdfTextExtractionResult = {
  text: string;
  pageCount: number;
  hasExtractableText: boolean;
  errorCode: "pdf_parse_failed" | null;
};

type PdfTextItem = {
  str: string;
};

export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextExtractionResult> {
  try {
    const document = await getDocument({
      data: bytes,
      disableFontFace: true,
      useSystemFonts: true
    }).promise;

    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .filter(isPdfTextItem)
        .map((item) => item.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      pageTexts.push(text);
    }

    const text = pageTexts.filter(Boolean).join("\n\n").trim();

    return {
      text,
      pageCount: document.numPages,
      hasExtractableText: text.length > 0,
      errorCode: null
    };
  } catch {
    return {
      text: "",
      pageCount: 0,
      hasExtractableText: false,
      errorCode: "pdf_parse_failed"
    };
  }
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  return typeof item === "object" && item !== null && "str" in item && typeof item.str === "string";
}
```

- [ ] **Step 5: Verify PDF tests**

Run:

```bash
bun test apps/api/src/modules/pdf/pdf-text-extractor.test.ts
```

Expected: PASS. If the fixture is malformed for the installed PDF.js version, replace only `TEXT_PDF_BASE64` with a known-good text-layer PDF generated from the two visible strings in the test.

- [ ] **Step 6: Review Gate 1**

Stop and review before parser work:

```bash
bun run test
bun run typecheck
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/pdf/pdf-text-extractor.ts apps/api/src/modules/pdf/pdf-text-extractor.test.ts apps/api/src/modules/pdf/text-pdf-fixture.ts
git commit -m "feat: extract text from report PDFs"
```

---

### Task 5: Add Sanitized Autoteka Fixtures And Golden Tests

**Files:**
- Create: `apps/api/src/modules/parsing/autoteka/__fixtures__/clean-report.txt`
- Create: `apps/api/src/modules/parsing/autoteka/__fixtures__/clean-report.golden.json`
- Create: `apps/api/src/modules/parsing/autoteka/__fixtures__/risky-report.txt`
- Create: `apps/api/src/modules/parsing/autoteka/__fixtures__/risky-report.golden.json`
- Create: `apps/api/src/modules/parsing/autoteka/__fixtures__/partial-report.txt`
- Create: `apps/api/src/modules/parsing/autoteka/__fixtures__/partial-report.golden.json`
- Create: `apps/api/src/modules/parsing/autoteka/autoteka-parser.test.ts`

- [ ] **Step 1: Create anonymized fixture rules**

Use these fixture rules for all committed dumps:

```text
1. VIN values are valid synthetic VINs.
2. Госномера, names, phones, seller contacts, addresses, and account identifiers are removed.
3. Prices, mileages, years, and cities may stay if they are synthetic or heavily generalized.
4. Original PDFs stay outside git under fixtures/private or .local.
5. Committed text dumps contain enough section headers to exercise parser structure.
```

- [ ] **Step 2: Create `clean-report.txt`**

```text
Отчет по автомобилю
VIN: XTA210990Y2765499
Дата формирования отчета: 01.05.2026

Паспорт автомобиля
Марка: LADA
Модель: Granta
Год выпуска: 2021
Кузов: седан
Цвет: белый
Двигатель: 1.6 бензин
Коробка: механическая
Привод: передний

История объявлений
15.04.2026 Москва цена 780 000 ₽ пробег 42 000 км

Пробеги
15.04.2026 42 000 км объявление
10.02.2025 31 000 км техническое обслуживание

Проверки
ДТП не найдены
Расчеты ремонта не найдены
Ограничения не найдены
Залог не найден
Розыск не найден
Такси не найдено
Лизинг не найден
```

- [ ] **Step 3: Create `clean-report.golden.json`**

```json
{
  "sourceKind": "autoteka_pdf",
  "parserVersion": "autoteka-v1",
  "status": "parsed",
  "vin": "XTA210990Y2765499",
  "generatedAt": "2026-05-01T00:00:00.000Z",
  "vehicle": {
    "vin": "XTA210990Y2765499",
    "make": "LADA",
    "model": "Granta",
    "year": 2021,
    "bodyType": "седан",
    "color": "белый",
    "engine": "1.6 бензин",
    "transmission": "механическая",
    "driveType": "передний"
  },
  "listings": [
    {
      "observedAt": "2026-04-15T00:00:00.000Z",
      "priceRub": 780000,
      "mileageKm": 42000,
      "city": "Москва"
    }
  ],
  "mileageReadings": [
    {
      "observedAt": "2026-04-15T00:00:00.000Z",
      "mileageKm": 42000,
      "context": "объявление"
    },
    {
      "observedAt": "2025-02-10T00:00:00.000Z",
      "mileageKm": 31000,
      "context": "техническое обслуживание"
    }
  ],
  "riskFlags": {
    "accidents": "not_found",
    "repairCalculations": "not_found",
    "restrictions": "not_found",
    "pledge": "not_found",
    "wanted": "not_found",
    "taxi": "not_found",
    "leasing": "not_found"
  },
  "keyBlocks": ["vehicle_passport", "listings_or_mileage", "risk_checks"],
  "warnings": [],
  "qualityScore": 1
}
```

- [ ] **Step 4: Create `risky-report.txt`**

```text
Отчет по автомобилю
VIN: XTA219010N1234567
Дата отчета: 20.04.2026

Паспорт автомобиля
Марка: Hyundai
Модель: Solaris
Год выпуска: 2018
Кузов: седан
Цвет: серый
Двигатель: 1.6 бензин
Коробка: автомат
Привод: передний

История объявлений
01.04.2026 Санкт-Петербург цена 930 000 ₽ пробег 88 500 км

Пробеги
01.04.2026 88 500 км объявление
18.10.2024 71 200 км техническое обслуживание

Проверки
ДТП найдено
Расчеты ремонта найдены
Ограничения найдены
Залог найден
Розыск не найден
Такси найдено
Лизинг не найден
```

- [ ] **Step 5: Create `risky-report.golden.json`**

```json
{
  "sourceKind": "autoteka_pdf",
  "parserVersion": "autoteka-v1",
  "status": "parsed",
  "vin": "XTA219010N1234567",
  "generatedAt": "2026-04-20T00:00:00.000Z",
  "vehicle": {
    "vin": "XTA219010N1234567",
    "make": "Hyundai",
    "model": "Solaris",
    "year": 2018,
    "bodyType": "седан",
    "color": "серый",
    "engine": "1.6 бензин",
    "transmission": "автомат",
    "driveType": "передний"
  },
  "listings": [
    {
      "observedAt": "2026-04-01T00:00:00.000Z",
      "priceRub": 930000,
      "mileageKm": 88500,
      "city": "Санкт-Петербург"
    }
  ],
  "mileageReadings": [
    {
      "observedAt": "2026-04-01T00:00:00.000Z",
      "mileageKm": 88500,
      "context": "объявление"
    },
    {
      "observedAt": "2024-10-18T00:00:00.000Z",
      "mileageKm": 71200,
      "context": "техническое обслуживание"
    }
  ],
  "riskFlags": {
    "accidents": "found",
    "repairCalculations": "found",
    "restrictions": "found",
    "pledge": "found",
    "wanted": "not_found",
    "taxi": "found",
    "leasing": "not_found"
  },
  "keyBlocks": ["vehicle_passport", "listings_or_mileage", "risk_checks"],
  "warnings": [],
  "qualityScore": 1
}
```

- [ ] **Step 6: Create `partial-report.txt`**

```text
Отчет по автомобилю
VIN: XTA111730R7654321

Паспорт автомобиля
Марка: Kia
Модель: Rio
Год выпуска: 2020
Цвет: синий
```

- [ ] **Step 7: Create `partial-report.golden.json`**

```json
{
  "sourceKind": "autoteka_pdf",
  "parserVersion": "autoteka-v1",
  "status": "manual_review",
  "vin": "XTA111730R7654321",
  "generatedAt": null,
  "vehicle": {
    "vin": "XTA111730R7654321",
    "make": "Kia",
    "model": "Rio",
    "year": 2020,
    "bodyType": null,
    "color": "синий",
    "engine": null,
    "transmission": null,
    "driveType": null
  },
  "listings": [],
  "mileageReadings": [],
  "riskFlags": {
    "accidents": "unknown",
    "repairCalculations": "unknown",
    "restrictions": "unknown",
    "pledge": "unknown",
    "wanted": "unknown",
    "taxi": "unknown",
    "leasing": "unknown"
  },
  "keyBlocks": ["vehicle_passport"],
  "warnings": [
    {
      "code": "missing_generated_at",
      "message": "Не удалось определить дату формирования отчета."
    },
    {
      "code": "insufficient_key_blocks",
      "message": "Отчет содержит меньше трех ключевых блоков для автоматической обработки."
    }
  ],
  "qualityScore": 0.33
}
```

- [ ] **Step 8: Write failing golden tests**

Create `apps/api/src/modules/parsing/autoteka/autoteka-parser.test.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parseAutotekaReport } from "./autoteka-parser";

const fixturesDir = join(import.meta.dir, "__fixtures__");

describe("parseAutotekaReport", () => {
  it("matches golden fixtures", async () => {
    const files = await readdir(fixturesDir);
    const textFixtures = files.filter((fileName) => fileName.endsWith(".txt")).sort();

    expect(textFixtures.length).toBeGreaterThanOrEqual(3);

    for (const textFileName of textFixtures) {
      const fixtureName = basename(textFileName, ".txt");
      const text = await readFile(join(fixturesDir, textFileName), "utf8");
      const expected = JSON.parse(
        await readFile(join(fixturesDir, `${fixtureName}.golden.json`), "utf8")
      );

      expect(parseAutotekaReport(text)).toEqual(expected);
    }
  });

  it("marks unknown report text for manual review", () => {
    const result = parseAutotekaReport("VIN: XTA210990Y2765499\nСлучайный документ");

    expect(result.status).toBe("manual_review");
    expect(result.warnings.map((warning) => warning.code)).toContain("suspicious_report_structure");
  });
});
```

- [ ] **Step 9: Run the failing parser test**

Run:

```bash
bun test apps/api/src/modules/parsing/autoteka/autoteka-parser.test.ts
```

Expected: FAIL because parser implementation does not exist.

- [ ] **Step 10: Commit fixtures and failing parser test**

```bash
git add apps/api/src/modules/parsing/autoteka
git commit -m "test: add sanitized autoteka parser fixtures"
```

---

### Task 6: Implement Autoteka Parser V1

**Files:**
- Create: `apps/api/src/modules/parsing/autoteka/autoteka-parser.ts`
- Modify: `apps/api/src/modules/parsing/autoteka/autoteka-parser.test.ts`

- [ ] **Step 1: Implement deterministic parser helpers**

Create helpers inside `autoteka-parser.ts`:

```ts
const PARSER_VERSION = "autoteka-v1";
const VIN_PATTERN = /\b[A-HJ-NPR-Z0-9]{17}\b/g;

function normalizeText(text: string): string {
  return text.normalize("NFKC").replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").trim();
}

function parseRuDate(value: string): string | null {
  const match = /(\d{2})\.(\d{2})\.(\d{4})/.exec(value);

  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseInteger(value: string): number | null {
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? Number.parseInt(digits, 10) : null;
}
```

- [ ] **Step 2: Implement parser body**

`parseAutotekaReport(text: string): ParsedReport` must:

```text
1. Normalize text.
2. Extract all VIN candidates with VIN_PATTERN.
3. Use the first VIN as `vin`; add `missing_vin` if none; add `multiple_vins_found` if distinct VIN count is greater than 1.
4. Extract generated date from `Дата формирования отчета`, `Дата отчета`, or `Отчет сформирован`.
5. Extract passport labels: Марка, Модель, Год выпуска, Кузов, Цвет, Двигатель, Коробка, Привод.
6. Extract listing lines matching date plus price plus mileage.
7. Extract mileage lines matching date plus kilometers.
8. Extract risk flags by checking section text for found or not-found phrases.
9. Count key blocks:
   - `vehicle_passport` when VIN plus make/model/year exist.
   - `listings_or_mileage` when at least one listing or mileage reading exists.
   - `risk_checks` when at least four risk flags are not `unknown`.
10. Set `qualityScore` to `keyBlocks.length / 3`, rounded to two decimals.
11. Set `status` to `manual_review` when VIN is missing, generated date is missing, key block count is less than 3, structure marker is missing, or multiple VINs are present.
```

Use warning messages in Russian, for example `{ code: "missing_generated_at", message: "Не удалось определить дату формирования отчета." }`.

- [ ] **Step 3: Implement risk flag extraction**

Use these phrase rules:

```ts
const RISK_RULES = {
  accidents: [/ДТП\s+не\s+найден[ыо]/i, /ДТП\s+найден[ыо]?|есть\s+ДТП/i],
  repairCalculations: [/Расч[её]ты\s+ремонта\s+не\s+найден[ыо]/i, /Расч[её]ты\s+ремонта\s+найден[ыо]?/i],
  restrictions: [/Ограничения\s+не\s+найден[ыо]/i, /Ограничения\s+найден[ыо]?|есть\s+ограничения/i],
  pledge: [/Залог\s+не\s+найден/i, /Залог\s+найден|есть\s+залог/i],
  wanted: [/Розыск\s+не\s+найден/i, /Розыск\s+найден|находится\s+в\s+розыске/i],
  taxi: [/Такси\s+не\s+найден[оа]?/i, /Такси\s+найден[оа]?|использовался\s+в\s+такси/i],
  leasing: [/Лизинг\s+не\s+найден/i, /Лизинг\s+найден|есть\s+лизинг/i]
} as const;
```

Return `"not_found"` when the first regex matches, `"found"` when the second regex matches, and `"unknown"` otherwise.

- [ ] **Step 4: Verify golden tests**

Run:

```bash
bun test apps/api/src/modules/parsing/autoteka/autoteka-parser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add targeted parser edge tests**

Extend `autoteka-parser.test.ts` with:

```ts
it("marks reports with multiple distinct VINs for manual review", () => {
  const result = parseAutotekaReport(`
    Отчет по автомобилю
    VIN: XTA210990Y2765499
    VIN: XTA210990Y2765400
    Дата формирования отчета: 01.05.2026
    Паспорт автомобиля
    Марка: LADA
    Модель: Granta
    Год выпуска: 2021
    История объявлений
    15.04.2026 Москва цена 780 000 ₽ пробег 42 000 км
    Проверки
    ДТП не найдены
    Расчеты ремонта не найдены
    Ограничения не найдены
    Залог не найден
  `);

  expect(result.status).toBe("manual_review");
  expect(result.warnings.map((warning) => warning.code)).toContain("multiple_vins_found");
});
```

- [ ] **Step 6: Run parser tests again**

Run:

```bash
bun test apps/api/src/modules/parsing/autoteka/autoteka-parser.test.ts
```

Expected: PASS.

- [ ] **Step 7: Review Gate 2**

Stop and review parser behavior before connecting uploads:

```bash
bun run test
bun run typecheck
```

Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/parsing/autoteka/autoteka-parser.ts apps/api/src/modules/parsing/autoteka/autoteka-parser.test.ts
git commit -m "feat: parse autoteka report text"
```

---

### Task 7: Map Parse Result To Points Policy

**Files:**
- Create: `apps/api/src/modules/uploads/points-evaluation.ts`
- Create: `apps/api/src/modules/uploads/points-evaluation.test.ts`

- [ ] **Step 1: Write failing points mapping tests**

Create `apps/api/src/modules/uploads/points-evaluation.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { evaluateParsedReportForPoints } from "./points-evaluation";
import type { ParsedReport } from "../parsing/report-parser";

const baseReport: ParsedReport = {
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
    bodyType: "седан",
    color: "белый",
    engine: "1.6 бензин",
    transmission: "механическая",
    driveType: "передний"
  },
  listings: [],
  mileageReadings: [{ observedAt: "2026-04-15T00:00:00.000Z", mileageKm: 42000, context: "объявление" }],
  riskFlags: {
    accidents: "not_found",
    repairCalculations: "not_found",
    restrictions: "not_found",
    pledge: "not_found",
    wanted: "not_found",
    taxi: "not_found",
    leasing: "not_found"
  },
  keyBlocks: ["vehicle_passport", "listings_or_mileage", "risk_checks"],
  warnings: [],
  qualityScore: 1
};

describe("evaluateParsedReportForPoints", () => {
  it("grants for a fresh parsed report when policy facts allow it", () => {
    const result = evaluateParsedReportForPoints({
      parsedReport: baseReport,
      now: new Date("2026-05-12T12:00:00.000Z"),
      isFirstReportForVin: true,
      isNewerThanCurrentVinReport: true,
      userHasEverReceivedPointForVin: false,
      userHasEverReceivedPointForFingerprint: false,
      automaticFingerprintGrantCount: 0
    });

    expect(result).toEqual({
      decision: "grant",
      points: 1,
      reason: "fresh_valid_report"
    });
  });

  it("requires manual review for partial parsed reports", () => {
    const result = evaluateParsedReportForPoints({
      parsedReport: { ...baseReport, status: "manual_review", keyBlocks: ["vehicle_passport"] },
      now: new Date("2026-05-12T12:00:00.000Z"),
      isFirstReportForVin: true,
      isNewerThanCurrentVinReport: true,
      userHasEverReceivedPointForVin: false,
      userHasEverReceivedPointForFingerprint: false,
      automaticFingerprintGrantCount: 0
    });

    expect(result).toEqual({
      decision: "manual_review",
      points: 0,
      reason: "insufficient_parsed_data"
    });
  });
});
```

- [ ] **Step 2: Run the failing points mapping test**

Run:

```bash
bun test apps/api/src/modules/uploads/points-evaluation.test.ts
```

Expected: FAIL because `points-evaluation.ts` does not exist.

- [ ] **Step 3: Implement points mapping**

Create `apps/api/src/modules/uploads/points-evaluation.ts`:

```ts
import { evaluateReportForPoints, type PointsPolicyResult } from "../points/points-policy";
import type { ParsedReport } from "../parsing/report-parser";

export type EvaluateParsedReportForPointsInput = {
  parsedReport: ParsedReport;
  now: Date;
  isFirstReportForVin: boolean;
  isNewerThanCurrentVinReport: boolean;
  userHasEverReceivedPointForVin: boolean;
  userHasEverReceivedPointForFingerprint: boolean;
  automaticFingerprintGrantCount: number;
};

export function evaluateParsedReportForPoints(input: EvaluateParsedReportForPointsInput): PointsPolicyResult {
  return evaluateReportForPoints({
    now: input.now,
    reportGeneratedAt: input.parsedReport.generatedAt ? new Date(input.parsedReport.generatedAt) : null,
    hasVin: input.parsedReport.vin !== null,
    parsedKeyBlockCount: input.parsedReport.keyBlocks.length,
    isFirstReportForVin: input.isFirstReportForVin,
    isNewerThanCurrentVinReport: input.isNewerThanCurrentVinReport,
    userHasEverReceivedPointForVin: input.userHasEverReceivedPointForVin,
    userHasEverReceivedPointForFingerprint: input.userHasEverReceivedPointForFingerprint,
    automaticFingerprintGrantCount: input.automaticFingerprintGrantCount
  });
}
```

- [ ] **Step 4: Verify points mapping**

Run:

```bash
bun test apps/api/src/modules/uploads/points-evaluation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/uploads/points-evaluation.ts apps/api/src/modules/uploads/points-evaluation.test.ts
git commit -m "feat: evaluate parsed uploads for points"
```

---

### Task 8: Build Report Upload Service With Fake Repository Tests

**Files:**
- Create: `apps/api/src/modules/uploads/report-upload-repository.ts`
- Create: `apps/api/src/modules/uploads/report-upload-service.ts`
- Create: `apps/api/src/modules/uploads/report-upload-service.test.ts`

- [ ] **Step 1: Define repository interface**

Create `apps/api/src/modules/uploads/report-upload-repository.ts`:

```ts
import type { PointsPolicyResult } from "../points/points-policy";
import type { ParsedReport } from "../parsing/report-parser";
import type { StoredObject } from "../storage/object-storage";

export type VehicleRecord = {
  id: string;
  vin: string;
  latestReportGeneratedAt: Date | null;
};

export type FingerprintRecord = {
  id: string;
  fingerprint: string;
  automaticGrantCount: number;
};

export type CreateReportUploadInput = {
  userId: string | null;
  guestSessionId: string | null;
  vehicleId: string | null;
  reportFingerprintId: string;
  status: "parsed" | "manual_review" | "rejected";
  sourceKind: string;
  originalObjectKey: string;
  generatedAt: Date | null;
  parserVersion: string;
  parseQualityScore: string;
  rawData: {
    storage: StoredObject;
    parseResult: ParsedReport;
    pointsEvaluation: PointsPolicyResult;
    extractedText: {
      pageCount: number;
      characterCount: number;
      sha256: string;
    };
  };
  reviewReason: string | null;
};

export type CreatedReportUpload = {
  id: string;
  status: "parsed" | "manual_review" | "rejected";
};

export interface ReportUploadRepository {
  findVehicleByVin(vin: string): Promise<VehicleRecord | null>;
  upsertVehicleFromParsedReport(parsedReport: ParsedReport): Promise<VehicleRecord | null>;
  findOrCreateFingerprint(fingerprint: string): Promise<FingerprintRecord>;
  userHasReceivedPointForVin(userId: string, vehicleId: string): Promise<boolean>;
  userHasReceivedPointForFingerprint(userId: string, fingerprintId: string): Promise<boolean>;
  createReportUpload(input: CreateReportUploadInput): Promise<CreatedReportUpload>;
}
```

- [ ] **Step 2: Write failing upload service tests**

Create `apps/api/src/modules/uploads/report-upload-service.test.ts` with fake storage, fake extractor, fake parser, and fake repository. Cover these cases:

```ts
it("stores original PDF, parses it, creates parsed report_upload, and evaluates points", async () => {
  const result = await service.ingestPdf({
    fileName: "report.pdf",
    contentType: "application/pdf",
    bytes: new TextEncoder().encode("%PDF text"),
    userId: "11111111-1111-1111-1111-111111111111",
    guestSessionId: null,
    now: new Date("2026-05-12T12:00:00.000Z")
  });

  expect(result.status).toBe("parsed");
  expect(result.pointsEvaluation.decision).toBe("grant");
  expect(repository.createdUploads[0]?.status).toBe("parsed");
  expect(repository.createdUploads[0]?.rawData.parseResult.vin).toBe("XTA210990Y2765499");
});

it("creates manual_review upload when text extraction is empty", async () => {
  extractor.result = { text: "", pageCount: 1, hasExtractableText: false, errorCode: null };

  const result = await service.ingestPdf({
    fileName: "scan.pdf",
    contentType: "application/pdf",
    bytes: new Uint8Array([37, 80, 68, 70]),
    userId: null,
    guestSessionId: null,
    now: new Date("2026-05-12T12:00:00.000Z")
  });

  expect(result.status).toBe("manual_review");
  expect(result.reviewReason).toBe("empty_pdf_text");
  expect(repository.createdUploads[0]?.vehicleId).toBeNull();
});

it("does not mutate user balances or point ledger entries", async () => {
  await service.ingestPdf({
    fileName: "report.pdf",
    contentType: "application/pdf",
    bytes: new Uint8Array([37, 80, 68, 70]),
    userId: "11111111-1111-1111-1111-111111111111",
    guestSessionId: null,
    now: new Date("2026-05-12T12:00:00.000Z")
  });

  expect(repository.pointLedgerMutations).toBe(0);
  expect(repository.userBalanceMutations).toBe(0);
});
```

- [ ] **Step 3: Run the failing upload service tests**

Run:

```bash
bun test apps/api/src/modules/uploads/report-upload-service.test.ts
```

Expected: FAIL because upload service does not exist.

- [ ] **Step 4: Implement upload service**

Create `apps/api/src/modules/uploads/report-upload-service.ts`:

```ts
import { createHash } from "node:crypto";
import { createReportFingerprint } from "../parsing/report-fingerprint";
import type { ParsedReport } from "../parsing/report-parser";
import type { PdfTextExtractionResult } from "../pdf/pdf-text-extractor";
import type { ObjectStorage } from "../storage/object-storage";
import { evaluateParsedReportForPoints } from "./points-evaluation";
import type { ReportUploadRepository } from "./report-upload-repository";

export type ReportUploadServiceDependencies = {
  storage: ObjectStorage;
  extractPdfText(bytes: Uint8Array): Promise<PdfTextExtractionResult>;
  parseReport(text: string): ParsedReport;
  repository: ReportUploadRepository;
  originalRetentionDays: number;
};

export type IngestPdfInput = {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  userId: string | null;
  guestSessionId: string | null;
  now: Date;
};

export type IngestPdfResult = {
  uploadId: string;
  status: "parsed" | "manual_review" | "rejected";
  vin: string | null;
  generatedAt: string | null;
  pointsEvaluation: { decision: string; points: 0 | 1; reason: string };
  reviewReason: string | null;
};

export class ReportUploadService {
  constructor(private readonly dependencies: ReportUploadServiceDependencies) {}

  async ingestPdf(input: IngestPdfInput): Promise<IngestPdfResult> {
    const expiresAt = new Date(input.now.getTime() + this.dependencies.originalRetentionDays * 86_400_000);
    const storedObject = await this.dependencies.storage.putObject({
      namespace: "report-originals",
      bytes: input.bytes,
      contentType: input.contentType,
      originalFileName: input.fileName,
      expiresAt
    });

    const extracted = await this.dependencies.extractPdfText(input.bytes);
    const parsedReport = extracted.hasExtractableText
      ? this.dependencies.parseReport(extracted.text)
      : createEmptyTextManualReviewReport();

    const fingerprint = createReportFingerprint({
      sourceKind: "autoteka_pdf",
      extractedText: extracted.text.length > 0 ? extracted.text : storedObject.sha256
    });

    const existingVehicle = parsedReport.vin
      ? await this.dependencies.repository.findVehicleByVin(parsedReport.vin)
      : null;
    const vehicle = parsedReport.vin
      ? await this.dependencies.repository.upsertVehicleFromParsedReport(parsedReport)
      : null;
    const fingerprintRecord = await this.dependencies.repository.findOrCreateFingerprint(fingerprint);
    const userHasVinPoint =
      input.userId && vehicle ? await this.dependencies.repository.userHasReceivedPointForVin(input.userId, vehicle.id) : false;
    const userHasFingerprintPoint =
      input.userId ? await this.dependencies.repository.userHasReceivedPointForFingerprint(input.userId, fingerprintRecord.id) : false;
    const pointsEvaluation = evaluateParsedReportForPoints({
      parsedReport,
      now: input.now,
      isFirstReportForVin: existingVehicle === null,
      isNewerThanCurrentVinReport: isNewerReport(parsedReport.generatedAt, existingVehicle?.latestReportGeneratedAt ?? null),
      userHasEverReceivedPointForVin: userHasVinPoint,
      userHasEverReceivedPointForFingerprint: userHasFingerprintPoint,
      automaticFingerprintGrantCount: fingerprintRecord.automaticGrantCount
    });

    const status = parsedReport.status === "parsed" && pointsEvaluation.decision !== "manual_review" ? "parsed" : "manual_review";
    const reviewReason = status === "manual_review" ? getReviewReason(parsedReport, extracted, pointsEvaluation.reason) : null;
    const created = await this.dependencies.repository.createReportUpload({
      userId: input.userId,
      guestSessionId: input.guestSessionId,
      vehicleId: vehicle?.id ?? null,
      reportFingerprintId: fingerprintRecord.id,
      status,
      sourceKind: "autoteka_pdf",
      originalObjectKey: storedObject.key,
      generatedAt: parsedReport.generatedAt ? new Date(parsedReport.generatedAt) : null,
      parserVersion: parsedReport.parserVersion,
      parseQualityScore: parsedReport.qualityScore.toFixed(2),
      rawData: {
        storage: storedObject,
        parseResult: parsedReport,
        pointsEvaluation,
        extractedText: {
          pageCount: extracted.pageCount,
          characterCount: extracted.text.length,
          sha256: createHash("sha256").update(extracted.text, "utf8").digest("hex")
        }
      },
      reviewReason
    });

    return {
      uploadId: created.id,
      status: created.status,
      vin: parsedReport.vin,
      generatedAt: parsedReport.generatedAt,
      pointsEvaluation,
      reviewReason
    };
  }
}
```

Also implement the local helper functions used above:

```ts
function isNewerReport(generatedAt: string | null, latest: Date | null): boolean {
  if (!generatedAt || !latest) {
    return true;
  }

  const current = new Date(generatedAt);
  return Number.isFinite(current.getTime()) && current.getTime() > latest.getTime();
}

function getReviewReason(
  parsedReport: ParsedReport,
  extracted: PdfTextExtractionResult,
  pointsReason: string
): string {
  if (!extracted.hasExtractableText) {
    return "empty_pdf_text";
  }

  return parsedReport.warnings[0]?.code ?? pointsReason;
}

function createEmptyTextManualReviewReport(): ParsedReport {
  return {
    sourceKind: "autoteka_pdf",
    parserVersion: "autoteka-v1",
    status: "manual_review",
    vin: null,
    generatedAt: null,
    vehicle: {
      vin: null,
      make: null,
      model: null,
      year: null,
      bodyType: null,
      color: null,
      engine: null,
      transmission: null,
      driveType: null
    },
    listings: [],
    mileageReadings: [],
    riskFlags: {
      accidents: "unknown",
      repairCalculations: "unknown",
      restrictions: "unknown",
      pledge: "unknown",
      wanted: "unknown",
      taxi: "unknown",
      leasing: "unknown"
    },
    keyBlocks: [],
    warnings: [{ code: "empty_pdf_text", message: "PDF не содержит извлекаемого текстового слоя." }],
    qualityScore: 0
  };
}
```

- [ ] **Step 5: Verify service tests**

Run:

```bash
bun test apps/api/src/modules/uploads/report-upload-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/uploads/report-upload-repository.ts apps/api/src/modules/uploads/report-upload-service.ts apps/api/src/modules/uploads/report-upload-service.test.ts
git commit -m "feat: orchestrate report PDF ingestion"
```

---

### Task 9: Implement Drizzle Repository

**Files:**
- Modify: `apps/api/src/modules/uploads/report-upload-repository.ts`
- Create: `apps/api/src/modules/uploads/drizzle-report-upload-repository.ts`

- [ ] **Step 1: Add repository factory dependencies**

Extend `report-upload-repository.ts` only if needed to represent Drizzle return values. Keep the interface from Task 8 stable for service tests.

- [ ] **Step 2: Implement Drizzle repository**

Create `apps/api/src/modules/uploads/drizzle-report-upload-repository.ts` with:

```ts
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
  pointLedgerEntries,
  reportFingerprints,
  reportUploads,
  vehicles
} from "../../db/schema";
import type { ParsedReport } from "../parsing/report-parser";
import type {
  CreateReportUploadInput,
  CreatedReportUpload,
  FingerprintRecord,
  ReportUploadRepository,
  VehicleRecord
} from "./report-upload-repository";

export class DrizzleReportUploadRepository implements ReportUploadRepository {
  async findVehicleByVin(vin: string): Promise<VehicleRecord | null> {
    const rows = await db.select().from(vehicles).where(eq(vehicles.vin, vin)).limit(1);
    const vehicle = rows[0];

    if (!vehicle) {
      return null;
    }

    const latestUploads = await db
      .select({ generatedAt: reportUploads.generatedAt })
      .from(reportUploads)
      .where(eq(reportUploads.vehicleId, vehicle.id))
      .orderBy(desc(reportUploads.generatedAt))
      .limit(1);

    return {
      id: vehicle.id,
      vin: vehicle.vin,
      latestReportGeneratedAt: latestUploads[0]?.generatedAt ?? null
    };
  }

  async upsertVehicleFromParsedReport(parsedReport: ParsedReport): Promise<VehicleRecord | null> {
    if (!parsedReport.vin) {
      return null;
    }

    const inserted = await db
      .insert(vehicles)
      .values({
        vin: parsedReport.vin,
        make: parsedReport.vehicle.make,
        model: parsedReport.vehicle.model,
        year: parsedReport.vehicle.year,
        bodyType: parsedReport.vehicle.bodyType,
        color: parsedReport.vehicle.color,
        engine: parsedReport.vehicle.engine,
        transmission: parsedReport.vehicle.transmission,
        driveType: parsedReport.vehicle.driveType
      })
      .onConflictDoUpdate({
        target: vehicles.vin,
        set: {
          make: parsedReport.vehicle.make,
          model: parsedReport.vehicle.model,
          year: parsedReport.vehicle.year,
          bodyType: parsedReport.vehicle.bodyType,
          color: parsedReport.vehicle.color,
          engine: parsedReport.vehicle.engine,
          transmission: parsedReport.vehicle.transmission,
          driveType: parsedReport.vehicle.driveType,
          updatedAt: new Date()
        }
      })
      .returning();

    const vehicle = inserted[0];

    return vehicle ? { id: vehicle.id, vin: vehicle.vin, latestReportGeneratedAt: null } : null;
  }

  async findOrCreateFingerprint(fingerprint: string): Promise<FingerprintRecord> {
    const inserted = await db
      .insert(reportFingerprints)
      .values({ fingerprint })
      .onConflictDoNothing()
      .returning();
    const row = inserted[0] ?? (await db.select().from(reportFingerprints).where(eq(reportFingerprints.fingerprint, fingerprint)).limit(1))[0];

    return {
      id: row.id,
      fingerprint: row.fingerprint,
      automaticGrantCount: row.automaticGrantCount
    };
  }

  async userHasReceivedPointForVin(userId: string, vehicleId: string): Promise<boolean> {
    const rows = await db
      .select({ id: pointLedgerEntries.id })
      .from(pointLedgerEntries)
      .where(
        and(
          eq(pointLedgerEntries.userId, userId),
          eq(pointLedgerEntries.vehicleId, vehicleId),
          eq(pointLedgerEntries.reason, "report_grant")
        )
      )
      .limit(1);

    return rows.length > 0;
  }

  async userHasReceivedPointForFingerprint(userId: string, fingerprintId: string): Promise<boolean> {
    const rows = await db
      .select({ id: pointLedgerEntries.id })
      .from(pointLedgerEntries)
      .innerJoin(reportUploads, eq(pointLedgerEntries.reportUploadId, reportUploads.id))
      .where(
        and(
          eq(pointLedgerEntries.userId, userId),
          eq(reportUploads.reportFingerprintId, fingerprintId),
          eq(pointLedgerEntries.reason, "report_grant")
        )
      )
      .limit(1);

    return rows.length > 0;
  }

  async createReportUpload(input: CreateReportUploadInput): Promise<CreatedReportUpload> {
    const rows = await db
      .insert(reportUploads)
      .values({
        userId: input.userId,
        guestSessionId: input.guestSessionId,
        vehicleId: input.vehicleId,
        reportFingerprintId: input.reportFingerprintId,
        status: input.status,
        sourceKind: input.sourceKind,
        originalObjectKey: input.originalObjectKey,
        generatedAt: input.generatedAt,
        parserVersion: input.parserVersion,
        parseQualityScore: input.parseQualityScore,
        rawData: input.rawData,
        reviewReason: input.reviewReason
      })
      .returning({ id: reportUploads.id, status: reportUploads.status });

    return rows[0];
  }
}
```

- [ ] **Step 3: Typecheck repository**

Run:

```bash
bun run --cwd apps/api typecheck
```

Expected: PASS.

- [ ] **Step 4: Confirm schema is unchanged**

Run:

```bash
bun run --cwd apps/api db:generate
```

Expected: no schema changes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/uploads/report-upload-repository.ts apps/api/src/modules/uploads/drizzle-report-upload-repository.ts
git commit -m "feat: persist parsed report uploads"
```

---

### Task 10: Add Upload API Route

**Files:**
- Create: `apps/api/src/modules/uploads/routes.ts`
- Create: `apps/api/src/modules/uploads/routes.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write failing route tests**

Create `apps/api/src/modules/uploads/routes.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { createUploadRoutes } from "./routes";

describe("upload routes", () => {
  it("requires rights confirmation", async () => {
    const routes = createUploadRoutes({
      ingestPdf: async () => {
        throw new Error("should not be called");
      },
      maxUploadBytes: 20 * 1024 * 1024
    });

    const body = new FormData();
    body.set("file", new File([new Uint8Array([37, 80, 68, 70])], "report.pdf", { type: "application/pdf" }));

    const response = await routes.request("/report-pdf", { method: "POST", body });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "rights_confirmation_required",
        message: "Подтвердите право загрузить отчет и согласие с правилами сервиса."
      }
    });
  });

  it("rejects non-PDF uploads", async () => {
    const routes = createUploadRoutes({
      ingestPdf: async () => {
        throw new Error("should not be called");
      },
      maxUploadBytes: 20 * 1024 * 1024
    });

    const body = new FormData();
    body.set("rightsConfirmed", "true");
    body.set("file", new File(["hello"], "report.txt", { type: "text/plain" }));

    const response = await routes.request("/report-pdf", { method: "POST", body });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_pdf_upload");
  });

  it("returns neutral upload status for parsed PDF", async () => {
    const routes = createUploadRoutes({
      ingestPdf: async () => ({
        uploadId: "22222222-2222-2222-2222-222222222222",
        status: "parsed",
        vin: "XTA210990Y2765499",
        generatedAt: "2026-05-01T00:00:00.000Z",
        pointsEvaluation: { decision: "grant", points: 1, reason: "fresh_valid_report" },
        reviewReason: null
      }),
      maxUploadBytes: 20 * 1024 * 1024
    });

    const body = new FormData();
    body.set("rightsConfirmed", "true");
    body.set("file", new File([new Uint8Array([37, 80, 68, 70])], "report.pdf", { type: "application/pdf" }));

    const response = await routes.request("/report-pdf", { method: "POST", body });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      upload: {
        id: "22222222-2222-2222-2222-222222222222",
        status: "parsed",
        vin: "XTA210990Y2765499",
        generatedAt: "2026-05-01T00:00:00.000Z",
        pointsPreview: {
          decision: "grant",
          points: 1,
          reason: "fresh_valid_report"
        },
        reviewReason: null
      }
    });
  });
});
```

- [ ] **Step 2: Run failing route tests**

Run:

```bash
bun test apps/api/src/modules/uploads/routes.test.ts
```

Expected: FAIL because `routes.ts` does not exist.

- [ ] **Step 3: Implement route factory**

Create `apps/api/src/modules/uploads/routes.ts`:

```ts
import { Hono } from "hono";
import { z } from "zod";
import { env } from "../../env";
import { parseAutotekaReport } from "../parsing/autoteka/autoteka-parser";
import { extractPdfText } from "../pdf/pdf-text-extractor";
import { LocalObjectStorage } from "../storage/local-object-storage";
import { DrizzleReportUploadRepository } from "./drizzle-report-upload-repository";
import { ReportUploadService, type IngestPdfResult } from "./report-upload-service";

export type UploadRoutesDependencies = {
  ingestPdf(input: {
    fileName: string;
    contentType: string;
    bytes: Uint8Array;
    userId: string | null;
    guestSessionId: string | null;
    now: Date;
  }): Promise<IngestPdfResult>;
  maxUploadBytes: number;
};

const uuidSchema = z.string().uuid();

export function createUploadRoutes(dependencies: UploadRoutesDependencies): Hono {
  const routes = new Hono();

  routes.post("/report-pdf", async (context) => {
    const body = await context.req.parseBody().catch(() => null);

    if (!body || body.rightsConfirmed !== "true") {
      return context.json(
        {
          error: {
            code: "rights_confirmation_required",
            message: "Подтвердите право загрузить отчет и согласие с правилами сервиса."
          }
        },
        400
      );
    }

    const file = body.file;

    if (!(file instanceof File) || !isPdfFile(file)) {
      return context.json(
        {
          error: {
            code: "invalid_pdf_upload",
            message: "Загрузите текстовый PDF-файл отчета."
          }
        },
        400
      );
    }

    if (file.size > dependencies.maxUploadBytes) {
      return context.json(
        {
          error: {
            code: "report_file_too_large",
            message: "Файл отчета превышает допустимый размер."
          }
        },
        413
      );
    }

    const userId = parseOptionalUuid(body.userId);
    const guestSessionId = parseOptionalUuid(body.guestSessionId);
    const result = await dependencies.ingestPdf({
      fileName: file.name,
      contentType: file.type || "application/pdf",
      bytes: new Uint8Array(await file.arrayBuffer()),
      userId,
      guestSessionId,
      now: new Date()
    });

    return context.json(
      {
        upload: {
          id: result.uploadId,
          status: result.status,
          vin: result.vin,
          generatedAt: result.generatedAt,
          pointsPreview: result.pointsEvaluation,
          reviewReason: result.reviewReason
        }
      },
      201
    );
  });

  return routes;
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function parseOptionalUuid(value: unknown): string | null {
  const parsed = uuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const uploadRoutes = createUploadRoutes({
  ingestPdf: (input) =>
    new ReportUploadService({
      storage: new LocalObjectStorage({ rootDir: env.REPORT_STORAGE_LOCAL_DIR }),
      extractPdfText,
      parseReport: parseAutotekaReport,
      repository: new DrizzleReportUploadRepository(),
      originalRetentionDays: env.REPORT_ORIGINAL_RETENTION_DAYS
    }).ingestPdf(input),
  maxUploadBytes: env.MAX_REPORT_UPLOAD_BYTES
});
```

- [ ] **Step 4: Wire route into app**

Update `apps/api/src/app.ts`:

```ts
import { uploadRoutes } from "./modules/uploads/routes";

app.route("/api/uploads", uploadRoutes);
```

- [ ] **Step 5: Verify route tests**

Run:

```bash
bun test apps/api/src/modules/uploads/routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Verify app test route wiring**

Extend `apps/api/src/app.test.ts` with an invalid upload smoke test:

```ts
it("exposes report upload route", async () => {
  const response = await app.request("/api/uploads/report-pdf", {
    method: "POST",
    body: new FormData()
  });

  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("rights_confirmation_required");
});
```

Run:

```bash
bun test apps/api/src/app.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/uploads/routes.ts apps/api/src/modules/uploads/routes.test.ts apps/api/src/app.ts apps/api/src/app.test.ts
git commit -m "feat: add report PDF upload API"
```

---

### Task 11: End-To-End Upload Service Review Gate

**Files:**
- No new files.

- [ ] **Step 1: Run focused API tests**

Run:

```bash
bun test apps/api/src/modules/parsing apps/api/src/modules/pdf apps/api/src/modules/storage apps/api/src/modules/uploads
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Confirm no web build is needed**

This milestone does not modify `apps/web`. If frontend files changed during execution, run:

```bash
bun run --cwd apps/web build
```

Expected: PASS.

- [ ] **Step 5: Confirm no schema migration is needed**

This plan does not modify `apps/api/src/db/schema.ts`. Run:

```bash
bun run --cwd apps/api db:generate
```

Expected: no schema changes.

- [ ] **Step 6: Manual API smoke test with a real text PDF**

Place a private, legally usable text-layer PDF at `.local/manual-fixtures/autoteka-text-report.pdf`. Then run the API locally and upload it:

```bash
bun run dev:api
```

In another terminal:

```bash
curl -sS \
  -F "rightsConfirmed=true" \
  -F "file=@.local/manual-fixtures/autoteka-text-report.pdf;type=application/pdf" \
  http://localhost:3001/api/uploads/report-pdf
```

Expected response shape:

```json
{
  "upload": {
    "id": "uuid",
    "status": "parsed",
    "vin": "synthetic-or-real-vin-from-private-fixture",
    "generatedAt": "2026-05-01T00:00:00.000Z",
    "pointsPreview": {
      "decision": "grant",
      "points": 1,
      "reason": "fresh_valid_report"
    },
    "reviewReason": null
  }
}
```

If the private report is partial or suspicious, expected `status` is `manual_review` and `reviewReason` contains the first parser or points policy reason.

- [ ] **Step 7: Commit final adjustments**

```bash
git add apps/api package.json bun.lock .env.example .gitignore
git commit -m "test: verify report ingestion milestone"
```

---

## Self-Review Checklist

- Upload API for PDF: Task 10.
- Storage abstraction: Task 3.
- PDF text extraction without OCR: Task 4.
- `report_fingerprint`: Task 2 and Task 8.
- Parser fixtures and golden tests: Task 5.
- Autoteka parser v1: Task 6.
- `report_upload` creation: Task 8 and Task 9.
- `manual_review` for partial or suspicious reports: Task 4, Task 6, Task 8, Task 10.
- Points policy connected to parse result without full UI accrual: Task 7 and Task 8.
- No original third-party report exposure to users: Scope Decisions and Task 10 response shape.
- No personal data in committed fixtures: Task 5 fixture rules.
- Original PDF closed storage with 180-day retention metadata: Task 1, Task 3, Task 8.
- Required final verification: Task 11.

## Execution Options

Plan complete. Recommended execution mode:

1. **Subagent-Driven**: one fresh worker per task, review gates after Tasks 4, 6, and 11.
2. **Inline Execution**: execute tasks in this session with the same review gates.
