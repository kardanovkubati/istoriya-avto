import { eq, and } from "drizzle-orm";
import { db } from "../../db/client";
import { authIdentities, users, userSessions } from "../../db/schema";
import type {
  AccountRepository,
  StoredAccount,
  StoredAuthIdentity,
  StoredUserSession
} from "./account-repository";
import type { AuthProvider } from "./identity";

export class DrizzleAccountRepository implements AccountRepository {
  async findAccountById(userId: string): Promise<StoredAccount | null> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return user === undefined ? null : mapAccount(user);
  }

  async findIdentity(
    provider: AuthProvider,
    providerUserId: string
  ): Promise<StoredAuthIdentity | null> {
    const [identity] = await db
      .select()
      .from(authIdentities)
      .where(
        and(
          eq(authIdentities.provider, provider),
          eq(authIdentities.providerUserId, providerUserId)
        )
      )
      .limit(1);

    return identity === undefined ? null : mapIdentity(identity);
  }

  async createUserWithIdentity(input: {
    provider: AuthProvider;
    providerUserId: string;
    displayName: string | null;
  }): Promise<StoredAccount> {
    return db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          primaryContactProvider: input.provider
        })
        .returning();

      if (user === undefined) {
        throw new Error("account_create_failed");
      }

      await tx.insert(authIdentities).values({
        userId: user.id,
        provider: input.provider,
        providerUserId: input.providerUserId,
        displayName: input.displayName
      });

      return mapAccount(user);
    });
  }

  async addIdentity(input: {
    userId: string;
    provider: AuthProvider;
    providerUserId: string;
    displayName: string | null;
  }): Promise<StoredAuthIdentity> {
    const [identity] = await db
      .insert(authIdentities)
      .values({
        userId: input.userId,
        provider: input.provider,
        providerUserId: input.providerUserId,
        displayName: input.displayName
      })
      .returning();

    if (identity === undefined) {
      throw new Error("identity_create_failed");
    }

    return mapIdentity(identity);
  }

  async listIdentityProviders(userId: string): Promise<AuthProvider[]> {
    const rows = await db
      .select({ provider: authIdentities.provider })
      .from(authIdentities)
      .where(eq(authIdentities.userId, userId));

    return rows.map((row) => row.provider);
  }

  async createUserSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<StoredUserSession> {
    const [session] = await db
      .insert(userSessions)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt
      })
      .returning();

    if (session === undefined) {
      throw new Error("user_session_create_failed");
    }

    return mapUserSession(session);
  }

  async findUserSessionByTokenHash(tokenHash: string): Promise<StoredUserSession | null> {
    const [session] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.tokenHash, tokenHash))
      .limit(1);

    return session === undefined ? null : mapUserSession(session);
  }

  async revokeUserSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void> {
    await db
      .update(userSessions)
      .set({
        revokedAt,
        updatedAt: revokedAt
      })
      .where(eq(userSessions.tokenHash, tokenHash));
  }
}

function mapAccount(row: typeof users.$inferSelect): StoredAccount {
  return {
    id: row.id,
    primaryContactProvider: row.primaryContactProvider
  };
}

function mapIdentity(row: typeof authIdentities.$inferSelect): StoredAuthIdentity {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    providerUserId: row.providerUserId,
    displayName: row.displayName
  };
}

function mapUserSession(row: typeof userSessions.$inferSelect): StoredUserSession {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt
  };
}
