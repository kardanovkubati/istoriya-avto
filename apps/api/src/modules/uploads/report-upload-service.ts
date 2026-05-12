import { createHash } from "node:crypto";
import { parseAutotekaReport } from "../parsing/autoteka/autoteka-parser";
import { createReportFingerprint } from "../parsing/report-fingerprint";
import type { ParsedReport } from "../parsing/report-parser";
import { extractPdfText, type PdfTextExtractionResult } from "../pdf/pdf-text-extractor";
import type { PointsPolicyResult } from "../points/points-policy";
import type { ObjectStorage } from "../storage/object-storage";
import { evaluateParsedReportForPoints } from "./points-evaluation";
import type { ReportUploadRepository } from "./report-upload-repository";

export type ReportUploadServiceOptions = {
  storage: ObjectStorage;
  repository: ReportUploadRepository;
  extractor?: ReportTextExtractor;
  parser?: ReportParser;
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
  reviewReason: string | null;
};

export interface ReportTextExtractor {
  extractText(bytes: Uint8Array): Promise<PdfTextExtractionResult>;
}

export interface ReportParser {
  parse(text: string): ParsedReport;
}

export class ReportUploadService {
  private readonly storage: ObjectStorage;
  private readonly repository: ReportUploadRepository;
  private readonly extractor: ReportTextExtractor;
  private readonly parser: ReportParser;
  private readonly now: () => Date;
  private readonly originalRetentionDays: number;

  constructor(options: ReportUploadServiceOptions) {
    this.storage = options.storage;
    this.repository = options.repository;
    this.extractor = options.extractor ?? { extractText: extractPdfText };
    this.parser = options.parser ?? { parse: parseAutotekaReport };
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

    const existingVehicle =
      parsedReport.vin === null ? null : await this.repository.findVehicleByVin(parsedReport.vin);
    const vehicle =
      parsedReport.vin === null
        ? null
        : await this.repository.upsertVehicleFromParsedReport(parsedReport);
    const fingerprintRecord = await this.repository.findOrCreateFingerprint(fingerprint);

    const userHasEverReceivedPointForVin =
      input.userId !== null && vehicle !== null
        ? await this.repository.userHasReceivedPointForVin(input.userId, vehicle.id)
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
      parseQualityScore: parsedReport.qualityScore,
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

    return {
      uploadId: upload.id,
      status: upload.status,
      vin: parsedReport.vin,
      generatedAt,
      pointsEvaluation,
      reviewReason
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
