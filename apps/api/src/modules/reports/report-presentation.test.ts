import { describe, expect, it } from "bun:test";
import type { VehicleFullReportReadModel } from "../vehicles/report-read-model";
import { buildReportPresentation } from "./report-presentation";

describe("report presentation", () => {
  it("builds full report sections in approved order", () => {
    const presentation = buildReportPresentation({
      report: fullReport(),
      mode: "owner"
    });

    expect(presentation.noindex).toBe(true);
    expect(presentation.actions).toEqual({ canShare: true, canDownloadPdf: true });
    expect(presentation.sections.map((section) => section.id)).toEqual([
      "summary",
      "passport",
      "legal_risks",
      "accidents_repairs",
      "mileage",
      "owners_registrations",
      "listings",
      "commercial_use",
      "data_quality",
      "update_history"
    ]);
  });

  it("renders critical empty sections with the approved empty text", () => {
    const report = fullReport({
      legalRisks: {
        restrictions: { status: "unknown", checkedAt: null },
        pledge: { status: "unknown", checkedAt: null },
        wanted: { status: "unknown", checkedAt: null }
      },
      accidentsAndRepairs: {
        accidents: { status: "unknown", checkedAt: null },
        repairCalculations: { status: "unknown", checkedAt: null }
      },
      mileage: { readings: [], hasRollbackSignals: false }
    });

    const presentation = buildReportPresentation({ report, mode: "owner" });

    expect(presentation.sections.find((section) => section.id === "legal_risks")).toMatchObject({
      state: "empty",
      emptyText: "данных не найдено на дату обновления"
    });
    expect(presentation.sections.find((section) => section.id === "accidents_repairs")).toMatchObject({
      state: "empty",
      emptyText: "данных не найдено на дату обновления"
    });
    expect(presentation.sections.find((section) => section.id === "mileage")).toMatchObject({
      state: "empty",
      emptyText: "данных не найдено на дату обновления"
    });
  });

  it("disables share and pdf actions for share mode", () => {
    const presentation = buildReportPresentation({ report: fullReport(), mode: "share" });

    expect(presentation.actions).toEqual({ canShare: false, canDownloadPdf: false });
  });

  it("builds negative-first summary without purchase recommendations", () => {
    const presentation = buildReportPresentation({
      report: fullReport({
        accidentsAndRepairs: {
          accidents: { status: "found", checkedAt: "2026-05-01T00:00:00.000Z" },
          repairCalculations: { status: "found", checkedAt: "2026-05-01T00:00:00.000Z" }
        },
        mileage: {
          readings: [
            { observedAt: "2026-01-01T00:00:00.000Z", mileageKm: 120000, context: "listing" },
            { observedAt: "2026-04-01T00:00:00.000Z", mileageKm: 98000, context: "report" }
          ],
          hasRollbackSignals: true
        }
      }),
      mode: "owner"
    });

    expect(presentation.summarySignals.headline).toBe("Найдены сигналы, которые стоит проверить перед осмотром");
    expect(presentation.summarySignals.negativeSignals.map((signal) => signal.label)).toEqual([
      "ДТП",
      "Расчеты ремонта",
      "Пробег"
    ]);
    expect(presentation.summarySignals.expertChecks.map((check) => check.label)).toEqual([
      "Кузов",
      "Пробег"
    ]);
    expect(JSON.stringify(presentation)).not.toMatch(/можно брать|рекомендуем|хорошо|чисто|машина нормальная|прозрачн/i);
  });

  it("keeps neutral facts factual when risks are not found", () => {
    const presentation = buildReportPresentation({ report: fullReport(), mode: "owner" });

    expect(presentation.summarySignals.neutralFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Ограничения", value: "не найдены", tone: "good" }),
        expect.objectContaining({ label: "Залог", value: "не найден", tone: "good" }),
        expect.objectContaining({ label: "Розыск", value: "не найден", tone: "good" }),
        expect.objectContaining({ label: "Объявления", value: "1 запись", tone: "default" })
      ])
    );
    expect(presentation.summarySignals.negativeSignals).toEqual([]);
    expect(JSON.stringify(presentation)).not.toMatch(/хорошо|чисто|прозрачн/i);
  });
});

function fullReport(
  overrides: Partial<VehicleFullReportReadModel> = {}
): VehicleFullReportReadModel {
  const base: VehicleFullReportReadModel = {
    vehicleId: "vehicle-1",
    vin: "XTA210990Y2765499",
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
      vin: "XTA210990Y2765499",
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
      wanted: { status: "not_found", checkedAt: "2026-05-01T00:00:00.000Z" }
    },
    accidentsAndRepairs: {
      accidents: { status: "not_found", checkedAt: "2026-05-01T00:00:00.000Z" },
      repairCalculations: { status: "not_found", checkedAt: "2026-05-01T00:00:00.000Z" }
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

  return { ...base, ...overrides };
}
