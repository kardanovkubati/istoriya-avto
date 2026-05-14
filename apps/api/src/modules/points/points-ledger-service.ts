import type {
  PointsAdjustmentReason,
  PointsLedgerMutationResult,
  PointsLedgerRepository
} from "./points-ledger-repository";

export type GrantReportPointInput = {
  userId: string;
  vehicleId: string;
  reportUploadId: string;
  reportFingerprintId: string;
  idempotencyKey: string;
  note?: string | null;
};

export type SpendPointForAccessInput = {
  userId: string;
  vehicleId: string;
  idempotencyKey: string;
  note?: string | null;
};

export type AdjustPointsInput = {
  userId: string;
  delta: number;
  reason: PointsAdjustmentReason;
  idempotencyKey: string;
  note: string;
};

export class PointsLedgerService {
  constructor(private readonly options: { repository: PointsLedgerRepository }) {}

  async grantReportPoint(input: GrantReportPointInput): Promise<PointsLedgerMutationResult> {
    return await this.options.repository.grantReportPoint({
      ...input,
      note: input.note ?? null
    });
  }

  async spendPointForAccess(input: SpendPointForAccessInput): Promise<PointsLedgerMutationResult> {
    return await this.options.repository.spendPointForAccess({
      ...input,
      note: input.note ?? null
    });
  }

  async adjustPoints(input: AdjustPointsInput): Promise<PointsLedgerMutationResult> {
    if (input.note.trim().length === 0) {
      return this.denied(input.userId, "adjustment_note_required");
    }

    if (!Number.isInteger(input.delta) || input.delta === 0) {
      return this.denied(input.userId, "invalid_adjustment_delta");
    }

    return await this.options.repository.adjustPoints({
      ...input,
      note: input.note.trim()
    });
  }

  private async denied(
    userId: string,
    reason: PointsLedgerMutationResult["reason"]
  ): Promise<PointsLedgerMutationResult> {
    return {
      status: "denied",
      entry: null,
      ledgerEntryId: null,
      balanceAfter: await this.options.repository.getBalance(userId),
      reason
    };
  }
}
