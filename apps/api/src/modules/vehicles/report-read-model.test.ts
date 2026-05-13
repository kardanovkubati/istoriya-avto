import { describe, expect, it } from "bun:test";
import type { VehicleFactConflictSnapshot } from "./conflict-detection";
import type { NormalizedVehicleObservation } from "./fact-normalizer";
import { assertNoSourceBrandLeak, buildVehicleReadModels, maskVinForPreview } from "./report-read-model";

describe("vehicle report read model helpers", () => {
  it("masks VIN for preview without exposing plate data", () => {
    expect(maskVinForPreview("XTA210990Y2765499")).toBe("XTA2109********99");
  });

  it("does not fail neutral user-facing responses", () => {
    expect(() =>
      assertNoSourceBrandLeak({
        summary: {
          historyBasisText:
            "История составлена на основе 2 загруженных отчетов. Последнее обновление: 01.05.2026."
        }
      })
    ).not.toThrow();
  });

  it("fails if a user-facing response contains third-party source names or internal source fields", () => {
    const unsafePayloads = [
      { sourceKind: "autoteka_pdf" },
      { parserVersion: "autoteka-v1" },
      { originalObjectKey: "report-originals/1.pdf" },
      { source_kind: "autoru_listing" },
      { parser_version: "autoru-v1" },
      { original_object_key: "report-originals/1.json" },
      { text: "Факт получен из Автотеки" },
      { text: "Источник: Авито" },
      { text: "Источник: Auto.ru" },
      { text: "Источник: Авто.ру" },
      { text: "Источник: Дром" },
      { text: "Источник: Drom" }
    ];

    for (const payload of unsafePayloads) {
      expect(() => assertNoSourceBrandLeak(payload)).toThrow("source_brand_leak");
    }
  });
});

describe("buildVehicleReadModels", () => {
  it("builds preview and full report without source brands", () => {
    const result = buildVehicleReadModels({
      now: new Date("2026-05-13T10:00:00.000Z"),
      vehicle: { id: "vehicle-1", vin: "XTA210990Y2765499" },
      observations: [
        observation("identifier", "vin", { vin: "XTA210990Y2765499" }),
        observation("passport", "make", { field: "make", value: "LADA" }),
        observation("passport", "model", { field: "model", value: "Granta" }),
        observation("passport", "year", { field: "year", value: 2021 }),
        observation("listing", "listing", {
          observedAt: "2026-04-15T00:00:00.000Z",
          priceRub: 780000,
          mileageKm: 42000,
          city: "Москва"
        }),
        observation("mileage", "mileage", {
          observedAt: "2026-04-15T00:00:00.000Z",
          mileageKm: 42000,
          context: "listing"
        }),
        observation("risk_flag", "accidents", { risk: "accidents", status: "not_found" }),
        observation("risk_flag", "repairCalculations", {
          risk: "repairCalculations",
          status: "not_found"
        }),
        observation("risk_flag", "restrictions", { risk: "restrictions", status: "not_found" }),
        observation("risk_flag", "pledge", { risk: "pledge", status: "not_found" }),
        observation("risk_flag", "wanted", { risk: "wanted", status: "not_found" }),
        observation("risk_flag", "taxi", { risk: "taxi", status: "unknown" }),
        observation("risk_flag", "leasing", { risk: "leasing", status: "unknown" }),
        observation("quality_marker", "vehicle_passport", { keyBlock: "vehicle_passport" }),
        observation("quality_marker", "listings_or_mileage", { keyBlock: "listings_or_mileage" }),
        observation("quality_marker", "risk_checks", { keyBlock: "risk_checks" })
      ],
      conflicts: []
    });

    expect(result.preview).toMatchObject({
      vehicleId: "vehicle-1",
      vinMasked: "XTA2109********99",
      title: "LADA Granta",
      make: "LADA",
      model: "Granta",
      year: 2021,
      photo: null,
      lastListing: {
        observedAt: "2026-04-15T00:00:00.000Z",
        priceRub: 780000,
        mileageKm: 42000,
        city: "Москва"
      },
      lastUpdatedAt: "2026-05-01T00:00:00.000Z"
    });
    expect(result.report.summary.historyBasisText).toBe(
      "История составлена на основе 1 загруженного отчета. Последнее обновление: 01.05.2026."
    );
    expect(result.report.summary.transparency.kind).toBe("score");
    expect(result.report.legalRisks.restrictions.status).toBe("not_found");
    expect(result.report.mileage.hasRollbackSignals).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/autoteka|автотек|авито|auto\.ru|дром|drom|sourceKind|parserVersion/i);
  });

  it("includes conflicts in the full report", () => {
    const conflict: VehicleFactConflictSnapshot = {
      vehicleId: "vehicle-1",
      factKind: "passport",
      factKey: "color",
      severity: "warning",
      status: "open",
      values: [
        {
          observationIds: ["obs-1"],
          value: { field: "color", value: "black" },
          observedAt: "2026-05-01T00:00:00.000Z",
          reportedAt: "2026-05-01T00:00:00.000Z",
          isLatest: true
        },
        {
          observationIds: ["obs-2"],
          value: { field: "color", value: "white" },
          observedAt: "2026-04-01T00:00:00.000Z",
          reportedAt: "2026-04-01T00:00:00.000Z",
          isLatest: false
        }
      ]
    };

    const result = buildVehicleReadModels({
      now: new Date("2026-05-13T10:00:00.000Z"),
      vehicle: { id: "vehicle-1", vin: "XTA210990Y2765499" },
      observations: [
        observation("identifier", "vin", { vin: "XTA210990Y2765499" }),
        observation("quality_marker", "vehicle_passport", { keyBlock: "vehicle_passport" }),
        observation("quality_marker", "listings_or_mileage", { keyBlock: "listings_or_mileage" }),
        observation("quality_marker", "risk_checks", { keyBlock: "risk_checks" })
      ],
      conflicts: [conflict]
    });

    expect(result.report.conflicts).toEqual([
      {
        factKind: "passport",
        factKey: "color",
        severity: "warning",
        message: "Есть противоречия в поле color.",
        values: [
          {
            value: { field: "color", value: "black" },
            observedAt: "2026-05-01T00:00:00.000Z",
            reportedAt: "2026-05-01T00:00:00.000Z",
            isLatest: true
          },
          {
            value: { field: "color", value: "white" },
            observedAt: "2026-04-01T00:00:00.000Z",
            reportedAt: "2026-04-01T00:00:00.000Z",
            isLatest: false
          }
        ]
      }
    ]);
  });
});

function observation(
  factKind: NormalizedVehicleObservation["factKind"],
  factKey: string,
  value: Record<string, unknown>
): NormalizedVehicleObservation {
  return {
    id: `${factKind}-${factKey}`,
    vehicleId: "vehicle-1",
    reportUploadId: "upload-1",
    factKind,
    factKey,
    valueHash: `${factKind}-${factKey}-hash`,
    value,
    observedAt: (value.observedAt as string | null) ?? "2026-05-01T00:00:00.000Z",
    reportedAt: "2026-05-01T00:00:00.000Z",
    acceptedAt: "2026-05-13T10:00:00.000Z",
    qualityScore: 1
  };
}
