# Auth, Guest Session, Points Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Milestone 4 so guests can start the product flow for 7 days, sign in through Telegram, Max, or phone, carry their guest context into an account, receive and spend points through an idempotent ledger, and unlock VIN reports permanently through the real access service.

**Architecture:** Keep auth/session identity separate from report data. Add a request identity middleware that resolves either a claimed user or a 7-day guest session, add account/auth services for provider identities, move all point mutations into a ledger service with idempotency keys, and replace the Milestone 3 locked access stub with an access service that grants already-opened VINs first, spends active subscription limits before points, then records permanent `vehicle_accesses`. Upload ingestion continues to parse and aggregate reports, but point grants become real ledger entries only when policy grants them.

**Tech Stack:** Bun, TypeScript, Hono, Drizzle ORM, PostgreSQL, Zod, React, Vite, `bun:test`, existing shared query detection and report read models.

---

## Scope Decisions

- Guest sessions live for exactly 7 days from creation. The server owns the guest token and stores only `tokenHash` in PostgreSQL. The browser receives an `ia_guest` HttpOnly cookie.
- The MVP accepts development-friendly auth assertions for `phone`, `telegram`, and `max` through API routes. Real Telegram/Max bot OAuth/deep-link verification and SMS OTP delivery are integration adapters for later milestones; Milestone 4 defines provider identity uniqueness, account creation, login, and linking boundaries.
- Provider identities are unique by `(provider, providerUserId)`. If an identity already belongs to another user, linking fails; there is no automatic account merge.
- Phone identities use a normalized E.164-like provider id, for example `+79001234567`. Telegram and Max use stable provider account ids. Do not store these identity values in vehicle report read models or user-facing report JSON.
- Guest context transfer covers temporary point grants, report uploads, selected unlock VIN, and search context. It does not merge two user accounts.
- Points are never mutated directly by upload, auth, or access routes. Only `PointsLedgerService` may insert ledger entries and update `users.pointsBalance`.
- Ledger entries are idempotent by a required `idempotencyKey`. Retrying a grant/spend/adjustment with the same key returns the existing entry and does not double-update balance.
- A user can receive an automatic report point for a VIN only once forever. A user can receive an automatic report point for a source report fingerprint only once forever. A `report_fingerprint` can automatically grant at most 3 users; after that the upload remains accepted only if otherwise parsed, but automatic points go to manual review or no-grant per existing policy path.
- Access service ordering is strict: existing `vehicle_accesses` first, then active subscription `remainingReports`, then points balance. One subscription limit or one point opens the consolidated VIN report forever for that user, including future report updates.
- Guests cannot view a full report. If a guest tries to unlock, the API returns `auth_required` and preserves the unlock intent in guest context.
- Full report route must never call the report repository unless access is granted. This preserves the Milestone 3 lock boundary.
- Frontend status shows auth state, tariff name, remaining new reports, points, and locked/unlocked states. No full report data is rendered unless API access succeeds.
- Do not implement OCR, Drom parser, Auto.ru parser, billing provider integration, real Telegram/Max bot callbacks, or SMS delivery.
- Do not change the approved product logic without discussion.
- Do not store personal data about people in vehicle report read models.
- Do not show third-party service names as sources of specific facts.

## Target File Structure

```text
apps/api/src
├── app.ts
├── db/schema.ts
└── modules
    ├── access
    │   ├── drizzle-report-access-repository.ts
    │   ├── report-access-repository.ts
    │   ├── report-access-service.test.ts
    │   └── report-access-service.ts
    ├── auth
    │   ├── account-service.test.ts
    │   ├── account-service.ts
    │   ├── auth-routes.test.ts
    │   ├── auth-routes.ts
    │   ├── drizzle-account-repository.ts
    │   ├── account-repository.ts
    │   ├── identity.ts
    │   ├── identity.test.ts
    │   ├── user-session-service.test.ts
    │   └── user-session-service.ts
    ├── context
    │   ├── request-context.test.ts
    │   ├── request-context.ts
    │   ├── routes.test.ts
    │   └── routes.ts
    ├── guest
    │   ├── drizzle-guest-session-repository.ts
    │   ├── guest-session-repository.ts
    │   ├── guest-session-service.test.ts
    │   └── guest-session-service.ts
    ├── points
    │   ├── drizzle-points-ledger-repository.ts
    │   ├── points-ledger-repository.ts
    │   ├── points-ledger-service.test.ts
    │   ├── points-ledger-service.ts
    │   ├── points-policy.test.ts
    │   └── points-policy.ts
    ├── uploads
    │   ├── drizzle-report-upload-repository.ts
    │   ├── report-upload-repository.ts
    │   ├── report-upload-service.test.ts
    │   └── report-upload-service.ts
    └── vehicles
        ├── routes.test.ts
        └── routes.ts

apps/web/src
├── App.tsx
├── lib/api.ts
└── styles.css
```

## Data Model Changes

Extend existing tables instead of replacing them:

```ts
export const guestEventKind = pgEnum("guest_event_kind", [
  "search_context",
  "selected_unlock_vin"
]);

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
    pointUserFingerprintGrantUnique: uniqueIndex("point_ledger_entries_user_fingerprint_grant_unique")
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
    transferredLedgerEntryId: uuid("transferred_ledger_entry_id").references(() => pointLedgerEntries.id),
    ...timestamps
  },
  (table) => ({
    guestPointGrantUploadUnique: uniqueIndex("guest_point_grants_upload_unique").on(
      table.guestSessionId,
      table.reportUploadId
    )
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
```

Update existing rows/columns:

