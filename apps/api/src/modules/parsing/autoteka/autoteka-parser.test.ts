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
});
