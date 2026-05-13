import { detectSearchQuery } from "@istoriya-avto/shared";
import type { ObjectStorage } from "../storage/object-storage";
import { parseAvitoListingSnapshotHtml } from "./avito-listing-snapshot";
import {
  assertSafeSearchResponse,
  createEmptySearchResult,
  createListingCandidate,
  createVehicleCandidate,
  type SearchResult
} from "./search-contract";
import { parseSupportedListingUrl } from "./listing-url";
import type { SearchRepository } from "./search-repository";

export type SearchServiceOptions = {
  repository: SearchRepository;
  storage: ObjectStorage;
  fetchListingHtml?: (url: string) => Promise<string>;
  now?: () => Date;
  originalRetentionDays: number;
};

export type SearchInput = {
  query: string;
};

export class SearchService {
  private readonly fetchListingHtml: (url: string) => Promise<string>;
  private readonly now: () => Date;

  constructor(private readonly options: SearchServiceOptions) {
    this.fetchListingHtml = options.fetchListingHtml ?? defaultFetchListingHtml;
    this.now = options.now ?? (() => new Date());
  }

  async search(input: SearchInput): Promise<SearchResult> {
    const detected = detectSearchQuery(input.query);

    if (detected.kind === "vin") {
      return this.searchVin(detected.normalized);
    }

    if (detected.kind === "plate") {
      return this.searchPlate(detected.normalized);
    }

    if (detected.kind === "listing_url") {
      return this.searchListingUrl(detected.normalized);
    }

    return createEmptySearchResult({
      query: { kind: "unknown", normalized: "" },
      code: "unsupported_query"
    });
  }

  private async searchVin(vin: string): Promise<SearchResult> {
    const query = { kind: "vin" as const, normalized: vin };
    const preview = await this.options.repository.findPreviewByVin(vin);

    if (preview === null) {
      return createEmptySearchResult({ query, code: "report_not_found" });
    }

    return safeResult({
      query,
      candidates: [
        createVehicleCandidate({
          match: "exact_vin",
          preview
        })
      ],
      emptyState: null
    });
  }

  private async searchPlate(plate: string): Promise<SearchResult> {
    const query = { kind: "plate" as const, normalized: plate };
    const previews = await this.options.repository.findPreviewsByIdentifier({
      kind: "plate",
      value: plate,
      limit: 5
    });

    if (previews.length === 0) {
      return createEmptySearchResult({ query, code: "report_not_found" });
    }

    return safeResult({
      query,
      candidates: previews.map((preview) =>
        createVehicleCandidate({
          match: "internal_plate",
          preview
        })
      ),
      emptyState: null
    });
  }

  private async searchListingUrl(url: string): Promise<SearchResult> {
    const query = { kind: "listing_url" as const, normalized: "listing" };
    const identity = parseSupportedListingUrl(url);

    if (identity.kind !== "avito") {
      return createEmptySearchResult({ query, code: "listing_snapshot_unavailable" });
    }

    const cachedSnapshot = await this.options.repository.findListingSnapshot({
      sourceKind: "avito",
      listingId: identity.listingId
    });

    if (cachedSnapshot?.status === "captured" && cachedSnapshot.normalizedData !== null) {
      const preview =
        cachedSnapshot.normalizedData.vin === null
          ? null
          : await this.options.repository.findPreviewByVin(cachedSnapshot.normalizedData.vin);

      return safeResult({
        query,
        candidates: [
          createListingCandidate({
            sourceKind: "avito",
            listingId: identity.listingId,
            observedAt: cachedSnapshot.fetchedAt,
            vehicleId: preview?.vehicleId ?? null,
            reportAvailable: preview !== null,
            snapshot: cachedSnapshot.normalizedData
          })
        ],
        emptyState: null
      });
    }

    let html: string;
    const fetchedAt = this.now();

    try {
      html = await this.fetchListingHtml(identity.canonicalUrl);
    } catch {
      await this.saveUnavailableSnapshot({
        listingId: identity.listingId,
        canonicalUrl: identity.canonicalUrl,
        fetchedAt,
        originalObjectKey: null,
        originalExpiresAt: null
      });

      return createEmptySearchResult({ query, code: "listing_snapshot_unavailable" });
    }

    const originalExpiresAt = addDays(fetchedAt, this.options.originalRetentionDays);
    const storedObject = await this.options.storage.putObject({
      namespace: "listing-originals",
      bytes: new TextEncoder().encode(html),
      contentType: "text/html; charset=utf-8",
      originalFileName: `${identity.listingId}.html`,
      expiresAt: originalExpiresAt
    });
    const parsed = parseAvitoListingSnapshotHtml(html);

    if (parsed.status === "unavailable") {
      await this.saveUnavailableSnapshot({
        listingId: identity.listingId,
        canonicalUrl: identity.canonicalUrl,
        fetchedAt,
        originalObjectKey: storedObject.key,
        originalExpiresAt: storedObject.expiresAt
      });

      return createEmptySearchResult({ query, code: "listing_snapshot_unavailable" });
    }

    const preview =
      parsed.data.vin === null
        ? null
        : await this.options.repository.findPreviewByVin(parsed.data.vin);

    await this.options.repository.saveListingSnapshot({
      sourceKind: "avito",
      listingId: identity.listingId,
      canonicalUrl: identity.canonicalUrl,
      vehicleId: preview?.vehicleId ?? null,
      status: "captured",
      originalObjectKey: storedObject.key,
      fetchedAt,
      originalExpiresAt: storedObject.expiresAt,
      normalizedData: parsed.data
    });

    return safeResult({
      query,
      candidates: [
        createListingCandidate({
          sourceKind: "avito",
          listingId: identity.listingId,
          observedAt: fetchedAt.toISOString(),
          vehicleId: preview?.vehicleId ?? null,
          reportAvailable: preview !== null,
          snapshot: parsed.data
        })
      ],
      emptyState: null
    });
  }

  private async saveUnavailableSnapshot(input: {
    listingId: string;
    canonicalUrl: string;
    fetchedAt: Date;
    originalObjectKey: string | null;
    originalExpiresAt: Date | null;
  }): Promise<void> {
    await this.options.repository.saveListingSnapshot({
      sourceKind: "avito",
      listingId: input.listingId,
      canonicalUrl: input.canonicalUrl,
      vehicleId: null,
      status: "unavailable",
      originalObjectKey: input.originalObjectKey,
      fetchedAt: input.fetchedAt,
      originalExpiresAt: input.originalExpiresAt,
      normalizedData: null
    });
  }
}

function safeResult(result: SearchResult): SearchResult {
  assertSafeSearchResponse(result);
  return result;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function defaultFetchListingHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "IstoriyaAvtoBot/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`listing_fetch_failed:${response.status}`);
  }

  return response.text();
}
