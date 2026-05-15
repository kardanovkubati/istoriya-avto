import { detectSearchQuery } from "@istoriya-avto/shared";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { db } from "../../db/client";
import {
  assertNoSourceBrandLeak,
  type VehicleFullReportReadModel,
  type VehiclePreviewReadModel
} from "./report-read-model";
import { buildReportPresentation } from "../reports/report-presentation";
import {
  type ReportAccessDecision,
  ReportAccessService,
  type UnlockCommitDecision,
  type UnlockPreviewDecision,
  maskVin
} from "../access/report-access-service";
import { DrizzleReportAccessRepository } from "../access/drizzle-report-access-repository";
import { getRequestIdentity, type RequestIdentity } from "../context/request-context";
import { DrizzleGuestSessionRepository } from "../guest/drizzle-guest-session-repository";
import { DrizzlePointsLedgerRepository } from "../points/drizzle-points-ledger-repository";
import { PointsLedgerService } from "../points/points-ledger-service";
import { DrizzleVehicleReportRepository } from "./drizzle-vehicle-report-repository";

const unlockPayloadSchema = z.object({
  idempotencyKey: z.string().min(1)
});
const vehicleIdParamSchema = z.string().uuid();

export type VehicleRoutesDependencies = {
  accessService: ReportAccessService;
  findPreviewByVin(vin: string): Promise<VehiclePreviewReadModel | null>;
  findFullReportByVin(vin: string): Promise<VehicleFullReportReadModel | null>;
  findFullReportByVehicleId(vehicleId: string): Promise<VehicleFullReportReadModel | null>;
};

