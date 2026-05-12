import { describe, expect, it } from "bun:test";
import type { ParsedReport } from "../parsing/report-parser";
import { evaluateParsedReportForPoints } from "./points-evaluation";

const NOW = new Date("2026-05-12T12:00:00.000Z");

const baseReport: ParsedReport = {
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
  listings: [],
  mileageReadings: [
    {
      observedAt: "2026-05-01T00:00:00.000Z",
      mileageKm: 45_000,
      context: "listing"
    }
  ],
  riskFlags: {
    accidents: "not_found",
    repairCalculations: "not_found",
    restrictions: "not_found",
    pledge: "not_found",
    wanted: "not_found",
    taxi: "not_found",
    leasing: "not_found"
  },
  keyBlocks: ["vehicle_passport", "listings_or_mileage", "risk_checks"],
  warnings: [],
  qualityScore: 1
};

describe("evaluateParsedReportForPoints", () => {
  it("grants for a fresh parsed report when policy facts allow it", () => {
    expect(
      evaluateParsedReportForPoints({
        parsedReport: baseReport,
        now: NOW,
        isFirstReportForVin: true,
        isNewerThanCurrentVinReport: true,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "grant",
      points: 1,
      reason: "fresh_valid_report"
    });
  });

  it("requires manual review for partial parsed reports", () => {
    expect(
      evaluateParsedReportForPoints({
        parsedReport: {
          ...baseReport,
          status: "manual_review",
          keyBlocks: ["vehicle_passport", "risk_checks"],
          warnings: [{ code: "insufficient_key_blocks", message: "Missing key report blocks." }],
          qualityScore: 0.67
        },
        now: NOW,
        isFirstReportForVin: true,
        isNewerThanCurrentVinReport: true,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "manual_review",
      points: 0,
      reason: "parser_manual_review_required"
    });
  });

  it("requires manual review when the parser marked the report for manual review", () => {
    expect(
      evaluateParsedReportForPoints({
        parsedReport: {
          ...baseReport,
          status: "manual_review",
          warnings: [{ code: "multiple_vins_found", message: "В отчете найдено несколько разных VIN." }]
        },
        now: NOW,
        isFirstReportForVin: true,
        isNewerThanCurrentVinReport: true,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "manual_review",
      points: 0,
      reason: "parser_manual_review_required"
    });
  });
});
