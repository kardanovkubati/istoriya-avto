export type PointsDecision = "grant" | "deny" | "manual_review";

export type PointsDecisionReason =
  | "fresh_valid_report"
  | "first_report_for_vin_with_aging_data"
  | "newer_report_for_known_vin"
  | "user_already_rewarded_for_vin"
  | "user_already_rewarded_for_fingerprint"
  | "fingerprint_auto_grant_limit_reached"
  | "report_older_than_180_days"
  | "aging_report_not_first_for_vin"
  | "missing_vin_or_generated_date"
  | "insufficient_parsed_data"
  | "not_newer_than_current_report";

export type EvaluateReportForPointsInput = {
  now: Date;
  reportGeneratedAt: Date | null;
  hasVin: boolean;
  parsedKeyBlockCount: number;
  isFirstReportForVin: boolean;
  isNewerThanCurrentVinReport: boolean;
  userHasEverReceivedPointForVin: boolean;
  userHasEverReceivedPointForFingerprint: boolean;
  automaticFingerprintGrantCount: number;
};

export type PointsPolicyResult = {
  decision: PointsDecision;
  points: 0 | 1;
  reason: PointsDecisionReason;
};

const FRESH_REPORT_MAX_DAYS = 90;
const AGING_REPORT_MAX_DAYS = 180;
const MINIMUM_KEY_BLOCKS_FOR_AUTO_GRANT = 3;
const MAX_AUTOMATIC_GRANTS_PER_FINGERPRINT = 3;

export function evaluateReportForPoints(input: EvaluateReportForPointsInput): PointsPolicyResult {
  if (!input.hasVin || input.reportGeneratedAt === null) {
    return deny("missing_vin_or_generated_date");
  }

  if (input.parsedKeyBlockCount < MINIMUM_KEY_BLOCKS_FOR_AUTO_GRANT) {
    return manualReview("insufficient_parsed_data");
  }

  if (input.userHasEverReceivedPointForVin) {
    return deny("user_already_rewarded_for_vin");
  }

  if (input.userHasEverReceivedPointForFingerprint) {
    return deny("user_already_rewarded_for_fingerprint");
  }

  if (input.automaticFingerprintGrantCount >= MAX_AUTOMATIC_GRANTS_PER_FINGERPRINT) {
    return manualReview("fingerprint_auto_grant_limit_reached");
  }

  const reportAgeDays = getAgeInDays(input.reportGeneratedAt, input.now);

  if (reportAgeDays > AGING_REPORT_MAX_DAYS) {
    return deny("report_older_than_180_days");
  }

  if (reportAgeDays > FRESH_REPORT_MAX_DAYS) {
    if (input.isFirstReportForVin) {
      return grant("first_report_for_vin_with_aging_data");
    }

    return deny("aging_report_not_first_for_vin");
  }

  if (input.isFirstReportForVin) {
    return grant("fresh_valid_report");
  }

  if (input.isNewerThanCurrentVinReport) {
    return grant("newer_report_for_known_vin");
  }

  return deny("not_newer_than_current_report");
}

function grant(reason: PointsDecisionReason): PointsPolicyResult {
  return { decision: "grant", points: 1, reason };
}

function deny(reason: PointsDecisionReason): PointsPolicyResult {
  return { decision: "deny", points: 0, reason };
}

function manualReview(reason: PointsDecisionReason): PointsPolicyResult {
  return { decision: "manual_review", points: 0, reason };
}

function getAgeInDays(from: Date, to: Date): number {
  const milliseconds = to.getTime() - from.getTime();
  return Math.floor(milliseconds / 86_400_000);
}
