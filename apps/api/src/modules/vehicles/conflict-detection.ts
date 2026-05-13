import type { NormalizedVehicleObservation, VehicleFactKind } from "./fact-normalizer";

export type VehicleFactConflictSnapshot = {
  vehicleId: string;
  factKind: VehicleFactKind;
  factKey: string;
  severity: "info" | "warning" | "critical";
  status: "open";
  values: VehicleFactConflictValueSnapshot[];
};

type VehicleFactConflictValueSnapshot = {
  observationIds: string[];
  value: Record<string, unknown>;
  observedAt: string | null;
  reportedAt: string | null;
  isLatest: boolean;
};

const CONFLICTING_PASSPORT_FIELDS = new Set([
  "make",
  "model",
  "year",
  "bodyType",
  "color",
  "engine",
  "transmission",
  "driveType"
]);

export function detectVehicleFactConflicts(
  observations: NormalizedVehicleObservation[]
): VehicleFactConflictSnapshot[] {
  return [
    ...detectPassportConflicts(observations),
    ...detectRiskFlagConflicts(observations),
    ...detectMileageRollbackConflicts(observations)
  ];
}

function detectPassportConflicts(
  observations: NormalizedVehicleObservation[]
): VehicleFactConflictSnapshot[] {
  return groupObservations(
    observations.filter(
      (observation) =>
        observation.factKind === "passport" && CONFLICTING_PASSPORT_FIELDS.has(observation.factKey)
    )
  ).flatMap((group) => {
    const values = groupedConflictValues(group);
    if (values.length < 2) return [];

    const firstObservation = group[0];
    if (firstObservation === undefined) return [];

    return [
      {
        vehicleId: firstObservation.vehicleId,
        factKind: "passport",
        factKey: firstObservation.factKey,
        severity: "warning",
        status: "open",
        values
      }
    ];
  });
}

function detectRiskFlagConflicts(
  observations: NormalizedVehicleObservation[]
): VehicleFactConflictSnapshot[] {
  return groupObservations(
    observations.filter((observation) => observation.factKind === "risk_flag")
  ).flatMap((group) => {
    const statuses = new Set(group.map((observation) => observation.value.status));
    if (!statuses.has("found") || !statuses.has("not_found")) return [];

    const firstObservation = group[0];
    if (firstObservation === undefined) return [];

    return [
      {
        vehicleId: firstObservation.vehicleId,
        factKind: "risk_flag",
        factKey: firstObservation.factKey,
        severity: "warning",
        status: "open",
        values: groupedConflictValues(group)
      }
    ];
  });
}

function detectMileageRollbackConflicts(
  observations: NormalizedVehicleObservation[]
): VehicleFactConflictSnapshot[] {
  return groupObservations(
    observations.filter(
      (observation) =>
        observation.factKind === "mileage" &&
        observation.factKey === "mileage" &&
        typeof observation.value.mileageKm === "number"
    )
  ).flatMap((group) => {
    const sorted = [...group].sort(compareOldestFirst);
    const conflicts: VehicleFactConflictSnapshot[] = [];

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (previous === undefined || current === undefined) continue;

      if (
        typeof previous.value.mileageKm === "number" &&
        typeof current.value.mileageKm === "number" &&
        current.value.mileageKm < previous.value.mileageKm
      ) {
        conflicts.push({
          vehicleId: current.vehicleId,
          factKind: "mileage",
          factKey: "mileage_rollback",
          severity: "critical",
          status: "open",
          values: groupedConflictValues([previous, current])
        });
      }
    }

    return conflicts;
  });
}

function groupObservations(
  observations: NormalizedVehicleObservation[]
): NormalizedVehicleObservation[][] {
  const groups = new Map<string, NormalizedVehicleObservation[]>();

  for (const observation of observations) {
    const key = `${observation.vehicleId}:${observation.factKind}:${observation.factKey}`;
    const group = groups.get(key) ?? [];
    group.push(observation);
    groups.set(key, group);
  }

  return [...groups.values()];
}

function groupedConflictValues(
  observations: NormalizedVehicleObservation[]
): VehicleFactConflictValueSnapshot[] {
  const groups = new Map<string, NormalizedVehicleObservation[]>();

  for (const observation of observations) {
    const key = JSON.stringify(observation.value);
    const group = groups.get(key) ?? [];
    group.push(observation);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      const sortedGroup = [...group].sort(compareNewestFirst);
      const latest = sortedGroup[0] ?? group[0]!;

      return {
        observationIds: group.map((observation) => observation.id ?? observation.valueHash).sort(),
        value: latest.value,
        observedAt: latest.observedAt,
        reportedAt: latest.reportedAt,
        isLatest: false
      };
    })
    .sort((left, right) => compareConflictValuesNewestFirst(left, right))
    .map((value, index) => ({ ...value, isLatest: index === 0 }));
}

function compareOldestFirst(
  left: NormalizedVehicleObservation,
  right: NormalizedVehicleObservation
): number {
  return compareNullableIso(left.observedAt, right.observedAt) || compareNullableIso(left.reportedAt, right.reportedAt);
}

function compareNewestFirst(
  left: NormalizedVehicleObservation,
  right: NormalizedVehicleObservation
): number {
  return compareNullableIso(right.reportedAt, left.reportedAt) || compareNullableIso(right.observedAt, left.observedAt);
}

function compareConflictValuesNewestFirst(
  left: VehicleFactConflictValueSnapshot,
  right: VehicleFactConflictValueSnapshot
): number {
  return compareNullableIso(right.reportedAt, left.reportedAt) || compareNullableIso(right.observedAt, left.observedAt);
}

function compareNullableIso(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}
