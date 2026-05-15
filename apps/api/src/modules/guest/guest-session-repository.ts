export type StoredGuestSession = {
  id: string;
  tokenHash: string;
  expiresAt: Date;
  claimedByUserId: string | null;
};

export type GuestPointGrant = {
  id: string;
  guestSessionId: string;
  vehicleId: string | null;
  reportUploadId: string | null;
  reportFingerprintId: string | null;
  points: 1;
  reason: string;
};

export interface GuestContextTransferRepository {
  claimGuestSession(input: {
    guestSessionId: string;
    userId: string;
    claimedAt: Date;
  }): Promise<boolean>;
  assignGuestUploadsToUser(input: { guestSessionId: string; userId: string }): Promise<number>;
  findUntransferredGuestPointGrants(guestSessionId: string): Promise<GuestPointGrant[]>;
  markGuestPointGrantTransferred(input: {
    guestPointGrantId: string;
    userId: string;
    ledgerEntryId: string;
  }): Promise<boolean>;
  markGuestEventsTransferred(input: { guestSessionId: string; userId: string }): Promise<void>;
  findLatestSelectedUnlockVin(guestSessionId: string): Promise<string | null>;
}

export interface GuestUnlockIntentRepository {
  recordSelectedUnlockVin(input: {
    guestSessionId: string;
    vin: string;
  }): Promise<void>;
}

export interface GuestSessionRepository {
  create(input: { tokenHash: string; expiresAt: Date }): Promise<StoredGuestSession>;
  findByTokenHash(tokenHash: string): Promise<StoredGuestSession | null>;
}
