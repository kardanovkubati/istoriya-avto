import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthRoutes } from "./modules/health/routes";
import { searchRoutes } from "./modules/search/routes";
import { uploadRoutes } from "./modules/uploads/routes";

export function createApp() {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
      allowHeaders: ["content-type"],
      allowMethods: ["GET", "POST", "OPTIONS"]
    })
  );

  app.route("/health", healthRoutes);
  app.route("/api/search", searchRoutes);
  app.route("/api/uploads", uploadRoutes);

  app.notFound((context) => {
    return context.json(
      {
        error: {
          code: "not_found",
          message: "Маршрут не найден."
        }
      },
      404
    );
  });

  app.onError((error, context) => {
    console.error(error);

    return context.json(
      {
        error: {
          code: "internal_error",
          message: "Внутренняя ошибка сервиса."
        }
      },
      500
    );
  });

  return app;
}

const app = createApp();

export default app;
