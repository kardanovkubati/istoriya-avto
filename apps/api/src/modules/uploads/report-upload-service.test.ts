import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";
import type { ParsedReport } from "../parsing/report-parser";
import type { PutObjectInput, StoredObject } from "../storage/object-storage";
import type {
  CreateReportUploadInput,
  FingerprintRecord,
  ReportUploadRepository,
  VehicleRecord
} from "./report-upload-repository";
import { ReportUploadService } from "./report-upload-service";

const NOW = new Date("2026-05-12T12:00:00.000Z");
const PDF_BYTES = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
const REPORT_TEXT = [
  "Отчет по автомобилю",
  "Дата формирования отчета: 01.05.2026",
  "Паспорт автомобиля",
  "VIN: XTA210990Y2765499",
  "Марка: LADA",
  "Модель: Granta",
  "Год выпуска: 2021",
  "Пробеги",
  "01.05.2026 45000 км объявление",
  "Проверки",
  "ДТП не найдено",
  "Ограничения не найдено",
  "Залог не найден",
  "Розыск не найден"
].join("\n");

function parsedReport(overrides: Partial<ParsedReport> = {}): ParsedReport {
  const report: ParsedReport = {
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
    listings: [],
    mileageReadings: [
      {
        observedAt: "2026-05-01T00:00:00.000Z",
        mileageKm: 45_000,
        context: "listing"
      }
    ],
    riskFlags: {
      accidents: "not_found",
      repairCalculations: "not_found",
      restrictions: "not_found",
      pledge: "not_found",
      wanted: "not_found",
      taxi: "not_found",
      leasing: "not_found"
    },
    keyBlocks: ["vehicle_passport", "listings_or_mileage", "risk_checks"],
    warnings: [],
    qualityScore: 1
  };

  return { ...report, ...overrides };
}

describe("ReportUploadService", () => {
  it("stores original PDF, parses it, creates parsed report upload, and evaluates points", async () => {
    const repository = new FakeReportUploadRepository();
    const service = createService({
      repository,
      extractor: new FakeExtractor({
        text: REPORT_TEXT,
        pageCount: 2,
        hasExtractableText: true,
        errorCode: null
      }),
      parser: new FakeParser(parsedReport())
    });

    const result = await service.ingestPdf({
      userId: "user-1",
      guestSessionId: "guest-1",
      bytes: PDF_BYTES,
      originalFileName: "autoteka.pdf"
    });

    expect(result.status).toBe("parsed");
    expect(result.vin).toBe("XTA210990Y2765499");
    expect(result.generatedAt?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(result.pointsEvaluation).toEqual({
      decision: "grant",
      points: 1,
      reason: "fresh_valid_report"
    });
    expect(repository.createdUploads).toHaveLength(1);
    expect(repository.createdUploads[0]?.status).toBe("parsed");
    expect(repository.createdUploads[0]?.rawData.parseResult.vin).toBe("XTA210990Y2765499");
    expect(repository.createdUploads[0]?.rawData.pointsEvaluation.decision).toBe("grant");
    expect(repository.createdUploads[0]?.parseQualityScore).toBe("1.00");
    expect(repository.createdUploads[0]?.originalObjectKey).toBe("report-originals/1.pdf");
    expect(repository.createdUploads[0]?.rawData.storage.expiresAt.toISOString()).toBe(
      "2026-06-11T12:00:00.000Z"
    );
  });

  it("creates manual_review upload when text extraction is empty", async () => {
    const repository = new FakeReportUploadRepository();
    const parser = new FakeParser(parsedReport());
    const service = createService({
      repository,
      extractor: new FakeExtractor({
        text: "",
        pageCount: 1,
        hasExtractableText: false,
        errorCode: null
      }),
      parser
    });

    const result = await service.ingestPdf({
      userId: "user-1",
      guestSessionId: "guest-1",
      bytes: PDF_BYTES,
      originalFileName: "empty.pdf"
    });

    expect(result.status).toBe("manual_review");
    expect(result.reviewReason).toBe("empty_pdf_text");
    expect(parser.calls).toBe(0);
    expect(repository.createdUploads[0]?.status).toBe("manual_review");
    expect(repository.createdUploads[0]?.vehicleId).toBeNull();
    expect(repository.createdUploads[0]?.reviewReason).toBe("empty_pdf_text");
    expect(repository.createdUploads[0]?.rawData.parseResult.warnings[0]?.code).toBe(
      "empty_pdf_text"
    );
  });

  it("does not mutate user balances or point ledger entries", async () => {
    const repository = new FakeReportUploadRepository();
    const service = createService({
      repository,
      extractor: new FakeExtractor({
        text: REPORT_TEXT,
        pageCount: 2,
        hasExtractableText: true,
        errorCode: null
      }),
      parser: new FakeParser(parsedReport())
    });

    await service.ingestPdf({
      userId: "user-1",
      guestSessionId: "guest-1",
      bytes: PDF_BYTES,
      originalFileName: "autoteka.pdf"
    });

    expect(repository.pointLedgerMutations).toBe(0);
    expect(repository.userBalanceMutations).toBe(0);
  });

  it("does not detach or mutate caller-owned bytes", async () => {
    const repository = new FakeReportUploadRepository();
    const bytes = new Uint8Array(PDF_BYTES);
    const originalBytes = Array.from(bytes);
    const service = createService({
      repository,
      extractor: new FakeExtractor({
        text: REPORT_TEXT,
        pageCount: 2,
        hasExtractableText: true,
        errorCode: null
      }),
      parser: new FakeParser(parsedReport())
    });

    await service.ingestPdf({
      userId: "user-1",
      guestSessionId: "guest-1",
      bytes,
      originalFileName: "autoteka.pdf"
    });

    expect(bytes.byteLength).toBe(PDF_BYTES.byteLength);
    expect(Array.from(bytes)).toEqual(originalBytes);
  });

  it("creates manual_review upload when parser requires manual review despite all key blocks", async () => {
    const repository = new FakeReportUploadRepository();
    const service = createService({
      repository,
      extractor: new FakeExtractor({
        text: REPORT_TEXT,
        pageCount: 2,
        hasExtractableText: true,
        errorCode: null
      }),
      parser: new FakeParser(
        parsedReport({
          status: "manual_review",
          warnings: [{ code: "multiple_vins_found", message: "В отчете найдено несколько разных VIN." }]
        })
      )
    });

    const result = await service.ingestPdf({
      userId: "user-1",
      guestSessionId: "guest-1",
      bytes: PDF_BYTES,
      originalFileName: "autoteka.pdf"
    });

    expect(result.status).toBe("manual_review");
    expect(result.pointsEvaluation).toEqual({
      decision: "manual_review",
      points: 0,
      reason: "parser_manual_review_required"
    });
    expect(repository.createdUploads[0]?.status).toBe("manual_review");
    expect(repository.createdUploads[0]?.reviewReason).toBe("multiple_vins_found");
  });
});

function createService(input: {
  repository: ReportUploadRepository;
  extractor: FakeExtractor;
  parser: FakeParser;
}): ReportUploadService {
  return new ReportUploadService({
    storage: new FakeStorage(),
    extractor: input.extractor,
    parser: input.parser,
    repository: input.repository,
    now: () => new Date(NOW),
    originalRetentionDays: 30
  });
}

class FakeStorage {
  calls: PutObjectInput[] = [];

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    this.calls.push({ ...input, bytes: new Uint8Array(input.bytes) });

    return {
      key: `${input.namespace}/${this.calls.length}.pdf`,
      sizeBytes: input.bytes.byteLength,
      contentType: input.contentType,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      expiresAt: input.expiresAt
    };
  }
}

