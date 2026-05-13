import { describe, expect, it } from "bun:test";
import type { ParsedReport } from "../parsing/report-parser";
import { detectVehicleFactConflicts } from "./conflict-detection";
import { normalizeParsedReportToObservations, type NormalizedVehicleObservation } from "./fact-normalizer";
import { buildVehicleReadModels } from "./report-read-model";

const vehicle = { id: "vehicle-1", vin: "XTA210990Y2765499" };

describe("vehicle report read model integration", () => {
  it("aggregates two parsed uploads into a neutral report with deterministic conflicts", () => {
    const firstUpload = parsedReport({
      generatedAt: "2026-04-01T00:00:00.000Z",
      color: "white",
      mileageKm: 50000
    });
    const secondUpload = parsedReport({
      generatedAt: "2026-05-01T00:00:00.000Z",
      color: "black",
      mileageKm: 45000
    });

    const observations = withStableObservationIds([
      ...normalizeParsedReportToObservations({
        vehicleId: vehicle.id,
        reportUploadId: "upload-1",
        acceptedAt: "2026-05-13T10:00:00.000Z",
        parsedReport: firstUpload
      }),
      ...normalizeParsedReportToObservations({
        vehicleId: vehicle.id,
        reportUploadId: "upload-2",
        acceptedAt: "2026-05-13T11:00:00.000Z",
        parsedReport: secondUpload
      })
    ]);

    const conflicts = detectVehicleFactConflicts(observations);
    const result = buildVehicleReadModels({
      now: new Date("2026-05-13T12:00:00.000Z"),
      vehicle,
      observations,
      conflicts
    });

    expect(result.report.summary.sourceUploadCount).toBe(2);
    expect(result.report.passport.color).toBe("black");
    expect(result.report.conflicts.map((conflict) => conflict.factKey)).toEqual([
      "mileage_rollback",
      "color"
    ]);
    expect(result.report.summary.transparency.kind).toBe("score");
    expect(JSON.stringify(result)).not.toMatch(
      /autoteka|автотек|авито|auto\.ru|дром|drom|sourceKind|parserVersion/i
    );
  });
});

function withStableObservationIds(
  observations: NormalizedVehicleObservation[]
): NormalizedVehicleObservation[] {
  return observations.map((observation, index) => ({
    ...observation,
    id: `obs-${String(index + 1).padStart(2, "0")}`
  }));
}

function parsedReport(input: {
  generatedAt: string;
  color: string;
  mileageKm: number;
}): ParsedReport {
  return {
    sourceKind: "autoteka_pdf",
    parserVersion: "autoteka-v1",
    status: "parsed",
    vin: vehicle.vin,
    generatedAt: input.generatedAt,
    vehicle: {
      vin: vehicle.vin,
      make: "LADA",
      model: "Granta",
      year: 2021,
      bodyType: "sedan",
      color: input.color,
      engine: "1.6",
      transmission: "manual",
      driveType: "front"
    },
    listings: [
      {
        observedAt: input.generatedAt,
        priceRub: 780000,
        mileageKm: input.mileageKm,
        city: "Москва"
      }
    ],
    mileageReadings: [
      {
        observedAt: input.generatedAt,
        mileageKm: input.mileageKm,
        context: "report"
      }
    ],
    riskFlags: {
      accidents: "not_found",
      repairCalculations: "not_found",
      restrictions: "not_found",
      pledge: "not_found",
      wanted: "not_found",
      taxi: "unknown",
      leasing: "unknown"
    },
    keyBlocks: ["vehicle_passport", "listings_or_mileage", "risk_checks"],
    warnings: [],
    qualityScore: 1
  };
}
