import { getDocument, VerbosityLevel, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

export type PdfTextExtractionResult = {
  text: string;
  pageCount: number;
  hasExtractableText: boolean;
  errorCode: "pdf_parse_failed" | null;
};

type PdfTextItem = { str: string };

export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextExtractionResult> {
  let document: PDFDocumentProxy | null = null;
  let loadingTask: ReturnType<typeof getDocument> | null = null;

  try {
    loadingTask = getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      useSystemFonts: true,
      verbosity: VerbosityLevel.ERRORS
    });
    document = await loadingTask.promise;

    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => (isPdfTextItem(item) ? item.str : ""))
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      pageTexts.push(text);
    }

    const text = pageTexts.filter(Boolean).join("\n\n").trim();

    return { text, pageCount: document.numPages, hasExtractableText: text.length > 0, errorCode: null };
  } catch {
    return { text: "", pageCount: 0, hasExtractableText: false, errorCode: "pdf_parse_failed" };
  } finally {
    try {
      if (document !== null) {
        await document.cleanup();
        await document.destroy();
      } else {
        await loadingTask?.destroy();
      }
    } catch {
      // Cleanup failures should not replace the extraction result.
    }
  }
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  return typeof item === "object" && item !== null && "str" in item && typeof item.str === "string";
}
