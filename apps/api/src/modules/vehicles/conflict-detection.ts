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
  ].sort(compareConflicts);
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
        observation.observedAt !== null &&
        typeof observation.value.mileageKm === "number"
    )
  ).flatMap((group) => {
    const sorted = [...group].sort(compareOldestFirst);
    const rollbackObservations = new Set<NormalizedVehicleObservation>();
    let priorMaxMileage: number | null = null;
    let priorMaxObservations: NormalizedVehicleObservation[] = [];

    for (const sameDateObservations of groupByObservedAt(sorted)) {
      const currentDateMax = maxMileageObservations(sameDateObservations);

      if (priorMaxMileage !== null) {
        for (const current of sameDateObservations) {
          if (typeof current.value.mileageKm !== "number" || current.value.mileageKm >= priorMaxMileage) continue;

          for (const priorMaxObservation of priorMaxObservations) {
            rollbackObservations.add(priorMaxObservation);
          }
          rollbackObservations.add(current);
        }
      }

      if (currentDateMax.mileageKm !== null && (priorMaxMileage === null || currentDateMax.mileageKm > priorMaxMileage)) {
        priorMaxMileage = currentDateMax.mileageKm;
        priorMaxObservations = currentDateMax.observations;
      }
    }

    if (rollbackObservations.size === 0) return [];

    const firstObservation = sorted[0];
    if (firstObservation === undefined) return [];

    return [
      {
        vehicleId: firstObservation.vehicleId,
        factKind: "mileage",
        factKey: "mileage_rollback",
        severity: "critical",
        status: "open",
        values: groupedConflictValues([...rollbackObservations])
      }
    ];
  });
}

function groupByObservedAt(
  observations: NormalizedVehicleObservation[]
): NormalizedVehicleObservation[][] {
  const groups: NormalizedVehicleObservation[][] = [];

  for (const observation of observations) {
    const lastGroup = groups[groups.length - 1];
    const lastObservation = lastGroup?.[0];

    if (lastGroup !== undefined && lastObservation?.observedAt === observation.observedAt) {
      lastGroup.push(observation);
      continue;
    }

    groups.push([observation]);
  }

  return groups;
}

function maxMileageObservations(
  observations: NormalizedVehicleObservation[]
): { mileageKm: number | null; observations: NormalizedVehicleObservation[] } {
  let mileageKm: number | null = null;
  let maxObservations: NormalizedVehicleObservation[] = [];

  for (const observation of observations) {
    if (typeof observation.value.mileageKm !== "number") continue;

    if (mileageKm === null || observation.value.mileageKm > mileageKm) {
      mileageKm = observation.value.mileageKm;
      maxObservations = [observation];
      continue;
    }

    if (observation.value.mileageKm === mileageKm) {
      maxObservations.push(observation);
    }
  }

  return { mileageKm, observations: maxObservations };
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
    const key = stableJson(observation.value);
    const group = groups.get(key) ?? [];
    group.push(observation);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      const sortedGroup = [...group].sort(compareNewestFirst);
      const latest = sortedGroup[0] ?? group[0]!;
      const observationIds = group.map(observationId).sort();

      return {
        observationIds,
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
  return (
    compareNullableIso(left.observedAt, right.observedAt) ||
    compareNullableIso(left.reportedAt, right.reportedAt) ||
    stableJson(left.value).localeCompare(stableJson(right.value)) ||
    observationId(left).localeCompare(observationId(right))
  );
}

function compareNewestFirst(
  left: NormalizedVehicleObservation,
  right: NormalizedVehicleObservation
): number {
  return (
    compareNullableIso(right.reportedAt, left.reportedAt) ||
    compareNullableIso(right.observedAt, left.observedAt) ||
    stableJson(left.value).localeCompare(stableJson(right.value)) ||
    observationId(left).localeCompare(observationId(right))
  );
}

function compareConflictValuesNewestFirst(
  left: VehicleFactConflictValueSnapshot,
  right: VehicleFactConflictValueSnapshot
): number {
  return (
    compareNullableIso(right.reportedAt, left.reportedAt) ||
    compareNullableIso(right.observedAt, left.observedAt) ||
    stableJson(left.value).localeCompare(stableJson(right.value)) ||
    left.observationIds.join("\u0000").localeCompare(right.observationIds.join("\u0000"))
  );
}

function compareConflicts(
  left: VehicleFactConflictSnapshot,
  right: VehicleFactConflictSnapshot
): number {
  return (
    left.vehicleId.localeCompare(right.vehicleId) ||
    left.factKind.localeCompare(right.factKind) ||
    left.factKey.localeCompare(right.factKey) ||
    compareConflictValueLists(left.values, right.values)
  );
}

function compareConflictValueLists(
  left: VehicleFactConflictValueSnapshot[],
  right: VehicleFactConflictValueSnapshot[]
): number {
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined && rightValue === undefined) return 0;
    if (leftValue === undefined) return -1;
    if (rightValue === undefined) return 1;

    const comparison =
      stableJson(leftValue.value).localeCompare(stableJson(rightValue.value)) ||
      leftValue.observationIds.join("\u0000").localeCompare(rightValue.observationIds.join("\u0000"));

    if (comparison !== 0) return comparison;
  }

  return 0;
}

function compareNullableIso(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}

function observationId(observation: NormalizedVehicleObservation): string {
  return observation.id ?? observation.valueHash;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableJson(nestedValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
