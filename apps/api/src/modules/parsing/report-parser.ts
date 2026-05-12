export type ReportSourceKind = "autoteka_pdf";

export type ParseWarningCode =
  | "unsupported_report_source"
  | "missing_vin"
  | "multiple_vins_found"
  | "missing_generated_at"
  | "future_generated_at"
  | "insufficient_key_blocks"
  | "empty_pdf_text"
  | "suspicious_report_structure";

export type ParsedVehiclePassport = {
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  bodyType: string | null;
  color: string | null;
  engine: string | null;
  transmission: string | null;
  driveType: string | null;
};

export type ParsedReport = {
  sourceKind: ReportSourceKind;
  parserVersion: string;
  status: "parsed" | "manual_review";
  vin: string | null;
  generatedAt: string | null;
  vehicle: ParsedVehiclePassport;
  listings: Array<{
    observedAt: string | null;
    priceRub: number | null;
    mileageKm: number | null;
    city: string | null;
  }>;
  mileageReadings: Array<{
    observedAt: string | null;
    mileageKm: number;
    context: string;
  }>;
  riskFlags: {
    accidents: "found" | "not_found" | "unknown";
    repairCalculations: "found" | "not_found" | "unknown";
    restrictions: "found" | "not_found" | "unknown";
    pledge: "found" | "not_found" | "unknown";
    wanted: "found" | "not_found" | "unknown";
    taxi: "found" | "not_found" | "unknown";
    leasing: "found" | "not_found" | "unknown";
  };
  keyBlocks: Array<"vehicle_passport" | "listings_or_mileage" | "risk_checks">;
  warnings: Array<{ code: ParseWarningCode; message: string }>;
  qualityScore: number;
};
