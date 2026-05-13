import { detectSearchQuery } from "@istoriya-avto/shared";
import { type Context, Hono } from "hono";
import {
  assertNoSourceBrandLeak,
  type VehicleFullReportReadModel,
  type VehiclePreviewReadModel
} from "./report-read-model";
import { DrizzleVehicleReportRepository } from "./drizzle-vehicle-report-repository";

export type VehicleRoutesDependencies = {
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

    const report = await dependencies.findFullReportByVin(vin);
    if (report === null) {
      return vehicleReportNotFound(context);
    }

    assertNoSourceBrandLeak(report);

    return context.json({ report });
  });

  return routes;
}

const vehicleReportRepository = new DrizzleVehicleReportRepository();

export const vehicleRoutes = createVehicleRoutes({
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
