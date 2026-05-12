import { describe, expect, it } from "bun:test";
import { createUploadRoutes, type UploadRoutesDependencies } from "./routes";

const VALID_USER_ID = "11111111-1111-4111-8111-111111111111";
const VALID_GUEST_SESSION_ID = "22222222-2222-4222-8222-222222222222";

describe("upload routes", () => {
  it("requires a Content-Length header without calling ingestPdf", async () => {
    const dependencies = createDependencies();
    const routes = createUploadRoutes(dependencies);

    const response = await routes.request("/report-pdf", {
      method: "POST",
      body: new FormData()
    });

    expect(response.status).toBe(411);
    expect(await response.json()).toEqual({
      error: {
        code: "upload_content_length_required",
        message: "Для загрузки отчета требуется корректный Content-Length."
      }
    });
    expect(dependencies.calls).toHaveLength(0);
  });

  it("requires a valid positive Content-Length header without calling ingestPdf", async () => {
    const dependencies = createDependencies();
    const routes = createUploadRoutes(dependencies);

    for (const contentLength of ["not-a-number", "0", "-1", "1.5"]) {
      const response = await routes.request("/report-pdf", {
        method: "POST",
        headers: {
          "content-length": contentLength
        },
        body: new FormData()
      });

      expect(response.status).toBe(411);
      expect(await response.json()).toEqual({
        error: {
          code: "upload_content_length_required",
          message: "Для загрузки отчета требуется корректный Content-Length."
        }
      });
    }

    expect(dependencies.calls).toHaveLength(0);
  });

  it("requires rights confirmation", async () => {
    const dependencies = createDependencies();
    const routes = createUploadRoutes(dependencies);
    const form = new FormData();
    form.append("file", pdfFile());

    const response = await routes.request("/report-pdf", {
      method: "POST",
      headers: {
        "content-length": "100"
      },
      body: form
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "rights_confirmation_required",
        message: "Подтвердите, что у вас есть право загружать этот отчет."
      }
    });
    expect(dependencies.calls).toHaveLength(0);
  });

  it("rejects non-PDF uploads", async () => {
    const dependencies = createDependencies();
    const routes = createUploadRoutes(dependencies);
    const form = new FormData();
    form.append("rightsConfirmed", "true");
    form.append("file", new File(["not a pdf"], "report.txt", { type: "text/plain" }));

    const response = await routes.request("/report-pdf", {
      method: "POST",
      headers: {
        "content-length": "100"
      },
      body: form
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_pdf_upload",
        message: "Загрузите PDF-файл отчета."
      }
    });
    expect(dependencies.calls).toHaveLength(0);
  });

  it("returns neutral upload status for parsed PDF", async () => {
    const dependencies = createDependencies();
    const routes = createUploadRoutes(dependencies);
    const form = new FormData();
    form.append("rightsConfirmed", "true");
    form.append("file", pdfFile("autoteka.pdf", "application/pdf"));

    const response = await routes.request("/report-pdf", {
      method: "POST",
      headers: {
        "content-length": "100"
      },
      body: form
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      upload: {
        id: "upload-1",
        status: "parsed",
        vin: "XTA210990Y2765499",
        generatedAt: "2026-05-01T00:00:00.000Z",
        pointsPreview: {
          decision: "grant",
          points: 1,
          reason: "fresh_valid_report"
        },
        reviewReason: null
      }
    });
    expect(dependencies.calls).toHaveLength(1);
    expect(dependencies.calls[0]).toMatchObject({
      fileName: "autoteka.pdf",
      contentType: "application/pdf",
      userId: null,
      guestSessionId: null
    });
    expect(Array.from(dependencies.calls[0]?.bytes ?? [])).toEqual([37, 80, 68, 70]);
    expect(dependencies.calls[0]?.now).toBeInstanceOf(Date);
  });

  it("rejects oversized PDFs with 413 without calling ingestPdf", async () => {
    const dependencies = createDependencies({ maxUploadBytes: 3 });
    const routes = createUploadRoutes(dependencies);
    const form = new FormData();
    form.append("rightsConfirmed", "true");
    form.append("file", pdfFile());

    const response = await routes.request("/report-pdf", {
      method: "POST",
      headers: {
        "content-length": "3"
      },
      body: form
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: {
        code: "report_file_too_large",
        message: "PDF-файл отчета слишком большой."
      }
    });
    expect(dependencies.calls).toHaveLength(0);
  });

  it("rejects oversized requests by content-length before parsing without calling ingestPdf", async () => {
    const dependencies = createDependencies({ maxUploadBytes: 3 });
    const routes = createUploadRoutes(dependencies);

    const response = await routes.request("/report-pdf", {
      method: "POST",
      headers: {
        "content-length": "4"
      },
      body: new FormData()
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: {
        code: "report_file_too_large",
        message: "PDF-файл отчета слишком большой."
      }
    });
    expect(dependencies.calls).toHaveLength(0);
  });

  it("rejects client-supplied identity fields without calling ingestPdf", async () => {
    const dependencies = createDependencies();
    const routes = createUploadRoutes(dependencies);

    const identityFields: Array<[string, string]> = [
      ["userId", VALID_USER_ID],
      ["guestSessionId", VALID_GUEST_SESSION_ID]
    ];

    for (const [field, value] of identityFields) {
      const form = new FormData();
      form.append("rightsConfirmed", "true");
      form.append("file", pdfFile());
      form.append(field, value);

      const response = await routes.request("/report-pdf", {
        method: "POST",
        headers: {
          "content-length": "100"
        },
        body: form
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "client_identity_not_allowed",
          message: "Идентификатор пользователя определяется сервером."
        }
      });
    }

    expect(dependencies.calls).toHaveLength(0);
  });

  it("rejects fake PDFs by magic bytes without calling ingestPdf", async () => {
    const dependencies = createDependencies();
    const routes = createUploadRoutes(dependencies);
    const form = new FormData();
    form.append("rightsConfirmed", "true");
    form.append("file", new File(["not pdf"], "report.pdf", { type: "application/pdf" }));

    const response = await routes.request("/report-pdf", {
      method: "POST",
      headers: {
        "content-length": "100"
      },
      body: form
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_pdf_upload",
        message: "Загрузите PDF-файл отчета."
      }
    });
    expect(dependencies.calls).toHaveLength(0);
  });
});

function pdfFile(name = "report.pdf", type = "application/pdf"): File {
  return new File([new Uint8Array([37, 80, 68, 70])], name, { type });
}

function createDependencies(
  overrides: Partial<UploadRoutesDependencies> = {}
): UploadRoutesDependencies & { calls: Array<Parameters<UploadRoutesDependencies["ingestPdf"]>[0]> } {
  const calls: Array<Parameters<UploadRoutesDependencies["ingestPdf"]>[0]> = [];

  return {
    calls,
    maxUploadBytes: overrides.maxUploadBytes ?? 1024,
    ingestPdf:
      overrides.ingestPdf ??
      (async (input) => {
        calls.push(input);

        return {
          uploadId: "upload-1",
          status: "parsed",
          vin: "XTA210990Y2765499",
          generatedAt: new Date("2026-05-01T00:00:00.000Z"),
          pointsEvaluation: {
            decision: "grant",
            points: 1,
            reason: "fresh_valid_report"
          },
          reviewReason: null
        };
      })
  };
}
