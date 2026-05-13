import type { VehicleFactConflictSnapshot } from "./conflict-detection";
import type { NormalizedVehicleObservation } from "./fact-normalizer";
import { calculateTransparencyScore } from "./transparency-score";

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

export type BuildVehicleReadModelsInput = {
  now: Date;
  vehicle: { id: string; vin: string };
  observations: NormalizedVehicleObservation[];
  conflicts: VehicleFactConflictSnapshot[];
};

export type BuildVehicleReadModelsResult = {
  preview: VehiclePreviewReadModel;
  report: VehicleFullReportReadModel;
};

const SOURCE_LEAK_PATTERNS = [
  /(sourceKind|parserVersion|originalObjectKey|source_kind|parser_version|original_object_key)/,
  /(autoteka|автотек|auto\.ru|авто\.ру)/i,
  /(^|[^\p{L}\p{N}_])авито($|[^\p{L}\p{N}_])/iu,
  /(^|[^\p{L}\p{N}_])дром($|[^\p{L}\p{N}_])/iu,
  /(^|[^A-Za-z0-9_])drom($|[^A-Za-z0-9_])/i
] as const;

const FRESHNESS_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

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

type RiskField = (typeof RISK_FIELDS)[number];
type RiskMap = Record<RiskField, ReportRiskFact>;
type KeyBlock = "vehicle_passport" | "listings_or_mileage" | "risk_checks";

export function buildVehicleReadModels(input: BuildVehicleReadModelsInput): BuildVehicleReadModelsResult {
  const passport = selectPassport(input.observations, input.vehicle.vin);
  const listings = selectListings(input.observations);
  const mileageReadings = selectMileageReadings(input.observations);
  const risks = selectRisks(input.observations);
  const sourceUploadCount = new Set(input.observations.map((observation) => observation.reportUploadId)).size;
  const latestReportGeneratedAt = latestIso(input.observations.map((observation) => observation.reportedAt));
  const keyBlocks = selectKeyBlocks(input.observations);

  const preview: VehiclePreviewReadModel = {
    vehicleId: input.vehicle.id,
    vinMasked: maskVinForPreview(input.vehicle.vin),
    title: [passport.make, passport.model].filter(Boolean).join(" ") || "Автомобиль",
    make: passport.make,
    model: passport.model,
    year: passport.year,
    bodyType: passport.bodyType,
    color: passport.color,
    engine: passport.engine,
    transmission: passport.transmission,
    driveType: passport.driveType,
    photo: null,
    lastListing: listings[0] ?? null,
    lastUpdatedAt: latestReportGeneratedAt
  };

  const report: VehicleFullReportReadModel = {
    vehicleId: input.vehicle.id,
    vin: input.vehicle.vin,
    generatedAt: input.now.toISOString(),
    summary: {
      historyBasisText: historyBasisText(sourceUploadCount, latestReportGeneratedAt),
      sourceUploadCount,
      lastUpdatedAt: latestReportGeneratedAt,
      freshnessWarning: freshnessWarning(latestReportGeneratedAt, input.now),
      transparency: calculateTransparencyScore({
        now: input.now,
        vin: input.vehicle.vin,
        latestReportGeneratedAt,
        keyBlocks,
        sourceUploadCount,
        riskStatuses: Object.fromEntries(
          Object.entries(risks).map(([key, value]) => [key, value.status])
        ) as Partial<Record<RiskField, RiskStatus>>,
        conflicts: input.conflicts
      })
    },
    passport,
    legalRisks: {
      restrictions: risks.restrictions,
      pledge: risks.pledge,
      wanted: risks.wanted
    },
    accidentsAndRepairs: {
      accidents: risks.accidents,
      repairCalculations: risks.repairCalculations
    },
    commercialUse: {
      taxi: risks.taxi,
      leasing: risks.leasing
    },
    mileage: {
      readings: mileageReadings,
      hasRollbackSignals: input.conflicts.some((conflict) => conflict.factKey === "mileage_rollback")
    },
    listings,
    conflicts: input.conflicts.map(toConflictReadModel),
    updateHistory: selectUpdateHistory(input.observations)
  };

  assertNoSourceBrandLeak({ preview, report });
  return { preview, report };
}

