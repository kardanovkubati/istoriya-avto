import { createHash, randomBytes } from "node:crypto";
import type { AccountRepository, StoredUserSession } from "./account-repository";

export type { StoredUserSession } from "./account-repository";

export type UserSessionRepository = Pick<
  AccountRepository,
  "createUserSession" | "findUserSessionByTokenHash" | "revokeUserSessionByTokenHash"
>;

const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const USER_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export class UserSessionService {
  constructor(
    private readonly repository: UserSessionRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async createUserSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(this.now().getTime() + USER_SESSION_TTL_MS);
    await this.repository.createUserSession({
      userId,
      tokenHash: hashUserSessionToken(token),
      expiresAt
    });

    return {
      token,
      expiresAt
    };
  }

  async resolveUserSession(token: string | null): Promise<{ userId: string } | null> {
    if (token === null || !USER_TOKEN_PATTERN.test(token)) {
      return null;
    }

    const session = await this.repository.findUserSessionByTokenHash(hashUserSessionToken(token));

    if (session === null || session.revokedAt !== null) {
      return null;
    }

    if (session.expiresAt.getTime() <= this.now().getTime()) {
      return null;
    }

    return {
      userId: session.userId
    };
  }

  async revokeUserSession(token: string): Promise<void> {
    if (!USER_TOKEN_PATTERN.test(token)) {
      return;
    }

    await this.repository.revokeUserSessionByTokenHash(hashUserSessionToken(token), this.now());
  }
}

export function hashUserSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
