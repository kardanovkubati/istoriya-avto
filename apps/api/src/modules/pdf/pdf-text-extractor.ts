import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type PdfTextExtractionResult = {
  text: string;
  pageCount: number;
  hasExtractableText: boolean;
  errorCode: "pdf_parse_failed" | null;
};

type PdfTextItem = { str: string };

export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextExtractionResult> {
  try {
    const document = await getDocument({
      data: bytes,
      disableFontFace: true,
      useSystemFonts: true
    }).promise;

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
  }
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  return typeof item === "object" && item !== null && "str" in item && typeof item.str === "string";
}
