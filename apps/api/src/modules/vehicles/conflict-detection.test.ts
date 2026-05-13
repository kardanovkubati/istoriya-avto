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

  it("collapses multiple mileage rollbacks into one conflict per vehicle", () => {
    const conflicts = detectVehicleFactConflicts([
      observation({
        id: "obs-1",
        factKind: "mileage",
        factKey: "mileage",
        value: { observedAt: "2026-01-01T00:00:00.000Z", mileageKm: 90000, context: "listing" },
        observedAt: "2026-01-01T00:00:00.000Z",
        reportedAt: "2026-01-01T00:00:00.000Z"
      }),
      observation({
        id: "obs-2",
        factKind: "mileage",
        factKey: "mileage",
        value: { observedAt: "2026-02-01T00:00:00.000Z", mileageKm: 70000, context: "listing" },
        observedAt: "2026-02-01T00:00:00.000Z",
        reportedAt: "2026-02-01T00:00:00.000Z"
      }),
      observation({
        id: "obs-3",
        factKind: "mileage",
        factKey: "mileage",
        value: { observedAt: "2026-03-01T00:00:00.000Z", mileageKm: 60000, context: "listing" },
        observedAt: "2026-03-01T00:00:00.000Z",
        reportedAt: "2026-03-01T00:00:00.000Z"
      })
    ]);

    expect(conflicts).toEqual([
      {
        vehicleId: "vehicle-1",
        factKind: "mileage",
        factKey: "mileage_rollback",
        severity: "critical",
        status: "open",
        values: [
          {
            observationIds: ["obs-3"],
            value: { observedAt: "2026-03-01T00:00:00.000Z", mileageKm: 60000, context: "listing" },
            observedAt: "2026-03-01T00:00:00.000Z",
            reportedAt: "2026-03-01T00:00:00.000Z",
            isLatest: true
          },
          {
            observationIds: ["obs-2"],
            value: { observedAt: "2026-02-01T00:00:00.000Z", mileageKm: 70000, context: "listing" },
            observedAt: "2026-02-01T00:00:00.000Z",
            reportedAt: "2026-02-01T00:00:00.000Z",
            isLatest: false
          },
          {
            observationIds: ["obs-1"],
            value: { observedAt: "2026-01-01T00:00:00.000Z", mileageKm: 90000, context: "listing" },
            observedAt: "2026-01-01T00:00:00.000Z",
            reportedAt: "2026-01-01T00:00:00.000Z",
            isLatest: false
          }
        ]
      }
    ]);
  });

  it("ignores undated mileage readings for rollback detection", () => {
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
        value: { observedAt: null, mileageKm: 45000, context: "listing" },
        observedAt: null
      })
    ]);

    expect(conflicts).toEqual([]);
  });

  it("does not create mileage rollback conflicts for readings with the same observedAt", () => {
    const conflicts = detectVehicleFactConflicts([
      observation({
        id: "obs-1",
        factKind: "mileage",
        factKey: "mileage",
        value: { observedAt: "2026-01-01T00:00:00.000Z", mileageKm: 70000, context: "listing" },
        observedAt: "2026-01-01T00:00:00.000Z",
        reportedAt: "2026-01-01T00:00:00.000Z"
      }),
      observation({
        id: "obs-2",
        factKind: "mileage",
        factKey: "mileage",
        value: { observedAt: "2026-01-01T00:00:00.000Z", mileageKm: 45000, context: "listing" },
        observedAt: "2026-01-01T00:00:00.000Z",
        reportedAt: "2026-02-01T00:00:00.000Z"
      })
    ]);

    expect(conflicts).toEqual([]);
  });

  it("groups semantically identical values with different key insertion order", () => {
    const conflicts = detectVehicleFactConflicts([
      observation({
        id: "obs-1",
        factKind: "passport",
        factKey: "engine",
        value: { field: "engine", value: "1.6" }
      }),
      observation({
        id: "obs-2",
        factKind: "passport",
        factKey: "engine",
        value: { value: "1.6", field: "engine" }
      })
    ]);

    expect(conflicts).toEqual([]);
  });

  it("sorts conflicts and tied values deterministically", () => {
    const conflicts = detectVehicleFactConflicts([
      observation({
        id: "obs-risk-b",
        vehicleId: "vehicle-b",
        factKind: "risk_flag",
        factKey: "wanted",
        value: { risk: "wanted", status: "found" }
      }),
      observation({
        id: "obs-model-b",
        factKind: "passport",
        factKey: "model",
        value: { field: "model", value: "Vesta" }
      }),
      observation({
        id: "obs-color-a",
        factKind: "passport",
        factKey: "color",
        value: { field: "color", value: "white" }
      }),
      observation({
        id: "obs-model-a",
        factKind: "passport",
        factKey: "model",
        value: { field: "model", value: "Granta" }
      }),
      observation({
        id: "obs-color-b",
        factKind: "passport",
        factKey: "color",
        value: { field: "color", value: "black" }
      }),
      observation({
        id: "obs-risk-a",
        vehicleId: "vehicle-b",
        factKind: "risk_flag",
        factKey: "wanted",
        value: { risk: "wanted", status: "not_found" }
      })
    ]);

    expect(conflicts.map((conflict) => `${conflict.vehicleId}:${conflict.factKind}:${conflict.factKey}`)).toEqual([
      "vehicle-1:passport:color",
      "vehicle-1:passport:model",
      "vehicle-b:risk_flag:wanted"
    ]);
    expect(conflicts[0]?.values.map((value) => value.observationIds)).toEqual([
      ["obs-color-b"],
      ["obs-color-a"]
    ]);
  });

  it("creates risk flag conflicts for found versus not_found", () => {
    const conflicts = detectVehicleFactConflicts([
      observation({
        id: "obs-1",
        factKind: "risk_flag",
        factKey: "pledge",
        value: { risk: "pledge", status: "found" }
      }),
      observation({
        id: "obs-2",
        factKind: "risk_flag",
        factKey: "pledge",
        value: { risk: "pledge", status: "not_found" }
      })
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      vehicleId: "vehicle-1",
      factKind: "risk_flag",
      factKey: "pledge",
      severity: "warning",
      status: "open"
    });
  });

  it("does not create risk flag conflicts for found or not_found versus unknown", () => {
    const conflicts = detectVehicleFactConflicts([
      observation({
        id: "obs-1",
        factKind: "risk_flag",
        factKey: "pledge",
        value: { risk: "pledge", status: "found" }
      }),
      observation({
        id: "obs-2",
        factKind: "risk_flag",
        factKey: "pledge",
        value: { risk: "pledge", status: "unknown" }
      }),
      observation({
        id: "obs-3",
        factKind: "risk_flag",
        factKey: "taxi",
        value: { risk: "taxi", status: "not_found" }
      }),
      observation({
        id: "obs-4",
        factKind: "risk_flag",
        factKey: "taxi",
        value: { risk: "taxi", status: "unknown" }
      })
    ]);

    expect(conflicts).toEqual([]);
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
