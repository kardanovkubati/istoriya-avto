import {
  assertNoSourceBrandLeak,
  type ReportRiskFact,
  type VehicleFullReportReadModel
} from "../vehicles/report-read-model";

export type ReportPresentationMode = "owner" | "share";

export type ReportSectionId =
  | "summary"
  | "passport"
  | "legal_risks"
  | "accidents_repairs"
  | "mileage"
  | "owners_registrations"
  | "listings"
  | "commercial_use"
  | "maintenance"
  | "data_quality"
  | "update_history";

export type ReportPresentationItem = {
  label: string;
  value: string;
  tone?: "default" | "good" | "warning" | "danger";
  date?: string | null;
};

export type ReportPresentationSection = {
  id: ReportSectionId;
  title: string;
  critical: boolean;
  state: "ready" | "empty";
  emptyText?: "данных не найдено на дату обновления";
  items: ReportPresentationItem[];
};

export type ReportPresentation = {
  generatedAt: string;
  noindex: true;
  disclaimer: string;
  watermark: string;
  actions: { canShare: boolean; canDownloadPdf: boolean };
  sections: ReportPresentationSection[];
};

const CRITICAL_EMPTY_TEXT = "данных не найдено на дату обновления" as const;

export function buildReportPresentation(input: {
  report: VehicleFullReportReadModel;
  mode: ReportPresentationMode;
}): ReportPresentation {
  const presentation: ReportPresentation = {
    generatedAt: input.report.generatedAt,
    noindex: true,
    disclaimer:
      "Отчет является сводкой нормализованных фактов и не заменяет юридическую или техническую проверку автомобиля.",
    watermark: `История Авто · ${input.report.vehicleId} · ${formatDateTime(input.report.generatedAt)}`,
    actions: {
      canShare: input.mode === "owner",
      canDownloadPdf: input.mode === "owner"
    },
    sections: [
      summarySection(input.report),
      passportSection(input.report),
      legalRisksSection(input.report),
      accidentsRepairsSection(input.report),
      mileageSection(input.report),
      ownersRegistrationsSection(),
      listingsSection(input.report),
      commercialUseSection(input.report),
      maintenanceSection(),
      dataQualitySection(input.report),
      updateHistorySection(input.report)
    ].filter((section) => section.state === "ready" || section.critical)
  };

  assertNoSourceBrandLeak(presentation);
  return presentation;
}

function summarySection(report: VehicleFullReportReadModel): ReportPresentationSection {
  const transparency =
    report.summary.transparency.kind === "score"
      ? `${report.summary.transparency.value} / ${report.summary.transparency.max} · ${report.summary.transparency.label}`
      : report.summary.transparency.message;

  return ready("summary", "Сводка", true, [
    { label: "Оценка прозрачности", value: transparency },
    { label: "Основа истории", value: report.summary.historyBasisText },
    ...(
      report.summary.freshnessWarning === null
        ? []
        : [
            {
              label: "Свежесть",
              value: report.summary.freshnessWarning,
              tone: "warning" as const
            }
          ]
    )
  ]);
}

function passportSection(report: VehicleFullReportReadModel): ReportPresentationSection {
  return ready("passport", "Паспорт авто и идентификаторы", true, compactItems([
    ["VIN", report.passport.vin],
    ["Марка", report.passport.make],
    ["Модель", report.passport.model],
    ["Год", report.passport.year === null ? null : String(report.passport.year)],
    ["Кузов", report.passport.bodyType],
    ["Цвет", report.passport.color],
    ["Двигатель", report.passport.engine],
    ["КПП", report.passport.transmission],
    ["Привод", report.passport.driveType]
  ]));
}

function legalRisksSection(report: VehicleFullReportReadModel): ReportPresentationSection {
  return riskSection("legal_risks", "Юридические риски", true, [
    ["Ограничения", report.legalRisks.restrictions],
    ["Залог", report.legalRisks.pledge],
    ["Розыск", report.legalRisks.wanted]
  ]);
}

function accidentsRepairsSection(report: VehicleFullReportReadModel): ReportPresentationSection {
  return riskSection("accidents_repairs", "ДТП и расчеты ремонта", true, [
    ["ДТП", report.accidentsAndRepairs.accidents],
    ["Расчеты ремонта", report.accidentsAndRepairs.repairCalculations]
  ]);
}

