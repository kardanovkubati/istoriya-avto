import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { guestSessions } from "../../db/schema";
import type { GuestSessionRepository, StoredGuestSession } from "./guest-session-repository";

export class DrizzleGuestSessionRepository implements GuestSessionRepository {
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
}

function mapGuestSession(row: typeof guestSessions.$inferSelect): StoredGuestSession {
  return {
    id: row.id,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    claimedByUserId: row.claimedByUserId
  };
}
