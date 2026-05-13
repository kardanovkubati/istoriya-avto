import { describe, expect, it } from "bun:test";
import type { VehicleFactConflictSnapshot } from "./conflict-detection";
import { calculateTransparencyScore } from "./transparency-score";

describe("calculateTransparencyScore", () => {
  it("returns insufficient data without a fresh report", () => {
    expect(
      calculateTransparencyScore({
        now: new Date("2026-05-13T00:00:00.000Z"),
        vin: "XTA210990Y2765499",
        latestReportGeneratedAt: "2026-01-01T00:00:00.000Z",
        keyBlocks: ["vehicle_passport", "listings_or_mileage", "risk_checks"],
        sourceUploadCount: 1,
        riskStatuses: { accidents: "not_found", restrictions: "not_found" },
        conflicts: []
      })
    ).toEqual({
      kind: "insufficient_data",
      message: "Недостаточно данных для оценки.",
      reasons: ["latest_report_is_stale"]
    });
  });

  it("returns insufficient data without all three key blocks", () => {
    expect(
      calculateTransparencyScore({
        now: new Date("2026-05-13T00:00:00.000Z"),
        vin: "XTA210990Y2765499",
        latestReportGeneratedAt: "2026-05-01T00:00:00.000Z",
        keyBlocks: ["vehicle_passport", "risk_checks"],
        sourceUploadCount: 1,
        riskStatuses: { accidents: "not_found", restrictions: "not_found" },
        conflicts: []
      })
    ).toEqual({
      kind: "insufficient_data",
      message: "Недостаточно данных для оценки.",
      reasons: ["missing_key_blocks"]
    });
  });

  it("calculates a bounded score and label from risks and conflicts", () => {
    const result = calculateTransparencyScore({
      now: new Date("2026-05-13T00:00:00.000Z"),
      vin: "XTA210990Y2765499",
      latestReportGeneratedAt: "2026-05-01T00:00:00.000Z",
      keyBlocks: ["vehicle_passport", "listings_or_mileage", "risk_checks"],
      sourceUploadCount: 2,
      riskStatuses: { accidents: "found", restrictions: "not_found", pledge: "not_found" },
      conflicts: [
        conflict("passport", "color", "warning"),
        conflict("mileage", "mileage_rollback", "critical")
      ]
    });

    expect(result).toEqual({
      kind: "score",
      value: 3.4,
      max: 5,
      label: "Есть вопросы"
    });
  });
});

function conflict(
  factKind: VehicleFactConflictSnapshot["factKind"],
  factKey: string,
  severity: "info" | "warning" | "critical"
): VehicleFactConflictSnapshot {
  return {
    vehicleId: "vehicle-1",
    factKind,
    factKey,
    severity,
    status: "open",
    values: []
  };
}