export function maskVinForPreview(vin: string): string {
  return `${vin.slice(0, 7)}********${vin.slice(-2)}`;
}

export function assertNoSourceBrandLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (SOURCE_LEAK_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error("source_brand_leak");
  }
}

function selectPassport(
  observations: NormalizedVehicleObservation[],
  vin: string
): VehicleFullReportReadModel["passport"] {
  const passport: VehicleFullReportReadModel["passport"] = {
    vin,
    make: null,
    model: null,
    year: null,
    bodyType: null,
    color: null,
    engine: null,
    transmission: null,
    driveType: null
  };

  for (const field of PASSPORT_FIELDS) {
    const observation = observations
      .filter((candidate) => candidate.factKind === "passport" && candidate.factKey === field)
      .sort(compareNewestObservationFirst)[0];
    if (observation === undefined) continue;

    const value = observation.value.value;
    if (field === "year") {
      passport.year = typeof value === "number" ? value : null;
      continue;
    }

    passport[field] = typeof value === "string" ? value : null;
  }

  return passport;
}

function selectListings(observations: NormalizedVehicleObservation[]): VehicleListingReadModel[] {
  return observations
    .filter((observation) => observation.factKind === "listing")
    .sort(compareNewestListingObservationFirst)
    .map((observation) => ({
      observedAt: observation.observedAt,
      priceRub: numberOrNull(observation.value.priceRub),
      mileageKm: numberOrNull(observation.value.mileageKm),
      city: stringOrNull(observation.value.city)
    }));
}

function selectMileageReadings(
  observations: NormalizedVehicleObservation[]
): VehicleMileageReadingReadModel[] {
  return observations
    .filter((observation) => observation.factKind === "mileage" && typeof observation.value.mileageKm === "number")
    .sort(compareMileageObservationOldestFirst)
    .map((observation) => ({
      observedAt: observation.observedAt,
      mileageKm: observation.value.mileageKm as number,
      context: typeof observation.value.context === "string" ? observation.value.context : "report"
    }));
}

function selectRisks(observations: NormalizedVehicleObservation[]): RiskMap {
  const risks = Object.fromEntries(
    RISK_FIELDS.map((risk) => [risk, { status: "unknown", checkedAt: null }])
  ) as RiskMap;

  for (const risk of RISK_FIELDS) {
    const observation = observations
      .filter((candidate) => candidate.factKind === "risk_flag" && candidate.factKey === risk)
      .sort(compareNewestObservationFirst)[0];
    if (observation === undefined || !isRiskStatus(observation.value.status)) continue;

    risks[risk] = {
      status: observation.value.status,
      checkedAt: observation.value.status === "unknown" ? null : observation.reportedAt
    };
  }

  return risks;
}

function selectKeyBlocks(observations: NormalizedVehicleObservation[]): KeyBlock[] {
  return observations
    .filter((observation) => observation.factKind === "quality_marker" && isKeyBlock(observation.factKey))
    .map((observation) => observation.factKey as KeyBlock);
}

function selectUpdateHistory(
  observations: NormalizedVehicleObservation[]
): VehicleFullReportReadModel["updateHistory"] {
  const history = new Map<string, { reportedAt: string | null; acceptedAt: string }>();

  for (const observation of observations) {
    const key = `${observation.reportUploadId}:${observation.reportedAt ?? ""}:${observation.acceptedAt}`;
    history.set(key, {
      reportedAt: observation.reportedAt,
      acceptedAt: observation.acceptedAt
    });
  }

  return [...history.values()].sort(
    (left, right) =>
      compareNullableIsoDesc(left.acceptedAt, right.acceptedAt) ||
      compareNullableIsoDesc(left.reportedAt, right.reportedAt)
  );
}

