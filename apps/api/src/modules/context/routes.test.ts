import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type {
  AccountRepository,
  AddIdentityResult,
  StoredAccount,
  StoredAuthIdentity,
  StoredUserSession
} from "../auth/account-repository";
import type { AuthProvider } from "../auth/identity";
import type {
  ActiveSubscription,
  CommitUnlockResult,
  ReportAccessRepository,
  ReportAccessVehicle,
  UserEntitlements,
  VehicleAccess
} from "../access/report-access-repository";
import { REQUEST_IDENTITY_KEY, type RequestIdentity } from "./request-context";
import { createContextRoutes } from "./routes";

describe("context routes", () => {
  it("returns guest context with expiry and zero entitlements", async () => {
    const app = createTestApp(createDependencies(), {
      kind: "guest",
      guestSessionId: "guest-1",
      expiresAt: new Date("2026-05-21T10:00:00.000Z")
    });

    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      session: { kind: "guest", expiresAt: "2026-05-21T10:00:00.000Z" },
      account: null,
      entitlements: { plan: null, remainingReports: 0, points: 0 }
    });
  });

  it("returns user context with account providers and entitlements", async () => {
    const dependencies = createDependencies();
    const app = createTestApp(dependencies, { kind: "user", userId: "user-1" });

    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      session: { kind: "user" },
      account: {
        id: "user-1",
        primaryContactProvider: "telegram",
        identities: ["telegram"]
      },
      entitlements: {
        plan: { code: "pro", name: "Pro" },
        remainingReports: 12,
        points: 3
      }
    });
    expect(dependencies.reportAccessRepository.entitlementCalls).toEqual([
      { userId: "user-1", now: new Date("2026-05-15T10:00:00.000Z") }
    ]);
  });

  it("does not leak raw identity data, display names, or session tokens", async () => {
    const app = createTestApp(createDependencies(), { kind: "user", userId: "user-1" });

    const response = await app.request("/");

    expect(response.status).toBe(200);
    const bodyText = await response.text();
    const body = JSON.parse(bodyText);
    expect(body.account.identities).toEqual(["telegram"]);
    expect(body.account).toEqual({
      id: "user-1",
      primaryContactProvider: "telegram",
      identities: ["telegram"]
    });
    expect(bodyText).not.toContain("telegram-raw-id");
    expect(bodyText).not.toContain("phone-raw-id");
    expect(bodyText).not.toContain("max-raw-id");
    expect(bodyText).not.toContain("Public Display Name");
    expect(bodyText).not.toContain("session-token");
  });

  it("returns auth_required when a user session points to a missing account", async () => {
    const dependencies = createDependencies({
      account: null
    });
    const app = createTestApp(dependencies, { kind: "user", userId: "missing-user" });

    const response = await app.request("/");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "auth_required",
        message: "Войдите, чтобы продолжить."
      }
    });
  });
});

function createTestApp(dependencies: ContextRouteTestDependencies, identity: RequestIdentity) {
  const app = new Hono<{
    Variables: {
      requestIdentity: RequestIdentity;
    };
  }>();
  app.use("*", async (context, next) => {
    context.set(REQUEST_IDENTITY_KEY, identity);
    await next();
  });
  app.route("/", createContextRoutes(dependencies));
  return app;
}

type ContextRouteTestDependencies = {
  accountRepository: FakeAccountRepository;
  reportAccessRepository: FakeReportAccessRepository;
  now: () => Date;
};

function createDependencies(options: { account?: StoredAccount | null } = {}) {
  return {
    accountRepository: new FakeAccountRepository(options.account),
    reportAccessRepository: new FakeReportAccessRepository(),
    now: () => new Date("2026-05-15T10:00:00.000Z")
  };
}

class FakeAccountRepository implements AccountRepository {
  constructor(
    private readonly account: StoredAccount | null | undefined = {
      id: "user-1",
      primaryContactProvider: "telegram"
    }
  ) {}

  async findAccountById(): Promise<StoredAccount | null> {
    return this.account ?? null;
  }

  async listIdentityProviders(): Promise<AuthProvider[]> {
    return ["telegram"];
  }

  async findIdentity(): Promise<StoredAuthIdentity | null> {
    return {
      id: "identity-1",
      userId: "user-1",
      provider: "telegram",
      providerUserId: "telegram-raw-id",
      displayName: "Public Display Name"
    };
  }

  async createUserWithIdentity(): Promise<StoredAccount> {
    throw new Error("not_used");
  }

  async addIdentity(): Promise<AddIdentityResult> {
    throw new Error("not_used");
  }

  async createUserSession(): Promise<StoredUserSession> {
    return {
      id: "session-1",
      userId: "user-1",
      tokenHash: "session-token",
      expiresAt: new Date("2026-06-01T00:00:00.000Z"),
      revokedAt: null
    };
  }

  async findUserSessionByTokenHash(): Promise<StoredUserSession | null> {
    return null;
  }

  async revokeUserSessionByTokenHash(): Promise<void> {}
}

class FakeReportAccessRepository implements ReportAccessRepository {
  readonly entitlementCalls: Array<{ userId: string; now: Date }> = [];

  async getEntitlements(input: { userId: string; now: Date }): Promise<UserEntitlements> {
    this.entitlementCalls.push(input);
    return {
      plan: { code: "pro", name: "Pro" },
      remainingReports: 12,
      points: 3
    };
  }

  async findVehicleByVin(): Promise<ReportAccessVehicle | null> {
    throw new Error("not_used");
  }

  async findVehicleById(): Promise<ReportAccessVehicle | null> {
    throw new Error("not_used");
  }

  async findVehicleAccess(): Promise<VehicleAccess | null> {
    throw new Error("not_used");
  }

  async findActiveSubscription(): Promise<ActiveSubscription | null> {
    throw new Error("not_used");
  }

  async decrementSubscriptionReport(): Promise<ActiveSubscription> {
    throw new Error("not_used");
  }

  async createVehicleAccess(): Promise<VehicleAccess> {
    throw new Error("not_used");
  }

  async commitUnlock(): Promise<CommitUnlockResult> {
    throw new Error("not_used");
  }
}