- Add `idempotencyKey` to `point_ledger_entries`; tests and migration should set it for new writes only. If local dev data exists, generated SQL may need a two-phase default/backfill review before applying outside dev.
- Add `reportFingerprintId` to `point_ledger_entries` so one-user/one-fingerprint grant checks do not depend on parsing JSON or fragile upload joins.
- Add `user_sessions` for account login persistence. Store only token hashes; browser gets an `ia_user` HttpOnly cookie.
- Keep `auth_identities.displayName` for messenger UI labels only. Do not include it in report/search responses.
- Keep `users.pointsBalance` as a cached balance maintained only by ledger service.
- Keep `subscriptions.remainingReports` as the current-period counter. Billing creation remains outside Milestone 4, but tests may seed active subscriptions directly.
- Keep `report_fingerprints.automaticGrantCount`; update it only when an automatic grant is committed.

## Public API Contracts

### Current Context

```http
GET /api/context
```

Guest response:

```json
{
  "session": { "kind": "guest", "expiresAt": "2026-05-21T10:00:00.000Z" },
  "account": null,
  "entitlements": {
    "plan": null,
    "remainingReports": 0,
    "points": 0
  }
}
```

User response:

```json
{
  "session": { "kind": "user" },
  "account": {
    "id": "user-1",
    "primaryContactProvider": "telegram",
    "identities": ["telegram"]
  },
  "entitlements": {
    "plan": { "code": "pro", "name": "Pro" },
    "remainingReports": 12,
    "points": 3
  }
}
```

### Auth Assertion MVP

```http
POST /api/auth/login
content-type: application/json

{
  "provider": "telegram",
  "providerUserId": "tg-123",
  "displayName": "Kubati"
}
```

Success:

```json
{
  "account": {
    "id": "user-1",
    "primaryContactProvider": "telegram",
    "identities": ["telegram"]
  },
  "transferredGuestContext": {
    "pointGrants": 1,
    "reportUploads": 1,
    "selectedUnlockVin": "XTA210990Y2765499"
  }
}
```

```http
POST /api/auth/link
content-type: application/json

{
  "provider": "phone",
  "providerUserId": "+79001234567"
}
```

If another user owns the identity:

```json
{
  "error": {
    "code": "identity_already_linked",
    "message": "Этот способ входа уже привязан к другому аккаунту."
  }
}
```

### Unlock Intent And Commit

```http
POST /api/vehicles/XTA210990Y2765499/unlock-intent
```

Guest response:

```json
{
  "unlock": {
    "status": "auth_required",
    "vinMasked": "XTA2109********99",
    "message": "Войдите, чтобы закрепить доступ к отчету.",
    "options": ["telegram", "max", "phone"],
    "warning": "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
  }
}
```

User with subscription limit:

```json
{
  "unlock": {
    "status": "ready",
    "vinMasked": "XTA2109********99",
    "spendOrder": "subscription",
    "willSpendSubscriptionReport": true,
    "willSpendPoints": false,
    "pointsBalanceAfter": 3,
    "remainingReportsAfter": 11,
    "warning": "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
  }
}
```

User with no funds:

```json
{
  "unlock": {
    "status": "payment_required",
    "vinMasked": "XTA2109********99",
    "options": ["upload_report", "choose_plan"],
    "willSpendPoints": false,
    "message": "Загрузите отчет или выберите тариф, чтобы открыть полный отчет."
  }
}
```

For preview candidates where the frontend has `vehicleId` but must not receive the full VIN, use the same response shape through vehicle-id endpoints:

```http
POST /api/vehicles/by-id/vehicle-1/unlock-intent
POST /api/vehicles/by-id/vehicle-1/unlock
```

The response may include `vehicleId` and `vinMasked`, but not the full VIN. `GET /api/vehicles/:vin/report` remains the only Milestone 4 full-report read route.

```http
POST /api/vehicles/XTA210990Y2765499/unlock
content-type: application/json

{ "idempotencyKey": "unlock:user-1:XTA210990Y2765499" }
```

Success:

```json
{
  "access": {
    "status": "granted",
    "method": "subscription_limit",
    "vehicleId": "vehicle-1",
    "vin": "XTA210990Y2765499"
  },
  "entitlements": {
    "plan": { "code": "pro", "name": "Pro" },
    "remainingReports": 11,
    "points": 3
  }
}
```

## Task Decomposition And Ownership

Milestone 4 should be implemented in small subagent-driven batches. Each worker is not alone in the codebase; they must not revert edits made by other workers and must keep changes inside their declared ownership scope.

### Task 1: Schema Hardening For Ledger And Guest Context

**Ownership:** `apps/api/src/db/schema.ts`, generated Drizzle migration only.

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Generated: `apps/api/drizzle/*`

- [ ] **Step 1: Write the schema test target as a Drizzle generation expectation**

Run this before editing to capture current no-op state:

```bash
bun run --cwd apps/api db:generate
```

Expected now: no new migration if schema and migrations are in sync.

- [ ] **Step 2: Add schema definitions**

Modify `apps/api/src/db/schema.ts` with the `guestEventKind`, `userSessions`, `guestPointGrants`, `guestEvents`, `pointLedgerEntries.idempotencyKey`, and `pointLedgerEntries.reportFingerprintId` definitions from the Data Model Changes section.

- [ ] **Step 3: Generate and inspect migration**

Run:

```bash
bun run --cwd apps/api db:generate
```

Expected: one new migration adding `guest_event_kind`, `user_sessions`, `guest_point_grants`, `guest_events`, `point_ledger_entries.idempotency_key`, `point_ledger_entries.report_fingerprint_id`, and the new unique/index definitions. It must not drop existing tables or alter report read model tables unrelated to Milestone 4.

