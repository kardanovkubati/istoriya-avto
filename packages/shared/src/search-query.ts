export type SearchQueryKind =
  | "vin"
  | "plate"
  | "listing_url"
  | "unsupported_url"
  | "unknown";

export type SearchQueryDetection =
  | {
      kind: "vin" | "plate" | "unknown";
      normalized: string;
      original: string;
    }
  | {
      kind: "listing_url" | "unsupported_url";
      normalized: string;
      original: string;
      host: string;
    };

const SUPPORTED_LISTING_HOSTS = [
  "avito.ru",
  "www.avito.ru",
  "auto.ru",
  "www.auto.ru",
  "auto.drom.ru",
  "drom.ru",
  "www.drom.ru"
] as const;

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;
const RUSSIAN_PLATE_PATTERN = /^[АВЕКМНОРСТУХABEKMHOPCTYX]\d{3}[АВЕКМНОРСТУХABEKMHOPCTYX]{2}\d{2,3}$/i;

const LATIN_TO_CYRILLIC_PLATE: Record<string, string> = {
  A: "А",
  B: "В",
  E: "Е",
  K: "К",
  M: "М",
  H: "Н",
  O: "О",
  P: "Р",
  C: "С",
  T: "Т",
  Y: "У",
  X: "Х"
};

export function detectSearchQuery(input: string): SearchQueryDetection {
  const original = input;
  const normalizedInput = input.trim();

  if (normalizedInput.length === 0) {
    return { kind: "unknown", normalized: "", original };
  }

  const urlDetection = detectUrl(normalizedInput, original);
  if (urlDetection) {
    return urlDetection;
  }

  const vin = normalizedInput.replace(/\s+/g, "").toUpperCase();
  if (VIN_PATTERN.test(vin)) {
    return { kind: "vin", normalized: vin, original };
  }

  const plate = normalizePlate(normalizedInput);
  if (RUSSIAN_PLATE_PATTERN.test(plate)) {
    return { kind: "plate", normalized: plate, original };
  }

  return { kind: "unknown", normalized: normalizedInput, original };
}

function detectUrl(input: string, original: string): SearchQueryDetection | null {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const host = url.host.toLowerCase();
  const normalized = url.toString();

  if (SUPPORTED_LISTING_HOSTS.includes(host as (typeof SUPPORTED_LISTING_HOSTS)[number])) {
    return { kind: "listing_url", normalized, original, host };
  }

  return { kind: "unsupported_url", normalized, original, host };
}

function normalizePlate(value: string): string {
  return value
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/[ABEKMHOPCTYX]/g, (letter) => LATIN_TO_CYRILLIC_PLATE[letter] ?? letter);
}
