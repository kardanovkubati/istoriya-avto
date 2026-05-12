# История Авто Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working project foundation for История Авто: monorepo, Bun API, React/Vite web app, shared query utilities, core database schema, points policy, and tests.

**Architecture:** Use a small TypeScript monorepo with `apps/api`, `apps/web`, and `packages/shared`. The API is a Bun/Hono monolith with focused modules; the web app is a mobile-first React/Vite shell; shared pure utilities live in `packages/shared` and are tested independently.

**Tech Stack:** Bun, TypeScript, Hono, React, Vite, Drizzle ORM, PostgreSQL, Zod, bun:test.

---

## Scope Split

The approved MVP spec covers multiple independent subsystems. This plan implements only the first slice: the foundation that every later subsystem depends on.

Subsequent implementation plans should cover these slices in order:

1. Report ingestion and parsing for Авито/Автотека PDF/authless links.
2. Vehicle aggregation and full report rendering.
3. Auth, guest sessions, Telegram/Max/phone login.
4. Points ledger, subscriptions, access, share links, and PDF export.
5. Admin queues, complaints, support tickets, and audit workflows.
6. SEO/legal pages and production hardening.

## Target File Structure

Create this structure:

```text
.
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.base.json
├── apps
│   ├── api
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src
│   │       ├── app.test.ts
│   │       ├── app.ts
│   │       ├── env.ts
│   │       ├── server.ts
│   │       ├── db
│   │       │   ├── client.ts
│   │       │   └── schema.ts
│   │       └── modules
│   │           ├── health
│   │           │   └── routes.ts
│   │           ├── points
│   │           │   ├── points-policy.test.ts
│   │           │   └── points-policy.ts
│   │           └── search
│   │               └── routes.ts
│   └── web
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── src
│           ├── App.tsx
│           ├── main.tsx
│           ├── styles.css
│           └── lib
│               └── api.ts
└── packages
    └── shared
        ├── package.json
        ├── tsconfig.json
        └── src
            ├── index.ts
            ├── search-query.test.ts
            └── search-query.ts
```

---

### Task 1: Create Monorepo Tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`

- [ ] **Step 1: Create the root workspace files**

Create `package.json`:

```json
{
  "name": "istoriya-avto",
  "private": true,
  "type": "module",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev:api": "bun run --cwd apps/api dev",
    "dev:web": "bun run --cwd apps/web dev",
    "test": "bun run --cwd packages/shared test && bun run --cwd apps/api test",
    "typecheck": "bun run --cwd packages/shared typecheck && bun run --cwd apps/api typecheck && bun run --cwd apps/web typecheck",
    "db:generate": "bun run --cwd apps/api db:generate"
  }
}
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

Create `.gitignore`:

```gitignore
node_modules
.env
.env.local
dist
build
coverage
.DS_Store
*.log
```

Create `.env.example`:

```dotenv
PORT=3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/istoriya_avto
PUBLIC_WEB_URL=http://localhost:5173
PUBLIC_API_URL=http://localhost:3001
```

- [ ] **Step 2: Create package manifests**

Create `packages/shared/package.json`:

```json
{
  "name": "@istoriya-avto/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "latest"
  }
}
```

Create `packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts"]
}
```

Create `apps/api/package.json`:

```json
{
  "name": "@istoriya-avto/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/server.ts",
    "start": "bun src/server.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@istoriya-avto/shared": "workspace:*",
    "dotenv": "latest",
    "drizzle-orm": "latest",
    "hono": "latest",
    "postgres": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "drizzle-kit": "latest",
    "typescript": "latest"
  }
}
```

Create `apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts", "drizzle.config.ts"]
}
```

Create `apps/web/package.json`:

```json
{
  "name": "@istoriya-avto/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "preview": "vite preview"
  },
  "dependencies": {
    "@vitejs/plugin-react": "latest",
    "vite": "latest",
    "react": "latest",
    "react-dom": "latest",
    "lucide-react": "latest"
  },
  "devDependencies": {
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "typescript": "latest"
  }
}
```

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": ["vite/client"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"]
}
```

