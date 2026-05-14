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
  | "invalid_adjustment_delta";

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