- [ ] **Step 4: Typecheck backend schema**

Run:

```bash
bun run --cwd apps/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle
git commit -m "feat: harden ledger and guest context schema"
```

### Task 2: Guest Session Service With 7-Day Cookie Session

**Ownership:** `apps/api/src/modules/guest/*`, `apps/api/src/modules/context/request-context.ts`, route wiring in `apps/api/src/app.ts`.

**Files:**
- Create: `apps/api/src/modules/guest/guest-session-service.ts`
- Create: `apps/api/src/modules/guest/guest-session-service.test.ts`
- Create: `apps/api/src/modules/guest/guest-session-repository.ts`
- Create: `apps/api/src/modules/guest/drizzle-guest-session-repository.ts`
- Create: `apps/api/src/modules/context/request-context.ts`
- Create: `apps/api/src/modules/context/request-context.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write failing guest service tests**

Create `apps/api/src/modules/guest/guest-session-service.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { GuestSessionService } from "./guest-session-service";
import type { GuestSessionRepository, StoredGuestSession } from "./guest-session-repository";

const NOW = new Date("2026-05-14T10:00:00.000Z");

describe("GuestSessionService", () => {
  it("creates a 7-day guest session and stores only token hash", async () => {
    const repository = new FakeGuestSessionRepository();
    const service = createService(repository);

    const session = await service.createGuestSession();

    expect(session.token).toHaveLength(64);
    expect(session.expiresAt.toISOString()).toBe("2026-05-21T10:00:00.000Z");
    expect(repository.created[0]?.tokenHash).not.toBe(session.token);
    expect(repository.created[0]?.expiresAt.toISOString()).toBe("2026-05-21T10:00:00.000Z");
  });

  it("resolves an unexpired guest token", async () => {
    const repository = new FakeGuestSessionRepository();
    const service = createService(repository);
    const session = await service.createGuestSession();

    await expect(service.resolveGuestSession(session.token)).resolves.toMatchObject({
      id: "guest-1",
      claimedByUserId: null
    });
  });

  it("rejects expired and claimed sessions", async () => {
    const repository = new FakeGuestSessionRepository();
    const service = createService(repository);
    const session = await service.createGuestSession();
    repository.rows[0] = {
      ...repository.rows[0]!,
      expiresAt: new Date("2026-05-14T09:59:59.000Z")
    };

    await expect(service.resolveGuestSession(session.token)).resolves.toBeNull();

    repository.rows[0] = {
      ...repository.rows[0]!,
      expiresAt: new Date("2026-05-21T10:00:00.000Z"),
      claimedByUserId: "user-1"
    };

    await expect(service.resolveGuestSession(session.token)).resolves.toBeNull();
  });
});

function createService(repository: GuestSessionRepository): GuestSessionService {
  return new GuestSessionService({
    repository,
    now: () => new Date(NOW),
    tokenBytes: () => new Uint8Array(32).fill(7)
  });
}

class FakeGuestSessionRepository implements GuestSessionRepository {
  rows: StoredGuestSession[] = [];
  created: Array<{ tokenHash: string; expiresAt: Date }> = [];

  async create(input: { tokenHash: string; expiresAt: Date }): Promise<StoredGuestSession> {
    this.created.push(input);
    const row = {
      id: `guest-${this.rows.length + 1}`,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      claimedByUserId: null
    };
    this.rows.push(row);
    return row;
  }

  async findByTokenHash(tokenHash: string): Promise<StoredGuestSession | null> {
    return this.rows.find((row) => row.tokenHash === tokenHash) ?? null;
  }
}
```

- [ ] **Step 2: Implement repository interface and service**

Create `guest-session-repository.ts`:

```ts
export type StoredGuestSession = {
  id: string;
  tokenHash: string;
  expiresAt: Date;
  claimedByUserId: string | null;
};

export interface GuestSessionRepository {
  create(input: { tokenHash: string; expiresAt: Date }): Promise<StoredGuestSession>;
  findByTokenHash(tokenHash: string): Promise<StoredGuestSession | null>;
}
```

Create `guest-session-service.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";
import type { GuestSessionRepository, StoredGuestSession } from "./guest-session-repository";

export type CreatedGuestSession = {
  token: string;
  expiresAt: Date;
  session: StoredGuestSession;
};

export class GuestSessionService {
  constructor(
    private readonly options: {
      repository: GuestSessionRepository;
      now?: () => Date;
      tokenBytes?: () => Uint8Array;
    }
  ) {}

  async createGuestSession(): Promise<CreatedGuestSession> {
    const now = this.now();
    const token = Buffer.from(this.tokenBytes()).toString("hex");
    const expiresAt = addDays(now, 7);
    const session = await this.options.repository.create({
      tokenHash: hashToken(token),
      expiresAt
    });

    return { token, expiresAt, session };
  }

