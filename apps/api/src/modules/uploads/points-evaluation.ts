import { evaluateReportForPoints, type PointsPolicyResult } from "../points/points-policy";
import type { ParsedReport } from "../parsing/report-parser";

export type EvaluateParsedReportForPointsInput = {
  parsedReport: ParsedReport;
  now: Date;
  isFirstReportForVin: boolean;
  isNewerThanCurrentVinReport: boolean;
  userHasEverReceivedPointForVin: boolean;
  userHasEverReceivedPointForFingerprint: boolean;
  automaticFingerprintGrantCount: number;
};

export function evaluateParsedReportForPoints(input: EvaluateParsedReportForPointsInput): PointsPolicyResult {
  if (input.parsedReport.status === "manual_review") {
    return { decision: "manual_review", points: 0, reason: "parser_manual_review_required" };
  }

  return evaluateReportForPoints({
    now: input.now,
    reportGeneratedAt: input.parsedReport.generatedAt ? new Date(input.parsedReport.generatedAt) : null,
    hasVin: input.parsedReport.vin !== null,
    parsedKeyBlockCount: input.parsedReport.keyBlocks.length,
    isFirstReportForVin: input.isFirstReportForVin,
    isNewerThanCurrentVinReport: input.isNewerThanCurrentVinReport,
    userHasEverReceivedPointForVin: input.userHasEverReceivedPointForVin,
    userHasEverReceivedPointForFingerprint: input.userHasEverReceivedPointForFingerprint,
    automaticFingerprintGrantCount: input.automaticFingerprintGrantCount
  });
}
