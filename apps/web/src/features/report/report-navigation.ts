import type { ReportSection } from "./report-types";

export type ReportNavigationTarget = ReportSection["id"] | "report_basis";

export type ReportNavigationItem = {
  id: ReportNavigationTarget;
  label: string;
};

export type ReportNavigationGroup = {
  label: string;
  items: ReportNavigationItem[];
};

const GROUPS: ReportNavigationGroup[] = [
  {
    label: "Перед осмотром",
    items: [{ id: "summary", label: "Сводка" }],
  },
  {
    label: "История автомобиля",
    items: [
      { id: "update_history", label: "Хронология" },
      { id: "mileage", label: "Пробег" },
      { id: "listings", label: "Объявления" },
    ],
  },
  {
    label: "Проверки и детали",
    items: [
      { id: "legal_risks", label: "Статусы" },
      { id: "accidents_repairs", label: "ДТП и ремонт" },
      { id: "owners_registrations", label: "Регистрации" },
      { id: "commercial_use", label: "Использование" },
      { id: "maintenance", label: "ТО" },
      { id: "data_quality", label: "Расхождения" },
    ],
  },
  {
    label: "Основа отчета",
    items: [{ id: "report_basis", label: "База" }],
  },
];

export function buildReportNavigation(sections: ReportSection[]): ReportNavigationGroup[] {
  const availableSectionIds = new Set(sections.map((section) => section.id));

  return GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => item.id === "report_basis" || availableSectionIds.has(item.id)),
  })).filter((group) => group.items.length > 0);
}
