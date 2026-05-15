import type { VehicleFactConflictSnapshot } from "./conflict-detection";
import type { NormalizedVehicleObservation } from "./fact-normalizer";
import type {
  VehicleFullReportReadModel,
  VehiclePreviewReadModel
} from "./report-read-model";

export type VehicleLookupRecord = {
  id: string;
  vin: string;
};

export type StoredVehicleObservation = NormalizedVehicleObservation & { id: string };

export type SaveVehicleReportSnapshotInput = {
  vehicleId: string;
  preview: VehiclePreviewReadModel;
  report: VehicleFullReportReadModel;
  sourceUploadCount: number;
  latestReportGeneratedAt: Date | null;
  rebuiltAt: Date;
};

export interface VehicleReportRepository {
  findVehicleByVin(vin: string): Promise<VehicleLookupRecord | null>;
  replaceObservationsForUpload(input: {
    reportUploadId: string;
    observations: NormalizedVehicleObservation[];
  }): Promise<void>;
  listObservationsForVehicle(vehicleId: string): Promise<StoredVehicleObservation[]>;
  replaceConflictsForVehicle(input: {
    vehicleId: string;
    conflicts: VehicleFactConflictSnapshot[];
  }): Promise<void>;
  saveReportSnapshot(input: SaveVehicleReportSnapshotInput): Promise<void>;
  findPreviewByVin(vin: string): Promise<VehiclePreviewReadModel | null>;
  findFullReportByVin(vin: string): Promise<VehicleFullReportReadModel | null>;
  findFullReportByVehicleId(vehicleId: string): Promise<VehicleFullReportReadModel | null>;
}
