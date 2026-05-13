import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";
import type { PutObjectInput, StoredObject } from "../storage/object-storage";
import type { VehiclePreviewReadModel } from "../vehicles/report-read-model";
import { fetchListingHtmlWithLimits, SearchService } from "./search-service";
import type {
  SaveListingSnapshotInput,
  SearchRepository,
  StoredListingSnapshot
} from "./search-repository";

const NOW = "2026-05-14T10:00:00.000Z";
const VIN = "XTA210990Y2765499";

const preview: VehiclePreviewReadModel = {
  vehicleId: "vehicle-1",
  vinMasked: "XTA2109********99",
  title: "LADA Granta",
  make: "LADA",
  model: "Granta",
  year: 2021,
  bodyType: "sedan",
  color: "white",
  engine: "1.6",
  transmission: "manual",
  driveType: "front",
  photo: null,
  lastListing: {
    observedAt: "2026-04-15T00:00:00.000Z",
    priceRub: 780000,
    mileageKm: 42000,
    city: "Москва"
  },
  lastUpdatedAt: "2026-05-01T00:00:00.000Z"
};

describe("SearchService", () => {
  it("returns a locked exact VIN candidate when a preview exists", async () => {
    const repository = new FakeSearchRepository();
    repository.previewByVin.set(VIN, preview);

    const result = await createService({ repository }).search({ query: VIN.toLowerCase() });

    expect(result.emptyState).toBeNull();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      kind: "vehicle",
      match: "exact_vin",
      reportStatus: "available",
      preview: {
        vehicleId: "vehicle-1",
        vinMasked: "XTA2109********99"
      },
      unlock: {
        status: "locked",
        canRequestUnlock: true
      }
    });
  });

  it("returns report_not_found when a VIN has no preview", async () => {
    const result = await createService().search({ query: VIN });

    expect(result.candidates).toEqual([]);
    expect(result.emptyState?.code).toBe("report_not_found");
  });

  it("uses only internal identifiers for plate search and returns an empty state when none match", async () => {
    const repository = new FakeSearchRepository();
    const fetchListingHtml = async () => {
      throw new Error("listing fetch should not be called");
    };

    const result = await createService({ repository, fetchListingHtml }).search({
      query: "А123ВС777"
    });

    expect(repository.identifierCalls).toEqual([
      {
        kind: "plate",
        value: "А123ВС777",
        limit: 5
      }
    ]);
    expect(repository.listingSnapshotCalls).toEqual([]);
    expect(result.candidates).toEqual([]);
    expect(result.emptyState?.code).toBe("report_not_found");
  });

  it("returns internal plate candidates when a plate matches internal identifiers", async () => {
    const repository = new FakeSearchRepository();
    repository.previewsByIdentifier.set("plate:А123ВС777", [preview]);

    const result = await createService({ repository }).search({
      query: "А123ВС777"
    });

    expect(result.emptyState).toBeNull();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      kind: "vehicle",
      match: "internal_plate",
      reportStatus: "available",
      preview: {
        vehicleId: "vehicle-1"
      }
    });
  });

  it("returns a listing candidate from public Avito HTML without exposing source labels", async () => {
    const repository = new FakeSearchRepository();
    const storage = new FakeStorage();

    const result = await createService({
      repository,
      storage,
      fetchListingHtml: async () => avitoHtml({ vin: null })
    }).search({
      query: "https://www.avito.ru/moskva/avtomobili/lada_granta_1234567890"
    });

    expect(result.emptyState).toBeNull();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: "listing:1234567890",
      kind: "listing",
      match: "listing_snapshot",
      reportStatus: "missing",
      preview: {
        vehicleId: null,
        vinMasked: null,
        title: "LADA Granta, 2021"
      },
      unlock: {
        warning: "По этому объявлению отчета пока нет."
      }
    });
    expect(storage.calls[0]).toMatchObject({
      namespace: "listing-originals",
      contentType: "text/html; charset=utf-8",
      originalFileName: "1234567890.html"
    });
    expect(repository.savedSnapshots[0]).toMatchObject({
      status: "captured",
      originalObjectKey: "listing-originals/1.html",
      normalizedData: {
        vin: null,
        title: "LADA Granta, 2021"
      }
    });
    expect(JSON.stringify(result)).not.toMatch(/госномер|source|Авито|avito/i);
  });

  it("uses a cached listing snapshot before fetching the URL again", async () => {
    const repository = new FakeSearchRepository();
    repository.previewByVin.set(VIN, preview);
    repository.listingSnapshots.set("avito:1234567890", {
      id: "snapshot-1",
      sourceKind: "avito",
      listingId: "1234567890",
      canonicalUrl: "https://www.avito.ru/moskva/avtomobili/lada_granta_1234567890",
      vehicleId: null,
      status: "captured",
      originalObjectKey: "listing-originals/old.html",
      fetchedAt: "2026-05-13T10:00:00.000Z",
      originalExpiresAt: "2026-06-12T10:00:00.000Z",
      normalizedData: {
        vin: VIN,
        title: "LADA Granta, 2021",
        make: "LADA",
        model: "Granta",
        year: 2021,
        bodyType: null,
        color: null,
        engine: null,
        transmission: null,
        driveType: null,
        priceRub: 780000,
        mileageKm: 42000,
        city: "Москва",
        photos: []
      }
    });
    let fetchCalls = 0;

    const result = await createService({
      repository,
      fetchListingHtml: async () => {
        fetchCalls += 1;
        return avitoHtml({ vin: null });
      }
    }).search({
      query: "https://www.avito.ru/moskva/avtomobili/lada_granta_1234567890"
    });

    expect(fetchCalls).toBe(0);
    expect(repository.savedSnapshots).toEqual([]);
    expect(result.candidates[0]).toMatchObject({
      reportStatus: "available",
      preview: {
        vehicleId: "vehicle-1",
        vinMasked: "XTA2109********99"
      }
    });
  });

  it("returns listing_snapshot_unavailable for Auto.ru and Drom URLs", async () => {
    for (const query of [
      "https://auto.ru/cars/used/sale/lada/granta/123/",
      "https://auto.drom.ru/lada/granta/123.html"
    ]) {
      const result = await createService({
        fetchListingHtml: async () => {
          throw new Error("listing fetch should not be called");
        }
      }).search({ query });

      expect(result.candidates).toEqual([]);
      expect(result.emptyState?.code).toBe("listing_snapshot_unavailable");
    }
  });
});

