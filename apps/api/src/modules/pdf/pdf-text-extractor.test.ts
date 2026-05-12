import { describe, expect, it } from "bun:test";
import { extractPdfText } from "./pdf-text-extractor";
import { TEXT_PDF_BASE64 } from "./text-pdf-fixture";

describe("extractPdfText", () => {
  it("extracts text from a text-layer PDF without OCR", async () => {
    const bytes = Uint8Array.from(Buffer.from(TEXT_PDF_BASE64, "base64"));
    const result = await extractPdfText(bytes);

    expect(result.pageCount).toBe(1);
    expect(result.hasExtractableText).toBe(true);
    expect(result.text).toContain("VIN: XTA210990Y2765499");
    expect(result.text).toContain("Date: 01.05.2026");
  });

  it("marks non-PDF bytes as extraction failure", async () => {
    const result = await extractPdfText(new TextEncoder().encode("not a pdf"));

    expect(result.hasExtractableText).toBe(false);
    expect(result.text).toBe("");
    expect(result.errorCode).toBe("pdf_parse_failed");
  });
});
