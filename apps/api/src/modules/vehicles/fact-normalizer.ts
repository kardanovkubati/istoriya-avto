import { createHash } from "node:crypto";
import type { ParsedReport } from "../parsing/report-parser";

export type VehicleFactKind =
  | "identifier"
  | "passport"
  | "listing"
  | "mileage"
  | "risk_flag"
  | "quality_marker";

export type NormalizedVehicleObservation = {
  id?: string;
  vehicleId: string;
  reportUploadId: string;
  factKind: VehicleFactKind;
  factKey: string;
  valueHash: string;
  value: Record<string, unknown>;
  observedAt: string | null;
  reportedAt: string | null;
  acceptedAt: string;
  qualityScore: number;
};

type NormalizeInput = {
  vehicleId: string;
  reportUploadId: string;
  acceptedAt: string;
  parsedReport: ParsedReport;
};

const PASSPORT_FIELDS = [
  "make",
  "model",
  "year",
  "bodyType",
  "color",
  "engine",
  "transmission",
  "driveType"
] as const;

const RISK_FIELDS = [
  "accidents",
  "repairCalculations",
  "restrictions",
  "pledge",
  "wanted",
  "taxi",
  "leasing"
] as const;

export function normalizeParsedReportToObservations(input: NormalizeInput): NormalizedVehicleObservation[] {
  const { parsedReport } = input;
  if (parsedReport.status !== "parsed" || parsedReport.vin === null) {
    throw new Error("parsed_report_required");
  }

  const reportedAt = parsedReport.generatedAt;
  const observations: NormalizedVehicleObservation[] = [
    createObservation(input, "identifier", "vin", { vin: parsedReport.vin }, reportedAt)
  ];

  for (const field of PASSPORT_FIELDS) {
    const value = parsedReport.vehicle[field];
    if (value === null) continue;
    observations.push(createObservation(input, "passport", field, { field, value }, reportedAt));
  }

  for (const listing of parsedReport.listings) {
    observations.push(createObservation(input, "listing", "listing", { ...listing }, listing.observedAt));
  }

  for (const reading of parsedReport.mileageReadings) {
    observations.push(createObservation(input, "mileage", "mileage", { ...reading }, reading.observedAt));
  }

  for (const risk of RISK_FIELDS) {
    observations.push(
      createObservation(input, "risk_flag", risk, { risk, status: parsedReport.riskFlags[risk] }, reportedAt)
    );
  }

  for (const keyBlock of parsedReport.keyBlocks) {
    observations.push(createObservation(input, "quality_marker", keyBlock, { keyBlock }, reportedAt));
  }

  return deduplicateObservations(observations);
}

function createObservation(
  input: NormalizeInput,
  factKind: VehicleFactKind,
  factKey: string,
  value: Record<string, unknown>,
  observedAt: string | null
): NormalizedVehicleObservation {
  return {
    vehicleId: input.vehicleId,
    reportUploadId: input.reportUploadId,
    factKind,
    factKey,
    valueHash: hashValue({ factKind, factKey, value, observedAt }),
    value,
    observedAt,
    reportedAt: input.parsedReport.generatedAt,
    acceptedAt: input.acceptedAt,
    qualityScore: input.parsedReport.qualityScore
  };
}

function deduplicateObservations(observations: NormalizedVehicleObservation[]): NormalizedVehicleObservation[] {
  const seen = new Set<string>();
  return observations.filter((observation) => {
    const key = `${observation.factKind}:${observation.factKey}:${observation.valueHash}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableJson(nestedValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
