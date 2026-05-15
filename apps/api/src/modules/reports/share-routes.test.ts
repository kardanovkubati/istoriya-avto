import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { ReportAccessDecision, ReportAccessService } from "../access/report-access-service";
import { REQUEST_IDENTITY_KEY, type RequestIdentity } from "../context/request-context";
import type { VehicleFullReportReadModel } from "../vehicles/report-read-model";
import { createReportShareRoutes } from "./share-routes";
import type { ResolvedShareLink, ShareLinkService } from "./share-link-service";

const VALID_VEHICLE_ID = "11111111-1111-4111-8111-111111111111";
const VALID_VIN = "XTA210990Y2765499";

describe("report share routes", () => {
  it("creates a share link for a user with report access", async () => {
    const accessService = new FakeAccessService();
    accessService.reportByVehicleIdResult = {
      status: "granted",
      method: "already_opened",
      vehicleId: VALID_VEHICLE_ID
    };
    const shareService = new FakeShareLinkService();
    const app = createTestApp(createDependencies({ accessService, shareService }), userIdentity());

    const response = await app.request(`/api/vehicles/by-id/${VALID_VEHICLE_ID}/share-links`, {
      method: "POST"
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      share: {
        token: "ia_sh_created",
        url: "http://localhost:5173/#/share/ia_sh_created",
        expiresAt: "2026-05-22T10:00:00.000Z"
      }
    });
    expect(accessService.reportByVehicleIdCalls).toEqual([
      {
        vehicleId: VALID_VEHICLE_ID,
        userId: "user-1",
        guestSessionId: null
      }
    ]);
    expect(shareService.createCalls).toEqual([
      {
        ownerUserId: "user-1",
        vehicleId: VALID_VEHICLE_ID
      }
    ]);
  });

  it("rejects guest share creation before creating a token", async () => {
    const shareService = new FakeShareLinkService();
    const app = createTestApp(createDependencies({ shareService }), guestIdentity());

    const response = await app.request(`/api/vehicles/by-id/${VALID_VEHICLE_ID}/share-links`, {
      method: "POST"
    });

    expect(response.status).toBe(401);
    expect(shareService.createCalls).toEqual([]);
  });

  it("returns share report without auth, pdf action, or resharing", async () => {
    const shareService = new FakeShareLinkService();
    shareService.resolvedShare = {
      id: "share-1",
      ownerUserId: "user-1",
      vehicleId: VALID_VEHICLE_ID,
      expiresAt: "2026-05-22T10:00:00.000Z"
    };
    const dependencies = createDependencies({ shareService });
    const app = createTestApp(dependencies, guestIdentity());

    const response = await app.request("/api/share/ia_sh_active/report");

    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await response.json()).toMatchObject({
      report: { vehicleId: VALID_VEHICLE_ID, vin: VALID_VIN },
      presentation: {
        noindex: true,
        actions: { canShare: false, canDownloadPdf: false }
      },
      share: { expiresAt: "2026-05-22T10:00:00.000Z" }
    });
    expect(dependencies.reportByVehicleIdCalls).toEqual([VALID_VEHICLE_ID]);
    expect(shareService.viewCalls).toEqual([shareService.resolvedShare]);
  });

  it("returns owner-only PDF export with noindex headers", async () => {
    const accessService = new FakeAccessService();
    accessService.reportByVehicleIdResult = {
      status: "granted",
      method: "already_opened",
      vehicleId: VALID_VEHICLE_ID
    };
    const dependencies = createDependencies({ accessService });
    const app = createTestApp(dependencies, userIdentity());

    const response = await app.request(`/api/vehicles/by-id/${VALID_VEHICLE_ID}/report.pdf`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).not.toContain("sourceKind");
    expect(text).not.toContain("Автотека");
    expect(dependencies.reportByVehicleIdCalls).toEqual([VALID_VEHICLE_ID]);
  });

  it("rejects guest PDF export before report lookup", async () => {
    const dependencies = createDependencies();
    const app = createTestApp(dependencies, guestIdentity());

    const response = await app.request(`/api/vehicles/by-id/${VALID_VEHICLE_ID}/report.pdf`);

    expect(response.status).toBe(401);
    expect(dependencies.reportByVehicleIdCalls).toEqual([]);
  });

  it("returns neutral not found for unknown or expired share token before report lookup", async () => {
    const dependencies = createDependencies();
    const app = createTestApp(dependencies, guestIdentity());

    const response = await app.request("/api/share/ia_sh_missing/report");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "share_link_not_found",
        message: "Ссылка недоступна или срок действия истек."
      }
    });
    expect(dependencies.reportByVehicleIdCalls).toEqual([]);
  });
});

type ReportShareRouteTestDependencies = {
  accessService: FakeAccessService;
  shareService: FakeShareLinkService;
  publicWebUrl: string;
  reportByVehicleIdCalls: string[];
  findFullReportByVehicleId(vehicleId: string): Promise<VehicleFullReportReadModel | null>;
};

