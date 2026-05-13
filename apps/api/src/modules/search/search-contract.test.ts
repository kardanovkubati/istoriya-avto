import { describe, expect, it } from "bun:test";
import type { VehiclePreviewReadModel } from "../vehicles/report-read-model";
import {
  assertSafeSearchResponse,
  createEmptySearchResult,
  createListingCandidate,
  createVehicleCandidate
} from "./search-contract";

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

describe("search result contract", () => {
  it("creates a locked vehicle candidate from a safe vehicle preview", () => {
    const candidate = createVehicleCandidate({
      match: "exact_vin",
      preview
    });

    expect(candidate).toEqual({
      id: "vehicle:vehicle-1",
      kind: "vehicle",
      match: "exact_vin",
      reportStatus: "available",
      preview,
      unlock: {
        status: "locked",
        canRequestUnlock: true,
        warning:
          "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
      }
    });
  });

  it("creates a listing-only candidate without exposing a plate or source label", () => {
    const candidate = createListingCandidate({
      sourceKind: "avito",
      listingId: "1234567890",
      observedAt: "2026-05-14T10:00:00.000Z",
      vehicleId: null,
      reportAvailable: false,
      snapshot: {
        vin: null,
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
        photos: [{ url: "https://static.example.test/photo.jpg", alt: "Фото автомобиля" }]
      }
    });

    expect(candidate.preview.vinMasked).toBeNull();
    expect(JSON.stringify(candidate)).not.toMatch(/plate|госномер|source|avito|авито/i);
    expect(candidate.reportStatus).toBe("missing");
    expect(candidate.unlock.canRequestUnlock).toBe(false);
  });

  it("returns a neutral empty state for missing reports", () => {
    expect(
      createEmptySearchResult({
        query: { kind: "vin", normalized: "XTA210990Y2765499" },
        code: "report_not_found"
      })
    ).toEqual({
      query: { kind: "vin", normalized: "XTA210990Y2765499" },
      candidates: [],
      emptyState: {
        code: "report_not_found",
        title: "Отчета пока нет",
        message: "Загрузите свой отчет, и он может дать 1 балл на будущий просмотр.",
        action: {
          kind: "upload_report",
          label: "Загрузить отчет"
        }
      }
    });
  });

  it("blocks source brand labels and internal source fields in search candidates", () => {
    const unsafePayloads = [
      { candidate: { sourceKind: "avito" } },
      { candidate: { originalObjectKey: "listing-originals/1.html" } },
      { candidate: { text: "Цена из Авито" } },
      { candidate: { text: "Источник: Auto.ru" } },
      { candidate: { text: "Источник: Дром" } }
    ];

    for (const payload of unsafePayloads) {
      expect(() => assertSafeSearchResponse(payload)).toThrow("search_response_leak");
    }
  });

  it("blocks Autoteka labels without flagging unrelated substrings", () => {
    expect(() => assertSafeSearchResponse({ text: "myautotekadata" })).not.toThrow();
    expect(() => assertSafeSearchResponse({ text: "автотекст" })).not.toThrow();
    expect(() => assertSafeSearchResponse({ text: "Факт из Autoteka" })).toThrow("search_response_leak");
    expect(() => assertSafeSearchResponse({ text: "Факт из Автотеки" })).toThrow("search_response_leak");
  });
});
