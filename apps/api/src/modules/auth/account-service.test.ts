import { describe, expect, it } from "bun:test";
import {
  AccountService,
  type AddIdentityResult,
  type AccountRepository,
  type AccountTransferResult,
  type StoredAccount,
  type StoredAuthIdentity
} from "./account-service";
import { UserSessionService } from "./user-session-service";

describe("AccountService", () => {
  it("login with a new Telegram identity creates user, identity, transfer placeholder, and session", async () => {
    const repository = new FakeAccountRepository();
    const sessions = new FakeUserSessionService();
    const service = new AccountService({ repository, userSessionService: sessions });

    const result = await service.loginOrCreate({
      provider: "telegram",
      providerUserId: " 12345 ",
      displayName: "Kuba",
      guestSessionId: "guest-1"
    });

    expect(result.account).toEqual({
      id: "user-1",
      primaryContactProvider: "telegram",
      identities: ["telegram"]
    });
    expect(result.transferredGuestContext).toEqual({
      pointGrants: 0,
      reportUploads: 0,
      selectedUnlockVin: null
    });
    expect(result.sessionToken).toBe("token-for-user-1");
    expect(result.sessionExpiresAt.toISOString()).toBe("2026-06-13T10:00:00.000Z");
    expect(repository.identities[0]).toMatchObject({
      userId: "user-1",
      provider: "telegram",
      providerUserId: "12345",
      displayName: "Kuba"
    });
    expect(sessions.createdForUserIds).toEqual(["user-1"]);
  });

  it("login with an existing Telegram identity returns the same user", async () => {
    const repository = new FakeAccountRepository();
    const user = repository.createUserWithIdentitySync({
      provider: "telegram",
      providerUserId: "12345",
      displayName: null
    });
    const service = new AccountService({
      repository,
      userSessionService: new FakeUserSessionService()
    });

    const result = await service.loginOrCreate({
      provider: "telegram",
      providerUserId: " 12345 ",
      displayName: "Updated Name",
      guestSessionId: null
    });

    expect(result.account).toEqual({
      id: user.id,
      primaryContactProvider: "telegram",
      identities: ["telegram"]
    });
    expect(repository.users).toHaveLength(1);
    expect(repository.identities).toHaveLength(1);
  });

  it("links phone to current user when identity is free", async () => {
    const repository = new FakeAccountRepository();
    const user = repository.createUserWithIdentitySync({
      provider: "telegram",
      providerUserId: "12345",
      displayName: null
    });
    const service = new AccountService({
      repository,
      userSessionService: new FakeUserSessionService()
    });

    const result = await service.linkIdentity({
      userId: user.id,
      provider: "phone",
      providerUserId: "8 (900) 123-45-67",
      displayName: null
    });

    expect(result).toEqual({
      ok: true,
      account: {
        id: user.id,
        primaryContactProvider: "telegram",
        identities: ["telegram", "phone"]
      }
    });
  });

  it("fails when linking Max identity owned by another user", async () => {
    const repository = new FakeAccountRepository();
    const currentUser = repository.createUserWithIdentitySync({
      provider: "telegram",
      providerUserId: "12345",
      displayName: null
    });
    repository.createUserWithIdentitySync({
      provider: "max",
      providerUserId: "max-1",
      displayName: null
    });
    const service = new AccountService({
      repository,
      userSessionService: new FakeUserSessionService()
    });

    await expect(
      service.linkIdentity({
        userId: currentUser.id,
        provider: "max",
        providerUserId: "max-1",
        displayName: null
      })
    ).resolves.toEqual({ ok: false, error: "identity_already_linked" });
  });

  it("fails when repository reports a concurrent identity link conflict", async () => {
    const repository = new FakeAccountRepository();
    const currentUser = repository.createUserWithIdentitySync({
      provider: "telegram",
      providerUserId: "12345",
      displayName: null
    });
    repository.nextAddIdentityResult = { ok: false, error: "identity_already_linked" };
    const service = new AccountService({
      repository,
      userSessionService: new FakeUserSessionService()
    });

    await expect(
      service.linkIdentity({
        userId: currentUser.id,
        provider: "phone",
        providerUserId: "8 (900) 123-45-67",
        displayName: null
      })
    ).resolves.toEqual({ ok: false, error: "identity_already_linked" });
  });

  it("succeeds when linking the same existing identity for the same user", async () => {
    const repository = new FakeAccountRepository();
    const user = repository.createUserWithIdentitySync({
      provider: "telegram",
      providerUserId: "12345",
      displayName: null
    });
    const service = new AccountService({
      repository,
      userSessionService: new FakeUserSessionService()
    });

    await expect(
      service.linkIdentity({
        userId: user.id,
        provider: "telegram",
        providerUserId: "12345",
        displayName: null
      })
    ).resolves.toEqual({
      ok: true,
      account: {
        id: user.id,
        primaryContactProvider: "telegram",
        identities: ["telegram"]
      }
    });
  });

  it("uses an existing account when createUserWithIdentity recovers a concurrent first login", async () => {
    const repository = new FakeAccountRepository();
    const existingUser = repository.createUserWithIdentitySync({
      provider: "telegram",
      providerUserId: "12345",
      displayName: null
    });
    repository.hideIdentityOnce = true;
    repository.nextCreateUserResult = existingUser;
    const service = new AccountService({
      repository,
      userSessionService: new FakeUserSessionService()
    });

    const result = await service.loginOrCreate({
      provider: "telegram",
      providerUserId: "12345",
      displayName: "Kuba",
      guestSessionId: null
    });

    expect(result.account.id).toBe(existingUser.id);
    expect(repository.users).toHaveLength(1);
    expect(repository.identities).toHaveLength(1);
  });

  it("does not merge accounts automatically", async () => {
    const repository = new FakeAccountRepository();
    const userA = repository.createUserWithIdentitySync({
      provider: "telegram",
      providerUserId: "12345",
      displayName: null
    });
    const userB = repository.createUserWithIdentitySync({
      provider: "max",
      providerUserId: "max-1",
      displayName: null
    });
    const service = new AccountService({
      repository,
      userSessionService: new FakeUserSessionService()
    });

    const login = await service.loginOrCreate({
      provider: "max",
      providerUserId: "max-1",
      displayName: null,
      guestSessionId: "guest-from-user-a-device"
    });
    const link = await service.linkIdentity({
      userId: userA.id,
      provider: "max",
      providerUserId: "max-1",
      displayName: null
    });

    expect(login.account.id).toBe(userB.id);
    expect(link).toEqual({ ok: false, error: "identity_already_linked" });
    expect(repository.users).toHaveLength(2);
  });
});

