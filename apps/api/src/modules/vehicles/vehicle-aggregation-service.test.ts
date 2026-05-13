import { describe, expect, it } from "bun:test";
import type { ParsedReport } from "../parsing/report-parser";
import type { VehicleFactConflictSnapshot } from "./conflict-detection";
import type { NormalizedVehicleObservation } from "./fact-normalizer";
import type {
  SaveVehicleReportSnapshotInput,
  StoredVehicleObservation,
  VehicleLookupRecord,
  VehicleReportRepository
} from "./vehicle-report-repository";
import { VehicleAggregationService } from "./vehicle-aggregation-service";

const baseParsedReport: ParsedReport = {
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

describe("VehicleAggregationService", () => {
  it("rebuildFromParsedUpload normalizes parsed upload, stores observations and conflicts, and saves a read snapshot", async () => {
    const now = new Date("2026-05-13T10:00:00.000Z");
    const acceptedAt = new Date("2026-05-12T09:30:00.000Z");
    const repository = new FakeVehicleReportRepository({
      vehicle: { id: "vehicle-1", vin: "XTA210990Y2765499" }
    });
    const service = new VehicleAggregationService({ repository, now: () => now });

    await service.rebuildFromParsedUpload({
      vehicleId: "vehicle-1",
      reportUploadId: "upload-1",
      acceptedAt,
      parsedReport: baseParsedReport
    });

    expect(repository.replaceObservationInputs).toHaveLength(1);
    expect(repository.replaceObservationInputs[0]?.reportUploadId).toBe("upload-1");
    expect(repository.replaceObservationInputs[0]?.observations.map((observation) => observation.factKey)).toContain(
      "color"
    );
    expect(repository.replaceObservationInputs[0]?.observations[0]).toMatchObject({
      vehicleId: "vehicle-1",
      reportUploadId: "upload-1",
      acceptedAt: "2026-05-12T09:30:00.000Z"
    });
    expect(repository.replaceConflictInputs).toEqual([{ vehicleId: "vehicle-1", conflicts: [] }]);
    expect(repository.savedSnapshots).toHaveLength(1);
    expect(repository.savedSnapshots[0]).toMatchObject({
      vehicleId: "vehicle-1",
      sourceUploadCount: 1,
      latestReportGeneratedAt: new Date("2026-05-01T00:00:00.000Z"),
      rebuiltAt: now,
      preview: {
        title: "LADA Granta",
        color: "white",
        lastUpdatedAt: "2026-05-01T00:00:00.000Z"
      },
      report: {
        generatedAt: "2026-05-13T10:00:00.000Z",
        summary: {
          sourceUploadCount: 1,
          lastUpdatedAt: "2026-05-01T00:00:00.000Z"
        },
        passport: {
          vin: "XTA210990Y2765499",
          color: "white"
        },
        conflicts: []
      }
    });
    expect(JSON.stringify(repository.savedSnapshots[0]?.report)).not.toMatch(
      /autoteka|автотек|авито|auto\.ru|дром|drom|sourceKind|parserVersion/i
    );
  });

  it("keeps a conflict when a later upload changes color and snapshots the latest passport color", async () => {
    const repository = new FakeVehicleReportRepository({
      vehicle: { id: "vehicle-1", vin: "XTA210990Y2765499" }
    });
    const service = new VehicleAggregationService({
      repository,
      now: () => new Date("2026-05-13T10:00:00.000Z")
    });

    await service.rebuildFromParsedUpload({
      vehicleId: "vehicle-1",
      reportUploadId: "upload-1",
      acceptedAt: new Date("2026-05-12T09:30:00.000Z"),
      parsedReport: baseParsedReport
    });
    await service.rebuildFromParsedUpload({
      vehicleId: "vehicle-1",
      reportUploadId: "upload-2",
      acceptedAt: new Date("2026-05-12T11:00:00.000Z"),
      parsedReport: {
        ...baseParsedReport,
        generatedAt: "2026-05-10T00:00:00.000Z",
        vehicle: { ...baseParsedReport.vehicle, color: "black" }
      }
    });

    expect(repository.replaceConflictInputs).toHaveLength(2);
    expect(repository.replaceConflictInputs[1]?.conflicts).toHaveLength(1);
    expect(repository.replaceConflictInputs[1]?.conflicts[0]).toMatchObject({
      vehicleId: "vehicle-1",
      factKind: "passport",
      factKey: "color",
      severity: "warning",
      status: "open"
    });
    expect(repository.replaceConflictInputs[1]?.conflicts[0]?.values).toEqual([
      expect.objectContaining({
        value: { field: "color", value: "black" },
        reportedAt: "2026-05-10T00:00:00.000Z",
        isLatest: true
      }),
      expect.objectContaining({
        value: { field: "color", value: "white" },
        reportedAt: "2026-05-01T00:00:00.000Z",
        isLatest: false
      })
    ]);
    expect(repository.savedSnapshots.at(-1)).toMatchObject({
      sourceUploadCount: 2,
      latestReportGeneratedAt: new Date("2026-05-10T00:00:00.000Z"),
      preview: { color: "black", lastUpdatedAt: "2026-05-10T00:00:00.000Z" },
      report: {
        summary: {
          sourceUploadCount: 2,
          lastUpdatedAt: "2026-05-10T00:00:00.000Z"
        },
        passport: { color: "black" },
        conflicts: [
          expect.objectContaining({
            factKind: "passport",
            factKey: "color",
            severity: "warning"
          })
        ]
      }
    });
  });

  it("rejects manual review reports without repository writes", async () => {
    const repository = new FakeVehicleReportRepository({
      vehicle: { id: "vehicle-1", vin: "XTA210990Y2765499" }
    });
    const service = new VehicleAggregationService({
      repository,
      now: () => new Date("2026-05-13T10:00:00.000Z")
    });

    await expect(
      service.rebuildFromParsedUpload({
        vehicleId: "vehicle-1",
        reportUploadId: "upload-1",
        acceptedAt: new Date("2026-05-12T09:30:00.000Z"),
        parsedReport: { ...baseParsedReport, status: "manual_review" }
      })
    ).rejects.toThrow("parsed_report_required");
    expect(repository.replaceObservationInputs).toEqual([]);
    expect(repository.replaceConflictInputs).toEqual([]);
    expect(repository.savedSnapshots).toEqual([]);
  });
});

class FakeVehicleReportRepository implements VehicleReportRepository {
  readonly replaceObservationInputs: Array<{
    reportUploadId: string;
    observations: NormalizedVehicleObservation[];
  }> = [];
  readonly replaceConflictInputs: Array<{
    vehicleId: string;
    conflicts: VehicleFactConflictSnapshot[];
  }> = [];
  readonly savedSnapshots: SaveVehicleReportSnapshotInput[] = [];
  private readonly observationsByUpload = new Map<string, StoredVehicleObservation[]>();

  constructor(private readonly options: { vehicle: VehicleLookupRecord }) {}

  async findVehicleByVin(vin: string): Promise<VehicleLookupRecord | null> {
    return this.options.vehicle.vin === vin ? this.options.vehicle : null;
  }

  async replaceObservationsForUpload(input: {
    reportUploadId: string;
    observations: NormalizedVehicleObservation[];
  }): Promise<void> {
    this.replaceObservationInputs.push(input);
    this.observationsByUpload.set(
      input.reportUploadId,
      input.observations.map((observation, index) => ({
        ...observation,
        id: `${input.reportUploadId}-observation-${index + 1}`
      }))
    );
  }

  async listObservationsForVehicle(vehicleId: string): Promise<StoredVehicleObservation[]> {
    return [...this.observationsByUpload.values()]
      .flat()
      .filter((observation) => observation.vehicleId === vehicleId);
  }

  async replaceConflictsForVehicle(input: {
    vehicleId: string;
    conflicts: VehicleFactConflictSnapshot[];
  }): Promise<void> {
    this.replaceConflictInputs.push(input);
  }

  async saveReportSnapshot(input: SaveVehicleReportSnapshotInput): Promise<void> {
    this.savedSnapshots.push(input);
  }

  async findPreviewByVin(): Promise<null> {
    return null;
  }

  async findFullReportByVin(): Promise<null> {
    return null;
  }
}