export function createVehicleRoutes(dependencies: VehicleRoutesDependencies): Hono {
  const routes = new Hono();

  routes.onError((error, context) => {
    if (error instanceof Error && error.message === "source_brand_leak") {
      return context.json(
        {
          error: {
            code: "internal_error",
            message: "Внутренняя ошибка сервиса."
          }
        },
        500
      );
    }

    throw error;
  });

  routes.get("/:vin/preview", async (context) => {
    const vin = parseVin(context.req.param("vin"));
    if (vin === null) {
      return invalidVin(context);
    }

    const preview = await dependencies.findPreviewByVin(vin);
    if (preview === null) {
      return vehicleReportNotFound(context);
    }

    assertNoSourceBrandLeak(preview);

    return context.json({ preview });
  });

  routes.get("/:vin/report", async (context) => {
    const vin = parseVin(context.req.param("vin"));
    if (vin === null) {
      return invalidVin(context);
    }

    const identity = getRequestIdentity(context);
    const access = await dependencies.accessService.canViewFullReport({
      vin,
      userId: identity.kind === "user" ? identity.userId : null,
      guestSessionId: identity.kind === "guest" ? identity.guestSessionId : null
    });
    if (access.status !== "granted") {
      return lockedReport(context, access);
    }

    const report = await dependencies.findFullReportByVin(vin);
    if (report === null) {
      return vehicleReportNotFound(context);
    }

    assertNoSourceBrandLeak(report);

    return fullReportResponse(context, report, "owner");
  });

  routes.post("/:vin/unlock-intent", async (context) => {
    const vin = parseVin(context.req.param("vin"));
    if (vin === null) {
      return invalidVin(context);
    }

    const identity = getRequestIdentity(context);
    const unlock = await dependencies.accessService.previewUnlock({
      vehicle: { kind: "vin", vin },
      userId: identity.kind === "user" ? identity.userId : null,
      guestSessionId: identity.kind === "guest" ? identity.guestSessionId : null
    });

    if (unlock.status === "not_found") {
      return vehicleReportNotFound(context);
    }

    return context.json({ unlock });
  });

  routes.get("/by-id/:vehicleId/report", async (context) => {
    const vehicleId = parseVehicleId(context.req.param("vehicleId"));
    if (vehicleId === null) {
      return invalidVehicleId(context);
    }

    const identity = getRequestIdentity(context);
    const access = await dependencies.accessService.canViewFullReportByVehicleId({
      vehicleId,
      userId: identity.kind === "user" ? identity.userId : null,
      guestSessionId: identity.kind === "guest" ? identity.guestSessionId : null
    });
    if (access.status !== "granted") {
      return lockedReport(context, access);
    }

    const report = await dependencies.findFullReportByVehicleId(vehicleId);
    if (report === null) {
      return vehicleReportNotFound(context);
    }

    assertNoSourceBrandLeak(report);

    return fullReportResponse(context, report, "owner");
  });

  routes.post("/:vin/unlock", async (context) => {
    const vin = parseVin(context.req.param("vin"));
    if (vin === null) {
      return invalidVin(context);
    }

    const payload = await parseUnlockPayload(context.req.json());
    if (payload === null) {
      return invalidUnlockRequest(context);
    }

    const identity = getRequestIdentity(context);
    const result = await dependencies.accessService.unlock({
      vehicle: { kind: "vin", vin },
      userId: identity.kind === "user" ? identity.userId : null,
      guestSessionId: identity.kind === "guest" ? identity.guestSessionId : null,
      idempotencyKey: scopedUnlockIdempotencyKey(identity, payload.idempotencyKey)
    });

    return unlockCommitResponse(context, result, { includeVin: true });
  });

  routes.post("/by-id/:vehicleId/unlock-intent", async (context) => {
    const vehicleId = parseVehicleId(context.req.param("vehicleId"));
    if (vehicleId === null) {
      return invalidVehicleId(context);
    }

    const identity = getRequestIdentity(context);
    const unlock = await dependencies.accessService.previewUnlock({
      vehicle: { kind: "vehicle_id", vehicleId },
      userId: identity.kind === "user" ? identity.userId : null,
      guestSessionId: identity.kind === "guest" ? identity.guestSessionId : null
    });

    if (unlock.status === "not_found") {
      return vehicleReportNotFound(context);
    }

    return context.json({ unlock });
  });

  routes.post("/by-id/:vehicleId/unlock", async (context) => {
    const vehicleId = parseVehicleId(context.req.param("vehicleId"));
    if (vehicleId === null) {
      return invalidVehicleId(context);
    }

    const payload = await parseUnlockPayload(context.req.json());
    if (payload === null) {
      return invalidUnlockRequest(context);
    }

    const identity = getRequestIdentity(context);
    const result = await dependencies.accessService.unlock({
      vehicle: { kind: "vehicle_id", vehicleId },
      userId: identity.kind === "user" ? identity.userId : null,
      guestSessionId: identity.kind === "guest" ? identity.guestSessionId : null,
      idempotencyKey: scopedUnlockIdempotencyKey(identity, payload.idempotencyKey)
    });

    return unlockCommitResponse(context, result, { includeVin: false });
  });

  return routes;
}

const vehicleReportRepository = new DrizzleVehicleReportRepository();
const vehicleAccessRepository = new DrizzleReportAccessRepository(db);
const guestSessionRepository = new DrizzleGuestSessionRepository();
const pointsLedgerService = new PointsLedgerService({
  repository: new DrizzlePointsLedgerRepository(db)
});

export const vehicleRoutes = createVehicleRoutes({
  accessService: new ReportAccessService({
    repository: vehicleAccessRepository,
    pointsLedgerService,
    guestUnlockIntentRecorder: guestSessionRepository
  }),
  findPreviewByVin: (vin) => vehicleReportRepository.findPreviewByVin(vin),
  findFullReportByVin: (vin) => vehicleReportRepository.findFullReportByVin(vin),
  findFullReportByVehicleId: (vehicleId) =>
    vehicleReportRepository.findFullReportByVehicleId(vehicleId)
});

function parseVin(value: string): string | null {
  const detection = detectSearchQuery(value);

  return detection.kind === "vin" ? detection.normalized : null;
}

