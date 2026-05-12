import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db/client";
import {
  pointLedgerEntries,
  reportFingerprints,
  reportUploads,
  vehicles
} from "../../db/schema";
import type { ParsedReport } from "../parsing/report-parser";
import type {
  CreatedReportUpload,
  CreateReportUploadInput,
  FingerprintRecord,
  ReportUploadRepository,
  VehicleRecord
} from "./report-upload-repository";

type VehicleAttributeColumn =
  | "make"
  | "model"
  | "year"
  | "bodyType"
  | "color"
  | "engine"
  | "transmission"
  | "driveType";

type VehicleConflictUpdate = Partial<Pick<typeof vehicles.$inferInsert, VehicleAttributeColumn>> & {
  updatedAt: Date;
};

export class DrizzleReportUploadRepository implements ReportUploadRepository {
  async findVehicleByVin(vin: string): Promise<VehicleRecord | null> {
    const [vehicle] = await db
      .select({
        id: vehicles.id,
        vin: vehicles.vin
      })
      .from(vehicles)
      .where(eq(vehicles.vin, vin))
      .limit(1);

    if (vehicle === undefined) return null;

    const [latestUpload] = await db
      .select({
        generatedAt: reportUploads.generatedAt
      })
      .from(reportUploads)
      .where(and(eq(reportUploads.vehicleId, vehicle.id), isNotNull(reportUploads.generatedAt)))
      .orderBy(desc(reportUploads.generatedAt))
      .limit(1);

    return {
      id: vehicle.id,
      vin: vehicle.vin,
      latestReportGeneratedAt: latestUpload?.generatedAt ?? null
    };
  }

  async upsertVehicleFromParsedReport(parsedReport: ParsedReport): Promise<VehicleRecord> {
    if (parsedReport.vin === null) {
      throw new Error("vehicle_vin_required");
    }

    const now = new Date();
    const updateSet: VehicleConflictUpdate = { updatedAt: now };
    if (parsedReport.vehicle.make !== null) updateSet.make = parsedReport.vehicle.make;
    if (parsedReport.vehicle.model !== null) updateSet.model = parsedReport.vehicle.model;
    if (parsedReport.vehicle.year !== null) updateSet.year = parsedReport.vehicle.year;
    if (parsedReport.vehicle.bodyType !== null) updateSet.bodyType = parsedReport.vehicle.bodyType;
    if (parsedReport.vehicle.color !== null) updateSet.color = parsedReport.vehicle.color;
    if (parsedReport.vehicle.engine !== null) updateSet.engine = parsedReport.vehicle.engine;
    if (parsedReport.vehicle.transmission !== null) {
      updateSet.transmission = parsedReport.vehicle.transmission;
    }
    if (parsedReport.vehicle.driveType !== null) updateSet.driveType = parsedReport.vehicle.driveType;

    const [vehicle] = await db
      .insert(vehicles)
      .values({
        vin: parsedReport.vin,
        make: parsedReport.vehicle.make,
        model: parsedReport.vehicle.model,
        year: parsedReport.vehicle.year,
        bodyType: parsedReport.vehicle.bodyType,
        color: parsedReport.vehicle.color,
        engine: parsedReport.vehicle.engine,
        transmission: parsedReport.vehicle.transmission,
        driveType: parsedReport.vehicle.driveType,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: vehicles.vin,
        set: updateSet
      })
      .returning({
        id: vehicles.id,
        vin: vehicles.vin
      });

    if (vehicle === undefined) {
      throw new Error("vehicle_upsert_failed");
    }

    return {
      id: vehicle.id,
      vin: vehicle.vin,
      latestReportGeneratedAt: null
    };
  }

  async findOrCreateFingerprint(fingerprint: string): Promise<FingerprintRecord> {
    const [inserted] = await db
      .insert(reportFingerprints)
      .values({ fingerprint })
      .onConflictDoNothing({
        target: reportFingerprints.fingerprint
      })
      .returning({
        id: reportFingerprints.id,
        fingerprint: reportFingerprints.fingerprint,
        automaticGrantCount: reportFingerprints.automaticGrantCount
      });

    if (inserted !== undefined) return inserted;

    const [existing] = await db
      .select({
        id: reportFingerprints.id,
        fingerprint: reportFingerprints.fingerprint,
        automaticGrantCount: reportFingerprints.automaticGrantCount
      })
      .from(reportFingerprints)
      .where(eq(reportFingerprints.fingerprint, fingerprint))
      .limit(1);

    if (existing === undefined) {
      throw new Error("fingerprint_upsert_failed");
    }

    return existing;
  }

  async userHasReceivedPointForVin(userId: string, vehicleId: string): Promise<boolean> {
    const [entry] = await db
      .select({ id: pointLedgerEntries.id })
      .from(pointLedgerEntries)
      .where(
        and(
          eq(pointLedgerEntries.userId, userId),
          eq(pointLedgerEntries.vehicleId, vehicleId),
          eq(pointLedgerEntries.reason, "report_grant")
        )
      )
      .limit(1);

    return entry !== undefined;
  }

  async userHasReceivedPointForFingerprint(
    userId: string,
    fingerprintId: string
  ): Promise<boolean> {
    const [entry] = await db
      .select({ id: pointLedgerEntries.id })
      .from(pointLedgerEntries)
      .innerJoin(reportUploads, eq(pointLedgerEntries.reportUploadId, reportUploads.id))
      .where(
        and(
          eq(pointLedgerEntries.userId, userId),
          eq(reportUploads.reportFingerprintId, fingerprintId),
          eq(pointLedgerEntries.reason, "report_grant")
        )
      )
      .limit(1);

    return entry !== undefined;
  }

  async createReportUpload(input: CreateReportUploadInput): Promise<CreatedReportUpload> {
    const [upload] = await db
      .insert(reportUploads)
      .values({
        userId: input.userId,
        guestSessionId: input.guestSessionId,
        vehicleId: input.vehicleId,
        reportFingerprintId: input.reportFingerprintId,
        status: input.status,
        sourceKind: input.sourceKind,
        originalObjectKey: input.originalObjectKey,
        generatedAt: input.generatedAt,
        parserVersion: input.parserVersion,
        parseQualityScore: input.parseQualityScore,
        rawData: input.rawData as Record<string, unknown>,
        reviewReason: input.reviewReason
      })
      .returning({
        id: reportUploads.id,
        status: reportUploads.status
      });

    if (upload === undefined) {
      throw new Error("report_upload_create_failed");
    }

    return {
      id: upload.id,
      status: upload.status as CreatedReportUpload["status"]
    };
  }
}