type ExtractionResult = {
  text: string;
  pageCount: number;
  hasExtractableText: boolean;
  errorCode: "pdf_parse_failed" | null;
};

class FakeExtractor {
  calls = 0;

  constructor(private readonly result: ExtractionResult) {}

  async extractText(bytes: Uint8Array): Promise<ExtractionResult> {
    this.calls += 1;
    expect(bytes.byteLength).toBeGreaterThan(0);
    return this.result;
  }
}

class FakeParser {
  calls = 0;

  constructor(private readonly result: ParsedReport) {}

  parse(text: string): ParsedReport {
    this.calls += 1;
    expect(text).toBe(REPORT_TEXT);
    return this.result;
  }
}

class FakeReportUploadRepository implements ReportUploadRepository {
  createdUploads: CreateReportUploadInput[] = [];
  pointLedgerMutations = 0;
  userBalanceMutations = 0;
  private readonly vehicles = new Map<string, VehicleRecord>();
  private readonly fingerprints = new Map<string, FingerprintRecord>();

  async findVehicleByVin(vin: string): Promise<VehicleRecord | null> {
    return this.vehicles.get(vin) ?? null;
  }

  async upsertVehicleFromParsedReport(report: ParsedReport): Promise<VehicleRecord | null> {
    if (report.vin === null) throw new Error("Cannot upsert vehicle without VIN.");

    const vehicle = this.vehicles.get(report.vin) ?? {
      id: `vehicle-${this.vehicles.size + 1}`,
      vin: report.vin,
      latestReportGeneratedAt: null
    };
    this.vehicles.set(report.vin, vehicle);
    return vehicle;
  }

  async findOrCreateFingerprint(fingerprint: string): Promise<FingerprintRecord> {
    const record = this.fingerprints.get(fingerprint) ?? {
      id: `fingerprint-${this.fingerprints.size + 1}`,
      fingerprint,
      automaticGrantCount: 0
    };
    this.fingerprints.set(fingerprint, record);
    return record;
  }

  async userHasReceivedPointForVin(): Promise<boolean> {
    return false;
  }

  async userHasReceivedPointForFingerprint(): Promise<boolean> {
    return false;
  }

  async createReportUpload(input: CreateReportUploadInput): Promise<{ id: string; status: CreateReportUploadInput["status"] }> {
    this.createdUploads.push(input);
    return { id: `upload-${this.createdUploads.length}`, status: input.status };
  }
}
