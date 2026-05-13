import { describe, expect, it } from "bun:test";
import { assertNoSourceBrandLeak, maskVinForPreview } from "./report-read-model";

describe("vehicle report read model helpers", () => {
  it("masks VIN for preview without exposing plate data", () => {
    expect(maskVinForPreview("XTA210990Y2765499")).toBe("XTA2109********99");
  });

  it("does not fail neutral user-facing responses", () => {
    expect(() =>
      assertNoSourceBrandLeak({
        summary: {
          historyBasisText:
            "История составлена на основе 2 загруженных отчетов. Последнее обновление: 01.05.2026."
        }
      })
    ).not.toThrow();
  });

  it("fails if a user-facing response contains third-party source names or internal source fields", () => {
    const unsafePayloads = [
      { sourceKind: "autoteka_pdf" },
      { parserVersion: "autoteka-v1" },
      { originalObjectKey: "report-originals/1.pdf" },
      { text: "Факт получен из Автотеки" },
      { text: "Источник: Авито" },
      { text: "Источник: Auto.ru" },
      { text: "Источник: Дром" },
      { text: "Источник: Drom" }
    ];

    for (const payload of unsafePayloads) {
      expect(() => assertNoSourceBrandLeak(payload)).toThrow("source_brand_leak");
    }
  });
});