- [ ] **Step 3: Install dependencies**

Run:

```bash
bun install
```

Expected:

```text
Saved lockfile
```

- [ ] **Step 4: Commit workspace tooling**

Run:

```bash
git add package.json tsconfig.base.json .gitignore .env.example apps/api/package.json apps/api/tsconfig.json apps/web/package.json apps/web/tsconfig.json packages/shared/package.json packages/shared/tsconfig.json bun.lock
git commit -m "chore: scaffold TypeScript workspace"
```

Expected:

```text
[master ...] chore: scaffold TypeScript workspace
```

---

### Task 2: Add Shared Search Query Detection

**Files:**
- Create: `packages/shared/src/search-query.test.ts`
- Create: `packages/shared/src/search-query.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/search-query.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { detectSearchQuery } from "./search-query";

describe("detectSearchQuery", () => {
  it("detects VIN values", () => {
    expect(detectSearchQuery("xw8zzz61zkg123456")).toEqual({
      kind: "vin",
      normalized: "XW8ZZZ61ZKG123456",
      original: "xw8zzz61zkg123456"
    });
  });

  it("detects Russian plate values and normalizes spaces", () => {
    expect(detectSearchQuery("а 123 вс 777")).toEqual({
      kind: "plate",
      normalized: "А123ВС777",
      original: "а 123 вс 777"
    });
  });

  it("detects supported listing URLs", () => {
    expect(detectSearchQuery("https://www.avito.ru/moskva/avtomobili/test_123")).toEqual({
      kind: "listing_url",
      normalized: "https://www.avito.ru/moskva/avtomobili/test_123",
      original: "https://www.avito.ru/moskva/avtomobili/test_123",
      host: "www.avito.ru"
    });
  });

  it("detects unsupported URLs", () => {
    expect(detectSearchQuery("https://example.com/car/1")).toEqual({
      kind: "unsupported_url",
      normalized: "https://example.com/car/1",
      original: "https://example.com/car/1",
      host: "example.com"
    });
  });

  it("returns unknown for empty and unrecognized input", () => {
    expect(detectSearchQuery("")).toEqual({
      kind: "unknown",
      normalized: "",
      original: ""
    });
    expect(detectSearchQuery("купить авто")).toEqual({
      kind: "unknown",
      normalized: "купить авто",
      original: "купить авто"
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
bun run --cwd packages/shared test src/search-query.test.ts
```

Expected:

```text
error: Cannot find module './search-query'
```

- [ ] **Step 3: Implement query detection**

Create `packages/shared/src/search-query.ts`:

