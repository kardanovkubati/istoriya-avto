import { normalizeIdentity, type AuthProvider } from "./identity";
import type {
  AccountRepository,
  StoredAccount,
  StoredAuthIdentity
} from "./account-repository";
import type { UserSessionService } from "./user-session-service";
import type { GuestContextTransferResult } from "../guest/guest-context-transfer-service";

export type {
  AddIdentityResult,
  AccountRepository,
  StoredAccount,
  StoredAuthIdentity,
  StoredUserSession
} from "./account-repository";

export type AccountSummary = {
  id: string;
  primaryContactProvider: AuthProvider | null;
  identities: AuthProvider[];
};

export type AccountTransferResult = GuestContextTransferResult;

export type LoginResult = {
  account: AccountSummary;
  transferredGuestContext: AccountTransferResult;
};

export type LinkIdentityResult =
  | {
      ok: true;
      account: AccountSummary;
    }
  | {
      ok: false;
      error: "identity_already_linked";
    };

export class AccountService {
  private readonly transferGuestContext: (input: {
    guestSessionId: string;
    userId: string;
  }) => Promise<AccountTransferResult>;

  constructor(options: {
    repository: AccountRepository;
    userSessionService: UserSessionService;
    transferGuestContext?: (input: {
      guestSessionId: string;
      userId: string;
    }) => Promise<AccountTransferResult>;
  }) {
    this.repository = options.repository;
    this.userSessionService = options.userSessionService;
    this.transferGuestContext =
      options.transferGuestContext ??
      (async () => ({
        pointGrants: 0,
        reportUploads: 0,
        selectedUnlockVin: null
      }));
  }

  private readonly repository: AccountRepository;
  private readonly userSessionService: UserSessionService;

  async loginOrCreate(input: {
    provider: AuthProvider;
    providerUserId: string;
    displayName: string | null;
    guestSessionId: string | null;
  }): Promise<LoginResult & { sessionToken: string; sessionExpiresAt: Date }> {
    const identity = normalizeIdentity(input);
    const existingIdentity = await this.repository.findIdentity(
      identity.provider,
      identity.providerUserId
    );
    const account =
      existingIdentity === null
        ? await this.repository.createUserWithIdentity({
            ...identity,
            displayName: input.displayName
          })
        : await this.requireAccount(existingIdentity.userId);
    const transferredGuestContext =
      input.guestSessionId === null
        ? {
            pointGrants: 0,
            reportUploads: 0,
            selectedUnlockVin: null
          }
        : await this.transferGuestContext({
            guestSessionId: input.guestSessionId,
            userId: account.id
          });
    const session = await this.userSessionService.createUserSession(account.id);

    return {
      account: await this.accountSummary(account),
      transferredGuestContext,
      sessionToken: session.token,
      sessionExpiresAt: session.expiresAt
    };
  }

  async linkIdentity(input: {
    userId: string;
    provider: AuthProvider;
    providerUserId: string;
    displayName: string | null;
  }): Promise<LinkIdentityResult> {
    const identity = normalizeIdentity(input);
    const existingIdentity = await this.repository.findIdentity(
      identity.provider,
      identity.providerUserId
    );

    if (existingIdentity !== null && existingIdentity.userId !== input.userId) {
      return {
        ok: false,
        error: "identity_already_linked"
      };
    }

    if (existingIdentity === null) {
      const addIdentityResult = await this.repository.addIdentity({
        userId: input.userId,
        ...identity,
        displayName: input.displayName
      });
      if (!addIdentityResult.ok) {
        return addIdentityResult;
      }
    }

    const account = await this.requireAccount(input.userId);

    return {
      ok: true,
      account: await this.accountSummary(account)
    };
  }

  private async requireAccount(userId: string): Promise<StoredAccount> {
    const account = await this.repository.findAccountById(userId);
    if (account === null) {
      throw new Error("account_not_found");
    }
    return account;
  }

  private async accountSummary(account: StoredAccount): Promise<AccountSummary> {
    return {
      id: account.id,
      primaryContactProvider: account.primaryContactProvider,
      identities: await this.repository.listIdentityProviders(account.id)
    };
  }
}
