import { describe, expect, it } from "bun:test";
import { evaluateReportForPoints } from "./points-policy";

const NOW = new Date("2026-05-12T12:00:00.000Z");

describe("evaluateReportForPoints", () => {
  it("grants one point for a fresh valid report", () => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("2026-05-01T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount: 3,
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

  it("denies a second point for the same VIN for the same user forever", () => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("2026-05-01T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount: 5,
        isFirstReportForVin: false,
        isNewerThanCurrentVinReport: true,
        userHasEverReceivedPointForVin: true,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "deny",
      points: 0,
      reason: "user_already_rewarded_for_vin"
    });
  });

  it("grants for a 91-180 day report only when it is the first report for the VIN", () => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("2026-02-01T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount: 3,
        isFirstReportForVin: true,
        isNewerThanCurrentVinReport: false,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "grant",
      points: 1,
      reason: "first_report_for_vin_with_aging_data"
    });
  });

  it("denies stale reports older than 180 days", () => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("2025-09-01T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount: 6,
        isFirstReportForVin: true,
        isNewerThanCurrentVinReport: false,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "deny",
      points: 0,
      reason: "report_older_than_180_days"
    });
  });

  it("requires manual review when the same report fingerprint already reached the automatic grant limit", () => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("2026-05-01T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount: 4,
        isFirstReportForVin: false,
        isNewerThanCurrentVinReport: true,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 3
      })
    ).toEqual({
      decision: "manual_review",
      points: 0,
      reason: "fingerprint_auto_grant_limit_reached"
    });
  });

  it("requires manual review when parsing quality is too weak", () => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("2026-05-01T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount: 1,
        isFirstReportForVin: true,
        isNewerThanCurrentVinReport: true,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "manual_review",
      points: 0,
      reason: "insufficient_parsed_data"
    });
  });

  it("requires manual review for a future report generated date", () => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("2026-05-13T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount: 3,
        isFirstReportForVin: true,
        isNewerThanCurrentVinReport: true,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "manual_review",
      points: 0,
      reason: "future_report_generated_at"
    });
  });

  it("requires manual review for an invalid report generated date", () => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("invalid"),
        hasVin: true,
        parsedKeyBlockCount: 3,
        isFirstReportForVin: true,
        isNewerThanCurrentVinReport: true,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "manual_review",
      points: 0,
      reason: "invalid_report_date"
    });
  });

  it("requires manual review for an invalid current date", () => {
    expect(
      evaluateReportForPoints({
        now: new Date("invalid"),
        reportGeneratedAt: new Date("2026-05-01T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount: 3,
        isFirstReportForVin: true,
        isNewerThanCurrentVinReport: true,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "manual_review",
      points: 0,
      reason: "invalid_report_date"
    });
  });

  it.each([
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative", -1]
  ])("requires manual review for %s parsed key block count", (_, parsedKeyBlockCount) => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("2026-05-01T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount,
        isFirstReportForVin: true,
        isNewerThanCurrentVinReport: true,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "manual_review",
      points: 0,
      reason: "invalid_parsed_key_block_count"
    });
  });

  it("denies duplicate VIN rewards before checking weak parsing quality", () => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("2026-05-01T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount: 1,
        isFirstReportForVin: false,
        isNewerThanCurrentVinReport: true,
        userHasEverReceivedPointForVin: true,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount: 0
      })
    ).toEqual({
      decision: "deny",
      points: 0,
      reason: "user_already_rewarded_for_vin"
    });
  });

  it.each([
    ["negative", -1],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["fractional", 2.5]
  ])("requires manual review for %s automatic fingerprint grant count", (_, automaticFingerprintGrantCount) => {
    expect(
      evaluateReportForPoints({
        now: NOW,
        reportGeneratedAt: new Date("2026-05-01T12:00:00.000Z"),
        hasVin: true,
        parsedKeyBlockCount: 3,
        isFirstReportForVin: true,
        isNewerThanCurrentVinReport: true,
        userHasEverReceivedPointForVin: false,
        userHasEverReceivedPointForFingerprint: false,
        automaticFingerprintGrantCount
      })
    ).toEqual({
      decision: "manual_review",
      points: 0,
      reason: "invalid_fingerprint_grant_count"
    });
  });
});