function createDependencies(
  overrides: Partial<Pick<ReportShareRouteTestDependencies, "accessService" | "shareService">> = {}
): ReportShareRouteTestDependencies {
  const reportByVehicleIdCalls: string[] = [];
  return {
    accessService: overrides.accessService ?? new FakeAccessService(),
    shareService: overrides.shareService ?? new FakeShareLinkService(),
    publicWebUrl: "http://localhost:5173",
    reportByVehicleIdCalls,
    findFullReportByVehicleId: async (vehicleId: string) => {
      reportByVehicleIdCalls.push(vehicleId);
      return fullReportReadModel();
    }
  };
}

function createTestApp(
  dependencies: ReportShareRouteTestDependencies,
  identity: RequestIdentity
) {
  const app = new Hono<{
    Variables: {
      requestIdentity: RequestIdentity;
    };
  }>();
  app.use("*", async (context, next) => {
    context.set(REQUEST_IDENTITY_KEY, identity);
    await next();
  });
  app.route(
    "/api",
    createReportShareRoutes({
      accessService: dependencies.accessService as unknown as ReportAccessService,
      shareService: dependencies.shareService as unknown as ShareLinkService,
      publicWebUrl: dependencies.publicWebUrl,
      findFullReportByVehicleId: dependencies.findFullReportByVehicleId
    })
  );
  return app;
}

function userIdentity(): RequestIdentity {
  return { kind: "user", userId: "user-1" };
}

function guestIdentity(): RequestIdentity {
  return {
    kind: "guest",
    guestSessionId: "guest-1",
    expiresAt: new Date("2026-05-22T10:00:00.000Z")
  };
}

class FakeAccessService {
  reportByVehicleIdCalls: Array<{
    vehicleId: string;
    userId: string | null;
    guestSessionId: string | null;
  }> = [];
  reportByVehicleIdResult: ReportAccessDecision = {
    status: "auth_required",
    vehicleId: VALID_VEHICLE_ID,
    vinMasked: "XTA2109********99",
    options: ["telegram", "max", "phone"],
    message: "Войдите, чтобы закрепить доступ к отчету.",
    warning:
      "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
  };

  async canViewFullReportByVehicleId(input: {
    vehicleId: string;
    userId: string | null;
    guestSessionId: string | null;
  }) {
    this.reportByVehicleIdCalls.push(input);
    return this.reportByVehicleIdResult;
  }
}

class FakeShareLinkService {
  createCalls: Array<{ ownerUserId: string; vehicleId: string }> = [];
  viewCalls: ResolvedShareLink[] = [];
  resolvedShare: ResolvedShareLink | null = null;

  async create(input: { ownerUserId: string; vehicleId: string }) {
    this.createCalls.push(input);
    return {
      token: "ia_sh_created",
      expiresAt: "2026-05-22T10:00:00.000Z"
    };
  }

  async resolve() {
    return this.resolvedShare;
  }

  async recordView(share: ResolvedShareLink) {
    this.viewCalls.push(share);
  }
}

function fullReportReadModel(): VehicleFullReportReadModel {
  return {
    vehicleId: VALID_VEHICLE_ID,
    vin: VALID_VIN,
    generatedAt: "2026-05-15T10:00:00.000Z",
    summary: {
      historyBasisText:
        "История составлена на основе 2 загруженных отчетов. Последнее обновление: 01.05.2026.",
      sourceUploadCount: 2,
      lastUpdatedAt: "2026-05-01T00:00:00.000Z",
      freshnessWarning: null,
      transparency: { kind: "score", value: 4.4, max: 5, label: "История в целом прозрачна" }
    },
    passport: {
      vin: VALID_VIN,
      make: "LADA",
      model: "Granta",
      year: 2021,
      bodyType: "sedan",
      color: "white",
      engine: "1.6",
      transmission: "manual",
      driveType: "front"
    },
    legalRisks: {
      restrictions: { status: "not_found", checkedAt: "2026-05-01T00:00:00.000Z" },
      pledge: { status: "not_found", checkedAt: "2026-05-01T00:00:00.000Z" },
      wanted: { status: "unknown", checkedAt: null }
    },
    accidentsAndRepairs: {
      accidents: { status: "not_found", checkedAt: "2026-05-01T00:00:00.000Z" },
      repairCalculations: { status: "found", checkedAt: "2026-05-01T00:00:00.000Z" }
    },
    commercialUse: {
      taxi: { status: "not_found", checkedAt: "2026-05-01T00:00:00.000Z" },
      leasing: { status: "unknown", checkedAt: null }
    },
    mileage: {
      readings: [{ observedAt: "2026-04-15T00:00:00.000Z", mileageKm: 42000, context: "listing" }],
      hasRollbackSignals: false
    },
    listings: [{ observedAt: "2026-04-15T00:00:00.000Z", priceRub: 780000, mileageKm: 42000, city: "Москва" }],
    conflicts: [],
    updateHistory: [{ reportedAt: "2026-05-01T00:00:00.000Z", acceptedAt: "2026-05-01T10:00:00.000Z" }]
  };
}
