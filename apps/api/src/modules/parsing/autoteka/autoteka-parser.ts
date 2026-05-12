import type { ParsedReport, ParsedVehiclePassport, ParseWarningCode } from "../report-parser";

const PARSER_VERSION = "autoteka-v1";
const VIN_PATTERN = /\b[A-HJ-NPR-Z0-9]{17}\b/g;

const RISK_RULES = {
  accidents: [/ДТП\s+не\s+найден[ыо]/i, /ДТП\s+найден[ыо]?|есть\s+ДТП/i],
  repairCalculations: [
    /Расч[её]ты\s+ремонта\s+не\s+найден[ыо]/i,
    /Расч[её]ты\s+ремонта\s+найден[ыо]?/i
  ],
  restrictions: [
    /Ограничения\s+не\s+найден[ыо]/i,
    /Ограничения\s+найден[ыо]?|есть\s+ограничения/i
  ],
  pledge: [/Залог\s+не\s+найден/i, /Залог\s+найден|есть\s+залог/i],
  wanted: [/Розыск\s+не\s+найден/i, /Розыск\s+найден|находится\s+в\s+розыске/i],
  taxi: [/Такси\s+не\s+найден[оа]?/i, /Такси\s+найден[оа]?|использовался\s+в\s+такси/i],
  leasing: [/Лизинг\s+не\s+найден/i, /Лизинг\s+найден|есть\s+лизинг/i]
} as const;

const WARNING_MESSAGES: Record<ParseWarningCode, string> = {
  unsupported_report_source: "Неподдерживаемый источник отчета.",
  missing_vin: "Не удалось определить VIN отчета.",
  multiple_vins_found: "В отчете найдено несколько разных VIN.",
  missing_generated_at: "Не удалось определить дату формирования отчета.",
  future_generated_at: "Дата формирования отчета находится в будущем.",
  insufficient_key_blocks:
    "Отчет содержит меньше трех ключевых блоков для автоматической обработки.",
  empty_pdf_text: "Текст отчета пуст.",
  suspicious_report_structure: "Структура отчета не похожа на поддерживаемый шаблон."
};

const PASSPORT_LABELS = {
  make: "Марка",
  model: "Модель",
  year: "Год выпуска",
  bodyType: "Кузов",
  color: "Цвет",
  engine: "Двигатель",
  transmission: "Коробка",
  driveType: "Привод"
} as const;

const SECTION_HEADERS = [
  "Паспорт автомобиля",
  "История объявлений",
  "Пробеги",
  "Проверки"
] as const;

function normalizeText(text: string): string {
  return text.normalize("NFKC").replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").trim();
}

function parseRuDate(value: string): string | null {
  const match = /(\d{2})\.(\d{2})\.(\d{4})/.exec(value);
  if (!match) return null;
  const day = match[1];
  const month = match[2];
  const year = match[3];
  if (!day || !month || !year) return null;

  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;

  const parsedDay = Number.parseInt(day, 10);
  const parsedMonth = Number.parseInt(month, 10);
  const parsedYear = Number.parseInt(year, 10);
  if (
    date.getUTCFullYear() !== parsedYear ||
    date.getUTCMonth() + 1 !== parsedMonth ||
    date.getUTCDate() !== parsedDay
  ) {
    return null;
  }

  return date.toISOString();
}

function parseInteger(value: string): number | null {
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? Number.parseInt(digits, 10) : null;
}

