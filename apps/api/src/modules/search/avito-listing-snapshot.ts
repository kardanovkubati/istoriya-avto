import { detectSearchQuery } from "@istoriya-avto/shared";
import { parse } from "node-html-parser";
import type { ListingSnapshotPublicData } from "./search-contract";

export type AvitoListingSnapshotParseResult =
  | {
      status: "captured";
      data: ListingSnapshotPublicData;
    }
  | {
      status: "unavailable";
      reason: "structured_data_missing";
    };

export function parseAvitoListingSnapshotHtml(html: string): AvitoListingSnapshotParseResult {
  const root = parse(html);
  const structuredListing = parseJsonRecords(root.querySelectorAll('script[type="application/ld+json"]').map((node) => node.text))
    .find(isVehicleListingRecord);

  if (structuredListing === undefined) {
    return { status: "unavailable", reason: "structured_data_missing" };
  }

  const title = stringOrNull(structuredListing.name) ?? "";
  const description = stringOrNull(structuredListing.description);
  const city = stringOrNull(root.querySelector('[data-marker="item-view/item-address"]')?.text.trim());
  const photos = arrayFromUnknown(structuredListing.image)
    .map((image) => stringOrNull(image))
    .filter((url): url is string => url !== null)
    .slice(0, 6)
    .map((url) => ({ url, alt: "Фото автомобиля" }));

  return {
    status: "captured",
    data: {
      vin: extractVin([title, description].filter((value): value is string => value !== null).join(" ")),
      title,
      make: extractMake(title),
      model: extractModel(title),
      year: extractYear(title),
      bodyType: null,
      color: null,
      engine: null,
      transmission: null,
      driveType: null,
      priceRub: extractPriceRub(structuredListing.offers),
      mileageKm: extractMileageKm(description ?? title),
      city,
      photos
    }
  };
}

function parseJsonRecords(values: string[]): Record<string, unknown>[] {
  return values.flatMap((value) => {
    try {
      return recordsFromJson(JSON.parse(value));
    } catch {
      return [];
    }
  });
}

function recordsFromJson(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(recordsFromJson);
  if (!isRecord(value)) return [];

  const graph = arrayFromUnknown(value["@graph"]).flatMap(recordsFromJson);
  return [value, ...graph];
}

function isVehicleListingRecord(value: Record<string, unknown>): boolean {
  return arrayFromUnknown(value["@type"])
    .flatMap((type) => (typeof type === "string" ? [type] : []))
    .map((type) => type.toLowerCase().replace(/^https?:\/\/schema\.org\//, ""))
    .some((type) => type === "product" || type === "vehicle");
}

function extractVin(value: string): string | null {
  const candidates = value.match(/[A-HJ-NPR-Z0-9]{17}/gi) ?? [];
  for (const candidate of candidates) {
    const detection = detectSearchQuery(candidate);
    if (detection.kind === "vin") return detection.normalized;
  }

  return null;
}

function extractMileageKm(value: string): number | null {
  const match = value.match(/Пробег\s*([\d\s\u00a0]+)\s*км/i);
  if (match === null) return null;
  return numberOrNull(match[1]);
}

function extractYear(value: string): number | null {
  const match = value.match(/\b(19\d{2}|20\d{2})\b/);
  return match === null ? null : numberOrNull(match[1]);
}

function extractMake(title: string): string | null {
  return titleParts(title)[0] ?? null;
}

function extractModel(title: string): string | null {
  return titleParts(title)[1] ?? null;
}

function titleParts(title: string): string[] {
  return title.split(",")[0]?.trim().split(/\s+/).filter(Boolean) ?? [];
}

function extractPriceRub(value: unknown): number | null {
  const offers = arrayFromUnknown(value);
  for (const offer of offers) {
    const price = numberOrNull(objectOrNull(offer)?.price);
    if (price !== null) return price;
  }

  return null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const numeric = Number(value.replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function arrayFromUnknown(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
