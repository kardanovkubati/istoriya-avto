import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { db } from "./db/client";
import { env } from "./env";
import { DrizzleReportAccessRepository } from "./modules/access/drizzle-report-access-repository";
import { ReportAccessService } from "./modules/access/report-access-service";
import { AccountService, type AccountTransferResult } from "./modules/auth/account-service";
import { createAuthRoutes } from "./modules/auth/auth-routes";
import { DrizzleAccountRepository } from "./modules/auth/drizzle-account-repository";
import { UserSessionService } from "./modules/auth/user-session-service";
import { createRequestContextMiddleware } from "./modules/context/request-context";
import { createContextRoutes } from "./modules/context/routes";
import { DrizzleGuestSessionRepository } from "./modules/guest/drizzle-guest-session-repository";
import { GuestContextTransferService } from "./modules/guest/guest-context-transfer-service";
import { GuestSessionService } from "./modules/guest/guest-session-service";
import { healthRoutes } from "./modules/health/routes";
import { DrizzlePointsLedgerRepository } from "./modules/points/drizzle-points-ledger-repository";
import { PointsLedgerService } from "./modules/points/points-ledger-service";
import { DrizzleShareLinkRepository } from "./modules/reports/drizzle-share-link-repository";
import { createReportShareRoutes } from "./modules/reports/share-routes";
import { ShareLinkService } from "./modules/reports/share-link-service";
import { searchRoutes } from "./modules/search/routes";
import { uploadRoutes } from "./modules/uploads/routes";
import { DrizzleVehicleReportRepository } from "./modules/vehicles/drizzle-vehicle-report-repository";
import { vehicleRoutes } from "./modules/vehicles/routes";

export type CreateAppOptions = {
  publicWebUrl?: string;
  requestContextMiddleware?: MiddlewareHandler | null;
  authRoutes?: Hono;
  contextRoutes?: Hono;
  guestContextTransfer?: (input: {
    guestSessionId: string;
    userId: string;
  }) => Promise<AccountTransferResult>;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono();
  const publicWebOrigin = new URL(options.publicWebUrl ?? env.PUBLIC_WEB_URL).origin;

  app.use(
    "*",
    cors({
      origin: [publicWebOrigin, "http://localhost:5173", "http://127.0.0.1:5173"],
      allowHeaders: ["content-type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      credentials: true
    })
  );

  const secureCookies = env.PUBLIC_API_URL.startsWith("https://");
  const accountRepository = new DrizzleAccountRepository();
  const userSessionService = new UserSessionService(accountRepository);
  const guestSessionRepository = new DrizzleGuestSessionRepository();
  const reportAccessRepository = new DrizzleReportAccessRepository(db);
  const pointsLedgerService = new PointsLedgerService({
    repository: new DrizzlePointsLedgerRepository(db)
  });
  const vehicleReportRepository = new DrizzleVehicleReportRepository();
  const guestContextTransferService = new GuestContextTransferService({
    repository: guestSessionRepository,
    ledger: pointsLedgerService
  });
  const requestContextMiddleware =
    options.requestContextMiddleware === undefined
      ? createRequestContextMiddleware({
          guestSessionService: new GuestSessionService(guestSessionRepository),
          userSessionResolver: userSessionService,
          secureCookies
        })
      : options.requestContextMiddleware;

  if (requestContextMiddleware !== null) {
    app.use("/api/*", requestContextMiddleware);
  }

  app.route("/health", healthRoutes);
  app.route(
    "/api/auth",
    options.authRoutes ??
      createAuthRoutes({
        accountService: new AccountService({
          repository: accountRepository,
          userSessionService,
          transferGuestContext:
            options.guestContextTransfer ??
            ((input) => guestContextTransferService.transferToUser(input))
        }),
        secureCookies
      })
  );
  app.route(
    "/api/context",
    options.contextRoutes ??
      createContextRoutes({
        accountRepository,
        reportAccessRepository
      })
  );
  app.route("/api/search", searchRoutes);
  app.route("/api/uploads", uploadRoutes);
  app.route(
    "/api",
    createReportShareRoutes({
      accessService: new ReportAccessService({
        repository: reportAccessRepository,
        pointsLedgerService
      }),
      shareService: new ShareLinkService({
        repository: new DrizzleShareLinkRepository(db)
      }),
      publicWebUrl: options.publicWebUrl ?? env.PUBLIC_WEB_URL,
      findFullReportByVehicleId: (vehicleId) =>
        vehicleReportRepository.findFullReportByVehicleId(vehicleId)
    })
  );
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
