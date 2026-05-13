import { detectSearchQuery } from "@istoriya-avto/shared";
import { type Context, Hono } from "hono";
import {
  assertNoSourceBrandLeak,
  type VehicleFullReportReadModel,
  type VehiclePreviewReadModel
} from "./report-read-model";
import {
  createLockedReportAccessService,
  type ReportAccessDecision,
  type ReportAccessService
} from "../access/report-access-service";
import { DrizzleVehicleReportRepository } from "./drizzle-vehicle-report-repository";

export type VehicleRoutesDependencies = {
  accessService: ReportAccessService;
  findPreviewByVin(vin: string): Promise<VehiclePreviewReadModel | null>;
  findFullReportByVin(vin: string): Promise<VehicleFullReportReadModel | null>;
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

    const access = await dependencies.accessService.canViewFullReport({
      vin,
      userId: null,
      guestSessionId: null
    });
    if (access.status !== "granted") {
      return lockedReport(context, access);
    }

    const report = await dependencies.findFullReportByVin(vin);
    if (report === null) {
      return vehicleReportNotFound(context);
    }

    assertNoSourceBrandLeak(report);

    return context.json({ report });
  });

  routes.post("/:vin/unlock-intent", async (context) => {
    const vin = parseVin(context.req.param("vin"));
    if (vin === null) {
      return invalidVin(context);
    }

    const preview = await dependencies.findPreviewByVin(vin);
    if (preview === null) {
      return vehicleReportNotFound(context);
    }

    const access = await dependencies.accessService.canViewFullReport({
      vin,
      userId: null,
      guestSessionId: null
    });

    if (access.status === "granted") {
      return context.json({ unlock: access });
    }

    return context.json({
      unlock: {
        status: access.status,
        vinMasked: preview.vinMasked,
        options: access.options,
        willSpendPoints: false,
        message: "Списание баллов и подписочных лимитов появится на следующем этапе.",
        warning: access.warning
      }
    });
  });

  return routes;
}

const vehicleReportRepository = new DrizzleVehicleReportRepository();

export const vehicleRoutes = createVehicleRoutes({
  accessService: createLockedReportAccessService(),
  findPreviewByVin: (vin) => vehicleReportRepository.findPreviewByVin(vin),
  findFullReportByVin: (vin) => vehicleReportRepository.findFullReportByVin(vin)
});

function parseVin(value: string): string | null {
  const detection = detectSearchQuery(value);

  return detection.kind === "vin" ? detection.normalized : null;
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

function lockedReport(context: Context, access: Extract<ReportAccessDecision, { status: "locked" }>) {
  return context.json(
    {
      error: {
        code: "vehicle_report_locked",
        message: "Полный отчет закрыт.",
        unlock: access
      }
    },
    403
  );
}
