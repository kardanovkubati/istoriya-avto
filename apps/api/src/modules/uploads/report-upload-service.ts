import { createHash } from "node:crypto";
import { parseAutotekaReport } from "../parsing/autoteka/autoteka-parser";
import { createReportFingerprint } from "../parsing/report-fingerprint";
import type { ParsedReport } from "../parsing/report-parser";
import { extractPdfText, type PdfTextExtractionResult } from "../pdf/pdf-text-extractor";
import type { PointsLedgerService } from "../points/points-ledger-service";
import type { PointsPolicyResult } from "../points/points-policy";
import type { ObjectStorage } from "../storage/object-storage";
import { evaluateParsedReportForPoints } from "./points-evaluation";
import type {
  CreatedReportUpload,
  FingerprintRecord,
  ReportUploadRepository,
  VehicleRecord
} from "./report-upload-repository";

export type ReportUploadServiceOptions = {
  storage: ObjectStorage;
  repository: ReportUploadRepository;
  pointsLedgerService: PointsLedgerService;
  guestPointGrantRepository: GuestPointGrantRepository;
  extractor?: ReportTextExtractor;
  parser?: ReportParser;
  vehicleReportRebuilder?: VehicleReportRebuilder;
  onReportRebuildError?: ReportRebuildErrorHandler;
  now?: () => Date;
  originalRetentionDays: number;
};

export type IngestPdfInput = {
  userId: string | null;
  guestSessionId: string | null;
  bytes: Uint8Array;
  originalFileName: string;
};

export type IngestPdfResult = {
  uploadId: string;
  status: "parsed" | "manual_review" | "rejected";
  vin: string | null;
  generatedAt: Date | null;
  pointsEvaluation: PointsPolicyResult;
  pointGrant: PointGrantResult;
  reviewReason: string | null;
};

export type PointGrantResult =
  | { status: "granted"; points: 1; balanceAfter: number }
  | { status: "guest_pending"; points: 1 }
  | { status: "not_granted"; reason: string };

export interface ReportTextExtractor {
  extractText(bytes: Uint8Array): Promise<PdfTextExtractionResult>;
}

export interface ReportParser {
  parse(text: string): ParsedReport;
}

export interface VehicleReportRebuilder {
  rebuildFromParsedUpload(input: {
    vehicleId: string;
    reportUploadId: string;
    acceptedAt: Date;
    parsedReport: ParsedReport;
  }): Promise<void>;
}

export interface GuestPointGrantRepository {
  createGrant(input: {
    guestSessionId: string;
    vehicleId: string;
    reportUploadId: string;
    reportFingerprintId: string;
    points: 1;
    reason: string;
  }): Promise<void>;
}

export type ReportRebuildErrorHandler = (input: {
  error: unknown;
  vehicleId: string;
  reportUploadId: string;
  vin: string;
}) => void;

export class ReportUploadService {
  private readonly storage: ObjectStorage;
  private readonly repository: ReportUploadRepository;
  private readonly pointsLedgerService: PointsLedgerService;
  private readonly guestPointGrantRepository: GuestPointGrantRepository;
  private readonly extractor: ReportTextExtractor;
  private readonly parser: ReportParser;
  private readonly vehicleReportRebuilder: VehicleReportRebuilder | null;
  private readonly onReportRebuildError: ReportRebuildErrorHandler;
  private readonly now: () => Date;
  private readonly originalRetentionDays: number;

  constructor(options: ReportUploadServiceOptions) {
    this.storage = options.storage;
    this.repository = options.repository;
    this.pointsLedgerService = options.pointsLedgerService;
    this.guestPointGrantRepository = options.guestPointGrantRepository;
    this.extractor = options.extractor ?? { extractText: extractPdfText };
    this.parser = options.parser ?? { parse: parseAutotekaReport };
    this.vehicleReportRebuilder = options.vehicleReportRebuilder ?? null;
    this.onReportRebuildError = options.onReportRebuildError ?? defaultReportRebuildErrorHandler;
    this.now = options.now ?? (() => new Date());
    this.originalRetentionDays = options.originalRetentionDays;
  }

