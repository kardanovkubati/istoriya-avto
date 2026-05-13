import type { ParsedReport } from "../parsing/report-parser";
import { detectVehicleFactConflicts } from "./conflict-detection";
import { normalizeParsedReportToObservations } from "./fact-normalizer";
import { buildVehicleReadModels } from "./report-read-model";
import type { VehicleReportRepository } from "./vehicle-report-repository";

export type VehicleAggregationServiceOptions = {
  repository: VehicleReportRepository;
  now?: () => Date;
};

export type RebuildFromParsedUploadInput = {
  vehicleId: string;
  reportUploadId: string;
  parsedReport: ParsedReport;
};

export class VehicleAggregationService {
  private readonly repository: VehicleReportRepository;
  private readonly now: () => Date;

  constructor(options: VehicleAggregationServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
  }

  async rebuildFromParsedUpload(input: RebuildFromParsedUploadInput): Promise<void> {
    if (input.parsedReport.status !== "parsed" || input.parsedReport.vin === null) {
      throw new Error("parsed_report_required");
    }

    const now = this.now();
    const observations = normalizeParsedReportToObservations({
      vehicleId: input.vehicleId,
      reportUploadId: input.reportUploadId,
      acceptedAt: now.toISOString(),
      parsedReport: input.parsedReport
    });

    await this.repository.replaceObservationsForUpload({
      reportUploadId: input.reportUploadId,
      observations
    });

    const allObservations = await this.repository.listObservationsForVehicle(input.vehicleId);
    const conflicts = detectVehicleFactConflicts(allObservations);
    const { preview, report } = buildVehicleReadModels({
      now,
      vehicle: { id: input.vehicleId, vin: input.parsedReport.vin },
      observations: allObservations,
      conflicts
    });

    await this.repository.replaceConflictsForVehicle({
      vehicleId: input.vehicleId,
      conflicts
    });
    await this.repository.saveReportSnapshot({
      vehicleId: input.vehicleId,
      preview,
      report,
      sourceUploadCount: report.summary.sourceUploadCount,
      latestReportGeneratedAt: parseDate(report.summary.lastUpdatedAt),
      rebuiltAt: now
    });
  }
}

function parseDate(value: string | null): Date | null {
  if (value === null) return null;

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
