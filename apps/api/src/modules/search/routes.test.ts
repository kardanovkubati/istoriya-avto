import { describe, expect, it } from "bun:test";
import { createSearchRoutes } from "./routes";
import type { SearchResult } from "./search-contract";

describe("search routes", () => {
  it("returns search candidates from the service on POST /", async () => {
    const serviceResult: SearchResult = {
      query: { kind: "vin", normalized: "XTA210990Y2765499" },
      candidates: [],
      emptyState: null
    };
    const routes = createSearchRoutes({
      search: async (input) => {
        expect(input).toEqual({ query: "XTA210990Y2765499" });
        return serviceResult;
      }
    });

    const response = await routes.request("/", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ query: "XTA210990Y2765499" })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(serviceResult);
  });

  it("returns 400 for invalid search payloads", async () => {
    const routes = createSearchRoutes({
      search: async () => {
        throw new Error("search should not be called");
      }
    });

    const response = await routes.request("/", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ query: 123 })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_request",
        message: "Поле query должно быть строкой."
      }
    });
  });
});
