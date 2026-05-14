import { describe, expect, it } from "bun:test";
import {
  GuestSessionService,
  hashToken,
  type GuestSessionRepository,
  type StoredGuestSession
} from "./guest-session-service";

describe("GuestSessionService", () => {
  it("creates 7-day session and stores only token hash", async () => {
    const repository = new FakeGuestSessionRepository();
    const now = new Date("2026-05-14T10:00:00.000Z");
    const service = new GuestSessionService(repository, () => now);

    const created = await service.createGuestSession();

    expect(created.token).toMatch(/^[0-9a-f]{64}$/);
    expect(created.expiresAt.toISOString()).toBe("2026-05-21T10:00:00.000Z");
    expect(created.session.expiresAt).toEqual(created.expiresAt);
    expect(repository.createdInputs).toHaveLength(1);
    expect(repository.createdInputs[0]?.tokenHash).toBe(hashToken(created.token));
    expect(repository.createdInputs[0]?.tokenHash).not.toBe(created.token);
    expect(repository.createdInputs[0]?.expiresAt).toEqual(created.expiresAt);
  });

  it("resolves unexpired token", async () => {
    const repository = new FakeGuestSessionRepository();
    const now = new Date("2026-05-14T10:00:00.000Z");
    const service = new GuestSessionService(repository, () => now);
    const created = await service.createGuestSession();

    const resolved = await service.resolveGuestSession(created.token);

    expect(resolved).toEqual(created.session);
  });

  it("rejects expired and claimed sessions", async () => {
    const repository = new FakeGuestSessionRepository();
    const token = "a".repeat(64);
    const expiredSession = repository.add({
      tokenHash: hashToken(token),
      expiresAt: new Date("2026-05-14T09:59:59.999Z"),
      claimedByUserId: null
    });
    const claimedToken = "b".repeat(64);
    const claimedSession = repository.add({
      tokenHash: hashToken(claimedToken),
      expiresAt: new Date("2026-05-21T10:00:00.000Z"),
      claimedByUserId: "user-1"
    });
    const service = new GuestSessionService(
      repository,
      () => new Date("2026-05-14T10:00:00.000Z")
    );

    expect(await service.resolveGuestSession(null)).toBeNull();
    expect(await service.resolveGuestSession("short")).toBeNull();
    expect(await service.resolveGuestSession(token)).toBeNull();
    expect(await service.resolveGuestSession(claimedToken)).toBeNull();
    expect(expiredSession.id).toBe("guest-1");
    expect(claimedSession.id).toBe("guest-2");
  });

  it("rejects malformed tokens without repository lookup", async () => {
    const repository = new FakeGuestSessionRepository();
    const service = new GuestSessionService(repository);

    expect(await service.resolveGuestSession("a".repeat(65))).toBeNull();
    expect(await service.resolveGuestSession(`${"a".repeat(63)}z`)).toBeNull();
    expect(repository.findByTokenHashCalls).toBe(0);
  });
});

class FakeGuestSessionRepository implements GuestSessionRepository {
  readonly createdInputs: Array<{ tokenHash: string; expiresAt: Date }> = [];
  findByTokenHashCalls = 0;
  private readonly sessionsByTokenHash = new Map<string, StoredGuestSession>();
  private nextId = 1;

  async create(input: { tokenHash: string; expiresAt: Date }): Promise<StoredGuestSession> {
    this.createdInputs.push(input);
    return this.add({ ...input, claimedByUserId: null });
  }

  async findByTokenHash(tokenHash: string): Promise<StoredGuestSession | null> {
    this.findByTokenHashCalls += 1;
    return this.sessionsByTokenHash.get(tokenHash) ?? null;
  }

  add(input: {
    tokenHash: string;
    expiresAt: Date;
    claimedByUserId: string | null;
  }): StoredGuestSession {
    const session: StoredGuestSession = {
      id: `guest-${this.nextId++}`,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      claimedByUserId: input.claimedByUserId
    };
    this.sessionsByTokenHash.set(session.tokenHash, session);
    return session;
  }
}
