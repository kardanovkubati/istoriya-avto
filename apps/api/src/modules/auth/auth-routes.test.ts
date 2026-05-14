import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createAuthRoutes } from "./auth-routes";
import type { AccountService, LinkIdentityResult, LoginResult } from "./account-service";
import type { AuthProvider } from "./identity";
import {
  REQUEST_IDENTITY_KEY,
  USER_COOKIE_NAME,
  type RequestIdentity
} from "../context/request-context";

type TestEnv = {
  Variables: {
    requestIdentity: RequestIdentity;
  };
};

describe("auth routes", () => {
  it("logs in guest identity, sets ia_user cookie, and hides raw identity fields", async () => {
    const accountService = new FakeAccountService();
    const app = createTestApp(accountService, "guest");

    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "telegram",
        providerUserId: "12345",
        displayName: "Kuba"
      })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(`${USER_COOKIE_NAME}=raw-session-token`);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).toContain("Path=/");
    expect(accountService.loginCalls).toEqual([
      {
        provider: "telegram",
        providerUserId: "12345",
        displayName: "Kuba",
        guestSessionId: "guest-1"
      }
    ]);
    const body = await response.json();
    expect(body).toEqual({
      account: {
        id: "user-1",
        primaryContactProvider: "telegram",
        identities: ["telegram"]
      },
      transferredGuestContext: {
        pointGrants: 0,
        reportUploads: 0,
        selectedUnlockVin: null
      }
    });
    expect(JSON.stringify(body)).not.toContain("12345");
    expect(JSON.stringify(body)).not.toContain("raw-session-token");
    expect(JSON.stringify(body)).not.toContain("Kuba");
  });

  it("logs in current user identity without guest transfer", async () => {
    const accountService = new FakeAccountService();
    const app = createTestApp(accountService, "user");

    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "max", providerUserId: "max-1" })
    });

    expect(response.status).toBe(200);
    expect(accountService.loginCalls[0]?.guestSessionId).toBeNull();
  });

  it("requires user identity for link", async () => {
    const app = createTestApp(new FakeAccountService(), "guest");

    const response = await app.request("/api/auth/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "phone", providerUserId: "9001234567" })
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "auth_required",
        message: "Войдите, чтобы привязать способ входа."
      }
    });
  });

  it("links identity for current user", async () => {
    const accountService = new FakeAccountService();
    const app = createTestApp(accountService, "user");

    const response = await app.request("/api/auth/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "phone", providerUserId: "9001234567" })
    });

    expect(response.status).toBe(200);
    expect(accountService.linkCalls).toEqual([
      {
        userId: "user-current",
        provider: "phone",
        providerUserId: "9001234567",
        displayName: null
      }
    ]);
    expect(await response.json()).toEqual({
      account: {
        id: "user-current",
        primaryContactProvider: "telegram",
        identities: ["telegram", "phone"]
      }
    });
  });

  it("maps occupied identity, invalid identity, and invalid payload errors", async () => {
    const accountService = new FakeAccountService();
    accountService.linkResult = { ok: false, error: "identity_already_linked" };
    const app = createTestApp(accountService, "user");

    const occupied = await app.request("/api/auth/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "max", providerUserId: "max-1" })
    });
    expect(occupied.status).toBe(409);
    expect(await occupied.json()).toEqual({
      error: {
        code: "identity_already_linked",
        message: "Этот способ входа уже привязан к другому аккаунту."
      }
    });

    accountService.throwInvalidIdentity = true;
    const invalidIdentity = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "phone", providerUserId: "123" })
    });
    expect(invalidIdentity.status).toBe(400);
    expect(await invalidIdentity.json()).toEqual({
      error: {
        code: "invalid_identity",
        message: "Передайте корректный способ входа."
      }
    });

    const invalidPayload = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "email", providerUserId: "x" })
    });
    expect(invalidPayload.status).toBe(400);
    expect(await invalidPayload.json()).toEqual({
      error: {
        code: "invalid_request",
        message: "Передайте корректные данные входа."
      }
    });
  });
});

function createTestApp(accountService: FakeAccountService, identityKind: "guest" | "user") {
  const app = new Hono<TestEnv>();
  app.use("*", async (context, next) => {
    context.set(
      REQUEST_IDENTITY_KEY,
      identityKind === "guest"
        ? {
            kind: "guest",
            guestSessionId: "guest-1",
            expiresAt: new Date("2026-05-21T10:00:00.000Z")
          }
        : {
            kind: "user",
            userId: "user-current"
          }
    );
    await next();
  });
  app.route(
    "/api/auth",
    createAuthRoutes({
      accountService: accountService as unknown as AccountService,
      secureCookies: false
    })
  );
  return app;
}

class FakeAccountService {
  readonly loginCalls: Array<{
    provider: AuthProvider;
    providerUserId: string;
    displayName: string | null;
    guestSessionId: string | null;
  }> = [];
  readonly linkCalls: Array<{
    userId: string;
    provider: AuthProvider;
    providerUserId: string;
    displayName: string | null;
  }> = [];
  linkResult: LinkIdentityResult = {
    ok: true,
    account: {
      id: "user-current",
      primaryContactProvider: "telegram",
      identities: ["telegram", "phone"]
    }
  };
  throwInvalidIdentity = false;

  async loginOrCreate(input: {
    provider: AuthProvider;
    providerUserId: string;
    displayName: string | null;
    guestSessionId: string | null;
  }): Promise<LoginResult & { sessionToken: string; sessionExpiresAt: Date }> {
    this.loginCalls.push(input);
    if (this.throwInvalidIdentity) {
      throw new Error("invalid_identity");
    }
    return {
      account: {
        id: "user-1",
        primaryContactProvider: "telegram",
        identities: ["telegram"]
      },
      transferredGuestContext: {
        pointGrants: 0,
        reportUploads: 0,
        selectedUnlockVin: null
      },
      sessionToken: "raw-session-token",
      sessionExpiresAt: new Date("2026-06-13T10:00:00.000Z")
    };
  }

  async linkIdentity(input: {
    userId: string;
    provider: AuthProvider;
    providerUserId: string;
    displayName: string | null;
  }): Promise<LinkIdentityResult> {
    this.linkCalls.push(input);
    if (this.throwInvalidIdentity) {
      throw new Error("invalid_identity");
    }
    return this.linkResult;
  }
}
