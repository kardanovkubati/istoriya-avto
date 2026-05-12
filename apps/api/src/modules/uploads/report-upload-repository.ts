import type { ParsedReport, ReportSourceKind } from "../parsing/report-parser";
import type { PointsPolicyResult } from "../points/points-policy";
import type { StoredObject } from "../storage/object-storage";

export type VehicleRecord = {
  id: string;
  vin: string;
  latestReportGeneratedAt: Date | null;
};

export type FingerprintRecord = {
  id: string;
  fingerprint: string;
  automaticGrantCount: number;
};

export type CreateReportUploadInput = {
  userId: string | null;
  guestSessionId: string | null;
  vehicleId: string | null;
  reportFingerprintId: string;
  status: "parsed" | "manual_review" | "rejected";
  sourceKind: ReportSourceKind;
  originalObjectKey: string;
  generatedAt: Date | null;
  parserVersion: string;
  parseQualityScore: number;
  rawData: {
    storage: StoredObject;
    parseResult: ParsedReport;
    pointsEvaluation: PointsPolicyResult;
    extractedText: {
      pageCount: number;
      characterCount: number;
      sha256: string;
    };
  };
  reviewReason: string | null;
};

export type CreatedReportUpload = {
  id: string;
  status: "parsed" | "manual_review" | "rejected";
};

export interface ReportUploadRepository {
  findVehicleByVin(vin: string): Promise<VehicleRecord | null>;
  upsertVehicleFromParsedReport(parsedReport: ParsedReport): Promise<VehicleRecord>;
  findOrCreateFingerprint(fingerprint: string): Promise<FingerprintRecord>;
  userHasReceivedPointForVin(userId: string, vehicleId: string): Promise<boolean>;
  userHasReceivedPointForFingerprint(userId: string, fingerprintId: string): Promise<boolean>;
  createReportUpload(input: CreateReportUploadInput): Promise<CreatedReportUpload>;
}
