import { describe, expect, it } from "bun:test";
import { detectSearchQuery } from "./search-query";

describe("detectSearchQuery", () => {
  it("detects VIN values", () => {
    expect(detectSearchQuery("xw8zzz61zkg123456")).toEqual({
      kind: "vin",
      normalized: "XW8ZZZ61ZKG123456",
      original: "xw8zzz61zkg123456"
    });
  });

  it("detects Russian plate values and normalizes spaces", () => {
    expect(detectSearchQuery("а 123 вс 777")).toEqual({
      kind: "plate",
      normalized: "А123ВС777",
      original: "а 123 вс 777"
    });
  });

  it("detects supported listing URLs", () => {
    const supportedUrls = [
      {
        input: "https://www.avito.ru/moskva/avtomobili/test_123",
        host: "www.avito.ru"
      },
      {
        input: "https://auto.ru/cars/used/sale/test/123/",
        host: "auto.ru"
      },
      {
        input: "https://auto.drom.ru/ulan-ude/isuzu/d-max/322002530.html",
        host: "auto.drom.ru"
      }
    ];

    for (const { input, host } of supportedUrls) {
      expect(detectSearchQuery(input)).toEqual({
        kind: "listing_url",
        normalized: input,
        original: input,
        host
      });
    }
  });

  it("detects unsupported URLs", () => {
    expect(detectSearchQuery("https://example.com/car/1")).toEqual({
      kind: "unsupported_url",
      normalized: "https://example.com/car/1",
      original: "https://example.com/car/1",
      host: "example.com"
    });
  });

  it("returns unknown for empty and unrecognized input", () => {
    expect(detectSearchQuery("")).toEqual({
      kind: "unknown",
      normalized: "",
      original: ""
    });
    expect(detectSearchQuery("купить авто")).toEqual({
      kind: "unknown",
      normalized: "купить авто",
      original: "купить авто"
    });
  });
});
