import { describe, expect, it } from "bun:test";
import {
  GuestContextTransferService,
  type GuestContextTransferRepository,
  type GuestPointGrant,
  type GuestPointLedgerGrantPort
} from "./guest-context-transfer-service";

describe("GuestContextTransferService", () => {
  it("transfers guest uploads and point grants, marks context, and returns selected VIN", async () => {
    const repository = new FakeGuestContextTransferRepository();
    repository.uploadsToAssign = 2;
    repository.selectedUnlockVin = "JTDBR32E720123456";
    repository.untransferredGrants = [
      guestPointGrant({
        id: "grant-1",
        guestSessionId: "guest-1",
        vehicleId: "vehicle-1",
        reportUploadId: "upload-1",
        reportFingerprintId: "fingerprint-1",
        reason: "report_upload"
      })
    ];
    const ledger = new FakeGuestPointLedgerGrantPort();
    ledger.nextResults.push({ status: "applied", ledgerEntryId: "ledger-1" });
    const service = new GuestContextTransferService({ repository, ledger });

    const result = await service.transferToUser({
      guestSessionId: "guest-1",
      userId: "user-1"
    });

    expect(result).toEqual({
      pointGrants: 1,
      reportUploads: 2,
      selectedUnlockVin: "JTDBR32E720123456"
    });
    expect(repository.claims).toEqual([
      { guestSessionId: "guest-1", userId: "user-1" }
    ]);
    expect(repository.assignedUploads).toEqual([
      { guestSessionId: "guest-1", userId: "user-1" }
    ]);
    expect(ledger.calls).toEqual([
      {
        userId: "user-1",
        vehicleId: "vehicle-1",
        reportUploadId: "upload-1",
        reportFingerprintId: "fingerprint-1",
        idempotencyKey: "guest-transfer:guest-1:grant:grant-1",
        note: "report_upload"
      }
    ]);
    expect(repository.markedGrants).toEqual([
      {
        guestPointGrantId: "grant-1",
        userId: "user-1",
        ledgerEntryId: "ledger-1"
      }
    ]);
    expect(repository.markedEvents).toEqual([
      { guestSessionId: "guest-1", userId: "user-1" }
    ]);
  });

  it("is idempotent when rerun after the repository has no work left", async () => {
    const repository = new FakeGuestContextTransferRepository();
    repository.uploadsToAssign = 1;
    repository.untransferredGrants = [
      guestPointGrant({
        id: "grant-1",
        guestSessionId: "guest-1",
        vehicleId: "vehicle-1",
        reportUploadId: "upload-1",
        reportFingerprintId: "fingerprint-1"
      })
    ];
    const ledger = new FakeGuestPointLedgerGrantPort();
    ledger.nextResults.push({ status: "applied", ledgerEntryId: "ledger-1" });
    const service = new GuestContextTransferService({ repository, ledger });

    const first = await service.transferToUser({
      guestSessionId: "guest-1",
      userId: "user-1"
    });
    repository.uploadsToAssign = 0;
    repository.untransferredGrants = [];
    const second = await service.transferToUser({
      guestSessionId: "guest-1",
      userId: "user-1"
    });

    expect(first.pointGrants).toBe(1);
    expect(first.reportUploads).toBe(1);
    expect(second).toEqual({
      pointGrants: 0,
      reportUploads: 0,
      selectedUnlockVin: null
    });
    expect(ledger.calls).toHaveLength(1);
    expect(repository.markedGrants).toHaveLength(1);
  });

  it("skips incomplete guest point grants without calling the ledger", async () => {
    const repository = new FakeGuestContextTransferRepository();
    repository.untransferredGrants = [
      guestPointGrant({
        id: "grant-1",
        guestSessionId: "guest-1",
        vehicleId: null,
        reportUploadId: "upload-1",
        reportFingerprintId: "fingerprint-1"
      }),
      guestPointGrant({
        id: "grant-2",
        guestSessionId: "guest-1",
        vehicleId: "vehicle-1",
        reportUploadId: null,
        reportFingerprintId: "fingerprint-1"
      }),
      guestPointGrant({
        id: "grant-3",
        guestSessionId: "guest-1",
        vehicleId: "vehicle-1",
        reportUploadId: "upload-1",
        reportFingerprintId: null
      })
    ];
    const ledger = new FakeGuestPointLedgerGrantPort();
    const service = new GuestContextTransferService({ repository, ledger });

    const result = await service.transferToUser({
      guestSessionId: "guest-1",
      userId: "user-1"
    });

    expect(result.pointGrants).toBe(0);
    expect(ledger.calls).toEqual([]);
    expect(repository.markedGrants).toEqual([]);
  });

  it("does not mark or count a denied ledger grant", async () => {
    const repository = new FakeGuestContextTransferRepository();
    repository.untransferredGrants = [
      guestPointGrant({
        id: "grant-1",
        guestSessionId: "guest-1",
        vehicleId: "vehicle-1",
        reportUploadId: "upload-1",
        reportFingerprintId: "fingerprint-1"
      })
    ];
    const ledger = new FakeGuestPointLedgerGrantPort();
    ledger.nextResults.push({ status: "denied", ledgerEntryId: null });
    const service = new GuestContextTransferService({ repository, ledger });

    const result = await service.transferToUser({
      guestSessionId: "guest-1",
      userId: "user-1"
    });

    expect(result.pointGrants).toBe(0);
    expect(repository.markedGrants).toEqual([]);
  });

  it("keeps transferring remaining guest grants when one ledger grant fails", async () => {
    const repository = new FakeGuestContextTransferRepository();
    repository.untransferredGrants = [
      guestPointGrant({
        id: "grant-1",
        guestSessionId: "guest-1",
        vehicleId: "vehicle-1",
        reportUploadId: "upload-1",
        reportFingerprintId: "fingerprint-1"
      }),
      guestPointGrant({
        id: "grant-2",
        guestSessionId: "guest-1",
        vehicleId: "vehicle-2",
        reportUploadId: "upload-2",
        reportFingerprintId: "fingerprint-2"
      })
    ];
    const ledger = new FakeGuestPointLedgerGrantPort();
    ledger.nextErrors.push(new Error("ledger_unavailable"));
    ledger.nextResults.push({ status: "applied", ledgerEntryId: "ledger-2" });
    const service = new GuestContextTransferService({ repository, ledger });

    const result = await service.transferToUser({
      guestSessionId: "guest-1",
      userId: "user-1"
    });

    expect(result.pointGrants).toBe(1);
    expect(ledger.calls.map((call) => call.reportUploadId)).toEqual(["upload-1", "upload-2"]);
    expect(repository.markedGrants).toEqual([
      {
        guestPointGrantId: "grant-2",
        userId: "user-1",
        ledgerEntryId: "ledger-2"
      }
    ]);
    expect(repository.markedEvents).toEqual([
      { guestSessionId: "guest-1", userId: "user-1" }
    ]);
  });

  it("does not count a ledger grant when the repository cannot mark it transferred", async () => {
    const repository = new FakeGuestContextTransferRepository();
    repository.untransferredGrants = [
      guestPointGrant({
        id: "grant-1",
        guestSessionId: "guest-1",
        vehicleId: "vehicle-1",
        reportUploadId: "upload-1",
        reportFingerprintId: "fingerprint-1"
      })
    ];
    repository.markGrantResults.push(false);
    const ledger = new FakeGuestPointLedgerGrantPort();
    ledger.nextResults.push({ status: "applied", ledgerEntryId: "ledger-1" });
    const service = new GuestContextTransferService({ repository, ledger });

    const result = await service.transferToUser({
      guestSessionId: "guest-1",
      userId: "user-1"
    });

    expect(result.pointGrants).toBe(0);
    expect(repository.markedGrants).toEqual([
      {
        guestPointGrantId: "grant-1",
        userId: "user-1",
        ledgerEntryId: "ledger-1"
      }
    ]);
  });

  it("does not transfer uploads, points, or events when guest session claim fails", async () => {
    const repository = new FakeGuestContextTransferRepository();
    repository.claimResult = false;
    repository.uploadsToAssign = 2;
    repository.selectedUnlockVin = "JTDBR32E720123456";
    repository.untransferredGrants = [
      guestPointGrant({
        id: "grant-1",
        guestSessionId: "guest-1",
        vehicleId: "vehicle-1",
        reportUploadId: "upload-1",
        reportFingerprintId: "fingerprint-1"
      })
    ];
    const ledger = new FakeGuestPointLedgerGrantPort();
    const service = new GuestContextTransferService({ repository, ledger });

    const result = await service.transferToUser({
      guestSessionId: "guest-1",
      userId: "user-1"
    });

    expect(result).toEqual({
      pointGrants: 0,
      reportUploads: 0,
      selectedUnlockVin: null
    });
    expect(repository.assignedUploads).toEqual([]);
    expect(repository.markedEvents).toEqual([]);
    expect(ledger.calls).toEqual([]);
  });
});

