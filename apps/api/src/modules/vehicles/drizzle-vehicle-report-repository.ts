import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
  vehicleFactConflicts,
  vehicleObservations,
  vehicleReportSnapshots,
  vehicles
} from "../../db/schema";
import type { VehicleFactConflictSnapshot } from "./conflict-detection";
import type { NormalizedVehicleObservation } from "./fact-normalizer";
import type {
  VehicleFullReportReadModel,
  VehiclePreviewReadModel
} from "./report-read-model";
import type {
  SaveVehicleReportSnapshotInput,
  StoredVehicleObservation,
  VehicleLookupRecord,
  VehicleReportRepository
} from "./vehicle-report-repository";

export class DrizzleVehicleReportRepository implements VehicleReportRepository {
  async findVehicleByVin(vin: string): Promise<VehicleLookupRecord | null> {
    const [vehicle] = await db
      .select({
        id: vehicles.id,
        vin: vehicles.vin
      })
      .from(vehicles)
      .where(eq(vehicles.vin, vin))
      .limit(1);

    return vehicle ?? null;
  }

  async replaceObservationsForUpload(input: {
    reportUploadId: string;
    observations: NormalizedVehicleObservation[];
  }): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(vehicleObservations)
        .where(eq(vehicleObservations.reportUploadId, input.reportUploadId));

      if (input.observations.length === 0) return;

      await tx.insert(vehicleObservations).values(
        input.observations.map((observation) => ({
          vehicleId: observation.vehicleId,
          reportUploadId: observation.reportUploadId,
          factKind: observation.factKind,
          factKey: observation.factKey,
          valueHash: observation.valueHash,
          value: observation.value,
          observedAt: parseDate(observation.observedAt),
          reportedAt: parseDate(observation.reportedAt),
          acceptedAt: parseRequiredDate(observation.acceptedAt),
          qualityScore: observation.qualityScore.toFixed(2)
        }))
      );
    });
  }

  async listObservationsForVehicle(vehicleId: string): Promise<StoredVehicleObservation[]> {
    const rows = await db
      .select({
        id: vehicleObservations.id,
        vehicleId: vehicleObservations.vehicleId,
        reportUploadId: vehicleObservations.reportUploadId,
        factKind: vehicleObservations.factKind,
        factKey: vehicleObservations.factKey,
        valueHash: vehicleObservations.valueHash,
        value: vehicleObservations.value,
        observedAt: vehicleObservations.observedAt,
        reportedAt: vehicleObservations.reportedAt,
        acceptedAt: vehicleObservations.acceptedAt,
        qualityScore: vehicleObservations.qualityScore
      })
      .from(vehicleObservations)
      .where(eq(vehicleObservations.vehicleId, vehicleId));

    return rows.map((row) => ({
      id: row.id,
      vehicleId: row.vehicleId,
      reportUploadId: row.reportUploadId,
      factKind: row.factKind as StoredVehicleObservation["factKind"],
      factKey: row.factKey,
      valueHash: row.valueHash,
      value: row.value,
      observedAt: row.observedAt?.toISOString() ?? null,
      reportedAt: row.reportedAt?.toISOString() ?? null,
      acceptedAt: row.acceptedAt.toISOString(),
      qualityScore: Number(row.qualityScore ?? 0)
    }));
  }

  async replaceConflictsForVehicle(input: {
    vehicleId: string;
    conflicts: VehicleFactConflictSnapshot[];
  }): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(vehicleFactConflicts)
        .where(
          and(
            eq(vehicleFactConflicts.vehicleId, input.vehicleId),
            eq(vehicleFactConflicts.status, "open")
          )
        );

      if (input.conflicts.length === 0) return;

      await tx.insert(vehicleFactConflicts).values(
        input.conflicts.map((conflict) => ({
          vehicleId: conflict.vehicleId,
          factKind: conflict.factKind,
          factKey: conflict.factKey,
          severity: conflict.severity,
          status: conflict.status,
          values: conflict.values
        }))
      );
    });
  }

  async saveReportSnapshot(input: SaveVehicleReportSnapshotInput): Promise<void> {
    const now = new Date();
    const values = {
      vehicleId: input.vehicleId,
      previewData: input.preview as unknown as Record<string, unknown>,
      reportData: input.report as unknown as Record<string, unknown>,
      sourceUploadCount: input.sourceUploadCount,
      latestReportGeneratedAt: input.latestReportGeneratedAt,
      rebuiltAt: input.rebuiltAt,
      updatedAt: now
    };

    await db
      .insert(vehicleReportSnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: vehicleReportSnapshots.vehicleId,
        set: values
      });
  }

  async findPreviewByVin(vin: string): Promise<VehiclePreviewReadModel | null> {
    const [snapshot] = await db
      .select({
        previewData: vehicleReportSnapshots.previewData
      })
      .from(vehicleReportSnapshots)
      .innerJoin(vehicles, eq(vehicleReportSnapshots.vehicleId, vehicles.id))
      .where(eq(vehicles.vin, vin))
      .limit(1);

    return (snapshot?.previewData as VehiclePreviewReadModel | undefined) ?? null;
  }

  async findFullReportByVin(vin: string): Promise<VehicleFullReportReadModel | null> {
    const [snapshot] = await db
      .select({
        reportData: vehicleReportSnapshots.reportData
      })
      .from(vehicleReportSnapshots)
      .innerJoin(vehicles, eq(vehicleReportSnapshots.vehicleId, vehicles.id))
      .where(eq(vehicles.vin, vin))
      .limit(1);

    return (snapshot?.reportData as VehicleFullReportReadModel | undefined) ?? null;
  }
}

function parseDate(value: string | null): Date | null {
  if (value === null) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function parseRequiredDate(value: string): Date {
  const date = parseDate(value);
  if (date === null) {
    throw new Error("invalid_observation_accepted_at");
  }

  return date;
}
