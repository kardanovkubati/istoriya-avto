import { beforeEach, describe, expect, it } from "bun:test";
import type {
  PointsLedgerEntry,
  PointsLedgerMutationResult,
  PointsLedgerRepository,
  PointsLedgerRepositoryAdjustInput,
  PointsLedgerRepositoryGrantInput,
  PointsLedgerRepositorySpendInput
} from "./points-ledger-repository";
import {
  adjustPointsIdempotencyFingerprint,
  grantReportPointIdempotencyFingerprint,
  resolveIdempotentReplay,
  resolveReplayAfterGuardedMutationDenial,
  spendPointForAccessIdempotencyFingerprint
} from "./points-ledger-repository";
import { PointsLedgerService } from "./points-ledger-service";

const USER_ID = "user-1";
const VEHICLE_ID = "vehicle-1";
const REPORT_UPLOAD_ID = "upload-1";
const REPORT_UPLOAD_ID_2 = "upload-2";
const REPORT_FINGERPRINT_ID = "fingerprint-1";

describe("PointsLedgerService", () => {
  let repository: FakePointsLedgerRepository;
  let service: PointsLedgerService;

  beforeEach(() => {
    repository = new FakePointsLedgerRepository();
    repository.setUserBalance(USER_ID, 0);
    repository.setFingerprintAutomaticGrantCount(REPORT_FINGERPRINT_ID, 0);
    service = new PointsLedgerService({ repository });
  });

  it("grantReportPoint inserts +1 report_grant, increments user balance, and increments fingerprint grant count", async () => {
    const result = await service.grantReportPoint({
      userId: USER_ID,
      vehicleId: VEHICLE_ID,
      reportUploadId: REPORT_UPLOAD_ID,
      reportFingerprintId: REPORT_FINGERPRINT_ID,
      idempotencyKey: "grant:1",
      note: "fresh_valid_report"
    });

    expect(result.status).toBe("applied");
    expect(result.entry).toMatchObject({
      userId: USER_ID,
      vehicleId: VEHICLE_ID,
      reportUploadId: REPORT_UPLOAD_ID,
      reportFingerprintId: REPORT_FINGERPRINT_ID,
      delta: 1,
      reason: "report_grant",
      idempotencyKey: "grant:1",
      note: "fresh_valid_report"
    });
    expect(result.ledgerEntryId).toBe(result.entry?.id ?? null);
    expect(result.balanceAfter).toBe(1);
    expect(repository.getUserBalance(USER_ID)).toBe(1);
    expect(repository.getFingerprintAutomaticGrantCount(REPORT_FINGERPRINT_ID)).toBe(1);
  });

  it("returns same entry as idempotent_replay without mutating balance or count again", async () => {
    const first = await service.grantReportPoint({
      userId: USER_ID,
      vehicleId: VEHICLE_ID,
      reportUploadId: REPORT_UPLOAD_ID,
      reportFingerprintId: REPORT_FINGERPRINT_ID,
      idempotencyKey: "grant:1",
      note: null
    });
    const replay = await service.grantReportPoint({
      userId: USER_ID,
      vehicleId: VEHICLE_ID,
      reportUploadId: REPORT_UPLOAD_ID,
      reportFingerprintId: REPORT_FINGERPRINT_ID,
      idempotencyKey: "grant:1",
      note: null
    });

    expect(replay.status).toBe("idempotent_replay");
    expect(replay.entry).toEqual(first.entry);
    expect(replay.ledgerEntryId).toBe(first.ledgerEntryId);
    expect(replay.balanceAfter).toBe(1);
    expect(repository.getUserBalance(USER_ID)).toBe(1);
    expect(repository.getFingerprintAutomaticGrantCount(REPORT_FINGERPRINT_ID)).toBe(1);
    expect(repository.entries).toHaveLength(1);
  });

  it("denies a reused grant idempotency key when the payload differs", async () => {
    await service.grantReportPoint({
      userId: USER_ID,
      vehicleId: VEHICLE_ID,
      reportUploadId: REPORT_UPLOAD_ID,
      reportFingerprintId: REPORT_FINGERPRINT_ID,
      idempotencyKey: "grant:1",
      note: null
    });
    repository.setUserBalance("user-2", 0);

    const conflict = await service.grantReportPoint({
      userId: "user-2",
      vehicleId: "vehicle-2",
      reportUploadId: REPORT_UPLOAD_ID_2,
      reportFingerprintId: "fingerprint-2",
      idempotencyKey: "grant:1",
      note: null
    });

    expect(conflict).toMatchObject({
      status: "denied",
      entry: null,
      ledgerEntryId: null,
      balanceAfter: 0,
      reason: "idempotency_key_conflict"
    });
    expect(repository.getUserBalance(USER_ID)).toBe(1);
    expect(repository.getUserBalance("user-2")).toBe(0);
    expect(repository.entries).toHaveLength(1);
  });

  it("denies the same user/VIN report grant forever even with a different upload", async () => {
    await service.grantReportPoint({
      userId: USER_ID,
      vehicleId: VEHICLE_ID,
      reportUploadId: REPORT_UPLOAD_ID,
      reportFingerprintId: REPORT_FINGERPRINT_ID,
      idempotencyKey: "grant:1",
      note: null
    });

    const denied = await service.grantReportPoint({
      userId: USER_ID,
      vehicleId: VEHICLE_ID,
      reportUploadId: REPORT_UPLOAD_ID_2,
      reportFingerprintId: "fingerprint-2",
      idempotencyKey: "grant:2",
      note: null
    });

    expect(denied).toMatchObject({
      status: "denied",
      entry: null,
      ledgerEntryId: null,
      balanceAfter: 1,
      reason: "user_already_rewarded_for_vin"
    });
    expect(repository.getUserBalance(USER_ID)).toBe(1);
    expect(repository.entries).toHaveLength(1);
  });

  it("denies the same user/report upload grant forever", async () => {
    await service.grantReportPoint({
      userId: USER_ID,
      vehicleId: VEHICLE_ID,
      reportUploadId: REPORT_UPLOAD_ID,
      reportFingerprintId: REPORT_FINGERPRINT_ID,
      idempotencyKey: "grant:1",
      note: null
    });

    const denied = await service.grantReportPoint({
      userId: USER_ID,
      vehicleId: "vehicle-2",
      reportUploadId: REPORT_UPLOAD_ID,
      reportFingerprintId: "fingerprint-2",
      idempotencyKey: "grant:2",
      note: null
    });

    expect(denied.reason).toBe("user_already_rewarded_for_report_upload");
    expect(denied.status).toBe("denied");
    expect(repository.getUserBalance(USER_ID)).toBe(1);
    expect(repository.entries).toHaveLength(1);
  });

  it("denies the same user/report fingerprint grant forever even through a different upload row", async () => {
    await service.grantReportPoint({
      userId: USER_ID,
      vehicleId: VEHICLE_ID,
      reportUploadId: REPORT_UPLOAD_ID,
      reportFingerprintId: REPORT_FINGERPRINT_ID,
      idempotencyKey: "grant:1",
      note: null
    });

    const denied = await service.grantReportPoint({
      userId: USER_ID,
      vehicleId: "vehicle-2",
      reportUploadId: REPORT_UPLOAD_ID_2,
      reportFingerprintId: REPORT_FINGERPRINT_ID,
      idempotencyKey: "grant:2",
      note: null
    });

    expect(denied.reason).toBe("user_already_rewarded_for_fingerprint");
    expect(denied.status).toBe("denied");
    expect(repository.getUserBalance(USER_ID)).toBe(1);
    expect(repository.entries).toHaveLength(1);
  });

  it("denies the fourth automatic grant for the same fingerprint", async () => {
    repository.setFingerprintAutomaticGrantCount(REPORT_FINGERPRINT_ID, 3);

    const denied = await service.grantReportPoint({
      userId: USER_ID,
      vehicleId: VEHICLE_ID,
      reportUploadId: REPORT_UPLOAD_ID,
      reportFingerprintId: REPORT_FINGERPRINT_ID,
      idempotencyKey: "grant:1",
      note: null
    });

    expect(denied).toMatchObject({
      status: "denied",
      entry: null,
      ledgerEntryId: null,
      balanceAfter: 0,
      reason: "fingerprint_auto_grant_limit_reached"
    });
    expect(repository.getFingerprintAutomaticGrantCount(REPORT_FINGERPRINT_ID)).toBe(3);
    expect(repository.entries).toHaveLength(0);
  });

  it("spendPointForAccess inserts -1 report_access_spend only when balance is positive", async () => {
    repository.setUserBalance(USER_ID, 1);

    const spent = await service.spendPointForAccess({
      userId: USER_ID,
      vehicleId: VEHICLE_ID,
      idempotencyKey: "spend:1",
      note: "unlock report"
    });

    expect(spent).toMatchObject({
      status: "applied",
      balanceAfter: 0
    });
    expect(spent.entry).toMatchObject({
      userId: USER_ID,
      vehicleId: VEHICLE_ID,
      delta: -1,
      reason: "report_access_spend",
      idempotencyKey: "spend:1",
      note: "unlock report"
    });
    expect(repository.getUserBalance(USER_ID)).toBe(0);

    const denied = await service.spendPointForAccess({
      userId: USER_ID,
      vehicleId: "vehicle-2",
      idempotencyKey: "spend:2",
      note: null
    });

    expect(denied).toMatchObject({
      status: "denied",
      entry: null,
      ledgerEntryId: null,
      balanceAfter: 0,
      reason: "insufficient_points"
    });
    expect(repository.entries).toHaveLength(1);
  });

  it("denies a reused spend idempotency key when the payload differs", async () => {
    repository.setUserBalance(USER_ID, 1);
    repository.setUserBalance("user-2", 1);
    await service.spendPointForAccess({
      userId: USER_ID,
      vehicleId: VEHICLE_ID,
      idempotencyKey: "spend:1",
      note: null
    });

    const conflict = await service.spendPointForAccess({
      userId: "user-2",
      vehicleId: "vehicle-2",
      idempotencyKey: "spend:1",
      note: null
    });

    expect(conflict).toMatchObject({
      status: "denied",
      entry: null,
      ledgerEntryId: null,
      balanceAfter: 1,
      reason: "idempotency_key_conflict"
    });
    expect(repository.getUserBalance(USER_ID)).toBe(0);
    expect(repository.getUserBalance("user-2")).toBe(1);
    expect(repository.entries).toHaveLength(1);
  });

  it("adjustPoints supports positive admin_adjustment and negative fraud_reversal with required nonblank note and idempotent replay", async () => {
    const adminAdjustment = await service.adjustPoints({
      userId: USER_ID,
      delta: 5,
      reason: "admin_adjustment",
      idempotencyKey: "adjust:admin",
      note: "manual compensation"
    });
    const fraudReversal = await service.adjustPoints({
      userId: USER_ID,
      delta: -2,
      reason: "fraud_reversal",
      idempotencyKey: "adjust:fraud",
      note: "duplicate source reversed"
    });
    const replay = await service.adjustPoints({
      userId: USER_ID,
      delta: -2,
      reason: "fraud_reversal",
      idempotencyKey: "adjust:fraud",
      note: "duplicate source reversed"
    });
    const blankNote = await service.adjustPoints({
      userId: USER_ID,
      delta: 1,
      reason: "admin_adjustment",
      idempotencyKey: "adjust:blank",
      note: "  "
    });

    expect(adminAdjustment).toMatchObject({
      status: "applied",
      balanceAfter: 5
    });
    expect(adminAdjustment.entry).toMatchObject({
      delta: 5,
      reason: "admin_adjustment",
      note: "manual compensation"
    });
    expect(fraudReversal).toMatchObject({
      status: "applied",
      balanceAfter: 3
    });
    expect(fraudReversal.entry).toMatchObject({
      delta: -2,
      reason: "fraud_reversal",
      note: "duplicate source reversed"
    });
    expect(replay.status).toBe("idempotent_replay");
    expect(replay.entry).toEqual(fraudReversal.entry);
    expect(replay.balanceAfter).toBe(3);
    expect(blankNote).toMatchObject({
      status: "denied",
      entry: null,
      ledgerEntryId: null,
      balanceAfter: 3,
      reason: "adjustment_note_required"
    });
    expect(repository.getUserBalance(USER_ID)).toBe(3);
    expect(repository.entries).toHaveLength(2);
  });

  it("denies a reused adjustment idempotency key when the payload differs", async () => {
    await service.adjustPoints({
      userId: USER_ID,
      delta: 5,
      reason: "admin_adjustment",
      idempotencyKey: "adjust:1",
      note: "manual compensation"
    });

    const conflict = await service.adjustPoints({
      userId: USER_ID,
      delta: 5,
      reason: "admin_adjustment",
      idempotencyKey: "adjust:1",
      note: "different note"
    });

    expect(conflict).toMatchObject({
      status: "denied",
      entry: null,
      ledgerEntryId: null,
      balanceAfter: 5,
      reason: "idempotency_key_conflict"
    });
    expect(repository.getUserBalance(USER_ID)).toBe(5);
    expect(repository.entries).toHaveLength(1);
  });

  it("denies negative adjustments that would make the balance negative", async () => {
    repository.setUserBalance(USER_ID, 1);

    const denied = await service.adjustPoints({
      userId: USER_ID,
      delta: -2,
      reason: "fraud_reversal",
      idempotencyKey: "adjust:negative",
      note: "reversal exceeds balance"
    });

    expect(denied).toMatchObject({
      status: "denied",
      entry: null,
      ledgerEntryId: null,
      balanceAfter: 1,
      reason: "adjustment_would_make_balance_negative"
    });
    expect(repository.getUserBalance(USER_ID)).toBe(1);
    expect(repository.entries).toHaveLength(0);
  });
});