  async ingestPdf(input: IngestPdfInput): Promise<IngestPdfResult> {
    const now = this.now();
    const storedObject = await this.storage.putObject({
      namespace: "report-originals",
      bytes: new Uint8Array(input.bytes),
      contentType: "application/pdf",
      originalFileName: input.originalFileName,
      expiresAt: addDays(now, this.originalRetentionDays)
    });

    const extractedText = await this.extractor.extractText(new Uint8Array(input.bytes));
    const parsedReport = extractedText.hasExtractableText
      ? this.parser.parse(extractedText.text)
      : createEmptyTextManualReviewReport();

    const fingerprint = createReportFingerprint({
      sourceKind: "autoteka_pdf",
      extractedText: extractedText.hasExtractableText ? extractedText.text : storedObject.sha256
    });

    const trustedVin = parsedReport.status === "parsed" ? parsedReport.vin : null;
    const existingVehicle = trustedVin !== null
      ? await this.repository.findVehicleByVin(trustedVin)
      : null;
    const fingerprintRecord = await this.repository.findOrCreateFingerprint(fingerprint);

    const userHasEverReceivedPointForVin =
      input.userId !== null && existingVehicle !== null
        ? await this.repository.userHasReceivedPointForVin(input.userId, existingVehicle.id)
        : false;
    const userHasEverReceivedPointForFingerprint =
      input.userId !== null
        ? await this.repository.userHasReceivedPointForFingerprint(
            input.userId,
            fingerprintRecord.id
          )
        : false;

    const generatedAt = parseGeneratedAt(parsedReport.generatedAt);
    const pointsEvaluation = evaluateParsedReportForPoints({
      parsedReport,
      now,
      isFirstReportForVin: existingVehicle === null,
      isNewerThanCurrentVinReport: isNewerThanCurrentReport(
        generatedAt,
        existingVehicle?.latestReportGeneratedAt ?? null
      ),
      userHasEverReceivedPointForVin,
      userHasEverReceivedPointForFingerprint,
      automaticFingerprintGrantCount: fingerprintRecord.automaticGrantCount
    });
    const status =
      parsedReport.status === "parsed" && pointsEvaluation.decision !== "manual_review"
        ? "parsed"
        : "manual_review";
    const vehicle =
      status === "parsed" && trustedVin !== null
        ? await this.repository.upsertVehicleFromParsedReport(parsedReport)
        : null;
    if (status === "parsed" && trustedVin !== null && vehicle === null) {
      throw new Error("vehicle_upsert_failed");
    }
    const reviewReason =
      status === "parsed"
        ? null
        : extractedText.hasExtractableText
          ? (parsedReport.warnings[0]?.code ?? pointsEvaluation.reason)
          : "empty_pdf_text";

    const upload = await this.repository.createReportUpload({
      userId: input.userId,
      guestSessionId: input.guestSessionId,
      vehicleId: vehicle?.id ?? null,
      reportFingerprintId: fingerprintRecord.id,
      status,
      sourceKind: parsedReport.sourceKind,
      originalObjectKey: storedObject.key,
      generatedAt,
      parserVersion: parsedReport.parserVersion,
      parseQualityScore: parsedReport.qualityScore.toFixed(2),
      rawData: {
        storage: storedObject,
        parseResult: parsedReport,
        pointsEvaluation,
        extractedText: {
          pageCount: extractedText.pageCount,
          characterCount: extractedText.text.length,
          sha256: sha256(extractedText.text)
        }
      },
      reviewReason
    });

    const pointGrant = await this.resolvePointGrant({
      input,
      upload,
      vehicle,
      fingerprintRecord,
      pointsEvaluation
    });

    if (status === "parsed" && vehicle !== null && trustedVin !== null) {
      try {
        await this.vehicleReportRebuilder?.rebuildFromParsedUpload({
          vehicleId: vehicle.id,
          reportUploadId: upload.id,
          acceptedAt: now,
          parsedReport
        });
      } catch (error) {
        this.onReportRebuildError({
          error,
          vehicleId: vehicle.id,
          reportUploadId: upload.id,
          vin: trustedVin
        });
      }
    }

    return {
      uploadId: upload.id,
      status: upload.status,
      vin: parsedReport.vin,
      generatedAt,
      pointsEvaluation,
      pointGrant,
      reviewReason
    };
  }

