export type PointsLedgerReason =
  | "report_grant"
  | "report_access_spend"
  | "admin_adjustment"
  | "fraud_reversal";

export type PointsAdjustmentReason = "admin_adjustment" | "fraud_reversal";

export type PointsLedgerDeniedReason =
  | "user_already_rewarded_for_vin"
  | "user_already_rewarded_for_report_upload"
  | "user_already_rewarded_for_fingerprint"
  | "fingerprint_auto_grant_limit_reached"
  | "insufficient_points"
  | "adjustment_note_required"
  | "invalid_adjustment_delta"
  | "idempotency_key_conflict"
  | "adjustment_would_make_balance_negative";

export type PointsLedgerResultReason =
  | PointsLedgerReason
  | PointsLedgerDeniedReason
  | "idempotent_replay";

export type PointsLedgerEntry = {
  id: string;
  userId: string;
  vehicleId: string | null;
  reportUploadId: string | null;
  reportFingerprintId: string | null;
  delta: number;
  reason: PointsLedgerReason;
  idempotencyKey: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PointsLedgerMutationResult = {
  status: "applied" | "idempotent_replay" | "denied";
  entry: PointsLedgerEntry | null;
  ledgerEntryId: string | null;
  balanceAfter: number | null;
  reason: PointsLedgerResultReason;
};

export type PointsLedgerRepositoryGrantInput = {
  userId: string;
  vehicleId: string;
  reportUploadId: string;
  reportFingerprintId: string;
  idempotencyKey: string;
  note: string | null;
};

export type PointsLedgerRepositorySpendInput = {
  userId: string;
  vehicleId: string;
  idempotencyKey: string;
  note: string | null;
};

export type PointsLedgerRepositoryAdjustInput = {
  userId: string;
  delta: number;
  reason: PointsAdjustmentReason;
  idempotencyKey: string;
  note: string;
};

export type PointsLedgerRepository = {
  grantReportPoint(input: PointsLedgerRepositoryGrantInput): Promise<PointsLedgerMutationResult>;
  spendPointForAccess(input: PointsLedgerRepositorySpendInput): Promise<PointsLedgerMutationResult>;
  adjustPoints(input: PointsLedgerRepositoryAdjustInput): Promise<PointsLedgerMutationResult>;
  getBalance(userId: string): Promise<number | null>;
};

export type PointsLedgerIdempotencyFingerprint = {
  userId: string;
  vehicleId: string | null;
  reportUploadId: string | null;
  reportFingerprintId: string | null;
  delta: number;
  reason: PointsLedgerReason;
  note?: string | null;
};

export function grantReportPointIdempotencyFingerprint(
  input: PointsLedgerRepositoryGrantInput
): PointsLedgerIdempotencyFingerprint {
  return {
    userId: input.userId,
    vehicleId: input.vehicleId,
    reportUploadId: input.reportUploadId,
    reportFingerprintId: input.reportFingerprintId,
    delta: 1,
    reason: "report_grant"
  };
}

export function spendPointForAccessIdempotencyFingerprint(
  input: PointsLedgerRepositorySpendInput
): PointsLedgerIdempotencyFingerprint {
  return {
    userId: input.userId,
    vehicleId: input.vehicleId,
    reportUploadId: null,
    reportFingerprintId: null,
    delta: -1,
    reason: "report_access_spend"
  };
}

export function adjustPointsIdempotencyFingerprint(
  input: PointsLedgerRepositoryAdjustInput
): PointsLedgerIdempotencyFingerprint {
  return {
    userId: input.userId,
    vehicleId: null,
    reportUploadId: null,
    reportFingerprintId: null,
    delta: input.delta,
    reason: input.reason,
    note: input.note
  };
}

export function resolveIdempotentReplay(
  entry: PointsLedgerEntry,
  fingerprint: PointsLedgerIdempotencyFingerprint,
  balanceAfter: number | null
): PointsLedgerMutationResult {
  if (!matchesIdempotencyFingerprint(entry, fingerprint)) {
    return {
      status: "denied",
      entry: null,
      ledgerEntryId: null,
      balanceAfter,
      reason: "idempotency_key_conflict"
    };
  }

  return {
    status: "idempotent_replay",
    entry,
    ledgerEntryId: entry.id,
    balanceAfter,
    reason: "idempotent_replay"
  };
}

function matchesIdempotencyFingerprint(
  entry: PointsLedgerEntry,
  fingerprint: PointsLedgerIdempotencyFingerprint
): boolean {
  return (
    entry.userId === fingerprint.userId &&
    entry.vehicleId === fingerprint.vehicleId &&
    entry.reportUploadId === fingerprint.reportUploadId &&
    entry.reportFingerprintId === fingerprint.reportFingerprintId &&
    entry.delta === fingerprint.delta &&
    entry.reason === fingerprint.reason &&
    (fingerprint.note === undefined || entry.note === fingerprint.note)
  );
}
