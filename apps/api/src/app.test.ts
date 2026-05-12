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

  it("exposes report upload route", async () => {
    const response = await app.request("/api/uploads/report-pdf", {
      method: "POST",
      headers: {
        "content-length": "100"
      },
      body: new FormData()
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "rights_confirmation_required",
        message: "Подтвердите, что у вас есть право загружать этот отчет."
      }
    });
  });

  it("allows browser calls from localhost and 127.0.0.1 dev origins", async () => {
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173"]) {
      const response = await app.request("/api/search/detect", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST"
        }
      });

      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  it("loads test-safe environment defaults", async () => {
    const { env } = await import("./env");

    expect(env.PORT).toBeGreaterThan(0);
    expect(env.DATABASE_URL.startsWith("postgresql://")).toBe(true);
  });
});