class FakeUserSessionService extends UserSessionService {
  readonly createdForUserIds: string[] = [];

  constructor() {
    super(new FakeAccountRepository());
  }

  async createUserSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    this.createdForUserIds.push(userId);
    return {
      token: `token-for-${userId}`,
      expiresAt: new Date("2026-06-13T10:00:00.000Z")
    };
  }
}

class FakeAccountRepository implements AccountRepository {
  readonly users: StoredAccount[] = [];
  readonly identities: StoredAuthIdentity[] = [];
  nextAddIdentityResult: AddIdentityResult | null = null;
  nextCreateUserResult: StoredAccount | null = null;
  hideIdentityOnce = false;
  private nextUserId = 1;
  private nextIdentityId = 1;

  async findIdentity(
    provider: StoredAuthIdentity["provider"],
    providerUserId: string
  ): Promise<StoredAuthIdentity | null> {
    if (this.hideIdentityOnce) {
      this.hideIdentityOnce = false;
      return null;
    }
    return (
      this.identities.find(
        (identity) =>
          identity.provider === provider && identity.providerUserId === providerUserId
      ) ?? null
    );
  }

  async findAccountById(userId: string): Promise<StoredAccount | null> {
    return this.users.find((user) => user.id === userId) ?? null;
  }

  async createUserWithIdentity(input: {
    provider: StoredAuthIdentity["provider"];
    providerUserId: string;
    displayName: string | null;
  }): Promise<StoredAccount> {
    if (this.nextCreateUserResult !== null) {
      const result = this.nextCreateUserResult;
      this.nextCreateUserResult = null;
      return result;
    }
    return this.createUserWithIdentitySync(input);
  }

  async addIdentity(input: {
    userId: string;
    provider: StoredAuthIdentity["provider"];
    providerUserId: string;
    displayName: string | null;
  }): Promise<AddIdentityResult> {
    if (this.nextAddIdentityResult !== null) {
      const result = this.nextAddIdentityResult;
      this.nextAddIdentityResult = null;
      return result;
    }
    const existing = await this.findIdentity(input.provider, input.providerUserId);
    if (existing !== null) {
      throw new Error("identity_already_linked");
    }
    const identity: StoredAuthIdentity = {
      id: `identity-${this.nextIdentityId++}`,
      userId: input.userId,
      provider: input.provider,
      providerUserId: input.providerUserId,
      displayName: input.displayName
    };
    this.identities.push(identity);
    return { ok: true, identity };
  }

  async listIdentityProviders(userId: string): Promise<StoredAuthIdentity["provider"][]> {
    return this.identities
      .filter((identity) => identity.userId === userId)
      .map((identity) => identity.provider);
  }

  async createUserSession(): Promise<never> {
    throw new Error("not_used");
  }

  async findUserSessionByTokenHash(): Promise<never> {
    throw new Error("not_used");
  }

  async revokeUserSessionByTokenHash(): Promise<never> {
    throw new Error("not_used");
  }

  createUserWithIdentitySync(input: {
    provider: StoredAuthIdentity["provider"];
    providerUserId: string;
    displayName: string | null;
  }): StoredAccount {
    const user: StoredAccount = {
      id: `user-${this.nextUserId++}`,
      primaryContactProvider: input.provider
    };
    this.users.push(user);
    this.identities.push({
      id: `identity-${this.nextIdentityId++}`,
      userId: user.id,
      provider: input.provider,
      providerUserId: input.providerUserId,
      displayName: input.displayName
    });
    return user;
  }
}

const _typecheckTransferResult: AccountTransferResult = {
  pointGrants: 0,
  reportUploads: 0,
  selectedUnlockVin: null
};