```ts
export type SearchQueryKind =
  | "vin"
  | "plate"
  | "listing_url"
  | "unsupported_url"
  | "unknown";

export type SearchQueryDetection =
  | {
      kind: "vin" | "plate" | "unknown";
      normalized: string;
      original: string;
    }
  | {
      kind: "listing_url" | "unsupported_url";
      normalized: string;
      original: string;
      host: string;
    };

const SUPPORTED_LISTING_HOSTS = [
  "avito.ru",
  "www.avito.ru",
  "auto.ru",
  "www.auto.ru",
  "drom.ru",
  "www.drom.ru"
] as const;

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;
const RUSSIAN_PLATE_PATTERN = /^[АВЕКМНОРСТУХABEKMHOPCTYX]\d{3}[АВЕКМНОРСТУХABEKMHOPCTYX]{2}\d{2,3}$/i;

const LATIN_TO_CYRILLIC_PLATE: Record<string, string> = {
  A: "А",
  B: "В",
  E: "Е",
  K: "К",
  M: "М",
  H: "Н",
  O: "О",
  P: "Р",
  C: "С",
  T: "Т",
  Y: "У",
  X: "Х"
};

export function detectSearchQuery(input: string): SearchQueryDetection {
  const original = input;
  const normalizedInput = input.trim();

  if (normalizedInput.length === 0) {
    return { kind: "unknown", normalized: "", original };
  }

  const urlDetection = detectUrl(normalizedInput, original);
  if (urlDetection) {
    return urlDetection;
  }

  const vin = normalizedInput.replace(/\s+/g, "").toUpperCase();
  if (VIN_PATTERN.test(vin)) {
    return { kind: "vin", normalized: vin, original };
  }

  const plate = normalizePlate(normalizedInput);
  if (RUSSIAN_PLATE_PATTERN.test(plate)) {
    return { kind: "plate", normalized: plate, original };
  }

  return { kind: "unknown", normalized: normalizedInput, original };
}

function detectUrl(input: string, original: string): SearchQueryDetection | null {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const host = url.host.toLowerCase();
  const normalized = url.toString();

  if (SUPPORTED_LISTING_HOSTS.includes(host as (typeof SUPPORTED_LISTING_HOSTS)[number])) {
    return { kind: "listing_url", normalized, original, host };
  }

  return { kind: "unsupported_url", normalized, original, host };
}

function normalizePlate(value: string): string {
  return value
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/[ABEKMHOPCTYX]/g, (letter) => LATIN_TO_CYRILLIC_PLATE[letter] ?? letter);
}
```

Create `packages/shared/src/index.ts`:

```ts
export type { SearchQueryDetection, SearchQueryKind } from "./search-query";
export { detectSearchQuery } from "./search-query";
```

- [ ] **Step 4: Run shared tests and typecheck**

Run:

```bash
bun run --cwd packages/shared test
bun run --cwd packages/shared typecheck
```

Expected:

```text
pass
```

- [ ] **Step 5: Commit shared query detection**

Run:

```bash
git add packages/shared/src packages/shared/package.json packages/shared/tsconfig.json
git commit -m "feat: add shared search query detection"
```

Expected:

```text
[master ...] feat: add shared search query detection
```

---

### Task 3: Add Hono API App with Health and Search Detection

**Files:**
- Create: `apps/api/src/app.test.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/modules/health/routes.ts`
- Create: `apps/api/src/modules/search/routes.ts`

- [ ] **Step 1: Write failing API tests**

Create `apps/api/src/app.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import app from "./app";

describe("api app", () => {
  it("returns health status", async () => {
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "istoriya-avto-api"
    });
  });

  it("detects search query type", async () => {
    const response = await app.request("/api/search/detect", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ query: "А123ВС777" })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      query: {
        kind: "plate",
        normalized: "А123ВС777",
        original: "А123ВС777"
      }
    });
  });

  it("rejects invalid search detection payloads", async () => {
    const response = await app.request("/api/search/detect", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
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
```

- [ ] **Step 2: Run the API test and verify it fails**

Run:

```bash
bun run --cwd apps/api test src/app.test.ts
```

Expected:

```text
error: Cannot find module './app'
```

- [ ] **Step 3: Implement the API app and routes**

Create `apps/api/src/modules/health/routes.ts`:

```ts
import { Hono } from "hono";

export const healthRoutes = new Hono();

healthRoutes.get("/", (context) => {
  return context.json({
    status: "ok",
    service: "istoriya-avto-api"
  });
});
```

Create `apps/api/src/modules/search/routes.ts`:

```ts
import { detectSearchQuery } from "@istoriya-avto/shared";
import { Hono } from "hono";
import { z } from "zod";

const detectSearchQuerySchema = z.object({
  query: z.string()
});

export const searchRoutes = new Hono();

searchRoutes.post("/detect", async (context) => {
  const body = await context.req.json().catch(() => null);
  const parsed = detectSearchQuerySchema.safeParse(body);

  if (!parsed.success) {
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

  return context.json({
    query: detectSearchQuery(parsed.data.query)
  });
});
```

