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

export type ReportSummarySignal = {
  label: string;
  value: string;
  tone: "default" | "good" | "warning" | "danger";
  sectionId?: ReportSectionId;
};

export type ReportExpertCheck = {
  label: "Кузов" | "Пробег" | "Документы" | "Юридические статусы";
  reason: string;
};

export type ReportSummarySignals = {
  headline: string;
  negativeSignals: ReportSummarySignal[];
  expertChecks: ReportExpertCheck[];
  neutralFacts: ReportSummarySignal[];
};

export type ReportPresentation = {
  generatedAt: string;
  noindex: true;
  disclaimer: string;
  watermark: string;
  actions: { canShare: boolean; canDownloadPdf: boolean };
  summarySignals: ReportSummarySignals;
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
    summarySignals: buildSummarySignals(input.report),
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
  return ready("summary", "Сводка", true, [
    { label: "Основа истории", value: report.summary.historyBasisText },
    ...(
      report.summary.freshnessWarning === null
        ? []
        : [
            {
              label: "Актуальность",
              value: report.summary.freshnessWarning,
              tone: "warning" as const
            }
          ]
    )
  ]);
}

function buildSummarySignals(report: VehicleFullReportReadModel): ReportSummarySignals {
  const negativeSignals: ReportSummarySignal[] = [
    riskSignal("ДТП", report.accidentsAndRepairs.accidents, "accidents_repairs"),
    riskSignal("Расчеты ремонта", report.accidentsAndRepairs.repairCalculations, "accidents_repairs"),
    riskSignal("Ограничения", report.legalRisks.restrictions, "legal_risks"),
    riskSignal("Залог", report.legalRisks.pledge, "legal_risks"),
    riskSignal("Розыск", report.legalRisks.wanted, "legal_risks"),
    report.mileage.hasRollbackSignals
      ? { label: "Пробег", value: "есть расхождение", tone: "warning" as const, sectionId: "mileage" as const }
      : null,
    ...report.conflicts
      .filter((conflict) => conflict.severity === "critical")
      .map((conflict) => ({
        label: "Расхождение данных",
        value: conflict.message,
        tone: "danger" as const,
        sectionId: "data_quality" as const
      }))
  ].filter((signal): signal is ReportSummarySignal => signal !== null);

  const neutralFacts: ReportSummarySignal[] = [
    neutralRiskFact("Ограничения", report.legalRisks.restrictions, "legal_risks", "не найдены"),
    neutralRiskFact("Залог", report.legalRisks.pledge, "legal_risks", "не найден"),
    neutralRiskFact("Розыск", report.legalRisks.wanted, "legal_risks", "не найден"),
    report.listings.length > 0
      ? {
          label: "Объявления",
          value: pluralize(report.listings.length, "запись", "записи", "записей"),
          tone: "default" as const,
          sectionId: "listings" as const
        }
      : null,
    report.mileage.readings.length > 0
      ? {
          label: "Пробег",
          value: `зафиксирован в ${pluralize(report.mileage.readings.length, "точке", "точках", "точках")}`,
          tone: report.mileage.hasRollbackSignals ? "warning" as const : "default" as const,
          sectionId: "mileage" as const
        }
      : null,
    report.summary.freshnessWarning === null
      ? {
          label: "Обновление",
          value: report.summary.lastUpdatedAt === null ? "дата не указана" : formatDate(report.summary.lastUpdatedAt),
          tone: "default" as const,
          sectionId: "update_history" as const
        }
      : {
          label: "Актуальность",
          value: report.summary.freshnessWarning,
          tone: "warning" as const,
          sectionId: "update_history" as const
        }
  ].filter((signal): signal is ReportSummarySignal => signal !== null);

  return {
    headline:
      negativeSignals.length > 0
        ? "Найдены сигналы, которые стоит проверить перед осмотром"
        : "Сводная история собрана по доступным данным",
    negativeSignals,
    expertChecks: expertChecksFor(negativeSignals),
    neutralFacts
  };
}

function riskSignal(
  label: string,
  risk: ReportRiskFact,
  sectionId: ReportSectionId
): ReportSummarySignal | null {
  if (risk.status !== "found") return null;
  return { label, value: "найдено", tone: "danger", sectionId };
}

function neutralRiskFact(
  label: string,
  risk: ReportRiskFact,
  sectionId: ReportSectionId,
  value: string
): ReportSummarySignal | null {
  if (risk.status !== "not_found") return null;
  return { label, value, tone: "good", sectionId };
}

function expertChecksFor(signals: ReportSummarySignal[]): ReportExpertCheck[] {
  const checks = new Map<ReportExpertCheck["label"], string>();

  for (const signal of signals) {
    if (signal.sectionId === "accidents_repairs") {
      checks.set("Кузов", "Проверить следы ремонта, окрасы и геометрию кузова.");
    }
    if (signal.sectionId === "mileage") {
      checks.set("Пробег", "Сверить пробег с диагностикой, сервисными записями и состоянием салона.");
    }
    if (signal.sectionId === "legal_risks") {
      checks.set("Юридические статусы", "Проверить актуальные ограничения и документы перед сделкой.");
    }
    if (signal.sectionId === "data_quality") {
      checks.set("Документы", "Сверить VIN, ПТС и факты из разных документов.");
    }
  }

  return Array.from(checks, ([label, reason]) => ({ label, reason }));
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

function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${formatNumber(count)} ${word}`;
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