function parseVehicleId(value: string): string | null {
  const result = vehicleIdParamSchema.safeParse(value);
  return result.success ? result.data : null;
}

function scopedUnlockIdempotencyKey(identity: RequestIdentity, idempotencyKey: string): string {
  return identity.kind === "user"
    ? `user:${identity.userId}:${idempotencyKey}`
    : `guest:${identity.guestSessionId}:${idempotencyKey}`;
}

function invalidVin(context: Context) {
  return context.json(
    {
      error: {
        code: "invalid_vin",
        message: "Передайте корректный VIN."
      }
    },
    400
  );
}

function invalidVehicleId(context: Context) {
  return context.json(
    {
      error: {
        code: "invalid_vehicle_id",
        message: "Передайте корректный идентификатор автомобиля."
      }
    },
    400
  );
}

function vehicleReportNotFound(context: Context) {
  return context.json(
    {
      error: {
        code: "vehicle_report_not_found",
        message: "Отчета по этому VIN пока нет."
      }
    },
    404
  );
}

async function parseUnlockPayload(jsonPromise: Promise<unknown>) {
  const json = await jsonPromise.catch(() => null);
  const result = unlockPayloadSchema.safeParse(json);
  return result.success ? result.data : null;
}

function invalidUnlockRequest(context: Context) {
  return context.json(
    {
      error: {
        code: "invalid_request",
        message: "Передайте ключ идемпотентности открытия отчета."
      }
    },
    400
  );
}

function lockedReport(
  context: Context,
  access: Exclude<ReportAccessDecision, { status: "granted" }>
) {
  if (access.status === "auth_required") {
    return context.json(
      {
        error: {
          code: "auth_required",
          message: "Войдите, чтобы открыть полный отчет.",
          unlock: withoutVehicleId(access)
        }
      },
      401
    );
  }

  return context.json(
    {
      error: {
        code: "vehicle_report_locked",
        message: "Полный отчет закрыт.",
        unlock: withoutVehicleId(access)
      }
    },
    403
  );
}

function fullReportResponse(
  context: Context,
  report: VehicleFullReportReadModel,
  mode: "owner" | "share"
) {
  context.header("X-Robots-Tag", "noindex, nofollow");
  return context.json({
    report,
    presentation: buildReportPresentation({ report, mode })
  });
}

function unlockCommitResponse(
  context: Context,
  result: UnlockCommitDecision,
  options: { includeVin: boolean }
) {
  if (result.status === "not_found") {
    return vehicleReportNotFound(context);
  }

  if (result.status === "auth_required") {
    return context.json(
      {
        error: {
          code: "auth_required",
          message: "Войдите, чтобы открыть полный отчет.",
          unlock: serializeUnlockError(result, options)
        }
      },
      401
    );
  }

  if (result.status === "payment_required") {
    return context.json(
      {
        error: {
          code: "payment_required",
          message: result.message,
          unlock: serializeUnlockError(result, options)
        }
      },
      402
    );
  }

  return context.json({
    access: options.includeVin
      ? {
          status: result.status,
          method: result.method,
          vehicleId: result.vehicleId,
          vin: result.vin
        }
      : {
          status: result.status,
          method: result.method,
          vehicleId: result.vehicleId,
          vinMasked: maskVin(result.vin)
        },
    entitlements: result.entitlements
  });
}

function withoutVehicleId<
  T extends ReportAccessDecision | UnlockPreviewDecision | UnlockCommitDecision
>(result: T) {
  if ("vehicleId" in result) {
    const { vehicleId: _vehicleId, ...rest } = result;
    return rest;
  }
  return result;
}

function serializeUnlockError(
  result: Extract<UnlockCommitDecision, { status: "auth_required" | "payment_required" }>,
  options: { includeVin: boolean }
) {
  return options.includeVin ? withoutVehicleId(result) : result;
}