function mileageSection(report: VehicleFullReportReadModel): ReportPresentationSection {
  const items = report.mileage.readings.map((reading) => ({
    label: reading.observedAt === null ? "Пробег" : `Пробег на ${formatDate(reading.observedAt)}`,
    value: `${formatNumber(reading.mileageKm)} км`,
    tone: report.mileage.hasRollbackSignals ? ("warning" as const) : ("default" as const),
    date: reading.observedAt
  }));

  return section("mileage", "Пробеги и расхождения", true, items);
}

function ownersRegistrationsSection(): ReportPresentationSection {
  return empty("owners_registrations", "История владельцев и регистраций", true);
}

function listingsSection(report: VehicleFullReportReadModel): ReportPresentationSection {
  const items = report.listings.map((listing) => ({
    label: listing.observedAt === null ? "Объявление" : `Объявление от ${formatDate(listing.observedAt)}`,
    value:
      [
        listing.priceRub === null ? null : `${formatNumber(listing.priceRub)} ₽`,
        listing.mileageKm === null ? null : `${formatNumber(listing.mileageKm)} км`,
        listing.city
      ].filter(Boolean).join(" · ") || "Данные объявления",
    date: listing.observedAt
  }));

  return section("listings", "История объявлений", false, items);
}

function commercialUseSection(report: VehicleFullReportReadModel): ReportPresentationSection {
  return riskSection("commercial_use", "Коммерческое использование", true, [
    ["Такси", report.commercialUse.taxi],
    ["Лизинг", report.commercialUse.leasing]
  ]);
}

function maintenanceSection(): ReportPresentationSection {
  return empty("maintenance", "ТО, страхование, диагностика", false);
}

function dataQualitySection(report: VehicleFullReportReadModel): ReportPresentationSection {
  const items = report.conflicts.map((conflict) => ({
    label: conflict.message,
    value: conflict.values.map((value) => String(value.value)).join(" / "),
    tone: conflict.severity === "critical" ? ("danger" as const) : ("warning" as const)
  }));

  return section("data_quality", "Расхождения и качество данных", true, items);
}

function updateHistorySection(report: VehicleFullReportReadModel): ReportPresentationSection {
  return section(
    "update_history",
    "История обновлений отчета",
    true,
    report.updateHistory.map((update) => ({
      label: update.reportedAt === null ? "Отчет без даты формирования" : `Отчет от ${formatDate(update.reportedAt)}`,
      value: `Принят ${formatDateTime(update.acceptedAt)}`,
      date: update.acceptedAt
    }))
  );
}

function riskSection(
  id: ReportSectionId,
  title: string,
  critical: boolean,
  risks: Array<[string, ReportRiskFact]>
): ReportPresentationSection {
  const known = risks.filter(([, risk]) => risk.status !== "unknown");

  return section(
    id,
    title,
    critical,
    known.map(([label, risk]) => ({
      label,
      value: risk.status === "found" ? "найдено" : "не найдено",
      tone: risk.status === "found" ? ("danger" as const) : ("good" as const),
      date: risk.checkedAt
    }))
  );
}

function compactItems(values: Array<[string, string | null]>): ReportPresentationItem[] {
  return values.flatMap(([label, value]) => value === null ? [] : [{ label, value }]);
}

function ready(
  id: ReportSectionId,
  title: string,
  critical: boolean,
  items: ReportPresentationItem[]
): ReportPresentationSection {
  return { id, title, critical, state: "ready", items };
}

function empty(id: ReportSectionId, title: string, critical: boolean): ReportPresentationSection {
  return critical
    ? { id, title, critical, state: "empty", emptyText: CRITICAL_EMPTY_TEXT, items: [] }
    : { id, title, critical, state: "empty", items: [] };
}

function section(
  id: ReportSectionId,
  title: string,
  critical: boolean,
  items: ReportPresentationItem[]
): ReportPresentationSection {
  return items.length > 0 ? ready(id, title, critical, items) : empty(id, title, critical);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC" }).format(date);
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC",
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}
