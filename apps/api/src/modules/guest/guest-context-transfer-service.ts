import type {
  GuestContextTransferRepository,
  GuestPointGrant
} from "./guest-session-repository";

export type { GuestContextTransferRepository, GuestPointGrant };

export type GuestContextTransferResult = {
  pointGrants: number;
  reportUploads: number;
  selectedUnlockVin: string | null;
};

export type GuestPointLedgerGrantPort = {
  grantReportPoint(input: {
    userId: string;
    vehicleId: string;
    reportUploadId: string;
    reportFingerprintId: string;
    idempotencyKey: string;
    note: string | null;
  }): Promise<{
    status: "applied" | "idempotent_replay" | "denied";
    ledgerEntryId: string | null;
  }>;
};

const EMPTY_TRANSFER_RESULT: GuestContextTransferResult = {
  pointGrants: 0,
  reportUploads: 0,
  selectedUnlockVin: null
};

export class GuestContextTransferService {
  constructor(
    private readonly options: {
      repository: GuestContextTransferRepository;
      ledger: GuestPointLedgerGrantPort;
      now?: () => Date;
    }
  ) {}

  async transferToUser(input: {
    guestSessionId: string;
    userId: string;
  }): Promise<GuestContextTransferResult> {
    const claimed = await this.options.repository.claimGuestSession({
      guestSessionId: input.guestSessionId,
      userId: input.userId,
      claimedAt: this.now()
    });

    if (!claimed) {
      return EMPTY_TRANSFER_RESULT;
    }

    const selectedUnlockVin = await this.findLatestSelectedUnlockVin(input.guestSessionId);
    const reportUploads = await this.assignGuestUploadsToUser(input);
    const grants = await this.findUntransferredGuestPointGrants(input.guestSessionId);
    let pointGrants = 0;
    const transferredGrantIds = new Set<string>();

    for (const grant of grants) {
      if (transferredGrantIds.has(grant.id)) {
        continue;
      }

      if (!isCompleteGuestPointGrant(grant)) {
        continue;
      }

      const ledgerResult = await this.grantReportPoint({
        userId: input.userId,
        vehicleId: grant.vehicleId,
        reportUploadId: grant.reportUploadId,
        reportFingerprintId: grant.reportFingerprintId,
        idempotencyKey: `guest-transfer:${input.guestSessionId}:grant:${grant.id}`,
        note: grant.reason
      });

      if (ledgerResult.ledgerEntryId === null) {
        continue;
      }

      const marked = await this.markGuestPointGrantTransferred({
        guestPointGrantId: grant.id,
        userId: input.userId,
        ledgerEntryId: ledgerResult.ledgerEntryId
      });
      if (!marked) {
        continue;
      }
      transferredGrantIds.add(grant.id);

      if (
        ledgerResult.status === "applied" ||
        ledgerResult.status === "idempotent_replay"
      ) {
        pointGrants += 1;
      }
    }

    await this.markGuestEventsTransferred(input);

    return {
      pointGrants,
      reportUploads,
      selectedUnlockVin
    };
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async findLatestSelectedUnlockVin(guestSessionId: string): Promise<string | null> {
    try {
      return await this.options.repository.findLatestSelectedUnlockVin(guestSessionId);
    } catch {
      return null;
    }
  }

  private async assignGuestUploadsToUser(input: {
    guestSessionId: string;
    userId: string;
  }): Promise<number> {
    try {
      return await this.options.repository.assignGuestUploadsToUser(input);
    } catch {
      return 0;
    }
  }

  private async findUntransferredGuestPointGrants(
    guestSessionId: string
  ): Promise<GuestPointGrant[]> {
    try {
      return await this.options.repository.findUntransferredGuestPointGrants(guestSessionId);
    } catch {
      return [];
    }
  }

  private async grantReportPoint(
    input: Parameters<GuestPointLedgerGrantPort["grantReportPoint"]>[0]
  ): ReturnType<GuestPointLedgerGrantPort["grantReportPoint"]> {
    try {
      return await this.options.ledger.grantReportPoint(input);
    } catch {
      return {
        status: "denied",
        ledgerEntryId: null
      };
    }
  }

  private async markGuestPointGrantTransferred(input: {
    guestPointGrantId: string;
    userId: string;
    ledgerEntryId: string;
  }): Promise<boolean> {
    try {
      return await this.options.repository.markGuestPointGrantTransferred(input);
    } catch {
      return false;
    }
  }

  private async markGuestEventsTransferred(input: {
    guestSessionId: string;
    userId: string;
  }): Promise<void> {
    try {
      await this.options.repository.markGuestEventsTransferred(input);
    } catch {}
  }
}

function isCompleteGuestPointGrant(
  grant: GuestPointGrant
): grant is GuestPointGrant & {
  vehicleId: string;
  reportUploadId: string;
  reportFingerprintId: string;
} {
  return (
    grant.vehicleId !== null &&
    grant.reportUploadId !== null &&
    grant.reportFingerprintId !== null
  );
}
