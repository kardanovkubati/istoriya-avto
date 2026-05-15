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

export type ContextResponse = {
  session: { kind: "guest"; expiresAt: string } | { kind: "user" };
  account: null | {
    id: string;
    primaryContactProvider: "phone" | "telegram" | "max" | null;
    identities: Array<"phone" | "telegram" | "max">;
  };
  entitlements: {
    plan: null | { code: string; name: string };
    remainingReports: number;
    points: number;
  };
};

export type UnlockIntentResponse = {
  unlock:
    | {
        status: "auth_required";
        vinMasked: string;
        message: string;
        warning: string;
        options: ["telegram", "max", "phone"];
      }
    | {
        status: "payment_required";
        vinMasked: string;
        message: string;
        options: Array<"upload_report" | "choose_plan">;
        willSpendPoints: false;
      }
    | {
        status: "ready";
        vehicleId: string;
        vinMasked: string;
        spendOrder: "subscription" | "point";
        willSpendSubscriptionReport: boolean;
        willSpendPoints: boolean;
        pointsBalanceAfter: number;
        remainingReportsAfter: number;
        warning: string;
      }
    | {
        status: "already_opened";
        vehicleId: string;
        vinMasked: string;
        warning: string;
      }
    | {
        status: "not_found";
      };
};

export type UnlockCommitResponse = {
  access: {
    status: "granted";
    method: "subscription_limit" | "point" | "already_opened";
    vehicleId: string;
    vin?: string;
    vinMasked?: string;
  };
  entitlements: ContextResponse["entitlements"];
};

export type ReportPresentation = {
  generatedAt: string;
  noindex: true;
  disclaimer: string;
  watermark: string;
  actions: { canShare: boolean; canDownloadPdf: boolean };
  sections: Array<{
    id:
      | "summary"
      | "passport"
      | "legal_risks"
      | "accidents_repairs"
      | "mileage"
      | "owners_registrations"
      | "listings"
      | "commercial_use"
      | "maintenance"
      | "data_quality"
      | "update_history";
    title: string;
    critical: boolean;
    state: "ready" | "empty";
    emptyText?: "данных не найдено на дату обновления";
    items: Array<{
      label: string;
      value: string;
      tone?: "default" | "good" | "warning" | "danger";
      date?: string | null;
    }>;
  }>;
};

export type VehicleFullReportResponse = {
  report: {
    vehicleId: string;
    vin: string;
    generatedAt: string;
    summary: {
      historyBasisText: string;
      sourceUploadCount: number;
      lastUpdatedAt: string | null;
      freshnessWarning: string | null;
      transparency:
        | { kind: "score"; value: number; max: 5; label: string }
        | { kind: "insufficient_data"; message: string; reasons: string[] };
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
  };
  presentation: ReportPresentation;
  share?: { expiresAt: string };
};

export type CreateShareLinkResponse = {
  share: {
    token: string;
    url: string;
    expiresAt: string;
  };
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export async function fetchContext(): Promise<ContextResponse> {
  const response = await fetch(`${API_BASE_URL}/api/context`, {
    method: "GET",
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error("Не удалось загрузить статус аккаунта.");
  }

  return response.json() as Promise<ContextResponse>;
}

export const getContext = fetchContext;

export async function detectSearchQuery(query: string): Promise<SearchDetectionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/search/detect`, {
    method: "POST",
    credentials: "include",
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
    credentials: "include",
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
    method: "POST",
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error("Не удалось подготовить открытие отчета.");
  }

  return response.json() as Promise<UnlockIntentResponse>;
}

export async function createUnlockIntentByVehicleId(vehicleId: string): Promise<UnlockIntentResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/vehicles/by-id/${encodeURIComponent(vehicleId)}/unlock-intent`,
    {
      method: "POST",
      credentials: "include"
    }
  );

  if (!response.ok) {
    throw new Error("Не удалось подготовить открытие отчета.");
  }

  return response.json() as Promise<UnlockIntentResponse>;
}

export async function unlockVehicleReport(input: {
  vin?: string | undefined;
  vehicleId?: string | undefined;
  idempotencyKey: string;
}): Promise<UnlockCommitResponse> {
  let path: string;
  if (input.vin) {
    path = `/api/vehicles/${encodeURIComponent(input.vin)}/unlock`;
  } else {
    const vehicleId = input.vehicleId;
    if (!vehicleId) {
      throw new Error("Не удалось определить отчет.");
    }
    path = `/api/vehicles/by-id/${encodeURIComponent(vehicleId)}/unlock`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ idempotencyKey: input.idempotencyKey })
  });

  if (!response.ok) {
    throw new Error("Не удалось открыть отчет.");
  }

  return response.json() as Promise<UnlockCommitResponse>;
}

export async function fetchFullReportByVehicleId(vehicleId: string): Promise<VehicleFullReportResponse> {
  const response = await fetch(`${API_BASE_URL}/api/vehicles/by-id/${encodeURIComponent(vehicleId)}/report`, {
    method: "GET",
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error("Не удалось загрузить полный отчет.");
  }

  return response.json() as Promise<VehicleFullReportResponse>;
}

export async function createShareLink(vehicleId: string): Promise<CreateShareLinkResponse> {
  const response = await fetch(`${API_BASE_URL}/api/vehicles/by-id/${encodeURIComponent(vehicleId)}/share-links`, {
    method: "POST",
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error("Не удалось создать share-ссылку.");
  }

  return response.json() as Promise<CreateShareLinkResponse>;
}

export async function fetchSharedReport(token: string): Promise<VehicleFullReportResponse> {
  const response = await fetch(`${API_BASE_URL}/api/share/${encodeURIComponent(token)}/report`, {
    method: "GET",
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error("Ссылка недоступна или срок действия истек.");
  }

  return response.json() as Promise<VehicleFullReportResponse>;
}

export function reportPdfUrl(vehicleId: string): string {
  return `${API_BASE_URL}/api/vehicles/by-id/${encodeURIComponent(vehicleId)}/report.pdf`;
}
