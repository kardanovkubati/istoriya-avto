import type { AuthProvider } from "./identity";

export type StoredAccount = {
  id: string;
  primaryContactProvider: AuthProvider | null;
};

export type StoredAuthIdentity = {
  id: string;
  userId: string;
  provider: AuthProvider;
  providerUserId: string;
  displayName: string | null;
};

export type StoredUserSession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type AddIdentityResult =
  | { ok: true; identity: StoredAuthIdentity }
  | { ok: false; error: "identity_already_linked" };

export interface AccountRepository {
  findAccountById(userId: string): Promise<StoredAccount | null>;
  findIdentity(provider: AuthProvider, providerUserId: string): Promise<StoredAuthIdentity | null>;
  createUserWithIdentity(input: {
    provider: AuthProvider;
    providerUserId: string;
    displayName: string | null;
  }): Promise<StoredAccount>;
  addIdentity(input: {
    userId: string;
    provider: AuthProvider;
    providerUserId: string;
    displayName: string | null;
  }): Promise<AddIdentityResult>;
  listIdentityProviders(userId: string): Promise<AuthProvider[]>;
  createUserSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<StoredUserSession>;
  findUserSessionByTokenHash(tokenHash: string): Promise<StoredUserSession | null>;
  revokeUserSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void>;
}
