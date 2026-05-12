import { describe, expect, it } from "bun:test";
import app from "./app";

describe("api app", () => {
  it("returns health status", async () => {
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "istoriya-avto-api"
    });
  });

  it("detects search query type", async () => {
    const response = await app.request("/api/search/detect", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ query: "А123ВС777" })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      query: {
        kind: "plate",
        normalized: "А123ВС777",
        original: "А123ВС777"
      }
    });
  });

  it("rejects invalid search detection payloads", async () => {
    const response = await app.request("/api/search/detect", {
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
