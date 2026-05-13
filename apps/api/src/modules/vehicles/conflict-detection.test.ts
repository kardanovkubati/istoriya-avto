import { describe, expect, it } from "bun:test";
import type { NormalizedVehicleObservation } from "./fact-normalizer";
import { detectVehicleFactConflicts } from "./conflict-detection";

describe("detectVehicleFactConflicts", () => {
  it("stores conflicting passport values instead of silently choosing one", () => {
    const conflicts = detectVehicleFactConflicts([
      observation({
        id: "obs-1",
        factKind: "passport",
        factKey: "color",
        value: { field: "color", value: "white" },
        reportedAt: "2026-04-01T00:00:00.000Z"
      }),
      observation({
        id: "obs-2",
        factKind: "passport",
        factKey: "color",
        value: { field: "color", value: "black" },
        reportedAt: "2026-05-01T00:00:00.000Z"
      })
    ]);

    expect(conflicts).toEqual([
      {
        vehicleId: "vehicle-1",
        factKind: "passport",
        factKey: "color",
        severity: "warning",
        status: "open",
        values: [
          {
            observationIds: ["obs-2"],
            value: { field: "color", value: "black" },
            observedAt: "2026-05-01T00:00:00.000Z",
            reportedAt: "2026-05-01T00:00:00.000Z",
            isLatest: true
          },
          {
            observationIds: ["obs-1"],
            value: { field: "color", value: "white" },
            observedAt: "2026-04-01T00:00:00.000Z",
            reportedAt: "2026-04-01T00:00:00.000Z",
            isLatest: false
          }
        ]
      }
    ]);
  });

  it("detects mileage rollback signals as critical conflicts", () => {
    const conflicts = detectVehicleFactConflicts([
      observation({
        id: "obs-1",
        factKind: "mileage",
        factKey: "mileage",
        value: { observedAt: "2026-01-01T00:00:00.000Z", mileageKm: 70000, context: "listing" },
        observedAt: "2026-01-01T00:00:00.000Z"
      }),
      observation({
        id: "obs-2",
        factKind: "mileage",
        factKey: "mileage",
        value: { observedAt: "2026-02-01T00:00:00.000Z", mileageKm: 45000, context: "listing" },
        observedAt: "2026-02-01T00:00:00.000Z"
      })
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      factKind: "mileage",
      factKey: "mileage_rollback",
      severity: "critical",
      status: "open"
    });
  });

  it("does not create conflicts for repeated identical values", () => {
    const conflicts = detectVehicleFactConflicts([
      observation({
        id: "obs-1",
        factKind: "passport",
        factKey: "make",
        value: { field: "make", value: "LADA" }
      }),
      observation({
        id: "obs-2",
        factKind: "passport",
        factKey: "make",
        value: { field: "make", value: "LADA" }
      })
    ]);

    expect(conflicts).toEqual([]);
  });
});

function observation(
  overrides: Partial<NormalizedVehicleObservation>
): NormalizedVehicleObservation {
  return {
    id: "obs",
    vehicleId: "vehicle-1",
    reportUploadId: "upload-1",
    factKind: "passport",
    factKey: "make",
    valueHash: "hash",
    value: { field: "make", value: "LADA" },
    observedAt: overrides.reportedAt ?? "2026-05-01T00:00:00.000Z",
    reportedAt: "2026-05-01T00:00:00.000Z",
    acceptedAt: "2026-05-13T10:00:00.000Z",
    qualityScore: 1,
    ...overrides
  };
}
