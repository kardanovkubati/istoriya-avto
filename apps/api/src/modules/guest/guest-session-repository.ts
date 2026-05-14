export type StoredGuestSession = {
  id: string;
  tokenHash: string;
  expiresAt: Date;
  claimedByUserId: string | null;
};

export interface GuestSessionRepository {
  create(input: { tokenHash: string; expiresAt: Date }): Promise<StoredGuestSession>;
  findByTokenHash(tokenHash: string): Promise<StoredGuestSession | null>;
}