  private async resolvePointGrant(input: {
    input: IngestPdfInput;
    upload: CreatedReportUpload;
    vehicle: VehicleRecord | null;
    fingerprintRecord: FingerprintRecord;
    pointsEvaluation: PointsPolicyResult;
  }): Promise<PointGrantResult> {
    if (
      input.pointsEvaluation.decision !== "grant" ||
      input.upload.status !== "parsed" ||
      input.vehicle === null
    ) {
      return {
        status: "not_granted",
        reason: input.pointsEvaluation.reason
      };
    }

    if (input.input.userId !== null) {
      const result = await this.pointsLedgerService.grantReportPoint({
        userId: input.input.userId,
        vehicleId: input.vehicle.id,
        reportUploadId: input.upload.id,
        reportFingerprintId: input.fingerprintRecord.id,
        idempotencyKey: `report-grant:user:${input.input.userId}:upload:${input.upload.id}`,
        note: input.pointsEvaluation.reason
      });

      if (
        (result.status === "applied" || result.status === "idempotent_replay") &&
        result.balanceAfter !== null
      ) {
        return {
          status: "granted",
          points: 1,
          balanceAfter: result.balanceAfter
        };
      }

      return {
        status: "not_granted",
        reason: result.reason
      };
    }

    if (input.input.guestSessionId !== null) {
      await this.guestPointGrantRepository.createGrant({
        guestSessionId: input.input.guestSessionId,
        vehicleId: input.vehicle.id,
        reportUploadId: input.upload.id,
        reportFingerprintId: input.fingerprintRecord.id,
        points: 1,
        reason: input.pointsEvaluation.reason
      });

      return {
        status: "guest_pending",
        points: 1
      };
    }

    return {
      status: "not_granted",
      reason: "identity_missing"
    };
  }
}

function createEmptyTextManualReviewReport(): ParsedReport {
  return {
    sourceKind: "autoteka_pdf",
    parserVersion: "autoteka-v1",
    status: "manual_review",
    vin: null,
    generatedAt: null,
    vehicle: {
      vin: null,
      make: null,
      model: null,
      year: null,
      bodyType: null,
      color: null,
      engine: null,
      transmission: null,
      driveType: null
    },
    listings: [],
    mileageReadings: [],
    riskFlags: {
      accidents: "unknown",
      repairCalculations: "unknown",
      restrictions: "unknown",
      pledge: "unknown",
      wanted: "unknown",
      taxi: "unknown",
      leasing: "unknown"
    },
    keyBlocks: [],
    warnings: [{ code: "empty_pdf_text", message: "Текст отчета пуст." }],
    qualityScore: 0
  };
}

function parseGeneratedAt(value: string | null): Date | null {
  if (value === null) return null;

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isNewerThanCurrentReport(generatedAt: Date | null, currentGeneratedAt: Date | null): boolean {
  if (generatedAt === null) return false;
  if (currentGeneratedAt === null) return true;

  return generatedAt.getTime() > currentGeneratedAt.getTime();
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function defaultReportRebuildErrorHandler(input: {
  error: unknown;
  vehicleId: string;
  reportUploadId: string;
  vin: string;
}): void {
  console.error("Vehicle report rebuild failed after parsed upload ingestion.", input);
}
