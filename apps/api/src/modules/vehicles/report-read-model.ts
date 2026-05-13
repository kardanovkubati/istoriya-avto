export type RiskStatus = "found" | "not_found" | "unknown";

export type ReportRiskFact = {
  status: RiskStatus;
  checkedAt: string | null;
};

export type TransparencyScore =
  | {
      kind: "score";
      value: number;
      max: 5;
      label: "История в целом прозрачна" | "Есть вопросы" | "Много вопросов";
    }
  | {
      kind: "insufficient_data";
      message: "Недостаточно данных для оценки.";
      reasons: string[];
    };

export type VehicleListingReadModel = {
  observedAt: string | null;
  priceRub: number | null;
  mileageKm: number | null;
  city: string | null;
};

export type VehicleMileageReadingReadModel = {
  observedAt: string | null;
  mileageKm: number;
  context: string;
};

export type VehicleConflictReadModel = {
  factKind: string;
  factKey: string;
  severity: "info" | "warning" | "critical";
  message: string;
  values: Array<{
    value: unknown;
    observedAt: string | null;
    reportedAt: string | null;
    isLatest: boolean;
  }>;
};

export type VehiclePreviewReadModel = {
  vehicleId: string;
  vinMasked: string;
  title: string;
  make: string | null;
  model: string | null;
  year: number | null;
  bodyType: string | null;
  color: string | null;
  engine: string | null;
  transmission: string | null;
  driveType: string | null;
  photo: null;
  lastListing: VehicleListingReadModel | null;
  lastUpdatedAt: string | null;
};

export type VehicleFullReportReadModel = {
  vehicleId: string;
  vin: string;
  generatedAt: string;
  summary: {
    historyBasisText: string;
    sourceUploadCount: number;
    lastUpdatedAt: string | null;
    freshnessWarning: string | null;
    transparency: TransparencyScore;
  };
  passport: {
    vin: string;
    make: string | null;
    model: string | null;
    year: number | null;
    bodyType: string | null;
    color: string | null;
    engine: string | null;
    transmission: string | null;
    driveType: string | null;
  };
  legalRisks: {
    restrictions: ReportRiskFact;
    pledge: ReportRiskFact;
    wanted: ReportRiskFact;
  };
  accidentsAndRepairs: {
    accidents: ReportRiskFact;
    repairCalculations: ReportRiskFact;
  };
  commercialUse: {
    taxi: ReportRiskFact;
    leasing: ReportRiskFact;
  };
  mileage: {
    readings: VehicleMileageReadingReadModel[];
    hasRollbackSignals: boolean;
  };
  listings: VehicleListingReadModel[];
  conflicts: VehicleConflictReadModel[];
  updateHistory: Array<{
    reportedAt: string | null;
    acceptedAt: string;
  }>;
};

const SOURCE_LEAK_PATTERN =
  /(sourceKind|parserVersion|originalObjectKey|autoteka|автотек|авито|auto\.ru|дром|drom)/i;

export function maskVinForPreview(vin: string): string {
  return `${vin.slice(0, 7)}********${vin.slice(-2)}`;
}

export function assertNoSourceBrandLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (SOURCE_LEAK_PATTERN.test(serialized)) {
    throw new Error("source_brand_leak");
  }
}
