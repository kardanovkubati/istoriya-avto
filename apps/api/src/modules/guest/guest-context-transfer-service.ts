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
      return {
        pointGrants: 0,
        reportUploads: 0,
        selectedUnlockVin: null
      };
    }

    const selectedUnlockVin = await this.options.repository.findLatestSelectedUnlockVin(
      input.guestSessionId
    );
    const reportUploads = await this.options.repository.assignGuestUploadsToUser(input);
    const grants = await this.options.repository.findUntransferredGuestPointGrants(
      input.guestSessionId
    );
    let pointGrants = 0;
    const transferredGrantIds = new Set<string>();

    for (const grant of grants) {
      if (transferredGrantIds.has(grant.id)) {
        continue;
      }

      if (!isCompleteGuestPointGrant(grant)) {
        continue;
      }

      const ledgerResult = await this.options.ledger.grantReportPoint({
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

      await this.options.repository.markGuestPointGrantTransferred({
        guestPointGrantId: grant.id,
        userId: input.userId,
        ledgerEntryId: ledgerResult.ledgerEntryId
      });
      transferredGrantIds.add(grant.id);

      if (
        ledgerResult.status === "applied" ||
        ledgerResult.status === "idempotent_replay"
      ) {
        pointGrants += 1;
      }
    }

    await this.options.repository.markGuestEventsTransferred(input);

    return {
      pointGrants,
      reportUploads,
      selectedUnlockVin
    };
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
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
