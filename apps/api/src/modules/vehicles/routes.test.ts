import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type {
  VehicleFullReportReadModel,
  VehiclePreviewReadModel
} from "./report-read-model";
import type {
  ReportAccessDecision,
  ReportAccessService,
  UnlockCommitDecision,
  UnlockPreviewDecision
} from "../access/report-access-service";
import {
  REQUEST_IDENTITY_KEY,
  type RequestIdentity
} from "../context/request-context";
import { createVehicleRoutes, type VehicleRoutesDependencies } from "./routes";

const VALID_VIN = "XTA210990Y2765499";

describe("vehicle routes", () => {
  it("returns vehicle preview by VIN", async () => {
    const dependencies = createDependencies();
    const routes = createTestApp(dependencies);

    const response = await routes.request(`/api/vehicles/${VALID_VIN}/preview`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      preview: previewReadModel()
    });
    expect(dependencies.previewCalls).toEqual([VALID_VIN]);
    expect(dependencies.reportCalls).toEqual([]);
  });

  it("locks full report by default before repository lookup", async () => {
    const dependencies = createDependencies();
    const routes = createTestApp(dependencies, guestIdentity());

    const response = await routes.request(`/api/vehicles/${VALID_VIN}/report`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "auth_required",
        message: "Войдите, чтобы открыть полный отчет.",
        unlock: {
          status: "auth_required",
          vinMasked: "XTA2109********99",
          options: ["telegram", "max", "phone"],
          message: "Войдите, чтобы закрепить доступ к отчету.",
          warning:
            "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
        }
      }
    });
    expect(dependencies.reportCalls).toEqual([]);
  });

  it("returns full report only when access service grants access", async () => {
    const dependencies = createDependencies({
      accessService: {
        async canViewFullReport() {
          return { status: "granted", method: "test_override", vehicleId: "vehicle-1" };
        }
      } as unknown as ReportAccessService
    });
    const routes = createTestApp(dependencies, userIdentity());

    const response = await routes.request(`/api/vehicles/${VALID_VIN}/report`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ report: fullReportReadModel() });
    expect(dependencies.reportCalls).toEqual([VALID_VIN]);
  });

  it("returns full report by VIN without source brands", async () => {
    const dependencies = createDependencies({
      accessService: {
        async canViewFullReport() {
          return { status: "granted", method: "test_override", vehicleId: "vehicle-1" };
        }
      } as unknown as ReportAccessService
    });
    const routes = createTestApp(dependencies, userIdentity());

    const response = await routes.request(`/api/vehicles/${VALID_VIN}/report`);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(serialized).not.toContain("sourceKind");
    expect(serialized).not.toContain("Автотека");
    expect(serialized).not.toContain("Auto.ru");
    expect(serialized).not.toContain("Drom");
    expect(dependencies.reportCalls).toEqual([VALID_VIN]);
    expect(dependencies.previewCalls).toEqual([]);
  });

  it("returns guest unlock intent without revealing full report", async () => {
    const accessService = new FakeAccessService();
    accessService.previewResult = authRequiredPreview();
    const dependencies = createDependencies({
      accessService: accessService as unknown as ReportAccessService
    });
    const routes = createTestApp(dependencies, guestIdentity());

    const response = await routes.request(`/api/vehicles/${VALID_VIN}/unlock-intent`, {
      method: "POST"
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      unlock: {
        status: "auth_required",
        vinMasked: "XTA2109********99",
        options: ["telegram", "max", "phone"],
        message: "Войдите, чтобы закрепить доступ к отчету.",
        warning:
          "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
      }
    });
    expect(accessService.previewCalls).toEqual([
      {
        vehicle: { kind: "vin", vin: VALID_VIN },
        userId: null,
        guestSessionId: "guest-1"
      }
    ]);
    expect(dependencies.previewCalls).toEqual([]);
    expect(dependencies.reportCalls).toEqual([]);
  });

  it("passes user identity to full report access check", async () => {
    const accessService = new FakeAccessService();
    accessService.reportResult = { status: "locked", vinMasked: "XTA2109********99" };
    const dependencies = createDependencies({
      accessService: accessService as unknown as ReportAccessService
    });
    const routes = createTestApp(dependencies, userIdentity());

    const response = await routes.request(`/api/vehicles/${VALID_VIN}/report`);

    expect(response.status).toBe(403);
    expect(accessService.reportCalls).toEqual([
      {
        vin: VALID_VIN,
        userId: "user-1",
        guestSessionId: null
      }
    ]);
    expect(dependencies.reportCalls).toEqual([]);
  });

  it("commits unlock by VIN with an idempotency key", async () => {
    const accessService = new FakeAccessService();
    accessService.commitResult = {
      status: "granted",
      method: "subscription_limit",
      vehicleId: "vehicle-1",
      vin: VALID_VIN,
      entitlements: {
        plan: { code: "pro", name: "Pro" },
        remainingReports: 11,
        points: 3
      }
    };
    const dependencies = createDependencies({
      accessService: accessService as unknown as ReportAccessService
    });
    const routes = createTestApp(dependencies, userIdentity());

    const response = await routes.request(`/api/vehicles/${VALID_VIN}/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "unlock:user-1:vehicle-1" })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      access: {
        status: "granted",
        method: "subscription_limit",
        vehicleId: "vehicle-1",
        vin: VALID_VIN
      },
      entitlements: {
        plan: { code: "pro", name: "Pro" },
        remainingReports: 11,
        points: 3
      }
    });
    expect(accessService.unlockCalls).toEqual([
      {
        vehicle: { kind: "vin", vin: VALID_VIN },
        userId: "user-1",
        guestSessionId: null,
        idempotencyKey: "unlock:user-1:vehicle-1"
      }
    ]);
    expect(dependencies.reportCalls).toEqual([]);
  });

  it("returns auth_required for guest unlock commit", async () => {
    const accessService = new FakeAccessService();
    accessService.commitResult = {
      status: "auth_required",
      vinMasked: "XTA2109********99",
      options: ["telegram", "max", "phone"],
      message: "Войдите, чтобы закрепить доступ к отчету.",
      warning:
        "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
    };
    const dependencies = createDependencies({
      accessService: accessService as unknown as ReportAccessService
    });
    const routes = createTestApp(dependencies, guestIdentity());

    const response = await routes.request(`/api/vehicles/${VALID_VIN}/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "unlock:guest" })
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "auth_required",
        message: "Войдите, чтобы открыть полный отчет.",
        unlock: authRequiredPreview()
      }
    });
  });

  it("unlocks by vehicleId without returning full VIN", async () => {
    const accessService = new FakeAccessService();
    accessService.previewResult = {
      status: "ready",
      vehicleId: "vehicle-1",
      vinMasked: "XTA2109********99",
      spendOrder: "point",
      willSpendSubscriptionReport: false,
      willSpendPoints: true,
      pointsBalanceAfter: 0,
      remainingReportsAfter: 0,
      warning:
        "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
    };
    accessService.commitResult = {
      status: "granted",
      method: "point",
      vehicleId: "vehicle-1",
      vin: VALID_VIN,
      entitlements: {
        plan: null,
        remainingReports: 0,
        points: 0
      }
    };
    const dependencies = createDependencies({
      accessService: accessService as unknown as ReportAccessService
    });
    const routes = createTestApp(dependencies, userIdentity());

    const preview = await routes.request("/api/vehicles/by-id/vehicle-1/unlock-intent", {
      method: "POST"
    });
    const commit = await routes.request("/api/vehicles/by-id/vehicle-1/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "unlock:user-1:vehicle-1" })
    });

    expect(preview.status).toBe(200);
    expect(JSON.stringify(await preview.json())).not.toContain(VALID_VIN);
    expect(commit.status).toBe(200);
    const body = await commit.json();
    expect(body).toEqual({
      access: {
        status: "granted",
        method: "point",
        vehicleId: "vehicle-1",
        vinMasked: "XTA2109********99"
      },
      entitlements: {
        plan: null,
        remainingReports: 0,
        points: 0
      }
    });
    expect(JSON.stringify(body)).not.toContain(VALID_VIN);
    expect(accessService.unlockCalls[0]?.vehicle).toEqual({
      kind: "vehicle_id",
      vehicleId: "vehicle-1"
    });
  });

  it("rejects invalid VIN before repository lookup", async () => {
    const dependencies = createDependencies();
    const routes = createTestApp(dependencies);

    const response = await routes.request("/api/vehicles/not-a-vin/preview");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_vin",
        message: "Передайте корректный VIN."
      }
    });
    expect(dependencies.previewCalls).toEqual([]);
    expect(dependencies.reportCalls).toEqual([]);
  });

  it("returns neutral not found when preview snapshot is missing", async () => {
    const dependencies = createDependencies({
      findPreviewByVin: async () => null
    });
    const routes = createTestApp(dependencies);

    const response = await routes.request(`/api/vehicles/${VALID_VIN}/preview`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "vehicle_report_not_found",
        message: "Отчета по этому VIN пока нет."
      }
    });
  });

  it("prevents source brand leaks from stored snapshots", async () => {
    const dependencies = createDependencies({
      accessService: {
        async canViewFullReport() {
          return { status: "granted", method: "test_override", vehicleId: "vehicle-1" };
        }
      } as unknown as ReportAccessService,
      findFullReportByVin: async () => ({
        ...fullReportReadModel(),
        sourceKind: "Avito"
      }) as VehicleFullReportReadModel
    });
    const routes = createTestApp(dependencies, userIdentity());

    const response = await routes.request(`/api/vehicles/${VALID_VIN}/report`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "internal_error",
        message: "Внутренняя ошибка сервиса."
      }
    });
  });
});