describe("resolveReplayAfterGuardedMutationDenial", () => {
  it("returns idempotent replay for a matching spend entry after a guarded spend denial", () => {
    const entry = pointLedgerEntry({
      userId: USER_ID,
      vehicleId: VEHICLE_ID,
      delta: -1,
      reason: "report_access_spend",
      idempotencyKey: "spend:1"
    });

    const result = resolveReplayAfterGuardedMutationDenial({
      entry,
      fingerprint: spendPointForAccessIdempotencyFingerprint({
        userId: USER_ID,
        vehicleId: VEHICLE_ID,
        idempotencyKey: "spend:1",
        note: null
      }),
      balanceAfter: 0,
      deniedReason: "insufficient_points"
    });

    expect(result).toEqual({
      status: "idempotent_replay",
      entry,
      ledgerEntryId: entry.id,
      balanceAfter: 0,
      reason: "idempotent_replay"
    });
  });

  it("returns idempotent replay for a matching negative adjustment after a guarded adjustment denial", () => {
    const entry = pointLedgerEntry({
      userId: USER_ID,
      delta: -2,
      reason: "fraud_reversal",
      idempotencyKey: "adjust:negative",
      note: "duplicate source reversed"
    });

    const result = resolveReplayAfterGuardedMutationDenial({
      entry,
      fingerprint: adjustPointsIdempotencyFingerprint({
        userId: USER_ID,
        delta: -2,
        reason: "fraud_reversal",
        idempotencyKey: "adjust:negative",
        note: "duplicate source reversed"
      }),
      balanceAfter: 0,
      deniedReason: "adjustment_would_make_balance_negative"
    });

    expect(result.status).toBe("idempotent_replay");
    expect(result.entry).toEqual(entry);
    expect(result.ledgerEntryId).toBe(entry.id);
  });

  it("keeps the guarded denial when no idempotency entry appeared", () => {
    const result = resolveReplayAfterGuardedMutationDenial({
      entry: null,
      fingerprint: spendPointForAccessIdempotencyFingerprint({
        userId: USER_ID,
        vehicleId: VEHICLE_ID,
        idempotencyKey: "spend:1",
        note: null
      }),
      balanceAfter: 0,
      deniedReason: "insufficient_points"
    });

    expect(result).toEqual({
      status: "denied",
      entry: null,
      ledgerEntryId: null,
      balanceAfter: 0,
      reason: "insufficient_points"
    });
  });
});