Create `apps/api/src/app.ts`:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthRoutes } from "./modules/health/routes";
import { searchRoutes } from "./modules/search/routes";

export function createApp() {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: ["http://localhost:5173"],
      allowHeaders: ["content-type"],
      allowMethods: ["GET", "POST", "OPTIONS"]
    })
  );

  app.route("/health", healthRoutes);
  app.route("/api/search", searchRoutes);

  app.notFound((context) => {
    return context.json(
      {
        error: {
          code: "not_found",
          message: "Маршрут не найден."
        }
      },
      404
    );
  });

  app.onError((error, context) => {
    console.error(error);

    return context.json(
      {
        error: {
          code: "internal_error",
          message: "Внутренняя ошибка сервиса."
        }
      },
      500
    );
  });

  return app;
}

const app = createApp();

export default app;
```

- [ ] **Step 4: Run API tests and typecheck**

Run:

```bash
bun run --cwd apps/api test
bun run --cwd apps/api typecheck
```

Expected:

```text
pass
```

- [ ] **Step 5: Commit the API app**

Run:

```bash
git add apps/api/src packages/shared/src
git commit -m "feat: add API health and search detection routes"
```

Expected:

```text
[master ...] feat: add API health and search detection routes
```

---

### Task 4: Add Environment and Database Schema

**Files:**
- Create: `apps/api/src/env.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle.config.ts`
- Modify: `apps/api/src/app.test.ts`

- [ ] **Step 1: Add environment tests**

Append this test to `apps/api/src/app.test.ts`:

```ts
it("loads test-safe environment defaults", async () => {
  const { env } = await import("./env");

  expect(env.PORT).toBeGreaterThan(0);
  expect(env.DATABASE_URL.startsWith("postgresql://")).toBe(true);
});
```

- [ ] **Step 2: Run the API test and verify it fails**

Run:

```bash
bun run --cwd apps/api test src/app.test.ts
```

Expected:

```text
error: Cannot find module './env'
```

- [ ] **Step 3: Implement environment parsing**

Create `apps/api/src/env.ts`:

```ts
import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url().default("postgresql://postgres:postgres@localhost:5432/istoriya_avto"),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:5173"),
  PUBLIC_API_URL: z.string().url().default("http://localhost:3001")
});

export const env = envSchema.parse(process.env);
```

Create `apps/api/src/server.ts`:

```ts
import app from "./app";
import { env } from "./env";

Bun.serve({
  port: env.PORT,
  fetch: app.fetch
});

console.log(`История Авто API listening on ${env.PORT}`);
```

- [ ] **Step 4: Add Drizzle schema and client**

Create `apps/api/src/db/schema.ts`:

```ts
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

