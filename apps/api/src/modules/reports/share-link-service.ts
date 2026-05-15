export type CreateShareLinkInput = {
  ownerUserId: string;
  vehicleId: string;
  tokenHash: string;
  expiresAt: Date;
};

export type ShareLinkRecord = {
  id: string;
  ownerUserId: string;
  vehicleId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type ResolvedShareLink = {
  id: string;
  ownerUserId: string;
  vehicleId: string;
  expiresAt: string;
};

export interface ShareLinkRepository {
  create(input: CreateShareLinkInput): Promise<ShareLinkRecord>;
  findByTokenHash(tokenHash: string): Promise<ShareLinkRecord | null>;
  recordView(input: { shareLinkId: string; vehicleId: string }): Promise<void>;
}

export class ShareLinkService {
  constructor(
    private readonly options: {
      repository: ShareLinkRepository;
      now?: () => Date;
      tokenFactory?: () => string;
    }
  ) {}

  async create(input: {
    ownerUserId: string;
    vehicleId: string;
  }): Promise<{ token: string; expiresAt: string }> {
    const now = this.now();
    const token = this.options.tokenFactory?.() ?? createShareToken();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const record = await this.options.repository.create({
      ownerUserId: input.ownerUserId,
      vehicleId: input.vehicleId,
      tokenHash: await hashShareToken(token),
      expiresAt
    });

    return {
      token,
      expiresAt: record.expiresAt.toISOString()
    };
  }

  async resolve(token: string): Promise<ResolvedShareLink | null> {
    const record = await this.options.repository.findByTokenHash(await hashShareToken(token));
    if (record === null) {
      return null;
    }

    if (record.revokedAt !== null || record.expiresAt.getTime() <= this.now().getTime()) {
      return null;
    }

    return {
      id: record.id,
      ownerUserId: record.ownerUserId,
      vehicleId: record.vehicleId,
      expiresAt: record.expiresAt.toISOString()
    };
  }

  async recordView(share: ResolvedShareLink): Promise<void> {
    await this.options.repository.recordView({
      shareLinkId: share.id,
      vehicleId: share.vehicleId
    });
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

function createShareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `ia_sh_${base64Url(bytes)}`;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function hashShareToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