  async resolveGuestSession(token: string | null): Promise<StoredGuestSession | null> {
    if (token === null || token.length < 32) return null;
    const session = await this.options.repository.findByTokenHash(hashToken(token));
    if (session === null) return null;
    if (session.claimedByUserId !== null) return null;
    if (session.expiresAt.getTime() <= this.now().getTime()) return null;
    return session;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private tokenBytes(): Uint8Array {
    return this.options.tokenBytes?.() ?? randomBytes(32);
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
```

- [ ] **Step 3: Implement Drizzle guest repository**

Create `drizzle-guest-session-repository.ts` with `insert(guestSessions)` and `select().where(eq(guestSessions.tokenHash, tokenHash)).limit(1)`.

- [ ] **Step 4: Add request context middleware**

Create `apps/api/src/modules/context/request-context.ts`:

```ts
import { getCookie, setCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import type { GuestSessionService } from "../guest/guest-session-service";

export type UserSessionResolver = {
  resolveUserSession(token: string | null): Promise<{ userId: string } | null>;
};

export type RequestIdentity =
  | { kind: "guest"; guestSessionId: string; expiresAt: Date }
  | { kind: "user"; userId: string };

export const REQUEST_IDENTITY_KEY = "requestIdentity";
export const GUEST_COOKIE_NAME = "ia_guest";
export const USER_COOKIE_NAME = "ia_user";

export function createRequestContextMiddleware(options: {
  guestSessionService: GuestSessionService;
  userSessionResolver?: UserSessionResolver;
}): MiddlewareHandler {
  return async (context, next) => {
    const userToken = getCookie(context, USER_COOKIE_NAME) ?? null;
    const userSession = await options.userSessionResolver?.resolveUserSession(userToken);
    if (userSession !== undefined && userSession !== null) {
      context.set(REQUEST_IDENTITY_KEY, { kind: "user", userId: userSession.userId });
      await next();
      return;
    }

    const guestToken = getCookie(context, GUEST_COOKIE_NAME) ?? null;
    const existing = await options.guestSessionService.resolveGuestSession(guestToken);

    if (existing === null) {
      const created = await options.guestSessionService.createGuestSession();
      setGuestCookie(context, created.token, created.expiresAt);
      context.set(REQUEST_IDENTITY_KEY, {
        kind: "guest",
        guestSessionId: created.session.id,
        expiresAt: created.expiresAt
      });
      await next();
      return;
    }

    context.set(REQUEST_IDENTITY_KEY, {
      kind: "guest",
      guestSessionId: existing.id,
      expiresAt: existing.expiresAt
    });
    await next();
  };
}

export function getRequestIdentity(context: Context): RequestIdentity {
  const identity = context.get(REQUEST_IDENTITY_KEY);
  if (identity === undefined) throw new Error("request_identity_missing");
  return identity as RequestIdentity;
}

function setGuestCookie(context: Context, token: string, expiresAt: Date): void {
  setCookie(context, GUEST_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    expires: expiresAt
  });
}
```

- [ ] **Step 5: Run guest tests**

Run:

```bash
bun test apps/api/src/modules/guest/guest-session-service.test.ts apps/api/src/modules/context/request-context.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/guest apps/api/src/modules/context/request-context.ts apps/api/src/modules/context/request-context.test.ts apps/api/src/app.ts
git commit -m "feat: add guest request sessions"
```

### Task 3: Account Auth Through Phone, Telegram, And Max Identities

**Ownership:** `apps/api/src/modules/auth/*`, auth route mount in `apps/api/src/app.ts`.

**Files:**
- Create: `apps/api/src/modules/auth/identity.ts`
- Create: `apps/api/src/modules/auth/identity.test.ts`
- Create: `apps/api/src/modules/auth/account-repository.ts`
- Create: `apps/api/src/modules/auth/drizzle-account-repository.ts`
- Create: `apps/api/src/modules/auth/account-service.ts`
- Create: `apps/api/src/modules/auth/account-service.test.ts`
- Create: `apps/api/src/modules/auth/user-session-service.ts`
- Create: `apps/api/src/modules/auth/user-session-service.test.ts`
- Create: `apps/api/src/modules/auth/auth-routes.ts`
- Create: `apps/api/src/modules/auth/auth-routes.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write identity normalization tests**

Create tests that assert:

```ts
expect(normalizeIdentity({ provider: "phone", providerUserId: "8 (900) 123-45-67" })).toEqual({
  provider: "phone",
  providerUserId: "+79001234567"
});
expect(normalizeIdentity({ provider: "telegram", providerUserId: " 12345 " })).toEqual({
  provider: "telegram",
  providerUserId: "12345"
});
expect(() => normalizeIdentity({ provider: "max", providerUserId: "" })).toThrow("invalid_identity");
```

- [ ] **Step 2: Implement `identity.ts`**

Use:

```ts
export type AuthProvider = "phone" | "telegram" | "max";

export function normalizeIdentity(input: {
  provider: AuthProvider;
  providerUserId: string;
}): { provider: AuthProvider; providerUserId: string } {
  if (input.provider === "phone") {
    const digits = input.providerUserId.replace(/\D/g, "");
    const normalized = digits.length === 11 && digits.startsWith("8")
      ? `+7${digits.slice(1)}`
      : digits.length === 11 && digits.startsWith("7")
        ? `+${digits}`
        : digits.length === 10
          ? `+7${digits}`
          : null;
    if (normalized === null) throw new Error("invalid_identity");
    return { provider: "phone", providerUserId: normalized };
  }

  const providerUserId = input.providerUserId.trim();
  if (providerUserId.length === 0) throw new Error("invalid_identity");
  return { provider: input.provider, providerUserId };
}
```

- [ ] **Step 3: Write account service tests**

Cover:

- Login with a new Telegram identity creates a user and identity.
- Login with an existing Telegram identity returns the same user.
- Linking a phone to the current user succeeds when free.
- Linking a Max identity owned by another user fails with `identity_already_linked`.
- Automatic merge of two users never occurs.
- Primary contact provider defaults to the first identity provider.
- Login creates a hashed `user_sessions` row and returns a raw session token for the HttpOnly `ia_user` cookie.
- `UserSessionService.resolveUserSession` rejects expired and revoked sessions.

- [ ] **Step 4: Implement account repository and service**

The service API should be:

```ts
export class AccountService {
  async loginOrCreate(input: {
    provider: AuthProvider;
    providerUserId: string;
    displayName: string | null;
    guestSessionId: string | null;
  }): Promise<LoginResult & { sessionToken: string; sessionExpiresAt: Date }>;

  async linkIdentity(input: {
    userId: string;
    provider: AuthProvider;
    providerUserId: string;
    displayName: string | null;
  }): Promise<LinkIdentityResult>;
}
```

`LoginResult` includes `userId`, `primaryContactProvider`, `identities`, and a `transferredGuestContext` summary that Task 4 will fill. Until Task 4 lands, return zeros/nulls through an injected `transferGuestContext` callback.

Add `UserSessionService`:

```ts
export class UserSessionService {
  async createUserSession(userId: string): Promise<{ token: string; expiresAt: Date }>;
  async resolveUserSession(token: string | null): Promise<{ userId: string } | null>;
  async revokeUserSession(token: string): Promise<void>;
}
```

Use a 30-day account session expiry, store only `sha256(token)` in `user_sessions`, and share the same token hashing helper shape as guest sessions.

- [ ] **Step 5: Add auth routes**

Routes:

- `POST /api/auth/login`
- `POST /api/auth/link`

Use Zod for payloads:

```ts
const authProviderSchema = z.enum(["phone", "telegram", "max"]);
const authPayloadSchema = z.object({
  provider: authProviderSchema,
  providerUserId: z.string().min(1),
  displayName: z.string().max(120).optional()
});
```

`POST /api/auth/link` must require `getRequestIdentity(context).kind === "user"` or return `401 auth_required`.

`POST /api/auth/login` must set the `ia_user` HttpOnly cookie from `sessionToken` and preserve the `ia_guest` cookie until Task 4 transfer marks it claimed. After Task 4, login may expire `ia_guest` once transfer succeeds.

- [ ] **Step 6: Run auth tests**

Run:

```bash
bun test apps/api/src/modules/auth/identity.test.ts apps/api/src/modules/auth/user-session-service.test.ts apps/api/src/modules/auth/account-service.test.ts apps/api/src/modules/auth/auth-routes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/auth apps/api/src/app.ts
git commit -m "feat: add account identity auth"
```

### Task 4: Guest Context Transfer Into Account

**Ownership:** `apps/api/src/modules/guest/*`, auth service integration, upload repository ownership fields.

**Files:**
- Modify: `apps/api/src/modules/guest/guest-session-repository.ts`
- Modify: `apps/api/src/modules/guest/drizzle-guest-session-repository.ts`
- Create: `apps/api/src/modules/guest/guest-context-transfer-service.ts`
- Create: `apps/api/src/modules/guest/guest-context-transfer-service.test.ts`
- Modify: `apps/api/src/modules/auth/account-service.ts`
- Modify: `apps/api/src/modules/auth/account-service.test.ts`

- [ ] **Step 1: Write transfer tests**

Cover:

- Transfers parsed guest uploads to `userId` and keeps `guestSessionId` for audit.
- Converts each untransferred `guest_point_grants` row into a real `point_ledger_entries` grant through `PointsLedgerService`.
- Marks `guest_sessions.claimedByUserId`.
- Copies latest `selected_unlock_vin` into the login response.
- Re-running transfer for the same guest session is idempotent and does not duplicate ledger entries.

- [ ] **Step 2: Implement transfer repository methods**

Required repository methods:

```ts
claimGuestSession(input: { guestSessionId: string; userId: string; claimedAt: Date }): Promise<boolean>;
assignGuestUploadsToUser(input: { guestSessionId: string; userId: string }): Promise<number>;
findUntransferredGuestPointGrants(guestSessionId: string): Promise<GuestPointGrant[]>;
markGuestPointGrantTransferred(input: {
  guestPointGrantId: string;
  userId: string;
  ledgerEntryId: string;
}): Promise<void>;
markGuestEventsTransferred(input: { guestSessionId: string; userId: string }): Promise<void>;
findLatestSelectedUnlockVin(guestSessionId: string): Promise<string | null>;
```

- [ ] **Step 3: Implement transfer service**

Use idempotency keys:

```ts
const key = `guest-transfer:${guestSessionId}:grant:${guestPointGrant.id}`;
```

For transferred uploads, call ledger grant with original `vehicleId`, `reportUploadId`, and `reportFingerprintId`. If the user already received a point for that VIN, upload, or fingerprint, ledger service returns an existing/denied result and the transfer summary must not over-count.

- [ ] **Step 4: Wire AccountService login**

When `loginOrCreate` receives a guest session id, call `GuestContextTransferService.transferToUser(...)` after resolving/creating the user and before returning the login response.

- [ ] **Step 5: Run tests**

Run:

```bash
bun test apps/api/src/modules/guest/guest-context-transfer-service.test.ts apps/api/src/modules/auth/account-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/guest apps/api/src/modules/auth
git commit -m "feat: transfer guest context to accounts"
```

### Task 5: Idempotent Points Ledger Service

**Ownership:** `apps/api/src/modules/points/*`, no route/UI work.

**Files:**
- Create: `apps/api/src/modules/points/points-ledger-repository.ts`
- Create: `apps/api/src/modules/points/drizzle-points-ledger-repository.ts`
- Create: `apps/api/src/modules/points/points-ledger-service.ts`
- Create: `apps/api/src/modules/points/points-ledger-service.test.ts`

- [ ] **Step 1: Write ledger service tests**

Cover these cases:

- `grantReportPoint` inserts `+1 report_grant`, increments `users.pointsBalance`, and increments `report_fingerprints.automaticGrantCount`.
- Retrying the same `idempotencyKey` returns the same ledger entry and does not update balance or fingerprint count.
- Same user/VIN report grant is denied forever even with a different upload.
- Same user/report upload grant is denied forever.
- Same user/report fingerprint grant is denied forever even through a different upload row.
- Fingerprint automatic grant count `3` blocks a fourth automatic grant.
- `spendPointForAccess` inserts `-1 report_access_spend` only when balance is positive.
- `adjustPoints` supports positive and negative admin/fraud corrections with a required note.

- [ ] **Step 2: Define repository interface**

```ts
export interface PointsLedgerRepository {
  findEntryByIdempotencyKey(idempotencyKey: string): Promise<PointLedgerEntry | null>;
  userHasReportGrantForVehicle(input: { userId: string; vehicleId: string }): Promise<boolean>;
  userHasReportGrantForUpload(input: { userId: string; reportUploadId: string }): Promise<boolean>;
  userHasReportGrantForFingerprint(input: {
    userId: string;
    reportFingerprintId: string;
  }): Promise<boolean>;
  getFingerprintGrantCount(reportFingerprintId: string): Promise<number>;
  getUserBalance(userId: string): Promise<number>;
  insertEntryAndApplyBalance(input: InsertLedgerEntryInput): Promise<PointLedgerEntry>;
  incrementFingerprintGrantCount(reportFingerprintId: string): Promise<void>;
}
```

- [ ] **Step 3: Implement service**

Expose:

```ts
grantReportPoint(input: {
  userId: string;
  vehicleId: string;
  reportUploadId: string;
  reportFingerprintId: string;
  idempotencyKey: string;
  note: string | null;
}): Promise<LedgerMutationResult>;

spendPointForAccess(input: {
  userId: string;
  vehicleId: string;
  idempotencyKey: string;
}): Promise<LedgerMutationResult>;

adjustPoints(input: {
  userId: string;
  delta: number;
  reason: "admin_adjustment" | "fraud_reversal";
  idempotencyKey: string;
  note: string;
}): Promise<LedgerMutationResult>;
```

The service returns `{ status: "applied" | "idempotent_replay" | "denied"; entry; balanceAfter; reason }`.

- [ ] **Step 4: Implement Drizzle repository with transactions**

Use the `postgres` client transaction support through Drizzle where available. The mutation must insert the ledger entry and update `users.pointsBalance` atomically. If the current db helper does not expose transactions cleanly, update `apps/api/src/db/client.ts` to export a transaction-capable database type rather than doing multi-step writes outside a transaction.

- [ ] **Step 5: Run ledger tests**

Run:

```bash
bun test apps/api/src/modules/points/points-ledger-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/points apps/api/src/db/client.ts
git commit -m "feat: add idempotent points ledger"
```

### Task 6: Real Point Grants During Report Upload

**Ownership:** `apps/api/src/modules/uploads/*`, integration with `PointsLedgerService`.

**Files:**
- Modify: `apps/api/src/modules/uploads/report-upload-service.ts`
- Modify: `apps/api/src/modules/uploads/report-upload-service.test.ts`
- Modify: `apps/api/src/modules/uploads/report-upload-repository.ts`
- Modify: `apps/api/src/modules/uploads/drizzle-report-upload-repository.ts`
- Modify: `apps/api/src/modules/uploads/routes.ts`
- Modify: `apps/api/src/modules/uploads/routes.test.ts`

- [ ] **Step 1: Update upload service tests first**

Replace the Milestone 3 expectation "does not mutate user balances or point ledger entries" with these cases:

- Authenticated user with `pointsEvaluation.decision === "grant"` receives a real ledger `+1`.
- Guest with grant decision creates a `guest_point_grants` temporary grant and does not create user ledger until login transfer.
- Duplicate user/VIN returns upload success with no second point.
- Duplicate user/fingerprint returns upload success with no second point.
- Fingerprint automatic grant limit prevents automatic point mutation.
- Manual review upload never grants points.

- [ ] **Step 2: Extend upload result contract**

Add:

```ts
pointGrant:
  | { status: "granted"; points: 1; balanceAfter: number }
  | { status: "guest_pending"; points: 1 }
  | { status: "not_granted"; reason: string };
```

The route response should return `pointGrant`, while `pointsPreview` may remain during transition only if tests need it. Prefer one clear field in frontend/API after this task.

- [ ] **Step 3: Inject `PointsLedgerService` and guest grant writer**

`ReportUploadService` should receive:

```ts
pointsLedgerService: PointsLedgerService;
guestPointGrantRepository: GuestPointGrantRepository;
```

When `input.userId !== null`, use idempotency key:

```ts
`report-grant:user:${input.userId}:upload:${upload.id}`
```

When `input.guestSessionId !== null`, create `guest_point_grants` with `points = 1`.

- [ ] **Step 4: Fix route identity**

`POST /api/uploads/report-pdf` must call `getRequestIdentity(context)` and pass either `userId` or `guestSessionId`. Keep rejecting client-supplied `userId` and `guestSessionId`.

- [ ] **Step 5: Run upload tests**

Run:

```bash
bun test apps/api/src/modules/uploads/report-upload-service.test.ts apps/api/src/modules/uploads/routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/uploads
git commit -m "feat: grant report points from uploads"
```

### Task 7: Access Service With Subscription-First Then Points

**Ownership:** `apps/api/src/modules/access/*`, vehicle routes only.

**Files:**
- Modify: `apps/api/src/modules/access/report-access-service.ts`
- Modify: `apps/api/src/modules/access/report-access-service.test.ts`
- Create: `apps/api/src/modules/access/report-access-repository.ts`
- Create: `apps/api/src/modules/access/drizzle-report-access-repository.ts`
- Modify: `apps/api/src/modules/vehicles/routes.ts`
- Modify: `apps/api/src/modules/vehicles/routes.test.ts`

- [ ] **Step 1: Write access service tests**

Cover:

- Existing `vehicle_accesses` grants without spending subscription or points.
- Guest gets `auth_required`.
- User with active subscription and `remainingReports > 0` unlocks through `subscription_limit`; points unchanged.
- User with no subscription limit but points > 0 unlocks through `point`.
- User with neither gets `payment_required`.
- Retrying unlock with the same idempotency key is idempotent.
- One access record opens the VIN forever; future full report reads do not spend again.
- Subscription period must be active at `now`; expired/canceled/payment_failed subscriptions are ignored.
- Unlock by `vehicleId` works for search candidates without returning the full VIN to the frontend.

- [ ] **Step 2: Define repository interface**

```ts
export interface ReportAccessRepository {
  findVehicleByVin(vin: string): Promise<{ id: string; vin: string } | null>;
  findVehicleById(vehicleId: string): Promise<{ id: string; vin: string } | null>;
  findVehicleAccess(input: { userId: string; vehicleId: string }): Promise<VehicleAccess | null>;
  findActiveSubscription(input: { userId: string; now: Date }): Promise<ActiveSubscription | null>;
  decrementSubscriptionReport(input: { subscriptionId: string }): Promise<ActiveSubscription>;
  createVehicleAccess(input: {
    userId: string;
    vehicleId: string;
    accessMethod: "already_opened" | "subscription_limit" | "point";
  }): Promise<VehicleAccess>;
  getEntitlements(userId: string): Promise<UserEntitlements>;
}
```

- [ ] **Step 3: Implement `ReportAccessService`**

Expose:

```ts
previewUnlock(input: {
  vehicle: { kind: "vin"; vin: string } | { kind: "vehicle_id"; vehicleId: string };
  userId: string | null;
  guestSessionId: string | null;
}): Promise<UnlockPreviewDecision>;

unlock(input: {
  vehicle: { kind: "vin"; vin: string } | { kind: "vehicle_id"; vehicleId: string };
  userId: string | null;
  guestSessionId: string | null;
  idempotencyKey: string;
}): Promise<UnlockCommitDecision>;

canViewFullReport(input: {
  vin: string;
  userId: string | null;
  guestSessionId: string | null;
}): Promise<ReportAccessDecision>;
```

`unlock()` ordering:

1. Resolve the vehicle by VIN or vehicle id. If vehicle missing: `not_found`.
2. If user missing: `auth_required`.
3. If `vehicle_accesses` exists: return `already_opened`.
4. If active subscription has remaining reports: decrement subscription, create access with `subscription_limit`.
5. Else if points balance > 0: call `PointsLedgerService.spendPointForAccess`, then create access with `point`.
6. Else return `payment_required`.

- [ ] **Step 4: Update vehicle routes**

`GET /api/vehicles/:vin/report` must pass real request identity into `canViewFullReport`.

`POST /api/vehicles/:vin/unlock-intent` must call `previewUnlock`.

Add:

```http
POST /api/vehicles/:vin/unlock
POST /api/vehicles/by-id/:vehicleId/unlock-intent
POST /api/vehicles/by-id/:vehicleId/unlock
```

with a Zod body requiring `idempotencyKey: string` for the commit endpoints. The by-id routes return `vehicleId` and `vinMasked`, never the full VIN.

- [ ] **Step 5: Run tests**

Run:

```bash
bun test apps/api/src/modules/access/report-access-service.test.ts apps/api/src/modules/vehicles/routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/access apps/api/src/modules/vehicles/routes.ts apps/api/src/modules/vehicles/routes.test.ts
git commit -m "feat: unlock reports through real access service"
```

### Task 8: Context API And Frontend Auth/Balance Status

**Ownership:** `apps/api/src/modules/context/*`, `apps/web/src/*`.

**Files:**
- Create: `apps/api/src/modules/context/routes.ts`
- Create: `apps/api/src/modules/context/routes.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write context route tests**

Cover guest and user responses exactly as in Public API Contracts. User response must include identities by provider name only, not raw phone/telegram/max ids.

- [ ] **Step 2: Implement `GET /api/context`**

Use request identity and repositories to return:

- session kind and guest expiry;
- account summary for users;
- entitlements: active plan code/name or null, remaining reports, points balance.

- [ ] **Step 3: Update frontend API client**

Add:

```ts
export type ContextResponse = {
  session: { kind: "guest"; expiresAt: string } | { kind: "user" };
  account: null | {
    id: string;
    primaryContactProvider: "phone" | "telegram" | "max" | null;
    identities: Array<"phone" | "telegram" | "max">;
  };
  entitlements: {
    plan: null | { code: string; name: string };
    remainingReports: number;
    points: number;
  };
};
```

- [ ] **Step 4: Update UI status**

Add a compact status strip near the topbar:

- Guest: `Гость до 21.05`, `Войти: Telegram / Max / Телефон`.
- User: `Тариф: Pro`, `Новые отчеты: 12`, `Баллы: 3`.
- Locked candidate: button says `Открыть отчет`.
- Auth-required unlock: shows login choices.
- Ready unlock: shows spend order, subscription before points.
- Unlocked candidate/report: shows `Открыт навсегда`.

Do not add explanatory marketing blocks; keep this in the existing app shell.

- [ ] **Step 5: Run frontend build**

Run:

```bash
bun run --cwd apps/web build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/context apps/api/src/app.ts apps/web/src/lib/api.ts apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "feat: show account access status"
```

### Task 9: Wire Unlock Flow End To End In Frontend

**Ownership:** `apps/web/src/*`, vehicle unlock API types only if needed.

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Add API client**

Add:

```ts
export async function unlockVehicleReport(input: {
  vin?: string;
  vehicleId?: string;
  idempotencyKey: string;
}): Promise<UnlockCommitResponse> {
  const path = input.vin
    ? `/api/vehicles/${encodeURIComponent(input.vin)}/unlock`
    : `/api/vehicles/by-id/${encodeURIComponent(input.vehicleId ?? "")}/unlock`;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey: input.idempotencyKey })
  });
  if (!response.ok) throw new Error("Не удалось открыть отчет.");
  return response.json() as Promise<UnlockCommitResponse>;
}
```

- [ ] **Step 2: Update UI behavior**

`Открыть отчет` calls unlock intent first. Use VIN endpoints when `searchState.data.query.kind === "vin"` and by-id endpoints when `candidate.preview.vehicleId !== null`. If `ready`, show confirmation button `Подтвердить открытие`. On confirm, call `unlockVehicleReport` with:

```ts
{
  vin: searchState.data.query.kind === "vin" ? searchState.data.query.normalized : undefined,
  vehicleId: searchState.data.query.kind === "vin" ? undefined : candidate.preview.vehicleId ?? undefined,
  idempotencyKey: `unlock:${candidate.id}`
}
```

After success, refresh `/api/context` and mark the candidate as unlocked. For non-VIN candidates, the UI shows the permanent unlocked state but still does not fetch the full report because the full report UI is Milestone 5.

- [ ] **Step 3: Ensure full report remains hidden**

The frontend must not call `GET /api/vehicles/:vin/report` until unlock commit returns `granted` or context already shows the VIN as opened through an API state. In Milestone 4, a simple success state is enough; full report UI remains Milestone 5.

- [ ] **Step 4: Run frontend build**

Run:

```bash
bun run --cwd apps/web build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "feat: connect unlock UI to access service"
```

### Task 10: End-To-End Verification And Review Gates

**Ownership:** verification only; no feature edits unless tests uncover a bug.

**Files:**
- No planned source files.

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

- [ ] **Step 4: Generate DB migration if schema changed**

Run:

```bash
bun run --cwd apps/api db:generate
```

Expected: no unexpected migration after Task 1 migration has been committed, or one reviewed migration if schema changed during implementation.

- [ ] **Step 5: Leak guards**

Run:

```bash
rg -n "Источник:|Цена из|Пробег из|sourceKind|originalObjectKey|parserVersion|providerUserId|displayName" apps/api/src/modules/vehicles apps/api/src/modules/search apps/web/src
```

Expected: no user-facing source labels or raw identity values in report/search/frontend response code. Internal backend tests and repository code may mention internal field names outside serialized response builders.

- [ ] **Step 6: Manual smoke**

Start:

```bash
bun run dev:api
bun run dev:web
```

Verify:

- New browser session receives a guest cookie and `/api/context` returns guest expiry 7 days ahead.
- Guest can search, preview, select unlock intent, and sees auth-required state.
- Guest upload with valid fixture creates a temporary pending point.
- Login through Telegram assertion creates account and transfers guest upload/context/point.
- Same phone/telegram/max identity cannot be linked to another account.
- Uploading another report for the same VIN by the same user does not grant a second point.
- A fourth automatic grant for the same `report_fingerprint` is not automatically granted.
- User with active subscription limit unlocks a VIN without spending points.
- User with no subscription limit but points unlocks a VIN by spending 1 point.
- Re-opening an already unlocked VIN does not spend subscription or points.
- Direct `GET /api/vehicles/:vin/report` returns `403` for guest/no access and `200` only after real access grant.

- [ ] **Step 7: Review gates**

Confirm in the implementation handoff:

- Product logic unchanged: subscription limit before points; one point/limit opens VIN forever including future updates.
- Guest sessions expire after 7 days.
- Auth identities are unique and no auto-merge exists.
- Ledger mutations are idempotent.
- Balance is derived through ledger-controlled writes.
- Full report repository is never called before granted access.
- No personal data in vehicle report read models.
- No third-party source names in user-facing fact responses.
- OCR, Drom parser, and Auto.ru parser were not added.

## Plan Self-Review

- Spec coverage: Covers guest sessions, Telegram/Max/phone account channels, identity uniqueness, guest context transfer, ledger grants/spends/adjustments/idempotency, VIN/fingerprint grant limits, subscription-first access, unlock intent/commit, full report lockout, UI status, tests-first tasks, and review gates.
- Placeholder scan: No task depends on TBD behavior. External provider verification is explicitly scoped as a development assertion boundary for Milestone 4, not an omitted implementation detail.
- Type consistency: `AuthProvider`, `GuestSessionService`, `AccountService`, `PointsLedgerService`, `ReportAccessService`, `ContextResponse`, and unlock response names are used consistently across API and UI tasks.
- Scope check: Billing provider integration, SMS sending, Telegram/Max bot callbacks, OCR, Drom parsing, Auto.ru parsing, full report UI, PDF export, and admin review tooling remain outside Milestone 4.
