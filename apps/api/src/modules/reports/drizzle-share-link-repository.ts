import { eq } from "drizzle-orm";
import type { Database } from "../../db/client";
import { auditEvents, shareLinks } from "../../db/schema";
import type {
  CreateShareLinkInput,
  ShareLinkRecord,
  ShareLinkRepository
} from "./share-link-service";

export class DrizzleShareLinkRepository implements ShareLinkRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateShareLinkInput): Promise<ShareLinkRecord> {
    const now = new Date();
    const [row] = await this.db
      .insert(shareLinks)
      .values({
        ownerUserId: input.ownerUserId,
        vehicleId: input.vehicleId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        createdAt: now,
        updatedAt: now
      })
      .returning();

    if (row === undefined) {
      throw new Error("share_link_create_failed");
    }

    return mapShareLink(row);
  }

  async findByTokenHash(tokenHash: string): Promise<ShareLinkRecord | null> {
    const [row] = await this.db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.tokenHash, tokenHash))
      .limit(1);

    return row === undefined ? null : mapShareLink(row);
  }

  async recordView(input: { shareLinkId: string; vehicleId: string }): Promise<void> {
    await this.db.insert(auditEvents).values({
      actorUserId: null,
      eventType: "share_viewed",
      entityType: "share_link",
      entityId: input.shareLinkId,
      metadata: { vehicleId: input.vehicleId }
    });
  }
}

function mapShareLink(row: typeof shareLinks.$inferSelect): ShareLinkRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    vehicleId: row.vehicleId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt
  };
}
