import { describe, expect, it } from "bun:test";
import type { ParsedReport } from "../parsing/report-parser";
import { normalizeParsedReportToObservations } from "./fact-normalizer";

const parsedReport: ParsedReport = {
  sourceKind: "autoteka_pdf",
  parserVersion: "autoteka-v1",
  status: "parsed",
  vin: "XTA210990Y2765499",
  generatedAt: "2026-05-01T00:00:00.000Z",
  vehicle: {
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
  listings: [
    {
      observedAt: "2026-04-15T00:00:00.000Z",
      priceRub: 780000,
      mileageKm: 42000,
      city: "Москва"
    }
  ],
  mileageReadings: [
    {
      observedAt: "2026-04-15T00:00:00.000Z",
      mileageKm: 42000,
      context: "listing"
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

describe("normalizeParsedReportToObservations", () => {
  it("turns vehicle passport, listings, mileage, risk flags, and key blocks into observations", () => {
    const observations = normalizeParsedReportToObservations({
      vehicleId: "vehicle-1",
      reportUploadId: "upload-1",
      acceptedAt: "2026-05-13T10:00:00.000Z",
      parsedReport
    });

    expect(observations.map((observation) => `${observation.factKind}:${observation.factKey}`)).toEqual([
      "identifier:vin",
      "passport:make",
      "passport:model",
      "passport:year",
      "passport:bodyType",
      "passport:color",
      "passport:engine",
      "passport:transmission",
      "passport:driveType",
      "listing:listing",
      "mileage:mileage",
      "risk_flag:accidents",
      "risk_flag:repairCalculations",
      "risk_flag:restrictions",
      "risk_flag:pledge",
      "risk_flag:wanted",
      "risk_flag:taxi",
      "risk_flag:leasing",
      "quality_marker:vehicle_passport",
      "quality_marker:listings_or_mileage",
      "quality_marker:risk_checks"
    ]);
    expect(observations[0]).toMatchObject({
      vehicleId: "vehicle-1",
      reportUploadId: "upload-1",
      factKind: "identifier",
      factKey: "vin",
      observedAt: "2026-05-01T00:00:00.000Z",
      reportedAt: "2026-05-01T00:00:00.000Z",
      acceptedAt: "2026-05-13T10:00:00.000Z",
      qualityScore: 1
    });
    expect(observations.every((observation) => observation.valueHash.length === 64)).toBe(true);
  });

  it("omits null passport values and deduplicates identical mileage/listing observations", () => {
    const observations = normalizeParsedReportToObservations({
      vehicleId: "vehicle-1",
      reportUploadId: "upload-1",
      acceptedAt: "2026-05-13T10:00:00.000Z",
      parsedReport: {
        ...parsedReport,
        vehicle: { ...parsedReport.vehicle, color: null },
        listings: [parsedReport.listings[0]!, parsedReport.listings[0]!],
        mileageReadings: [parsedReport.mileageReadings[0]!, parsedReport.mileageReadings[0]!]
      }
    });

    expect(observations.some((observation) => observation.factKey === "color")).toBe(false);
    expect(observations.filter((observation) => observation.factKind === "listing")).toHaveLength(1);
    expect(observations.filter((observation) => observation.factKind === "mileage")).toHaveLength(1);
  });

  it("rejects non-parsed reports before normalization", () => {
    expect(() =>
      normalizeParsedReportToObservations({
        vehicleId: "vehicle-1",
        reportUploadId: "upload-1",
        acceptedAt: "2026-05-13T10:00:00.000Z",
        parsedReport: { ...parsedReport, status: "manual_review" }
      })
    ).toThrow("parsed_report_required");
  });
});