class FakePointsLedgerRepository implements PointsLedgerRepository {
  readonly entries: PointsLedgerEntry[] = [];
  private readonly balances = new Map<string, number>();
  private readonly fingerprintAutomaticGrantCounts = new Map<string, number>();
  private nextEntryNumber = 1;

  setUserBalance(userId: string, balance: number): void {
    this.balances.set(userId, balance);
  }

  getUserBalance(userId: string): number {
    return this.balances.get(userId) ?? 0;
  }

  setFingerprintAutomaticGrantCount(reportFingerprintId: string, count: number): void {
    this.fingerprintAutomaticGrantCounts.set(reportFingerprintId, count);
  }

  getFingerprintAutomaticGrantCount(reportFingerprintId: string): number {
    return this.fingerprintAutomaticGrantCounts.get(reportFingerprintId) ?? 0;
  }

  async grantReportPoint(
    input: PointsLedgerRepositoryGrantInput
  ): Promise<PointsLedgerMutationResult> {
    const replay = this.findByIdempotencyKey(input.idempotencyKey);
    if (replay) {
      return resolveIdempotentReplay(
        replay,
        grantReportPointIdempotencyFingerprint(input),
        this.getUserBalance(input.userId)
      );
    }

    if (this.hasGrant((entry) => entry.userId === input.userId && entry.vehicleId === input.vehicleId)) {
      return this.denied(input.userId, "user_already_rewarded_for_vin");
    }

    if (
      this.hasGrant(
        (entry) => entry.userId === input.userId && entry.reportUploadId === input.reportUploadId
      )
    ) {
      return this.denied(input.userId, "user_already_rewarded_for_report_upload");
    }

    if (
      this.hasGrant(
        (entry) =>
          entry.userId === input.userId &&
          entry.reportFingerprintId === input.reportFingerprintId
      )
    ) {
      return this.denied(input.userId, "user_already_rewarded_for_fingerprint");
    }

    if (this.getFingerprintAutomaticGrantCount(input.reportFingerprintId) >= 3) {
      return this.denied(input.userId, "fingerprint_auto_grant_limit_reached");
    }

    const entry = this.createEntry({
      userId: input.userId,
      vehicleId: input.vehicleId,
      reportUploadId: input.reportUploadId,
      reportFingerprintId: input.reportFingerprintId,
      delta: 1,
      reason: "report_grant",
      idempotencyKey: input.idempotencyKey,
      note: input.note
    });
    this.incrementBalance(input.userId, 1);
    this.fingerprintAutomaticGrantCounts.set(
      input.reportFingerprintId,
      this.getFingerprintAutomaticGrantCount(input.reportFingerprintId) + 1
    );
    return this.applied(entry);
  }