function createDependencies(
  overrides: Partial<VehicleRoutesDependencies> = {}
): VehicleRoutesDependencies & { previewCalls: string[]; reportCalls: string[] } {
  const previewCalls: string[] = [];
  const reportCalls: string[] = [];

  return {
    previewCalls,
    reportCalls,
    accessService: overrides.accessService ?? (new FakeAccessService() as unknown as ReportAccessService),
    findPreviewByVin:
      overrides.findPreviewByVin ??
      (async (vin) => {
        previewCalls.push(vin);
        return previewReadModel();
      }),
    findFullReportByVin:
      overrides.findFullReportByVin ??
      (async (vin) => {
        reportCalls.push(vin);
        return fullReportReadModel();
      })
  };
}

function createTestApp(
  dependencies: VehicleRoutesDependencies,
  identity: RequestIdentity = guestIdentity()
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
  app.route("/api/vehicles", createVehicleRoutes(dependencies));
  return app;
}

function guestIdentity(): RequestIdentity {
  return {
    kind: "guest",
    guestSessionId: "guest-1",
    expiresAt: new Date("2026-05-21T10:00:00.000Z")
  };
}

function userIdentity(): RequestIdentity {
  return {
    kind: "user",
    userId: "user-1"
  };
}

function authRequiredPreview(): UnlockPreviewDecision {
  return {
    status: "auth_required",
    vinMasked: "XTA2109********99",
    options: ["telegram", "max", "phone"],
    message: "Войдите, чтобы закрепить доступ к отчету.",
    warning:
      "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
  };
}