class FakeGuestContextTransferRepository implements GuestContextTransferRepository {
  claimResult = true;
  uploadsToAssign = 0;
  selectedUnlockVin: string | null = null;
  untransferredGrants: GuestPointGrant[] = [];
  readonly claims: Array<{ guestSessionId: string; userId: string }> = [];
  readonly assignedUploads: Array<{ guestSessionId: string; userId: string }> = [];
  readonly markedGrants: Array<{
    guestPointGrantId: string;
    userId: string;
    ledgerEntryId: string;
  }> = [];
  readonly markGrantResults: boolean[] = [];
  readonly markedEvents: Array<{ guestSessionId: string; userId: string }> = [];

  async claimGuestSession(input: {
    guestSessionId: string;
    userId: string;
    claimedAt: Date;
  }): Promise<boolean> {
    this.claims.push({
      guestSessionId: input.guestSessionId,
      userId: input.userId
    });
    return this.claimResult;
  }

  async assignGuestUploadsToUser(input: {
    guestSessionId: string;
    userId: string;
  }): Promise<number> {
    this.assignedUploads.push(input);
    return this.uploadsToAssign;
  }

  async findUntransferredGuestPointGrants(): Promise<GuestPointGrant[]> {
    return this.untransferredGrants;
  }

  async markGuestPointGrantTransferred(input: {
    guestPointGrantId: string;
    userId: string;
    ledgerEntryId: string;
  }): Promise<boolean> {
    this.markedGrants.push(input);
    const result = this.markGrantResults.shift();
    if (result !== undefined) {
      return result;
    }
    return true;
  }

