import { createHash, randomBytes } from "node:crypto";
import type { GuestSessionRepository, StoredGuestSession } from "./guest-session-repository";

export type { GuestSessionRepository, StoredGuestSession } from "./guest-session-repository";

export type CreatedGuestSession = {
  token: string;
  expiresAt: Date;
  session: StoredGuestSession;
};

const GUEST_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_HEX_LENGTH = 64;

export class GuestSessionService {
  constructor(
    private readonly repository: GuestSessionRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async createGuestSession(): Promise<CreatedGuestSession> {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(this.now().getTime() + GUEST_SESSION_TTL_MS);
    const session = await this.repository.create({
      tokenHash: hashToken(token),
      expiresAt
    });

    return {
      token,
      expiresAt,
      session
    };
  }

  async resolveGuestSession(token: string | null): Promise<StoredGuestSession | null> {
    if (token === null || token.length < TOKEN_HEX_LENGTH) {
      return null;
    }

    const session = await this.repository.findByTokenHash(hashToken(token));

    if (session === null || session.claimedByUserId !== null) {
      return null;
    }

    if (session.expiresAt.getTime() <= this.now().getTime()) {
      return null;
    }

    return session;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
