import { describe, expect, it } from "bun:test";
import type { ReportSection } from "./report-types";
import { buildReportNavigation } from "./report-navigation";

describe("report navigation", () => {
  it("keeps pre-inspection decision before the timeline and detail sections", () => {
    const sections = [
      section("summary", "Сводка"),
      section("passport", "Паспорт авто и идентификаторы"),
      section("legal_risks", "Юридические риски"),
      section("accidents_repairs", "ДТП и расчеты ремонта"),
      section("mileage", "Пробеги и расхождения"),
      section("listings", "История объявлений"),
      section("data_quality", "Расхождения и качество данных"),
      section("update_history", "История обновлений отчета"),
    ];

    const groups = buildReportNavigation(sections);

    expect(groups.map((group) => group.label)).toEqual([
      "Перед осмотром",
      "История автомобиля",
      "Проверки и детали",
      "Основа отчета",
    ]);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["summary"]);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(["update_history", "mileage", "listings"]);
    expect(groups[2]?.items.map((item) => item.id)).toEqual(["legal_risks", "accidents_repairs", "data_quality"]);
    expect(groups[3]?.items.map((item) => item.id)).toEqual(["report_basis"]);
  });
});

function section(id: ReportSection["id"], title: string): ReportSection {
  return {
    id,
    title,
    critical: true,
    state: "ready",
    items: [],
  };
}