  async spendPointForAccess(
    input: PointsLedgerRepositorySpendInput
  ): Promise<PointsLedgerMutationResult> {
    const replay = this.findByIdempotencyKey(input.idempotencyKey);
    if (replay) {
      return resolveIdempotentReplay(
        replay,
        spendPointForAccessIdempotencyFingerprint(input),
        this.getUserBalance(input.userId)
      );
    }

    if (this.getUserBalance(input.userId) <= 0) {
      return this.denied(input.userId, "insufficient_points");
    }

    const entry = this.createEntry({
      userId: input.userId,
      vehicleId: input.vehicleId,
      reportUploadId: null,
      reportFingerprintId: null,
      delta: -1,
      reason: "report_access_spend",
      idempotencyKey: input.idempotencyKey,
      note: input.note
    });
    this.incrementBalance(input.userId, -1);
    return this.applied(entry);
  }

  async adjustPoints(
    input: PointsLedgerRepositoryAdjustInput
  ): Promise<PointsLedgerMutationResult> {
    const replay = this.findByIdempotencyKey(input.idempotencyKey);
    if (replay) {
      return resolveIdempotentReplay(
        replay,
        adjustPointsIdempotencyFingerprint(input),
        this.getUserBalance(input.userId)
      );
    }

    if (input.delta < 0 && this.getUserBalance(input.userId) + input.delta < 0) {
      return this.denied(input.userId, "adjustment_would_make_balance_negative");
    }

    const entry = this.createEntry({
      userId: input.userId,
      vehicleId: null,
      reportUploadId: null,
      reportFingerprintId: null,
      delta: input.delta,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      note: input.note
    });
    this.incrementBalance(input.userId, input.delta);
    return this.applied(entry);
  }

