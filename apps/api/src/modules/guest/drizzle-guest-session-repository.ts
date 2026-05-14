import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "../../db/client";
import {
  guestEvents,
  guestPointGrants,
  guestSessions,
  reportUploads
} from "../../db/schema";
import type {
  GuestContextTransferRepository,
  GuestPointGrant,
  GuestSessionRepository,
  StoredGuestSession
} from "./guest-session-repository";

export class DrizzleGuestSessionRepository
  implements GuestSessionRepository, GuestContextTransferRepository
{
  async create(input: { tokenHash: string; expiresAt: Date }): Promise<StoredGuestSession> {
    const [session] = await db
      .insert(guestSessions)
      .values({
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt
      })
      .returning();

    if (session === undefined) {
      throw new Error("guest_session_create_failed");
    }

    return mapGuestSession(session);
  }

  async findByTokenHash(tokenHash: string): Promise<StoredGuestSession | null> {
    const [session] = await db
      .select()
      .from(guestSessions)
      .where(eq(guestSessions.tokenHash, tokenHash))
      .limit(1);

    return session === undefined ? null : mapGuestSession(session);
  }

  async claimGuestSession(input: {
    guestSessionId: string;
    userId: string;
    claimedAt: Date;
  }): Promise<boolean> {
    const [session] = await db
      .update(guestSessions)
      .set({
        claimedByUserId: input.userId,
        updatedAt: input.claimedAt
      })
      .where(
        and(
          eq(guestSessions.id, input.guestSessionId),
          or(
            isNull(guestSessions.claimedByUserId),
            eq(guestSessions.claimedByUserId, input.userId)
          )
        )
      )
      .returning({ id: guestSessions.id });

    return session !== undefined;
  }

  async assignGuestUploadsToUser(input: {
    guestSessionId: string;
    userId: string;
  }): Promise<number> {
    const rowsToAssign = await db
      .select({ id: reportUploads.id })
      .from(reportUploads)
      .where(
        and(
          eq(reportUploads.guestSessionId, input.guestSessionId),
          isNull(reportUploads.userId)
        )
      );

    if (rowsToAssign.length === 0) return 0;

    await db
      .update(reportUploads)
      .set({
        userId: input.userId,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(reportUploads.guestSessionId, input.guestSessionId),
          isNull(reportUploads.userId)
        )
      );

    return rowsToAssign.length;
  }

  async findUntransferredGuestPointGrants(
    guestSessionId: string
  ): Promise<GuestPointGrant[]> {
    const grants = await db
      .select({
        id: guestPointGrants.id,
        guestSessionId: guestPointGrants.guestSessionId,
        vehicleId: guestPointGrants.vehicleId,
        reportUploadId: guestPointGrants.reportUploadId,
        reportFingerprintId: guestPointGrants.reportFingerprintId,
        points: guestPointGrants.points,
        reason: guestPointGrants.reason
      })
      .from(guestPointGrants)
      .where(
        and(
          eq(guestPointGrants.guestSessionId, guestSessionId),
          isNull(guestPointGrants.transferredToUserId)
        )
      );

    return grants
      .filter((grant) => grant.points === 1)
      .map((grant) => ({
        ...grant,
        points: 1
      }));
  }

  async markGuestPointGrantTransferred(input: {
    guestPointGrantId: string;
    userId: string;
    ledgerEntryId: string;
  }): Promise<void> {
    await db
      .update(guestPointGrants)
      .set({
        transferredToUserId: input.userId,
        transferredLedgerEntryId: input.ledgerEntryId,
        updatedAt: new Date()
      })
      .where(eq(guestPointGrants.id, input.guestPointGrantId));
  }

  async markGuestEventsTransferred(input: {
    guestSessionId: string;
    userId: string;
  }): Promise<void> {
    await db
      .update(guestEvents)
      .set({
        transferredToUserId: input.userId,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(guestEvents.guestSessionId, input.guestSessionId),
          isNull(guestEvents.transferredToUserId)
        )
      );
  }

  async findLatestSelectedUnlockVin(guestSessionId: string): Promise<string | null> {
    const [event] = await db
      .select({ payload: guestEvents.payload })
      .from(guestEvents)
      .where(
        and(
          eq(guestEvents.guestSessionId, guestSessionId),
          eq(guestEvents.kind, "selected_unlock_vin")
        )
      )
      .orderBy(desc(guestEvents.createdAt))
      .limit(1);

    const vin = event?.payload.vin;
    return typeof vin === "string" ? vin : null;
  }
}

function mapGuestSession(row: typeof guestSessions.$inferSelect): StoredGuestSession {
  return {
    id: row.id,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    claimedByUserId: row.claimedByUserId
  };
}
