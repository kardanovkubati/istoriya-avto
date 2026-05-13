import type { VehiclePreviewReadModel } from "../vehicles/report-read-model";
import { maskVinForPreview } from "../vehicles/report-read-model";

export type SearchQuerySummary = {
  kind: "vin" | "plate" | "listing_url" | "unknown";
  normalized: string;
};

export type SearchEmptyStateCode = "report_not_found" | "listing_snapshot_unavailable" | "unsupported_query";

export type SearchEmptyState = {
  code: SearchEmptyStateCode;
  title: string;
  message: string;
  action: {
    kind: "upload_report";
    label: "Загрузить отчет";
  };
};

export type CandidatePreviewPhoto = {
  url: string;
  alt: string | null;
};

export type SearchCandidatePreview = Omit<VehiclePreviewReadModel, "photo" | "vehicleId" | "vinMasked"> & {
  vehicleId: string | null;
  vinMasked: string | null;
  photo: CandidatePreviewPhoto | null;
};

export type SearchCandidate = {
  id: string;
  kind: "vehicle" | "listing";
  match: "exact_vin" | "listing";
  reportStatus: "available" | "missing";
  preview: SearchCandidatePreview;
  unlock: {
    status: "locked" | "unavailable";
    canRequestUnlock: boolean;
    warning: string | null;
  };
};

export type SearchResult = {
  query: SearchQuerySummary;
  candidates: SearchCandidate[];
  emptyState: SearchEmptyState | null;
};

export type ListingSnapshotPublicData = {
  vin: string | null;
  title: string;
  make: string | null;
  model: string | null;
  year: number | null;
  bodyType: string | null;
  color: string | null;
  engine: string | null;
  transmission: string | null;
  driveType: string | null;
  priceRub: number | null;
  mileageKm: number | null;
  city: string | null;
  photos: CandidatePreviewPhoto[];
};

type CreateVehicleCandidateInput = {
  match: "exact_vin";
  preview: VehiclePreviewReadModel;
};

type CreateListingCandidateInput = {
  sourceKind: "avito";
  listingId: string;
  observedAt: string;
  vehicleId: string | null;
  reportAvailable: boolean;
  snapshot: ListingSnapshotPublicData;
};

const UNLOCK_WARNING =
  "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается.";

const SOURCE_LEAK_PATTERNS = [
  /(sourceKind|source_kind|parserVersion|parser_version|originalObjectKey|original_object_key)/,
  /(^|[^A-Za-z0-9_])avito($|[^A-Za-z0-9_])/i,
  /(^|[^\p{L}\p{N}_])авито($|[^\p{L}\p{N}_])/iu,
  /(^|[^A-Za-z0-9_])autoteka($|[^A-Za-z0-9_])/i,
  /(^|[^\p{L}\p{N}_])автотек(?:а|и|е|у|ой|ою)?($|[^\p{L}\p{N}_])/iu,
  /(auto\.ru|авто\.ру)/i,
  /(^|[^A-Za-z0-9_])drom($|[^A-Za-z0-9_])/i,
  /(^|[^\p{L}\p{N}_])дром($|[^\p{L}\p{N}_])/iu
] as const;

export function createVehicleCandidate(input: CreateVehicleCandidateInput): SearchCandidate {
  const candidate: SearchCandidate = {
    id: `vehicle:${input.preview.vehicleId}`,
    kind: "vehicle",
    match: input.match,
    reportStatus: "available",
    preview: input.preview,
    unlock: lockedUnlock()
  };

  assertSafeSearchResponse(candidate);
  return candidate;
}

export function createListingCandidate(input: CreateListingCandidateInput): SearchCandidate {
  const candidate: SearchCandidate = {
    id: `listing:${input.listingId}`,
    kind: "listing",
    match: "listing",
    reportStatus: input.reportAvailable ? "available" : "missing",
    preview: {
      vehicleId: input.vehicleId,
      vinMasked: input.snapshot.vin === null ? null : maskVinForPreview(input.snapshot.vin),
      title: input.snapshot.title,
      make: input.snapshot.make,
      model: input.snapshot.model,
      year: input.snapshot.year,
      bodyType: input.snapshot.bodyType,
      color: input.snapshot.color,
      engine: input.snapshot.engine,
      transmission: input.snapshot.transmission,
      driveType: input.snapshot.driveType,
      photo: input.snapshot.photos[0] ?? null,
      lastListing: {
        observedAt: input.observedAt,
        priceRub: input.snapshot.priceRub,
        mileageKm: input.snapshot.mileageKm,
        city: input.snapshot.city
      },
      lastUpdatedAt: input.observedAt
    },
    unlock: input.reportAvailable ? lockedUnlock() : unavailableUnlock()
  };

  assertSafeSearchResponse(candidate);
  return candidate;
}

export function createEmptySearchResult(input: {
  query: SearchQuerySummary;
  code: SearchEmptyStateCode;
}): SearchResult {
  const result: SearchResult = {
    query: input.query,
    candidates: [],
    emptyState: emptyStateForCode(input.code)
  };

  assertSafeSearchResponse(result);
  return result;
}

export function emptyStateForCode(code: SearchEmptyStateCode): SearchEmptyState {
  if (code === "listing_snapshot_unavailable") {
    return {
      code,
      title: "Не удалось получить данные объявления",
      message: "Попробуйте поиск по VIN или загрузите отчет.",
      action: uploadReportAction()
    };
  }

  if (code === "unsupported_query") {
    return {
      code,
      title: "Запрос не распознан",
      message: "Введите VIN, госномер или публичную ссылку объявления.",
      action: uploadReportAction()
    };
  }

  return {
    code,
    title: "Отчета пока нет",
    message: "Загрузите свой отчет, и он может дать 1 балл на будущий просмотр.",
    action: uploadReportAction()
  };
}

export function assertSafeSearchResponse(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (SOURCE_LEAK_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error("search_response_leak");
  }
}

function lockedUnlock(): SearchCandidate["unlock"] {
  return {
    status: "locked",
    canRequestUnlock: true,
    warning: UNLOCK_WARNING
  };
}

function unavailableUnlock(): SearchCandidate["unlock"] {
  return {
    status: "unavailable",
    canRequestUnlock: false,
    warning: null
  };
}

function uploadReportAction(): SearchEmptyState["action"] {
  return {
    kind: "upload_report",
    label: "Загрузить отчет"
  };
}
