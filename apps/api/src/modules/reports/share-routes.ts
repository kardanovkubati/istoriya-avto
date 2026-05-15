import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  type ReportAccessDecision,
  ReportAccessService
} from "../access/report-access-service";
import { getRequestIdentity } from "../context/request-context";
import {
  assertNoSourceBrandLeak,
  type VehicleFullReportReadModel
} from "../vehicles/report-read-model";
import { buildReportPresentation } from "./report-presentation";
import { ShareLinkService } from "./share-link-service";

const vehicleIdParamSchema = z.string().uuid();

export type ReportShareRoutesDependencies = {
  accessService: ReportAccessService;
  shareService: ShareLinkService;
  publicWebUrl: string;
  findFullReportByVehicleId(vehicleId: string): Promise<VehicleFullReportReadModel | null>;
};

export function createReportShareRoutes(dependencies: ReportShareRoutesDependencies): Hono {
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

  routes.post("/vehicles/by-id/:vehicleId/share-links", async (context) => {
    const vehicleId = parseVehicleId(context.req.param("vehicleId"));
    if (vehicleId === null) {
      return invalidVehicleId(context);
    }

    const identity = getRequestIdentity(context);
    if (identity.kind !== "user") {
      return authRequired(context);
    }

    const access = await dependencies.accessService.canViewFullReportByVehicleId({
      vehicleId,
      userId: identity.userId,
      guestSessionId: null
    });
    if (access.status !== "granted") {
      return lockedReport(context, access);
    }

    const share = await dependencies.shareService.create({
      ownerUserId: identity.userId,
      vehicleId
    });

    return context.json({
      share: {
        token: share.token,
        url: shareUrl(dependencies.publicWebUrl, share.token),
        expiresAt: share.expiresAt
      }
    });
  });

  routes.get("/share/:token/report", async (context) => {
    const share = await dependencies.shareService.resolve(context.req.param("token"));
    if (share === null) {
      return shareLinkNotFound(context);
    }

    const report = await dependencies.findFullReportByVehicleId(share.vehicleId);
    if (report === null) {
      return shareLinkNotFound(context);
    }

    assertNoSourceBrandLeak(report);
    await dependencies.shareService.recordView(share);

    context.header("X-Robots-Tag", "noindex, nofollow");
    return context.json({
      report,
      presentation: buildReportPresentation({ report, mode: "share" }),
      share: { expiresAt: share.expiresAt }
    });
  });

  return routes;
}

function parseVehicleId(value: string): string | null {
  const result = vehicleIdParamSchema.safeParse(value);
  return result.success ? result.data : null;
}

function shareUrl(publicWebUrl: string, token: string): string {
  return `${publicWebUrl.replace(/\/+$/, "")}/#/share/${encodeURIComponent(token)}`;
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

function authRequired(context: Context) {
  return context.json(
    {
      error: {
        code: "auth_required",
        message: "Войдите, чтобы создать share-ссылку."
      }
    },
    401
  );
}

function lockedReport(
  context: Context,
  access: Exclude<ReportAccessDecision, { status: "granted" }>
) {
  return context.json(
    {
      error: {
        code: access.status === "auth_required" ? "auth_required" : "vehicle_report_locked",
        message:
          access.status === "auth_required"
            ? "Войдите, чтобы создать share-ссылку."
            : "Полный отчет закрыт."
      }
    },
    access.status === "auth_required" ? 401 : 403
  );
}

function shareLinkNotFound(context: Context) {
  return context.json(
    {
      error: {
        code: "share_link_not_found",
        message: "Ссылка недоступна или срок действия истек."
      }
    },
    404
  );
}