describe("fetchListingHtmlWithLimits", () => {
  it("returns HTML for a text/html response within the byte limit", async () => {
    const fetchImpl = async () =>
      new Response("<html><body>ok</body></html>", {
        status: 200,
        headers: { "content-type": "Text/HTML; charset=utf-8" }
      });

    const html = await fetchListingHtmlWithLimits("https://example.test/listing", {
      fetchImpl,
      maxBytes: 1024
    });

    expect(html).toBe("<html><body>ok</body></html>");
  });

  it("rejects non-html content types before reading the body", async () => {
    let bodyAccessed = false;
    const fetchImpl = async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        get body() {
          bodyAccessed = true;
          return new ReadableStream();
        }
      }) as Response;

    await expect(
      fetchListingHtmlWithLimits("https://example.test/listing", { fetchImpl })
    ).rejects.toThrow("listing_fetch_non_html");
    expect(bodyAccessed).toBe(false);
  });

  it("rejects content-length greater than the byte limit before reading the body", async () => {
    let bodyAccessed = false;
    const fetchImpl = async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({
          "content-type": "text/html",
          "content-length": "1025"
        }),
        get body() {
          bodyAccessed = true;
          return new ReadableStream();
        }
      }) as Response;

    await expect(
      fetchListingHtmlWithLimits("https://example.test/listing", {
        fetchImpl,
        maxBytes: 1024
      })
    ).rejects.toThrow("listing_fetch_too_large");
    expect(bodyAccessed).toBe(false);
  });

  it("rejects streamed bodies when bytes exceed the limit without content-length", async () => {
    const encoder = new TextEncoder();
    const fetchImpl = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode("<html>"));
            controller.enqueue(encoder.encode("too large"));
            controller.close();
          }
        }),
        {
          status: 200,
          headers: { "content-type": "text/html" }
        }
      );

    await expect(
      fetchListingHtmlWithLimits("https://example.test/listing", {
        fetchImpl,
        maxBytes: 8
      })
    ).rejects.toThrow("listing_fetch_too_large");
  });

  it("aborts through the timeout signal", async () => {
    const fetchImpl = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true
        });
      });

    await expect(
      fetchListingHtmlWithLimits("https://example.test/listing", {
        fetchImpl,
        timeoutMs: 1
      })
    ).rejects.toThrow("aborted");
  });
});

