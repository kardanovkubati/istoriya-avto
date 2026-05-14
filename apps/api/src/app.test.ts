import { describe, expect, it } from "bun:test";
import type { MiddlewareHandler } from "hono";
import { createApp } from "./app";

const app = createApp({ requestContextMiddleware: null });

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

  it("exposes search results route", async () => {
    const response = await app.request("/api/search", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ query: "not a useful query" })
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.candidates).toEqual([]);
    expect(body.emptyState.code).toBe("unsupported_query");
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

  it("exposes vehicle routes with VIN validation", async () => {
    const response = await app.request("/api/vehicles/not-a-vin/preview");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_vin",
        message: "Передайте корректный VIN."
      }
    });
  });

  it("allows browser calls from localhost and 127.0.0.1 dev origins", async () => {
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173"]) {
      const preflightResponse = await app.request("/api/search/detect", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST"
        }
      });

      expect(preflightResponse.headers.get("access-control-allow-origin")).toBe(origin);
      expect(preflightResponse.headers.get("access-control-allow-credentials")).toBe("true");

      const actualResponse = await app.request("/api/search/detect", {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json"
        },
        body: JSON.stringify({ query: "А123ВС777" })
      });

      expect(actualResponse.headers.get("access-control-allow-origin")).toBe(origin);
      expect(actualResponse.headers.get("access-control-allow-credentials")).toBe("true");
    }
  });

  it("does not run request context middleware for CORS preflight", async () => {
    const middlewarePaths: string[] = [];
    const requestContextMiddleware: MiddlewareHandler = async (context, next) => {
      middlewarePaths.push(context.req.path);
      await next();
    };
    const app = createApp({ requestContextMiddleware });

    const response = await app.request("/api/search/detect", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST"
      }
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(middlewarePaths).toEqual([]);
  });

  it("runs request context middleware on api routes but not health", async () => {
    const middlewarePaths: string[] = [];
    const requestContextMiddleware: MiddlewareHandler = async (context, next) => {
      middlewarePaths.push(context.req.path);
      await next();
    };
    const app = createApp({ requestContextMiddleware });

    const healthResponse = await app.request("/health");

    expect(healthResponse.status).toBe(200);
    expect(middlewarePaths).toEqual([]);

    const apiResponse = await app.request("/api/search/detect", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ query: "А123ВС777" })
    });

    expect(apiResponse.status).toBe(200);
    expect(middlewarePaths).toEqual(["/api/search/detect"]);
  });

  it("loads test-safe environment defaults", async () => {
    const { env } = await import("./env");

    expect(env.PORT).toBeGreaterThan(0);
    expect(env.DATABASE_URL.startsWith("postgresql://")).toBe(true);
  });
});
