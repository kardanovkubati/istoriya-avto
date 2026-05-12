import { createHash } from "node:crypto";
import type { ReportSourceKind } from "./report-parser";

export type CreateReportFingerprintInput = {
  sourceKind: ReportSourceKind;
  extractedText: string;
};

export function createReportFingerprint(input: CreateReportFingerprintInput): string {
  const normalizedText = normalizeReportTextForFingerprint(input.extractedText);
  return createHash("sha256")
    .update(`${input.sourceKind}:text-v1:${normalizedText}`, "utf8")
    .digest("hex");
}

export function normalizeReportTextForFingerprint(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