function findLabelValue(text: string, label: string): string | null {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escapedLabel}\\s*:\\s*(.+)$`, "im").exec(text);
  return match?.[1]?.trim() ?? null;
}

function getSectionLines(text: string, sectionName: string): string[] {
  const lines = text.split("\n").map((line) => line.trim());
  const startIndex = lines.findIndex((line) => line === sectionName);
  if (startIndex === -1) return [];

  const sectionLines: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (SECTION_HEADERS.some((header) => header !== sectionName && line === header)) break;
    if (line.length > 0) sectionLines.push(line);
  }
  return sectionLines;
}

function parseGeneratedAt(text: string): string | null {
  const match = /(?:Дата формирования отчета|Дата отчета|Отчет сформирован)\s*:?\s*([^\n]+)/i.exec(
    text
  );
  return match?.[1] ? parseRuDate(match[1]) : null;
}

function parseVehicle(text: string, vin: string | null): ParsedVehiclePassport {
  const yearValue = findLabelValue(text, PASSPORT_LABELS.year);
  const year = yearValue ? parseInteger(yearValue) : null;

  return {
    vin,
    make: findLabelValue(text, PASSPORT_LABELS.make),
    model: findLabelValue(text, PASSPORT_LABELS.model),
    year,
    bodyType: findLabelValue(text, PASSPORT_LABELS.bodyType),
    color: findLabelValue(text, PASSPORT_LABELS.color),
    engine: findLabelValue(text, PASSPORT_LABELS.engine),
    transmission: findLabelValue(text, PASSPORT_LABELS.transmission),
    driveType: findLabelValue(text, PASSPORT_LABELS.driveType)
  };
}

function parseListings(text: string): ParsedReport["listings"] {
  return getSectionLines(text, "История объявлений").flatMap((line) => {
    const match =
      /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s+цена\s+([\d\s]+)\s*(?:₽|руб\.?)?\s+пробег\s+([\d\s]+)\s*км/i.exec(
        line
      );
    if (!match) return [];

    const dateValue = match[1];
    const city = match[2];
    const priceValue = match[3];
    const mileageValue = match[4];
    if (!dateValue || !city || !priceValue || !mileageValue) return [];

    return [
      {
        observedAt: parseRuDate(dateValue),
        priceRub: parseInteger(priceValue),
        mileageKm: parseInteger(mileageValue),
        city: city.trim()
      }
    ];
  });
}

function parseMileageReadings(text: string): ParsedReport["mileageReadings"] {
  return getSectionLines(text, "Пробеги").flatMap((line) => {
    const match = /^(\d{2}\.\d{2}\.\d{4})\s+([\d\s]+)\s*км\s*(.*)$/i.exec(line);
    if (!match) return [];

    const dateValue = match[1];
    const mileageValue = match[2];
    const context = match[3] ?? "";
    if (!dateValue || !mileageValue) return [];

    const mileageKm = parseInteger(mileageValue);
    if (mileageKm === null) return [];

    return [
      {
        observedAt: parseRuDate(dateValue),
        mileageKm,
        context: context.trim()
      }
    ];
  });
}

function parseRiskFlags(text: string): ParsedReport["riskFlags"] {
  return Object.fromEntries(
    Object.entries(RISK_RULES).map(([riskName, [notFoundPattern, foundPattern]]) => {
      if (foundPattern.test(text)) return [riskName, "found"];
      if (notFoundPattern.test(text)) return [riskName, "not_found"];
      return [riskName, "unknown"];
    })
  ) as ParsedReport["riskFlags"];
}

function warning(code: ParseWarningCode): { code: ParseWarningCode; message: string } {
  return { code, message: WARNING_MESSAGES[code] };
}

export function parseAutotekaReport(text: string): ParsedReport {
  const normalizedText = normalizeText(text);
  const vinCandidates = [...normalizedText.matchAll(VIN_PATTERN)].map((match) => match[0]);
  const distinctVins = [...new Set(vinCandidates)];
  const vin = vinCandidates[0] ?? null;
  const generatedAt = parseGeneratedAt(normalizedText);
  const vehicle = parseVehicle(normalizedText, vin);
  const listings = parseListings(normalizedText);
  const mileageReadings = parseMileageReadings(normalizedText);
  const riskFlags = parseRiskFlags(normalizedText);
  const knownRiskFlags = Object.values(riskFlags).filter((value) => value !== "unknown").length;
  const hasSupportedStructure =
    normalizedText.includes("Отчет по автомобилю") &&
    (normalizedText.includes("Паспорт автомобиля") || normalizedText.includes("Проверки"));

  const keyBlocks: ParsedReport["keyBlocks"] = [];
  if (vin && vehicle.make && vehicle.model && vehicle.year !== null) {
    keyBlocks.push("vehicle_passport");
  }
  if (listings.length > 0 || mileageReadings.length > 0) {
    keyBlocks.push("listings_or_mileage");
  }
  if (knownRiskFlags >= 4) {
    keyBlocks.push("risk_checks");
  }

  const warnings: ParsedReport["warnings"] = [];
  if (!vin) warnings.push(warning("missing_vin"));
  if (distinctVins.length > 1) warnings.push(warning("multiple_vins_found"));
  if (!generatedAt) warnings.push(warning("missing_generated_at"));
  if (keyBlocks.length < 3) warnings.push(warning("insufficient_key_blocks"));
  if (!hasSupportedStructure) warnings.push(warning("suspicious_report_structure"));

  return {
    sourceKind: "autoteka_pdf",
    parserVersion: PARSER_VERSION,
    status: warnings.length > 0 ? "manual_review" : "parsed",
    vin,
    generatedAt,
    vehicle,
    listings,
    mileageReadings,
    riskFlags,
    keyBlocks,
    warnings,
    qualityScore: Math.round((keyBlocks.length / 3) * 100) / 100
  };
}
