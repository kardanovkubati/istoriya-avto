import { describe, expect, it } from "bun:test";
import { createReportFingerprint, normalizeReportTextForFingerprint } from "./report-fingerprint";

describe("report fingerprint", () => {
  it("ignores whitespace-only differences", () => {
    const first = createReportFingerprint({
      sourceKind: "autoteka_pdf",
      extractedText: "VIN: XTA210990Y2765499\nДата отчета: 01.05.2026"
    });
    const second = createReportFingerprint({
      sourceKind: "autoteka_pdf",
      extractedText: " VIN:   XTA210990Y2765499 \r\n\r\n Дата отчета: 01.05.2026 "
    });

    expect(first).toBe(second);
  });

  it("changes when meaningful report text changes", () => {
    const first = createReportFingerprint({
      sourceKind: "autoteka_pdf",
      extractedText: "VIN: XTA210990Y2765499 Дата отчета: 01.05.2026 Пробег: 42000 км"
    });
    const second = createReportFingerprint({
      sourceKind: "autoteka_pdf",
      extractedText: "VIN: XTA210990Y2765499 Дата отчета: 01.05.2026 Пробег: 43000 км"
    });

    expect(first).not.toBe(second);
  });

  it("normalizes casing and invisible separators", () => {
    expect(normalizeReportTextForFingerprint("  ViN:\u00a0xta210990y2765499  ")).toBe(
      "vin: xta210990y2765499"
    );
  });
});
