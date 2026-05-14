import { describe, expect, it } from "bun:test";
import {
  hashUserSessionToken,
  UserSessionService,
  type StoredUserSession,
  type UserSessionRepository
} from "./user-session-service";

describe("UserSessionService", () => {
  it("creates 30-day session and stores only token hash", async () => {
    const repository = new FakeUserSessionRepository();
    const now = new Date("2026-05-14T10:00:00.000Z");
    const service = new UserSessionService(repository, () => now);

    const created = await service.createUserSession("user-1");

    expect(created.token).toMatch(/^[0-9a-f]{64}$/);
    expect(created.expiresAt.toISOString()).toBe("2026-06-13T10:00:00.000Z");
    expect(repository.createdInputs).toHaveLength(1);
    expect(repository.createdInputs[0]).toEqual({
      userId: "user-1",
      tokenHash: hashUserSessionToken(created.token),
      expiresAt: created.expiresAt
    });
    expect(repository.createdInputs[0]?.tokenHash).not.toBe(created.token);
  });

  it("resolves unexpired active token", async () => {
    const repository = new FakeUserSessionRepository();
    const service = new UserSessionService(
      repository,
      () => new Date("2026-05-14T10:00:00.000Z")
    );
    const created = await service.createUserSession("user-1");

    await expect(service.resolveUserSession(created.token)).resolves.toEqual({ userId: "user-1" });
  });

  it("rejects null, malformed, expired, and revoked sessions", async () => {
    const repository = new FakeUserSessionRepository();
    const expiredToken = "a".repeat(64);
    repository.add({
      userId: "expired-user",
      tokenHash: hashUserSessionToken(expiredToken),
      expiresAt: new Date("2026-05-14T09:59:59.999Z"),
      revokedAt: null
    });
    const revokedToken = "b".repeat(64);
    repository.add({
      userId: "revoked-user",
      tokenHash: hashUserSessionToken(revokedToken),
      expiresAt: new Date("2026-06-13T10:00:00.000Z"),
      revokedAt: new Date("2026-05-14T09:00:00.000Z")
    });
    const service = new UserSessionService(
      repository,
      () => new Date("2026-05-14T10:00:00.000Z")
    );

    await expect(service.resolveUserSession(null)).resolves.toBeNull();
    await expect(service.resolveUserSession("short")).resolves.toBeNull();
    await expect(service.resolveUserSession(`${"a".repeat(63)}z`)).resolves.toBeNull();
    await expect(service.resolveUserSession(expiredToken)).resolves.toBeNull();
    await expect(service.resolveUserSession(revokedToken)).resolves.toBeNull();
  });

  it("revokes a session by raw token hash", async () => {
    const repository = new FakeUserSessionRepository();
    const service = new UserSessionService(repository);
    const created = await service.createUserSession("user-1");

    await service.revokeUserSession(created.token);

    expect(repository.revokedTokenHashes).toEqual([hashUserSessionToken(created.token)]);
    await expect(service.resolveUserSession(created.token)).resolves.toBeNull();
  });
});

class FakeUserSessionRepository implements UserSessionRepository {
  readonly createdInputs: Array<{ userId: string; tokenHash: string; expiresAt: Date }> = [];
  readonly revokedTokenHashes: string[] = [];
  private readonly sessionsByTokenHash = new Map<string, StoredUserSession>();
  private nextId = 1;

  async createUserSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<StoredUserSession> {
    this.createdInputs.push(input);
    return this.add({ ...input, revokedAt: null });
  }

  async findUserSessionByTokenHash(tokenHash: string): Promise<StoredUserSession | null> {
    return this.sessionsByTokenHash.get(tokenHash) ?? null;
  }

  async revokeUserSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void> {
    this.revokedTokenHashes.push(tokenHash);
    const existing = this.sessionsByTokenHash.get(tokenHash);
    if (existing !== undefined) {
      this.sessionsByTokenHash.set(tokenHash, { ...existing, revokedAt });
    }
  }

  add(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    revokedAt: Date | null;
  }): StoredUserSession {
    const session: StoredUserSession = {
      id: `session-${this.nextId++}`,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: input.revokedAt
    };
    this.sessionsByTokenHash.set(session.tokenHash, session);
    return session;
  }
}
