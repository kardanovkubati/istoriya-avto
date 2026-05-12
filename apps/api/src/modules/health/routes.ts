import { Hono } from "hono";

export const healthRoutes = new Hono();

healthRoutes.get("/", (context) => {
  return context.json({
    status: "ok",
    service: "istoriya-avto-api"
  });
});
