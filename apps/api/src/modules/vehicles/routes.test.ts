import { describe, expect, it } from "bun:test";
import type {
  VehicleFullReportReadModel,
  VehiclePreviewReadModel
} from "./report-read-model";
import { createVehicleRoutes, type VehicleRoutesDependencies } from "./routes";

const VALID_VIN = "XTA210990Y2765499";

describe("vehicle routes", () => {
  it("returns vehicle preview by VIN", async () => {
    const dependencies = createDependencies();
    const routes = createVehicleRoutes(dependencies);

    const response = await routes.request(`/${VALID_VIN}/preview`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      preview: previewReadModel()
    });
    expect(dependencies.previewCalls).toEqual([VALID_VIN]);
    expect(dependencies.reportCalls).toEqual([]);
  });

  it("returns full report by VIN without source brands", async () => {
    const dependencies = createDependencies();
    const routes = createVehicleRoutes(dependencies);

    const response = await routes.request(`/${VALID_VIN}/report`);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      report: fullReportReadModel()
    });
    expect(serialized).not.toContain("sourceKind");
    expect(serialized).not.toContain("Автотека");
    expect(serialized).not.toContain("Auto.ru");
    expect(serialized).not.toContain("Drom");
    expect(dependencies.reportCalls).toEqual([VALID_VIN]);
    expect(dependencies.previewCalls).toEqual([]);
  });

  it("rejects invalid VIN before repository lookup", async () => {
    const dependencies = createDependencies();
    const routes = createVehicleRoutes(dependencies);

    const response = await routes.request("/not-a-vin/preview");

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
    const routes = createVehicleRoutes(dependencies);

    const response = await routes.request(`/${VALID_VIN}/preview`);

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
      findFullReportByVin: async () => ({
        ...fullReportReadModel(),
        sourceKind: "Автотека"
      }) as VehicleFullReportReadModel
    });
    const routes = createVehicleRoutes(dependencies);

    const response = await routes.request(`/${VALID_VIN}/report`);

    expect(response.status).toBe(500);
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
