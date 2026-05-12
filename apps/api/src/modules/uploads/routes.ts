import { type Context, Hono } from "hono";
import { env } from "../../env";
import { parseAutotekaReport } from "../parsing/autoteka/autoteka-parser";
import { extractPdfText } from "../pdf/pdf-text-extractor";
import { LocalObjectStorage } from "../storage/local-object-storage";
import { DrizzleReportUploadRepository } from "./drizzle-report-upload-repository";
import { type IngestPdfResult, ReportUploadService } from "./report-upload-service";

export type UploadRoutesDependencies = {
  maxUploadBytes: number;
  ingestPdf(input: {
    fileName: string;
    contentType: string;
    bytes: Uint8Array;
    userId: string | null;
    guestSessionId: string | null;
    now: Date;
  }): Promise<IngestPdfResult>;
};

export function createUploadRoutes(dependencies: UploadRoutesDependencies): Hono {
  const routes = new Hono();

  routes.post("/report-pdf", async (context) => {
    const contentLength = parseContentLength(context.req.header("content-length"));
    if (contentLength !== null && contentLength > dependencies.maxUploadBytes) {
      return reportFileTooLarge(context);
    }

    const body = await context.req.parseBody().catch(() => null);

    if (body === null || body.rightsConfirmed !== "true") {
      return context.json(
        {
          error: {
            code: "rights_confirmation_required",
            message: "Подтвердите, что у вас есть право загружать этот отчет."
          }
        },
        400
      );
    }

    const file = body.file;

    if (!(file instanceof File) || !isPdfFile(file)) {
      return context.json(
        {
          error: {
            code: "invalid_pdf_upload",
            message: "Загрузите PDF-файл отчета."
          }
        },
        400
      );
    }

    if (file.size > dependencies.maxUploadBytes) {
      return reportFileTooLarge(context);
    }

    if (body.userId !== undefined || body.guestSessionId !== undefined) {
      return context.json(
        {
          error: {
            code: "client_identity_not_allowed",
            message: "Идентификатор пользователя определяется сервером."
          }
        },
        400
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasPdfMagicBytes(bytes)) {
      return context.json(
        {
          error: {
            code: "invalid_pdf_upload",
            message: "Загрузите PDF-файл отчета."
          }
        },
        400
      );
    }

    const result = await dependencies.ingestPdf({
      fileName: file.name,
      contentType: file.type || "application/pdf",
      bytes,
      userId: null,
      guestSessionId: null,
      now: new Date()
    });

    return context.json(
      {
        upload: {
          id: result.uploadId,
          status: result.status,
          vin: result.vin,
          generatedAt: result.generatedAt,
          pointsPreview: result.pointsEvaluation,
          reviewReason: result.reviewReason
        }
      },
      201
    );
  });

  return routes;
}

const reportUploadService = new ReportUploadService({
  storage: new LocalObjectStorage({ rootDir: env.REPORT_STORAGE_LOCAL_DIR }),
  repository: new DrizzleReportUploadRepository(),
  extractor: { extractText: extractPdfText },
  parser: { parse: parseAutotekaReport },
  originalRetentionDays: env.REPORT_ORIGINAL_RETENTION_DAYS
});

export const uploadRoutes = createUploadRoutes({
  maxUploadBytes: env.MAX_REPORT_UPLOAD_BYTES,
  ingestPdf: async (input) =>
    reportUploadService.ingestPdf({
      userId: input.userId,
      guestSessionId: input.guestSessionId,
      bytes: input.bytes,
      originalFileName: input.fileName
    })
});

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function hasPdfMagicBytes(bytes: Uint8Array): boolean {
  return bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70;
}

function parseContentLength(value: string | undefined): number | null {
  if (value === undefined) return null;

  const contentLength = Number(value);
  return Number.isInteger(contentLength) && Number.isFinite(contentLength) ? contentLength : null;
}

function reportFileTooLarge(context: Context) {
  return context.json(
    {
      error: {
        code: "report_file_too_large",
        message: "PDF-файл отчета слишком большой."
      }
    },
    413
  );
}
