import { describe, expect, it } from "bun:test";
import type { VehicleFullReportReadModel } from "../vehicles/report-read-model";
import { renderReportPdf } from "./report-pdf";
import { buildReportPresentation } from "./report-presentation";

const VIN = "XTA210990Y2765499";

describe("report pdf", () => {
  it("renders a valid PDF without source brands", () => {
    const bytes = renderReportPdf({
      title: "LADA Granta",
      presentation: buildReportPresentation({ report: fullReport(), mode: "owner" })
    });
    const text = new TextDecoder().decode(bytes);

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("Istoriya Avto");
    expect(text).not.toContain("sourceKind");
    expect(text).not.toContain("Автотека");
    expect(text).not.toContain("Auto.ru");
    expect(text).not.toContain("Drom");
  });
});

function fullReport(): VehicleFullReportReadModel {
  return {
    vehicleId: "vehicle-1",
    vin: VIN,
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
      vin: VIN,
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