function historyBasisText(sourceUploadCount: number, latestReportGeneratedAt: string | null): string {
  const uploadText = reportCountText(sourceUploadCount);
  const latestText = latestReportGeneratedAt === null ? "нет данных" : formatRussianDate(latestReportGeneratedAt);
  return `История составлена на основе ${uploadText}. Последнее обновление: ${latestText}.`;
}

function reportCountText(count: number): string {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return `${count} загруженных отчетов`;
  if (lastDigit === 1) return `${count} загруженного отчета`;
  if (lastDigit >= 2 && lastDigit <= 4) return `${count} загруженных отчета`;
  return `${count} загруженных отчетов`;
}

function freshnessWarning(latestReportGeneratedAt: string | null, now: Date): string | null {
  if (latestReportGeneratedAt !== null && !isOlderThanFreshnessWindow(latestReportGeneratedAt, now)) return null;
  return "Данные могли измениться после даты последнего отчета.";
}

function toConflictReadModel(conflict: VehicleFactConflictSnapshot): VehicleConflictReadModel {
  return {
    factKind: conflict.factKind,
    factKey: conflict.factKey,
    severity: conflict.severity,
    message: `Есть противоречия в поле ${conflict.factKey}.`,
    values: conflict.values.map((value) => ({
      value: value.value,
      observedAt: value.observedAt,
      reportedAt: value.reportedAt,
      isLatest: value.isLatest
    }))
  };
}

function compareNewestObservationFirst(
  left: NormalizedVehicleObservation,
  right: NormalizedVehicleObservation
): number {
  return (
    compareNullableIsoDesc(left.reportedAt, right.reportedAt) ||
    compareNullableIsoDesc(left.observedAt, right.observedAt) ||
    compareNullableIsoDesc(left.acceptedAt, right.acceptedAt) ||
    observationStableKey(left).localeCompare(observationStableKey(right))
  );
}

function compareNewestListingObservationFirst(
  left: NormalizedVehicleObservation,
  right: NormalizedVehicleObservation
): number {
  return (
    compareNullableIsoDesc(left.observedAt, right.observedAt) ||
    compareNullableIsoDesc(left.reportedAt, right.reportedAt) ||
    compareNullableIsoDesc(left.acceptedAt, right.acceptedAt) ||
    observationStableKey(left).localeCompare(observationStableKey(right))
  );
}

function compareMileageObservationOldestFirst(
  left: NormalizedVehicleObservation,
  right: NormalizedVehicleObservation
): number {
  return (
    compareNullableIsoAsc(left.observedAt, right.observedAt) ||
    compareNullableIsoAsc(left.reportedAt, right.reportedAt) ||
    compareNullableIsoAsc(left.acceptedAt, right.acceptedAt) ||
    observationStableKey(left).localeCompare(observationStableKey(right))
  );
}

function compareNullableIsoAsc(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}

function compareNullableIsoDesc(left: string | null, right: string | null): number {
  return compareNullableIsoAsc(right, left);
}

function latestIso(values: Array<string | null>): string | null {
  return values.filter((value): value is string => value !== null).sort().at(-1) ?? null;
}

function isOlderThanFreshnessWindow(generatedAt: string, now: Date): boolean {
  const date = new Date(generatedAt);
  if (!Number.isFinite(date.getTime())) return true;
  return now.getTime() - date.getTime() > FRESHNESS_WINDOW_MS;
}

function formatRussianDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "нет данных";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getUTCFullYear()}`;
}

function isRiskStatus(value: unknown): value is RiskStatus {
  return value === "found" || value === "not_found" || value === "unknown";
}

function isKeyBlock(value: string): value is KeyBlock {
  return value === "vehicle_passport" || value === "listings_or_mileage" || value === "risk_checks";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function observationStableKey(observation: NormalizedVehicleObservation): string {
  return observation.id ?? observation.valueHash;
}
