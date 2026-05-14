import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { env } from "./env";
import { createRequestContextMiddleware } from "./modules/context/request-context";
import { DrizzleGuestSessionRepository } from "./modules/guest/drizzle-guest-session-repository";
import { GuestSessionService } from "./modules/guest/guest-session-service";
import { healthRoutes } from "./modules/health/routes";
import { searchRoutes } from "./modules/search/routes";
import { uploadRoutes } from "./modules/uploads/routes";
import { vehicleRoutes } from "./modules/vehicles/routes";

export type CreateAppOptions = {
  requestContextMiddleware?: MiddlewareHandler | null;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: [env.PUBLIC_WEB_URL, "http://localhost:5173", "http://127.0.0.1:5173"],
      allowHeaders: ["content-type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      credentials: true
    })
  );

  const requestContextMiddleware =
    options.requestContextMiddleware === undefined
      ? createRequestContextMiddleware({
          guestSessionService: new GuestSessionService(new DrizzleGuestSessionRepository()),
          secureCookies: env.PUBLIC_API_URL.startsWith("https://")
        })
      : options.requestContextMiddleware;

  if (requestContextMiddleware !== null) {
    app.use("/api/*", requestContextMiddleware);
  }

  app.route("/health", healthRoutes);
  app.route("/api/search", searchRoutes);
  app.route("/api/uploads", uploadRoutes);
  app.route("/api/vehicles", vehicleRoutes);

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