export const pointLedgerEntries = pgTable(
  "point_ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id),
    reportUploadId: uuid("report_upload_id").references(() => reportUploads.id),
    delta: integer("delta").notNull(),
    reason: pointLedgerReason("reason").notNull(),
    note: text("note"),
    ...timestamps
  },
  (table) => ({
    pointUserIdx: index("point_ledger_entries_user_idx").on(table.userId)
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
```

Create `apps/api/src/db/client.ts`:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

const client = postgres(env.DATABASE_URL, {
  max: 10
});

export const db = drizzle(client, { schema });
export type Database = typeof db;
```

Create `apps/api/drizzle.config.ts`:

```ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/istoriya_avto"
  },
  strict: true,
  verbose: true
});
```

- [ ] **Step 5: Run tests, typecheck, and migration generation**

Run:

```bash
bun run --cwd apps/api test
bun run --cwd apps/api typecheck
bun run --cwd apps/api db:generate
```

Expected:

```text
pass
```

The `db:generate` command should create SQL migration files under `apps/api/drizzle`.

- [ ] **Step 6: Commit environment and schema**

Run:

```bash
git add apps/api/src apps/api/drizzle.config.ts apps/api/drizzle
git commit -m "feat: add API environment and core database schema"
```

Expected:

```text
[master ...] feat: add API environment and core database schema
```

---

### Task 5: Add Points Policy Unit

**Files:**
- Create: `apps/api/src/modules/points/points-policy.test.ts`
- Create: `apps/api/src/modules/points/points-policy.ts`

- [ ] **Step 1: Write failing points policy tests**

Create `apps/api/src/modules/points/points-policy.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { evaluateReportForPoints } from "./points-policy";

const NOW = new Date("2026-05-12T12:00:00.000Z");

describe("evaluateReportForPoints", () => {
  it("grants one point for a fresh valid report", () => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("2026-05-01T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount: 3,
        isFirstReportForVin: true,
        isNewerThanCurrentVinReport: true,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "grant",
      points: 1,
      reason: "fresh_valid_report"
    });
  });

  it("denies a second point for the same VIN for the same user forever", () => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("2026-05-01T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount: 5,
        isFirstReportForVin: false,
        isNewerThanCurrentVinReport: true,
        userHasEverReceivedPointForVin: true,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "deny",
      points: 0,
      reason: "user_already_rewarded_for_vin"
    });
  });

  it("grants for a 91-180 day report only when it is the first report for the VIN", () => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("2026-02-01T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount: 3,
        isFirstReportForVin: true,
        isNewerThanCurrentVinReport: false,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "grant",
      points: 1,
      reason: "first_report_for_vin_with_aging_data"
    });
  });

  it("denies stale reports older than 180 days", () => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("2025-09-01T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount: 6,
        isFirstReportForVin: true,
        isNewerThanCurrentVinReport: false,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "deny",
      points: 0,
      reason: "report_older_than_180_days"
    });
  });

  it("requires manual review when the same report fingerprint already reached the automatic grant limit", () => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("2026-05-01T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount: 4,
        isFirstReportForVin: false,
        isNewerThanCurrentVinReport: true,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 3
      })
    ).toEqual({
      decision: "manual_review",
      points: 0,
      reason: "fingerprint_auto_grant_limit_reached"
    });
  });

  it("requires manual review when parsing quality is too weak", () => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("2026-05-01T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount: 1,
        isFirstReportForVin: true,
        isNewerThanCurrentVinReport: true,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "manual_review",
      points: 0,
      reason: "insufficient_parsed_data"
    });
  });
});
```

- [ ] **Step 2: Run the points policy test and verify it fails**

Run:

```bash
bun run --cwd apps/api test src/modules/points/points-policy.test.ts
```

Expected:

```text
error: Cannot find module './points-policy'
```

- [ ] **Step 3: Implement the points policy**

Create `apps/api/src/modules/points/points-policy.ts`:

```ts
export type PointsDecision = "grant" | "deny" | "manual_review";

export type PointsDecisionReason =
  | "fresh_valid_report"
  | "first_report_for_vin_with_aging_data"
  | "newer_report_for_known_vin"
  | "user_already_rewarded_for_vin"
  | "user_already_rewarded_for_fingerprint"
  | "fingerprint_auto_grant_limit_reached"
  | "report_older_than_180_days"
  | "aging_report_not_first_for_vin"
  | "missing_vin_or_generated_date"
  | "insufficient_parsed_data"
  | "not_newer_than_current_report";

export type EvaluateReportForPointsInput = {
  now: Date;
  reportGeneratedAt: Date | null;
  hasVin: boolean;
  parsedKeyBlockCount: number;
  isFirstReportForVin: boolean;
  isNewerThanCurrentVinReport: boolean;
  userHasEverReceivedPointForVin: boolean;
  userHasEverReceivedPointForFingerprint: boolean;
  automaticFingerprintGrantCount: number;
};

export type PointsPolicyResult = {
  decision: PointsDecision;
  points: 0 | 1;
  reason: PointsDecisionReason;
};

const FRESH_REPORT_MAX_DAYS = 90;
const AGING_REPORT_MAX_DAYS = 180;
const MINIMUM_KEY_BLOCKS_FOR_AUTO_GRANT = 3;
const MAX_AUTOMATIC_GRANTS_PER_FINGERPRINT = 3;

export function evaluateReportForPoints(input: EvaluateReportForPointsInput): PointsPolicyResult {
  if (!input.hasVin || input.reportGeneratedAt === null) {
    return deny("missing_vin_or_generated_date");
  }

  if (input.parsedKeyBlockCount < MINIMUM_KEY_BLOCKS_FOR_AUTO_GRANT) {
    return manualReview("insufficient_parsed_data");
  }

  if (input.userHasEverReceivedPointForVin) {
    return deny("user_already_rewarded_for_vin");
  }

  if (input.userHasEverReceivedPointForFingerprint) {
    return deny("user_already_rewarded_for_fingerprint");
  }

  if (input.automaticFingerprintGrantCount >= MAX_AUTOMATIC_GRANTS_PER_FINGERPRINT) {
    return manualReview("fingerprint_auto_grant_limit_reached");
  }

  const reportAgeDays = getAgeInDays(input.reportGeneratedAt, input.now);

  if (reportAgeDays > AGING_REPORT_MAX_DAYS) {
    return deny("report_older_than_180_days");
  }

  if (reportAgeDays > FRESH_REPORT_MAX_DAYS) {
    if (input.isFirstReportForVin) {
      return grant("first_report_for_vin_with_aging_data");
    }

    return deny("aging_report_not_first_for_vin");
  }

  if (input.isFirstReportForVin) {
    return grant("fresh_valid_report");
  }

  if (input.isNewerThanCurrentVinReport) {
    return grant("newer_report_for_known_vin");
  }

  return deny("not_newer_than_current_report");
}

function grant(reason: PointsDecisionReason): PointsPolicyResult {
  return { decision: "grant", points: 1, reason };
}

function deny(reason: PointsDecisionReason): PointsPolicyResult {
  return { decision: "deny", points: 0, reason };
}

function manualReview(reason: PointsDecisionReason): PointsPolicyResult {
  return { decision: "manual_review", points: 0, reason };
}

function getAgeInDays(from: Date, to: Date): number {
  const milliseconds = to.getTime() - from.getTime();
  return Math.floor(milliseconds / 86_400_000);
}
```

- [ ] **Step 4: Run API tests and typecheck**

Run:

```bash
bun run --cwd apps/api test
bun run --cwd apps/api typecheck
```

Expected:

```text
pass
```

- [ ] **Step 5: Commit points policy**

Run:

```bash
git add apps/api/src/modules/points
git commit -m "feat: add report points policy"
```

Expected:

```text
[master ...] feat: add report points policy
```

---

### Task 6: Add Mobile-First React/Vite Web Shell

**Files:**
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/styles.css`

- [ ] **Step 1: Create the Vite entry files**

Create `apps/web/index.html`:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      name="description"
      content="История Авто помогает проверить историю автомобиля по ссылке объявления, VIN или госномеру."
    />
    <title>История Авто</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `apps/web/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  }
});
```

- [ ] **Step 2: Add the API client**

Create `apps/web/src/lib/api.ts`:

```ts
export type SearchDetectionResponse = {
  query: {
    kind: "vin" | "plate" | "listing_url" | "unsupported_url" | "unknown";
    normalized: string;
    original: string;
    host?: string;
  };
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export async function detectSearchQuery(query: string): Promise<SearchDetectionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/search/detect`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    throw new Error("Не удалось проверить запрос.");
  }

  return response.json() as Promise<SearchDetectionResponse>;
}
```

- [ ] **Step 3: Add the mobile-first app shell**

Create `apps/web/src/App.tsx`:

```tsx
import { ArrowRight, BadgeCheck, Bell, FileUp, Search } from "lucide-react";
import { FormEvent, useState } from "react";
import { detectSearchQuery, SearchDetectionResponse } from "./lib/api";

type SubmitState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: SearchDetectionResponse }
  | { status: "error"; message: string };

export function App() {
  const [query, setQuery] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (query.trim().length === 0) {
      setSubmitState({ status: "error", message: "Вставьте ссылку, VIN или госномер." });
      return;
    }

    setSubmitState({ status: "loading" });

    try {
      const result = await detectSearchQuery(query);
      setSubmitState({ status: "success", result });
    } catch {
      setSubmitState({ status: "error", message: "Сервис временно недоступен." });
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar" aria-label="Верхняя панель">
        <div className="brand">История Авто</div>
        <div className="account-pill">
          <span>0 отчетов</span>
          <span>0 баллов</span>
        </div>
      </header>

      <section className="search-section" aria-labelledby="search-title">
        <p className="eyebrow">Проверка истории автомобиля</p>
        <h1 id="search-title">Найдите отчет по объявлению, VIN или госномеру</h1>
        <p className="lead">
          Покажем только данные для распознавания автомобиля. Полный отчет открывается за балл или по подписке.
        </p>

        <form className="search-form" onSubmit={handleSubmit}>
          <label htmlFor="query">Ссылка объявления, VIN или госномер</label>
          <div className="input-row">
            <Search aria-hidden="true" size={20} />
            <input
              id="query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="https://www.avito.ru/... или XW8... или А123ВС777"
              autoComplete="off"
            />
            <button type="submit" aria-label="Найти отчет">
              <ArrowRight aria-hidden="true" size={20} />
            </button>
          </div>
        </form>

        <StatusPanel state={submitState} />
      </section>

      <section className="quick-actions" aria-label="Основные действия">
        <article>
          <FileUp aria-hidden="true" size={22} />
          <div>
            <h2>Загрузить отчет</h2>
            <p>PDF или публичная ссылка на отчет. Полезный отчет дает 1 балл.</p>
          </div>
        </article>
        <article>
          <BadgeCheck aria-hidden="true" size={22} />
          <div>
            <h2>Открытые отчеты</h2>
            <p>Купленный отчет по VIN остается доступен навсегда.</p>
          </div>
        </article>
        <article>
          <Bell aria-hidden="true" size={22} />
          <div>
            <h2>Уведомления</h2>
            <p>Telegram и Max сообщат, когда появятся новые данные.</p>
          </div>
        </article>
      </section>
    </main>
  );
}

function StatusPanel({ state }: { state: SubmitState }) {
  if (state.status === "idle") {
    return null;
  }

  if (state.status === "loading") {
    return <div className="status-panel">Проверяем запрос...</div>;
  }

  if (state.status === "error") {
    return <div className="status-panel error">{state.message}</div>;
  }

  return (
    <div className="status-panel">
      <strong>Тип запроса: {state.result.query.kind}</strong>
      <span>{state.result.query.normalized}</span>
    </div>
  );
}

export default App;
```

Create `apps/web/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `apps/web/src/styles.css`:

```css
:root {
  color: #17201c;
  background: #f6f4ef;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.5;
  font-weight: 400;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}

button,
input {
  font: inherit;
}

.app-shell {
  min-height: 100vh;
  padding: 16px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  max-width: 1080px;
  margin: 0 auto 32px;
}

.brand {
  font-size: 18px;
  font-weight: 800;
}

.account-pill {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  color: #fff;
  font-size: 13px;
}

.account-pill span {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: #2c463d;
  padding: 5px 10px;
}

.search-section {
  max-width: 760px;
  margin: 0 auto;
}

.eyebrow {
  margin: 0 0 8px;
  color: #7b4a30;
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  max-width: 720px;
  font-size: 36px;
  line-height: 1.05;
  letter-spacing: 0;
}

.lead {
  margin: 16px 0 22px;
  max-width: 660px;
  color: #4d5b55;
  font-size: 16px;
}

.search-form {
  display: grid;
  gap: 8px;
}

.search-form label {
  color: #33433d;
  font-size: 14px;
  font-weight: 700;
}

.input-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 44px;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  border: 1px solid #c7d0c7;
  border-radius: 8px;
  background: #fff;
  padding: 6px 6px 6px 14px;
  box-shadow: 0 12px 28px rgb(34 48 42 / 8%);
}