class FakeAccessService {
  previewCalls: Array<{
    vehicle: { kind: "vin"; vin: string } | { kind: "vehicle_id"; vehicleId: string };
    userId: string | null;
    guestSessionId: string | null;
  }> = [];
  unlockCalls: Array<{
    vehicle: { kind: "vin"; vin: string } | { kind: "vehicle_id"; vehicleId: string };
    userId: string | null;
    guestSessionId: string | null;
    idempotencyKey: string;
  }> = [];
  reportCalls: Array<{ vin: string; userId: string | null; guestSessionId: string | null }> = [];
  previewResult: UnlockPreviewDecision = authRequiredPreview();
  commitResult: UnlockCommitDecision = {
    status: "auth_required",
    vinMasked: "XTA2109********99",
    options: ["telegram", "max", "phone"],
    message: "Войдите, чтобы закрепить доступ к отчету.",
    warning:
      "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
  };
  reportResult: ReportAccessDecision = {
    status: "auth_required",
    vinMasked: "XTA2109********99",
    options: ["telegram", "max", "phone"],
    message: "Войдите, чтобы закрепить доступ к отчету.",
    warning:
      "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
  };

  async previewUnlock(input: {
    vehicle: { kind: "vin"; vin: string } | { kind: "vehicle_id"; vehicleId: string };
    userId: string | null;
    guestSessionId: string | null;
  }) {
    this.previewCalls.push(input);
    return this.previewResult;
  }

  async unlock(input: {
    vehicle: { kind: "vin"; vin: string } | { kind: "vehicle_id"; vehicleId: string };
    userId: string | null;
    guestSessionId: string | null;
    idempotencyKey: string;
  }) {
    this.unlockCalls.push(input);
    return this.commitResult;
  }

  async canViewFullReport(input: {
    vin: string;
    userId: string | null;
    guestSessionId: string | null;
  }) {
    this.reportCalls.push(input);
    return this.reportResult;
  }
}

function previewReadModel(): VehiclePreviewReadModel {
  return {
    vehicleId: "vehicle-1",
    vinMasked: "XTA2109********99",
    title: "LADA Granta",
    make: "LADA",
    model: "Granta",
    year: 2021,
    bodyType: "sedan",
    color: "white",
    engine: "1.6",
    transmission: "manual",
    driveType: "front",
    photo: null,
    lastListing: {
      observedAt: "2026-04-15T00:00:00.000Z",
      priceRub: 780000,
      mileageKm: 42000,
      city: "Москва"
    },
    lastUpdatedAt: "2026-05-01T00:00:00.000Z"
  };
}

function fullReportReadModel(): VehicleFullReportReadModel {
  return {
    vehicleId: "vehicle-1",
    vin: VALID_VIN,
    generatedAt: "2026-05-13T10:00:00.000Z",
    summary: {
      historyBasisText:
        "История составлена на основе 2 загруженных отчетов. Последнее обновление: 01.05.2026.",
      sourceUploadCount: 2,
      lastUpdatedAt: "2026-05-01T00:00:00.000Z",
      freshnessWarning: null,
      transparency: {
        kind: "score",
        value: 4.4,
        max: 5,
        label: "История в целом прозрачна"
      }
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
      readings: [
        {
          observedAt: "2026-04-15T00:00:00.000Z",
          mileageKm: 42000,
          context: "listing"
        }
      ],
      hasRollbackSignals: false
    },
    listings: [
      {
        observedAt: "2026-04-15T00:00:00.000Z",
        priceRub: 780000,
        mileageKm: 42000,
        city: "Москва"
      }
    ],
    conflicts: [],
    updateHistory: [
      {
        reportedAt: "2026-05-01T00:00:00.000Z",
        acceptedAt: "2026-05-01T10:00:00.000Z"
      }
    ]
  };
}
