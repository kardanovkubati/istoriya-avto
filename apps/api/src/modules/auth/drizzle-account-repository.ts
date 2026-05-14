import { eq, and } from "drizzle-orm";
import { db } from "../../db/client";
import { authIdentities, users, userSessions } from "../../db/schema";
import type {
  AddIdentityResult,
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
    try {
      return await db.transaction(async (tx) => {
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
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const identity = await this.findIdentity(input.provider, input.providerUserId);
      if (identity === null) {
        throw error;
      }

      return this.requireAccount(identity.userId, error);
    }
  }

  async addIdentity(input: {
    userId: string;
    provider: AuthProvider;
    providerUserId: string;
    displayName: string | null;
  }): Promise<AddIdentityResult> {
    const [identity] = await db
      .insert(authIdentities)
      .values({
        userId: input.userId,
        provider: input.provider,
        providerUserId: input.providerUserId,
        displayName: input.displayName
      })
      .onConflictDoNothing()
      .returning();

    if (identity !== undefined) {
      return { ok: true, identity: mapIdentity(identity) };
    }

    const providerUserIdentity = await this.findIdentity(input.provider, input.providerUserId);
    if (providerUserIdentity !== null) {
      return providerUserIdentity.userId === input.userId
        ? { ok: true, identity: providerUserIdentity }
        : { ok: false, error: "identity_already_linked" };
    }

    const userProviderIdentity = await this.findIdentityByUserAndProvider(
      input.userId,
      input.provider
    );
    if (userProviderIdentity !== null) {
      return { ok: false, error: "identity_already_linked" };
    }

    throw new Error("identity_create_failed");
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

  private async requireAccount(userId: string, cause: unknown): Promise<StoredAccount> {
    const account = await this.findAccountById(userId);
    if (account === null) {
      throw cause;
    }
    return account;
  }

  private async findIdentityByUserAndProvider(
    userId: string,
    provider: AuthProvider
  ): Promise<StoredAuthIdentity | null> {
    const [identity] = await db
      .select()
      .from(authIdentities)
      .where(
        and(
          eq(authIdentities.userId, userId),
          eq(authIdentities.provider, provider)
        )
      )
      .limit(1);

    return identity === undefined ? null : mapIdentity(identity);
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    cause?: unknown;
    constraint?: unknown;
    constraint_name?: unknown;
  };

  if (candidate.code === "23505") {
    return true;
  }

  const constraint = candidate.constraint ?? candidate.constraint_name;
  if (
    constraint === "auth_identities_provider_user_unique" ||
    constraint === "auth_identities_user_provider_unique"
  ) {
    return true;
  }

  return isUniqueViolation(candidate.cause);
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