function createService(input: {
  repository?: FakeSearchRepository;
  storage?: FakeStorage;
  fetchListingHtml?: (url: string) => Promise<string>;
} = {}): SearchService {
  return new SearchService({
    repository: input.repository ?? new FakeSearchRepository(),
    storage: input.storage ?? new FakeStorage(),
    ...(input.fetchListingHtml === undefined ? {} : { fetchListingHtml: input.fetchListingHtml }),
    now: () => new Date(NOW),
    originalRetentionDays: 30
  });
}

function avitoHtml(input: { vin: string | null }): string {
  const title = "LADA Granta, 2021";
  const description = input.vin === null ? "Пробег 42 000 км" : `Пробег 42 000 км ${input.vin}`;

  return `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "${title}",
            "description": "${description}",
            "image": ["https://static.example.test/photo.jpg"],
            "offers": [{ "price": "780000" }]
          }
        </script>
      </head>
      <body>
        <div data-marker="item-view/item-address">Москва</div>
      </body>
    </html>
  `;
}

class FakeSearchRepository implements SearchRepository {
  previewByVin = new Map<string, VehiclePreviewReadModel>();
  previewsByIdentifier = new Map<string, VehiclePreviewReadModel[]>();
  listingSnapshots = new Map<string, StoredListingSnapshot>();
  identifierCalls: Array<{ kind: "plate"; value: string; limit: number }> = [];
  listingSnapshotCalls: Array<{ sourceKind: "avito"; listingId: string }> = [];
  savedSnapshots: SaveListingSnapshotInput[] = [];

  async findPreviewByVin(vin: string): Promise<VehiclePreviewReadModel | null> {
    return this.previewByVin.get(vin) ?? null;
  }

  async findPreviewsByIdentifier(input: {
    kind: "plate";
    value: string;
    limit: number;
  }): Promise<VehiclePreviewReadModel[]> {
    this.identifierCalls.push(input);
    return this.previewsByIdentifier.get(`${input.kind}:${input.value}`) ?? [];
  }

  async findListingSnapshot(input: {
    sourceKind: "avito";
    listingId: string;
  }): Promise<StoredListingSnapshot | null> {
    this.listingSnapshotCalls.push(input);
    return this.listingSnapshots.get(`${input.sourceKind}:${input.listingId}`) ?? null;
  }

  async saveListingSnapshot(input: SaveListingSnapshotInput): Promise<StoredListingSnapshot> {
    this.savedSnapshots.push(input);

    return {
      id: `snapshot-${this.savedSnapshots.length}`,
      sourceKind: input.sourceKind,
      listingId: input.listingId,
      canonicalUrl: input.canonicalUrl,
      vehicleId: input.vehicleId,
      status: input.status,
      originalObjectKey: input.originalObjectKey,
      fetchedAt: input.fetchedAt.toISOString(),
      originalExpiresAt: input.originalExpiresAt?.toISOString() ?? null,
      normalizedData: input.normalizedData
    };
  }
}

class FakeStorage {
  calls: PutObjectInput[] = [];

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    this.calls.push({ ...input, bytes: new Uint8Array(input.bytes) });

    return {
      key: `${input.namespace}/${this.calls.length}.html`,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      sizeBytes: input.bytes.byteLength,
      contentType: input.contentType,
      expiresAt: input.expiresAt
    };
  }
}
