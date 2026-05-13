import { describe, expect, it } from "bun:test";
import { parseSupportedListingUrl } from "./listing-url";

describe("parseSupportedListingUrl", () => {
  it("extracts an Avito listing identity and strips tracking query params", () => {
    expect(
      parseSupportedListingUrl(
        "https://www.avito.ru/moskva/avtomobili/lada_granta_2021_1234567890?context=abc"
      )
    ).toEqual({
      kind: "avito",
      listingId: "1234567890",
      canonicalUrl: "https://www.avito.ru/moskva/avtomobili/lada_granta_2021_1234567890"
    });
  });

  it("recognizes Auto.ru and Drom as not captured in Milestone 3", () => {
    expect(parseSupportedListingUrl("https://auto.ru/cars/used/sale/test/123/")).toEqual({
      kind: "recognized_uncaptured",
      family: "auto_ru"
    });
    expect(parseSupportedListingUrl("https://auto.drom.ru/ulan-ude/isuzu/d-max/322002530.html")).toEqual({
      kind: "recognized_uncaptured",
      family: "drom"
    });
  });

  it("rejects unsupported URLs and malformed Avito URLs", () => {
    expect(parseSupportedListingUrl("https://example.com/car/1")).toEqual({
      kind: "unsupported"
    });
    expect(parseSupportedListingUrl("https://www.avito.ru/moskva/avtomobili/no-id")).toEqual({
      kind: "unsupported"
    });
  });
});
