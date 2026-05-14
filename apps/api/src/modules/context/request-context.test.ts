import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
  createRequestContextMiddleware,
  getOptionalGuestSession,
  getRequestIdentity,
  GUEST_COOKIE_NAME,
  USER_COOKIE_NAME,
  type UserSessionResolver
} from "./request-context";
import {
  GuestSessionService,
  type CreatedGuestSession,
  type GuestSessionRepository,
  type StoredGuestSession
} from "../guest/guest-session-service";

describe("request context middleware", () => {
  it("no cookies creates exactly one guest session and sets guest cookie attributes", async () => {
    const guestSessionService = new FakeGuestSessionService();
    const app = createTestApp(guestSessionService);

    const response = await app.request("/");

    expect(guestSessionService.createCalls).toBe(1);
    expectCreatedGuestCookie(response);
    expect(await response.json()).toEqual({
      kind: "guest",
      guestSessionId: "guest-created-1",
      expiresAt: "2026-05-21T10:00:00.000Z"
    });
  });

  it("sets Secure on created guest cookie when secure cookies are enabled", async () => {
    const guestSessionService = new FakeGuestSessionService();
    const app = createTestApp(guestSessionService, { secureCookies: true });

    const response = await app.request("/");

    expectCreatedGuestCookie(response);
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("invalid guest cookie creates exactly one new guest session and emits Set-Cookie", async () => {
    const guestSessionService = new FakeGuestSessionService();
    const app = createTestApp(guestSessionService);

    const response = await app.request("/", {
      headers: {
        cookie: `${GUEST_COOKIE_NAME}=stale-token`
      }
    });

    expect(guestSessionService.resolvedTokens).toEqual(["stale-token"]);
    expect(guestSessionService.createCalls).toBe(1);
    expectCreatedGuestCookie(response);
    expect(await response.json()).toEqual({
      kind: "guest",
      guestSessionId: "guest-created-1",
      expiresAt: "2026-05-21T10:00:00.000Z"
    });
  });

  it("valid guest cookie reuses existing guest and does not create another", async () => {
    const guestSessionService = new FakeGuestSessionService();
    guestSessionService.resolvedGuest = {
      id: "guest-existing",
      tokenHash: "hash",
      expiresAt: new Date("2026-05-21T10:00:00.000Z"),
      claimedByUserId: null
    };
    const app = createTestApp(guestSessionService);

    const response = await app.request("/", {
      headers: {
        cookie: `${GUEST_COOKIE_NAME}=raw-token`
      }
    });

    expect(guestSessionService.resolvedTokens).toEqual(["raw-token"]);
    expect(guestSessionService.createCalls).toBe(0);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({
      kind: "guest",
      guestSessionId: "guest-existing",
      expiresAt: "2026-05-21T10:00:00.000Z"
    });
  });

  it("valid user and guest cookies set user identity and keep guest session available for transfer", async () => {
    const guestSessionService = new FakeGuestSessionService();
    guestSessionService.transferResolvedGuest = {
      id: "guest-existing",
      tokenHash: "hash",
      expiresAt: new Date("2026-05-21T10:00:00.000Z"),
      claimedByUserId: null
    };
    const userSessionResolver: UserSessionResolver = {
      async resolveUserSession(token) {
        return token === "user-token" ? { userId: "user-1" } : null;
      }
    };
    const app = createTestApp(guestSessionService, { userSessionResolver });

    const response = await app.request("/", {
      headers: {
        cookie: `${USER_COOKIE_NAME}=user-token; ${GUEST_COOKIE_NAME}=guest-token`
      }
    });

    expect(guestSessionService.resolvedTokens).toEqual([]);
    expect(guestSessionService.transferResolvedInputs).toEqual([
      { token: "guest-token", userId: "user-1" }
    ]);
    expect(guestSessionService.createCalls).toBe(0);
    expect(await response.json()).toEqual({
      kind: "user",
      userId: "user-1",
      guestSessionId: "guest-existing"
    });
  });

  it("valid user cookie does not expose a guest session claimed by another user", async () => {
    const guestSessionService = new FakeGuestSessionService();
    guestSessionService.transferResolvedGuest = null;
    const userSessionResolver: UserSessionResolver = {
      async resolveUserSession(token) {
        return token === "user-token" ? { userId: "user-1" } : null;
      }
    };
    const app = createTestApp(guestSessionService, { userSessionResolver });

    const response = await app.request("/", {
      headers: {
        cookie: `${USER_COOKIE_NAME}=user-token; ${GUEST_COOKIE_NAME}=guest-token`
      }
    });

    expect(guestSessionService.transferResolvedInputs).toEqual([
      { token: "guest-token", userId: "user-1" }
    ]);
    expect(guestSessionService.createCalls).toBe(0);
    expect(await response.json()).toEqual({
      kind: "user",
      userId: "user-1"
    });
  });

  it("missing middleware makes getRequestIdentity throw request_identity_missing", async () => {
    const app = new Hono();
    app.get("/", (context) => {
      getRequestIdentity(context);
      return context.text("unreachable");
    });
    app.onError((error, context) => context.text(error.message, 500));

    const response = await app.request("/");

    expect(response.status).toBe(500);
    expect(await response.text()).toContain("request_identity_missing");
  });
});

function createTestApp(
  guestSessionService: FakeGuestSessionService,
  options: {
    userSessionResolver?: UserSessionResolver;
    secureCookies?: boolean;
  } = {}
) {
  const app = new Hono();
  const middlewareOptions: Parameters<typeof createRequestContextMiddleware>[0] = {
    guestSessionService
  };

  if (options.userSessionResolver !== undefined) {
    middlewareOptions.userSessionResolver = options.userSessionResolver;
  }

  if (options.secureCookies !== undefined) {
    middlewareOptions.secureCookies = options.secureCookies;
  }

  app.use("*", createRequestContextMiddleware(middlewareOptions));
  app.get("/", (context) => {
    const identity = getRequestIdentity(context);
    const guestSession = getOptionalGuestSession(context);
    return context.json(
      identity.kind === "guest"
        ? {
            ...identity,
            expiresAt: identity.expiresAt.toISOString()
          }
        : {
            ...identity,
            ...(guestSession === null ? {} : { guestSessionId: guestSession.guestSessionId })
          }
    );
  });
  return app;
}

function expectCreatedGuestCookie(response: Response) {
  const setCookie = response.headers.get("set-cookie");

  expect(setCookie).toContain(`${GUEST_COOKIE_NAME}=created-token-1`);
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Lax");
  expect(setCookie).toContain("Path=/");
  expect(setCookie).toContain("Expires=");
}

class FakeGuestSessionService extends GuestSessionService {
  createCalls = 0;
  readonly resolvedTokens: Array<string | null> = [];
  readonly transferResolvedInputs: Array<{ token: string | null; userId: string }> = [];
  resolvedGuest: StoredGuestSession | null = null;
  transferResolvedGuest: StoredGuestSession | null = null;

  constructor() {
    super(new UnusedGuestSessionRepository());
  }

  async createGuestSession(): Promise<CreatedGuestSession> {
    this.createCalls += 1;
    const expiresAt = new Date("2026-05-21T10:00:00.000Z");
    const session: StoredGuestSession = {
      id: `guest-created-${this.createCalls}`,
      tokenHash: "created-hash",
      expiresAt,
      claimedByUserId: null
    };
    return {
      token: `created-token-${this.createCalls}`,
      expiresAt,
      session
    };
  }

  async resolveGuestSession(token: string | null): Promise<StoredGuestSession | null> {
    this.resolvedTokens.push(token);
    return this.resolvedGuest;
  }

  async resolveGuestSessionForUserTransfer(
    token: string | null,
    userId: string
  ): Promise<StoredGuestSession | null> {
    this.transferResolvedInputs.push({ token, userId });
    return this.transferResolvedGuest;
  }
}

class UnusedGuestSessionRepository implements GuestSessionRepository {
  async create(): Promise<StoredGuestSession> {
    throw new Error("unexpected_guest_repository_create");
  }

  async findByTokenHash(): Promise<StoredGuestSession | null> {
    throw new Error("unexpected_guest_repository_find");
  }
}
