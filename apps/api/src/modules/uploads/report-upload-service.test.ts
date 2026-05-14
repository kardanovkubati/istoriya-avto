import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";
import type { ParsedReport } from "../parsing/report-parser";
import type {
  PointsLedgerEntry,
  PointsLedgerMutationResult,
  PointsLedgerRepository,
  PointsLedgerRepositoryAdjustInput,
  PointsLedgerRepositoryGrantInput,
  PointsLedgerRepositorySpendInput
} from "../points/points-ledger-repository";
import { PointsLedgerService } from "../points/points-ledger-service";
import type { PutObjectInput, StoredObject } from "../storage/object-storage";
import type {
  CreateReportUploadInput,
  FingerprintRecord,
  ReportUploadRepository,
  VehicleRecord
} from "./report-upload-repository";
import {
  ReportUploadService,
  type GuestPointGrantRepository,
  type VehicleReportRebuilder
} from "./report-upload-service";

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
    expect(result.pointGrant).toEqual({
      status: "granted",
      points: 1,
      balanceAfter: 1
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

  it("rebuilds vehicle report read model after parsed upload ingestion", async () => {
    const repository = new FakeReportUploadRepository();
    const report = parsedReport();
    const vehicleReportRebuilder = new FakeVehicleReportRebuilder();
    const service = createService({
      repository,
      vehicleReportRebuilder,
      extractor: new FakeExtractor({
        text: REPORT_TEXT,
        pageCount: 2,
        hasExtractableText: true,
        errorCode: null
      }),
      parser: new FakeParser(report)
    });

    await service.ingestPdf({
      userId: "user-1",
      guestSessionId: "guest-1",
      bytes: PDF_BYTES,
      originalFileName: "autoteka.pdf"
    });

    expect(vehicleReportRebuilder.calls).toEqual([
      {
        vehicleId: "vehicle-1",
        reportUploadId: "upload-1",
        acceptedAt: NOW,
        parsedReport: report
      }
    ]);
  });

  it("returns parsed upload result and reports diagnostics when vehicle report rebuild fails", async () => {
    const repository = new FakeReportUploadRepository();
    const error = new Error("read model rebuild failed");
    const rebuildErrors: Array<{
      error: unknown;
      vehicleId: string;
      reportUploadId: string;
      vin: string;
    }> = [];
    const service = createService({
      repository,
      vehicleReportRebuilder: new ThrowingVehicleReportRebuilder(error),
      onReportRebuildError: (input) => rebuildErrors.push(input),
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
    expect(result.uploadId).toBe("upload-1");
    expect(result.vin).toBe("XTA210990Y2765499");
    expect(rebuildErrors).toEqual([
      {
        error,
        vehicleId: "vehicle-1",
        reportUploadId: "upload-1",
        vin: "XTA210990Y2765499"
      }
    ]);
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
    expect(result.pointGrant).toEqual({
      status: "not_granted",
      reason: "parser_manual_review_required"
    });
    expect(parser.calls).toBe(0);
    expect(repository.createdUploads[0]?.status).toBe("manual_review");
    expect(repository.createdUploads[0]?.vehicleId).toBeNull();
    expect(repository.createdUploads[0]?.reviewReason).toBe("empty_pdf_text");
    expect(repository.createdUploads[0]?.rawData.parseResult.warnings[0]?.code).toBe(
      "empty_pdf_text"
    );
  });

  it("grants a real ledger point for authenticated users when policy grants", async () => {
    const repository = new FakeReportUploadRepository();
    const pointsLedgerRepository = new FakePointsLedgerRepository();
    const service = createService({
      repository,
      pointsLedgerRepository,
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
      guestSessionId: null,
      bytes: PDF_BYTES,
      originalFileName: "autoteka.pdf"
    });

    expect(result.pointGrant).toEqual({
      status: "granted",
      points: 1,
      balanceAfter: 1
    });
    expect(pointsLedgerRepository.grantCalls).toEqual([
      {
        userId: "user-1",
        vehicleId: "vehicle-1",
        reportUploadId: "upload-1",
        reportFingerprintId: "fingerprint-1",
        idempotencyKey: "report-grant:user:user-1:upload:upload-1",
        note: "fresh_valid_report"
      }
    ]);
  });

  it("creates a temporary guest point grant for guest uploads when policy grants", async () => {
    const repository = new FakeReportUploadRepository();
    const pointsLedgerRepository = new FakePointsLedgerRepository();
    const guestPointGrantRepository = new FakeGuestPointGrantRepository();
    const service = createService({
      repository,
      pointsLedgerRepository,
      guestPointGrantRepository,
      extractor: new FakeExtractor({
        text: REPORT_TEXT,
        pageCount: 2,
        hasExtractableText: true,
        errorCode: null
      }),
      parser: new FakeParser(parsedReport())
    });

    const result = await service.ingestPdf({
      userId: null,
      guestSessionId: "guest-1",
      bytes: PDF_BYTES,
      originalFileName: "autoteka.pdf"
    });

    expect(result.pointGrant).toEqual({
      status: "guest_pending",
      points: 1
    });
    expect(guestPointGrantRepository.createdGrants).toEqual([
      {
        guestSessionId: "guest-1",
        vehicleId: "vehicle-1",
        reportUploadId: "upload-1",
        reportFingerprintId: "fingerprint-1",
        points: 1,
        reason: "fresh_valid_report"
      }
    ]);
    expect(pointsLedgerRepository.grantCalls).toHaveLength(0);
  });

  it("returns upload success without a second point when ledger denies duplicate user VIN", async () => {
    const repository = new FakeReportUploadRepository();
    const pointsLedgerRepository = new FakePointsLedgerRepository({
      nextGrantResult: deniedLedgerResult("user_already_rewarded_for_vin", 1)
    });
    const service = createService({
      repository,
      pointsLedgerRepository,
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
      guestSessionId: null,
      bytes: PDF_BYTES,
      originalFileName: "autoteka.pdf"
    });

    expect(result.status).toBe("parsed");
    expect(result.pointGrant).toEqual({
      status: "not_granted",
      reason: "user_already_rewarded_for_vin"
    });
    expect(pointsLedgerRepository.grantCalls).toHaveLength(1);
  });

  it("returns upload success without a second point when ledger denies duplicate fingerprint", async () => {
    const repository = new FakeReportUploadRepository();
    const pointsLedgerRepository = new FakePointsLedgerRepository({
      nextGrantResult: deniedLedgerResult("user_already_rewarded_for_fingerprint", 1)
    });
    const service = createService({
      repository,
      pointsLedgerRepository,
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
      guestSessionId: null,
      bytes: PDF_BYTES,
      originalFileName: "autoteka.pdf"
    });

    expect(result.status).toBe("parsed");
    expect(result.pointGrant).toEqual({
      status: "not_granted",
      reason: "user_already_rewarded_for_fingerprint"
    });
    expect(pointsLedgerRepository.grantCalls).toHaveLength(1);
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
    const pointsLedgerRepository = new FakePointsLedgerRepository();
    const guestPointGrantRepository = new FakeGuestPointGrantRepository();
    const vehicleReportRebuilder = new FakeVehicleReportRebuilder();
    const service = createService({
      repository,
      pointsLedgerRepository,
      guestPointGrantRepository,
      vehicleReportRebuilder,
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
    expect(result.pointGrant).toEqual({
      status: "not_granted",
      reason: "parser_manual_review_required"
    });
    expect(repository.createdUploads[0]?.status).toBe("manual_review");
    expect(repository.upsertVehicleCalls).toBe(0);
    expect(repository.createdUploads[0]?.vehicleId).toBeNull();
    expect(repository.createdUploads[0]?.reviewReason).toBe("multiple_vins_found");
    expect(vehicleReportRebuilder.calls).toHaveLength(0);
    expect(pointsLedgerRepository.grantCalls).toHaveLength(0);
    expect(guestPointGrantRepository.createdGrants).toHaveLength(0);
  });

  it("rejects trusted parsed reports when vehicle upsert fails to return a vehicle", async () => {
    const repository = new FakeReportUploadRepository({ returnNullFromUpsert: true });
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

    await expect(
      service.ingestPdf({
        userId: "user-1",
        guestSessionId: "guest-1",
        bytes: PDF_BYTES,
        originalFileName: "autoteka.pdf"
      })
    ).rejects.toThrow("vehicle_upsert_failed");
  });

  it("does not attach vehicles for parsed reports that require manual review by points policy", async () => {
    const repository = new FakeReportUploadRepository({ automaticGrantCount: 3 });
    const pointsLedgerRepository = new FakePointsLedgerRepository();
    const guestPointGrantRepository = new FakeGuestPointGrantRepository();
    const service = createService({
      repository,
      pointsLedgerRepository,
      guestPointGrantRepository,
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

    expect(result.status).toBe("manual_review");
    expect(result.pointsEvaluation).toEqual({
      decision: "manual_review",
      points: 0,
      reason: "fingerprint_auto_grant_limit_reached"
    });
    expect(result.pointGrant).toEqual({
      status: "not_granted",
      reason: "fingerprint_auto_grant_limit_reached"
    });
    expect(repository.upsertVehicleCalls).toBe(0);
    expect(repository.createdUploads[0]?.vehicleId).toBeNull();
    expect(pointsLedgerRepository.grantCalls).toHaveLength(0);
    expect(guestPointGrantRepository.createdGrants).toHaveLength(0);
  });

  it("does not rebuild vehicle report read model for point-policy manual_review uploads", async () => {
    const repository = new FakeReportUploadRepository({ automaticGrantCount: 3 });
    const vehicleReportRebuilder = new FakeVehicleReportRebuilder();
    const service = createService({
      repository,
      vehicleReportRebuilder,
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

    expect(vehicleReportRebuilder.calls).toHaveLength(0);
  });
});

function createService(input: {
  repository: ReportUploadRepository;
  extractor: FakeExtractor;
  parser: FakeParser;
  pointsLedgerRepository?: FakePointsLedgerRepository;
  guestPointGrantRepository?: FakeGuestPointGrantRepository;
  vehicleReportRebuilder?: VehicleReportRebuilder;
  onReportRebuildError?: (input: {
    error: unknown;
    vehicleId: string;
    reportUploadId: string;
    vin: string;
  }) => void;
}): ReportUploadService {
  return new ReportUploadService({
    storage: new FakeStorage(),
    extractor: input.extractor,
    parser: input.parser,
    repository: input.repository,
    pointsLedgerService: new PointsLedgerService({
      repository: input.pointsLedgerRepository ?? new FakePointsLedgerRepository()
    }),
    guestPointGrantRepository:
      input.guestPointGrantRepository ?? new FakeGuestPointGrantRepository(),
    ...(input.vehicleReportRebuilder === undefined
      ? {}
      : { vehicleReportRebuilder: input.vehicleReportRebuilder }),
    ...(input.onReportRebuildError === undefined
      ? {}
      : { onReportRebuildError: input.onReportRebuildError }),
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

class FakeVehicleReportRebuilder implements VehicleReportRebuilder {
  calls: Array<{
    vehicleId: string;
    reportUploadId: string;
    acceptedAt: Date;
    parsedReport: ParsedReport;
  }> = [];

  async rebuildFromParsedUpload(input: {
    vehicleId: string;
    reportUploadId: string;
    acceptedAt: Date;
    parsedReport: ParsedReport;
  }): Promise<void> {
    this.calls.push(input);
  }
}

class ThrowingVehicleReportRebuilder implements VehicleReportRebuilder {
  constructor(private readonly error: unknown) {}

  async rebuildFromParsedUpload(): Promise<void> {
    throw this.error;
  }
}

class FakeReportUploadRepository implements ReportUploadRepository {
  createdUploads: CreateReportUploadInput[] = [];
  upsertVehicleCalls = 0;
  private readonly vehicles = new Map<string, VehicleRecord>();
  private readonly fingerprints = new Map<string, FingerprintRecord>();

  constructor(
    private readonly options: { automaticGrantCount?: number; returnNullFromUpsert?: boolean } = {}
  ) {}

  async findVehicleByVin(vin: string): Promise<VehicleRecord | null> {
    return this.vehicles.get(vin) ?? null;
  }

  async upsertVehicleFromParsedReport(report: ParsedReport): Promise<VehicleRecord> {
    this.upsertVehicleCalls += 1;
    if (report.vin === null) throw new Error("Cannot upsert vehicle without VIN.");
    if (this.options.returnNullFromUpsert === true) return null as unknown as VehicleRecord;

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
      automaticGrantCount: this.options.automaticGrantCount ?? 0
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

class FakeGuestPointGrantRepository implements GuestPointGrantRepository {
  createdGrants: Array<Parameters<GuestPointGrantRepository["createGrant"]>[0]> = [];

  async createGrant(input: Parameters<GuestPointGrantRepository["createGrant"]>[0]): Promise<void> {
    this.createdGrants.push(input);
  }
}

class FakePointsLedgerRepository implements PointsLedgerRepository {
  grantCalls: PointsLedgerRepositoryGrantInput[] = [];
  private balance = 0;

  constructor(
    private readonly options: { nextGrantResult?: PointsLedgerMutationResult } = {}
  ) {}

  async grantReportPoint(input: PointsLedgerRepositoryGrantInput): Promise<PointsLedgerMutationResult> {
    this.grantCalls.push(input);
    if (this.options.nextGrantResult !== undefined) return this.options.nextGrantResult;

    this.balance += 1;
    const entry: PointsLedgerEntry = {
      id: `ledger-${this.grantCalls.length}`,
      userId: input.userId,
      vehicleId: input.vehicleId,
      reportUploadId: input.reportUploadId,
      reportFingerprintId: input.reportFingerprintId,
      delta: 1,
      reason: "report_grant",
      idempotencyKey: input.idempotencyKey,
      note: input.note,
      createdAt: NOW,
      updatedAt: NOW
    };

    return {
      status: "applied",
      entry,
      ledgerEntryId: entry.id,
      balanceAfter: this.balance,
      reason: "report_grant"
    };
  }

  async spendPointForAccess(
    _input: PointsLedgerRepositorySpendInput
  ): Promise<PointsLedgerMutationResult> {
    throw new Error("spendPointForAccess is not used by upload tests.");
  }

  async adjustPoints(_input: PointsLedgerRepositoryAdjustInput): Promise<PointsLedgerMutationResult> {
    throw new Error("adjustPoints is not used by upload tests.");
  }

  async getBalance(): Promise<number | null> {
    return this.balance;
  }
}

function deniedLedgerResult(
  reason: PointsLedgerMutationResult["reason"],
  balanceAfter: number
): PointsLedgerMutationResult {
  return {
    status: "denied",
    entry: null,
    ledgerEntryId: null,
    balanceAfter,
    reason
  };
}
