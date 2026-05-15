import { describe, expect, it } from "bun:test";
import {
  ShareLinkService,
  type CreateShareLinkInput,
  type ShareLinkRecord,
  type ShareLinkRepository
} from "./share-link-service";

describe("ShareLinkService", () => {
  it("creates a seven day token and stores only its hash", async () => {
    const repository = new FakeShareLinkRepository();
    const service = new ShareLinkService({
      repository,
      now: () => new Date("2026-05-15T10:00:00.000Z"),
      tokenFactory: () => "ia_sh_test"
    });

    const share = await service.create({
      ownerUserId: "user-1",
      vehicleId: "vehicle-1"
    });

    expect(share).toEqual({
      token: "ia_sh_test",
      expiresAt: "2026-05-22T10:00:00.000Z"
    });
    expect(repository.created).toHaveLength(1);
    expect(repository.created[0]).toMatchObject({
      ownerUserId: "user-1",
      vehicleId: "vehicle-1",
      expiresAt: new Date("2026-05-22T10:00:00.000Z")
    });
    expect(repository.created[0]?.tokenHash).not.toBe("ia_sh_test");
  });

  it("resolves active tokens by hash", async () => {
    const repository = new FakeShareLinkRepository();
    const service = new ShareLinkService({
      repository,
      now: () => new Date("2026-05-15T10:00:00.000Z"),
      tokenFactory: () => "unused"
    });
    const created = await service.create({
      ownerUserId: "user-1",
      vehicleId: "vehicle-1"
    });

    await expect(service.resolve(created.token)).resolves.toMatchObject({
      id: "share-1",
      vehicleId: "vehicle-1",
      ownerUserId: "user-1",
      expiresAt: "2026-05-22T10:00:00.000Z"
    });
  });

  it("returns null for expired tokens", async () => {
    const repository = new FakeShareLinkRepository();
    let now = new Date("2026-05-15T10:00:00.000Z");
    const service = new ShareLinkService({
      repository,
      now: () => now,
      tokenFactory: () => "ia_sh_expired"
    });
    await service.create({
      ownerUserId: "user-1",
      vehicleId: "vehicle-1"
    });
    now = new Date("2026-05-23T10:00:00.000Z");

    await expect(service.resolve("ia_sh_expired")).resolves.toBeNull();
  });

  it("records share views without token or personal metadata", async () => {
    const repository = new FakeShareLinkRepository();
    const service = new ShareLinkService({
      repository,
      now: () => new Date("2026-05-15T10:00:00.000Z"),
      tokenFactory: () => "ia_sh_view"
    });
    const created = await service.create({
      ownerUserId: "user-1",
      vehicleId: "vehicle-1"
    });
    const share = await service.resolve(created.token);

    if (share === null) {
      throw new Error("expected_active_share");
    }
    await service.recordView(share);

    expect(repository.views).toEqual([
      {
        shareLinkId: "share-1",
        vehicleId: "vehicle-1"
      }
    ]);
  });
});

class FakeShareLinkRepository implements ShareLinkRepository {
  readonly created: CreateShareLinkInput[] = [];
  readonly views: Array<{ shareLinkId: string; vehicleId: string }> = [];
  private records: ShareLinkRecord[] = [];

  async create(input: CreateShareLinkInput): Promise<ShareLinkRecord> {
    this.created.push(input);
    const record: ShareLinkRecord = {
      id: `share-${this.records.length + 1}`,
      ownerUserId: input.ownerUserId,
      vehicleId: input.vehicleId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null
    };
    this.records.push(record);
    return record;
  }

  async findByTokenHash(tokenHash: string): Promise<ShareLinkRecord | null> {
    return this.records.find((record) => record.tokenHash === tokenHash) ?? null;
  }

  async recordView(input: { shareLinkId: string; vehicleId: string }): Promise<void> {
    this.views.push(input);
  }
}
