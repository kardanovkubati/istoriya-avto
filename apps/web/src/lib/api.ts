export type SearchDetectionResponse = {
  query: {
    kind: "vin" | "plate" | "listing_url" | "unsupported_url" | "unknown";
    normalized: string;
    original: string;
    host?: string;
  };
};

export type SearchResultResponse = {
  query: {
    kind: "vin" | "plate" | "listing_url" | "unknown";
    normalized: string;
  };
  candidates: Array<{
    id: string;
    kind: "vehicle" | "listing";
    match: "exact_vin" | "internal_plate" | "listing_snapshot";
    reportStatus: "available" | "missing";
    preview: {
      vehicleId: string | null;
      vinMasked: string | null;
      title: string;
      make: string | null;
      model: string | null;
      year: number | null;
      bodyType: string | null;
      color: string | null;
      engine: string | null;
      transmission: string | null;
      driveType: string | null;
      photo: { url: string; alt: string | null } | null;
      lastListing: {
        observedAt: string | null;
        priceRub: number | null;
        mileageKm: number | null;
        city: string | null;
      } | null;
      lastUpdatedAt: string | null;
    };
    unlock: {
      status: "locked" | "unavailable";
      canRequestUnlock: boolean;
      warning: string;
    };
  }>;
  emptyState: {
    code: "report_not_found" | "listing_snapshot_unavailable" | "unsupported_query";
    title: string;
    message: string;
    action: {
      kind: "upload_report";
      label: string;
    };
  } | null;
};

export type UnlockIntentResponse = {
  unlock:
    | {
        status: "locked";
        vinMasked: string;
        options: Array<"upload_report" | "choose_plan">;
        willSpendPoints: false;
        message: string;
        warning: string;
      }
    | {
        status: "granted";
        method: "already_opened" | "test_override";
      };
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export async function detectSearchQuery(query: string): Promise<SearchDetectionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/search/detect`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    throw new Error("Не удалось проверить запрос.");
  }

  return response.json() as Promise<SearchDetectionResponse>;
}

export async function searchVehicles(query: string): Promise<SearchResultResponse> {
  const response = await fetch(`${API_BASE_URL}/api/search`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    throw new Error("Не удалось выполнить поиск.");
  }

  return response.json() as Promise<SearchResultResponse>;
}

export async function createUnlockIntent(vin: string): Promise<UnlockIntentResponse> {
  const response = await fetch(`${API_BASE_URL}/api/vehicles/${encodeURIComponent(vin)}/unlock-intent`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error("Не удалось подготовить открытие отчета.");
  }

  return response.json() as Promise<UnlockIntentResponse>;
}