  async markGuestEventsTransferred(input: {
    guestSessionId: string;
    userId: string;
  }): Promise<void> {
    this.markedEvents.push(input);
  }

  async findLatestSelectedUnlockVin(): Promise<string | null> {
    return this.selectedUnlockVin;
  }
}

class FakeGuestPointLedgerGrantPort implements GuestPointLedgerGrantPort {
  readonly calls: Array<Parameters<GuestPointLedgerGrantPort["grantReportPoint"]>[0]> = [];
  readonly nextResults: Array<Awaited<ReturnType<GuestPointLedgerGrantPort["grantReportPoint"]>>> =
    [];
  readonly nextErrors: Error[] = [];

  async grantReportPoint(
    input: Parameters<GuestPointLedgerGrantPort["grantReportPoint"]>[0]
  ): ReturnType<GuestPointLedgerGrantPort["grantReportPoint"]> {
    this.calls.push(input);
    const error = this.nextErrors.shift();
    if (error !== undefined) {
      throw error;
    }
    return this.nextResults.shift() ?? { status: "applied", ledgerEntryId: "ledger-default" };
  }
}

function guestPointGrant(input: Partial<GuestPointGrant> & { id: string }): GuestPointGrant {
  return {
    guestSessionId: "guest-1",
    vehicleId: "vehicle-1",
    reportUploadId: "upload-1",
    reportFingerprintId: "fingerprint-1",
    points: 1,
    reason: "report_upload",
    ...input
  };
}