  getBalance(userId: string): Promise<number> {
    return Promise.resolve(this.getUserBalance(userId));
  }

  private createEntry(input: Omit<PointsLedgerEntry, "id" | "createdAt" | "updatedAt">): PointsLedgerEntry {
    const now = new Date("2026-05-14T00:00:00.000Z");
    const entry = {
      id: `entry-${this.nextEntryNumber++}`,
      ...input,
      createdAt: now,
      updatedAt: now
    };
    this.entries.push(entry);
    return entry;
  }

  private findByIdempotencyKey(idempotencyKey: string): PointsLedgerEntry | undefined {
    return this.entries.find((entry) => entry.idempotencyKey === idempotencyKey);
  }

  private hasGrant(predicate: (entry: PointsLedgerEntry) => boolean): boolean {
    return this.entries.some(
      (entry) => entry.reason === "report_grant" && entry.delta > 0 && predicate(entry)
    );
  }

  private incrementBalance(userId: string, delta: number): void {
    this.balances.set(userId, this.getUserBalance(userId) + delta);
  }

  private applied(entry: PointsLedgerEntry): PointsLedgerMutationResult {
    return {
      status: "applied",
      entry,
      ledgerEntryId: entry.id,
      balanceAfter: this.getUserBalance(entry.userId),
      reason: entry.reason
    };
  }

  private denied(userId: string, reason: PointsLedgerMutationResult["reason"]): PointsLedgerMutationResult {
    return {
      status: "denied",
      entry: null,
      ledgerEntryId: null,
      balanceAfter: this.getUserBalance(userId),
      reason
    };
  }
}

function pointLedgerEntry(
  input: Partial<PointsLedgerEntry> & Pick<PointsLedgerEntry, "delta" | "reason">
): PointsLedgerEntry {
  const now = new Date("2026-05-14T00:00:00.000Z");
  return {
    id: "entry-guarded-replay",
    userId: USER_ID,
    vehicleId: null,
    reportUploadId: null,
    reportFingerprintId: null,
    idempotencyKey: "entry:key",
    note: null,
    createdAt: now,
    updatedAt: now,
    ...input
  };
}
