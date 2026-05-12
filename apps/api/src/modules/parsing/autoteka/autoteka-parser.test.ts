import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parseAutotekaReport } from "./autoteka-parser";

const fixturesDir = join(import.meta.dir, "__fixtures__");

describe("parseAutotekaReport", () => {
  it("matches golden fixtures", async () => {
    const files = await readdir(fixturesDir);
    const textFixtures = files.filter((fileName) => fileName.endsWith(".txt")).sort();

    expect(textFixtures.length).toBeGreaterThanOrEqual(3);

    for (const textFileName of textFixtures) {
      const fixtureName = basename(textFileName, ".txt");
      const text = await readFile(join(fixturesDir, textFileName), "utf8");
      const expected = JSON.parse(
        await readFile(join(fixturesDir, `${fixtureName}.golden.json`), "utf8")
      );

      expect(parseAutotekaReport(text)).toEqual(expected);
    }
  });

  it("marks unknown report text for manual review", () => {
    const result = parseAutotekaReport("VIN: XTA210990Y2765499\nСлучайный документ");

    expect(result.status).toBe("manual_review");
    expect(result.warnings.map((warning) => warning.code)).toContain("suspicious_report_structure");
  });

  it("marks reports with multiple distinct VINs for manual review", () => {
    const result = parseAutotekaReport(`
      Отчет по автомобилю
      VIN: XTA210990Y2765499
      VIN: XTA210990Y2765400
      Дата формирования отчета: 01.05.2026
      Паспорт автомобиля
      Марка: LADA
      Модель: Granta
      Год выпуска: 2021
      История объявлений
      15.04.2026 Москва цена 780 000 ₽ пробег 42 000 км
      Проверки
      ДТП не найдены
      Расчеты ремонта не найдены
      Ограничения не найдены
      Залог не найден
    `);

    expect(result.status).toBe("manual_review");
    expect(result.warnings.map((warning) => warning.code)).toContain("multiple_vins_found");
  });
});
