import type { ParsedReport } from "../parsing/report-parser";
import type { VehicleFactConflictSnapshot } from "./conflict-detection";
import type { RiskStatus, TransparencyScore } from "./report-read-model";

type CalculateTransparencyScoreInput = {
  now: Date;
  vin: string | null;
  latestReportGeneratedAt: string | null;
  keyBlocks: ParsedReport["keyBlocks"];
  sourceUploadCount: number;
  riskStatuses: Partial<Record<keyof ParsedReport["riskFlags"], RiskStatus>>;
  conflicts: VehicleFactConflictSnapshot[];
};

const REQUIRED_KEY_BLOCKS: ParsedReport["keyBlocks"] = [
  "vehicle_passport",
  "listings_or_mileage",
  "risk_checks"
];

export function calculateTransparencyScore(
  input: CalculateTransparencyScoreInput
): TransparencyScore {
  const insufficientReasons: string[] = [];

  if (input.vin === null) insufficientReasons.push("missing_vin");
  if (input.latestReportGeneratedAt === null || reportAgeDays(input.latestReportGeneratedAt, input.now) > 90) {
    insufficientReasons.push("latest_report_is_stale");
  }
  if (!REQUIRED_KEY_BLOCKS.every((block) => input.keyBlocks.includes(block))) {
    insufficientReasons.push("missing_key_blocks");
  }

  if (insufficientReasons.length > 0) {
    return {
      kind: "insufficient_data",
      message: "Недостаточно данных для оценки.",
      reasons: insufficientReasons
    };
  }

  let score = 5;
  const age = reportAgeDays(input.latestReportGeneratedAt, input.now);
  if (age > 30) score -= 0.3;

  const foundRisks = Object.values(input.riskStatuses).filter((status) => status === "found").length;
  score -= Math.min(foundRisks * 0.5, 1.5);

  for (const conflict of input.conflicts) {
    if (conflict.severity === "critical") score -= 0.7;
    if (conflict.severity === "warning") score -= 0.4;
    if (conflict.severity === "info") score -= 0.1;
  }

  const value = Math.max(1, Math.min(5, Math.round(score * 10) / 10));

  return {
    kind: "score",
    value,
    max: 5,
    label: value >= 4 ? "История в целом прозрачна" : value >= 2.8 ? "Есть вопросы" : "Много вопросов"
  };
}

function reportAgeDays(generatedAt: string | null, now: Date): number {
  if (generatedAt === null) return Number.POSITIVE_INFINITY;
  const date = new Date(generatedAt);
  if (!Number.isFinite(date.getTime())) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}