.input-row svg {
  color: #52645d;
}

.input-row input {
  width: 100%;
  border: 0;
  outline: 0;
  color: #17201c;
}

.input-row input::placeholder {
  color: #87938e;
}

.input-row button {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  color: #fff;
  background: #0f6b4f;
  cursor: pointer;
}

.status-panel {
  margin-top: 14px;
  display: grid;
  gap: 4px;
  border: 1px solid #c7d0c7;
  border-radius: 8px;
  background: #fff;
  padding: 14px;
}

.status-panel.error {
  border-color: #d9a4a0;
  color: #8f2018;
}

.quick-actions {
  max-width: 760px;
  margin: 28px auto 0;
  display: grid;
  gap: 10px;
}

.quick-actions article {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  border: 1px solid #d8ddd6;
  border-radius: 8px;
  background: rgb(255 255 255 / 72%);
  padding: 14px;
}

.quick-actions svg {
  color: #7b4a30;
}

.quick-actions h2 {
  margin: 0 0 3px;
  font-size: 16px;
}

.quick-actions p {
  margin: 0;
  color: #586760;
  font-size: 14px;
}

@media (min-width: 760px) {
  .app-shell {
    padding: 24px;
  }

  .topbar {
    margin-bottom: 56px;
  }

  h1 {
    font-size: 52px;
  }

  .lead {
    font-size: 18px;
  }
}
```

- [ ] **Step 4: Run web typecheck and build**

Run:

```bash
bun run --cwd apps/web typecheck
bun run --cwd apps/web build
```

Expected:

```text
vite
✓ built
```

- [ ] **Step 5: Commit the web shell**

Run:

```bash
git add apps/web
git commit -m "feat: add mobile-first web shell"
```

Expected:

```text
[master ...] feat: add mobile-first web shell
```

---

### Task 7: Verify the Whole Foundation

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Run all tests and typechecks**

Run:

```bash
bun run test
bun run typecheck
bun run --cwd apps/web build
```

Expected:

```text
pass
✓ built
```

- [ ] **Step 2: Run the API locally**

Run:

```bash
bun run dev:api
```

Expected:

```text
История Авто API listening on 3001
```

In a second terminal, run:

```bash
curl http://localhost:3001/health
```

Expected:

```json
{"status":"ok","service":"istoriya-avto-api"}
```

- [ ] **Step 3: Run the web app locally**

Run:

```bash
bun run dev:web
```

Expected:

```text
Local: http://localhost:5173/
```

Open `http://localhost:5173/`, enter `А123ВС777`, and submit. Expected UI result: a status panel showing `Тип запроса: plate` and `А123ВС777`.

- [ ] **Step 4: Commit final verification notes if scripts changed**

If `package.json` scripts changed during verification, run:

```bash
git add package.json
git commit -m "chore: finalize foundation scripts"
```

Expected when scripts changed:

```text
[master ...] chore: finalize foundation scripts
```

Expected when scripts did not change:

```text
nothing to commit, working tree clean
```

---

## Completion Checklist

The foundation slice is complete when all of these are true:

- `bun install` succeeds.
- `bun run test` succeeds.
- `bun run typecheck` succeeds.
- `bun run --cwd apps/web build` succeeds.
- `bun run --cwd apps/api db:generate` creates Drizzle SQL migrations.
- `GET /health` returns the expected JSON.
- `POST /api/search/detect` detects VIN, госномер, supported listing URL, unsupported URL, and unknown input.
- The web shell renders on mobile width without layout overlap.
- The web shell can call the API search detection endpoint.
- All changes are committed.
