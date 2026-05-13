import { detectSearchQuery } from "@istoriya-avto/shared";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { env } from "../../env";
import { LocalObjectStorage } from "../storage/local-object-storage";
import { DrizzleSearchRepository } from "./drizzle-search-repository";
import { SearchService, type SearchInput } from "./search-service";

const detectSearchQuerySchema = z.object({
  query: z.string()
});

type SearchRoutesDependencies = {
  search: (input: SearchInput) => Promise<unknown>;
};

export function createSearchRoutes(dependencies: SearchRoutesDependencies): Hono {
  const routes = new Hono();

  routes.post("/", async (context) => {
    const body = await context.req.json().catch(() => null);
    const parsed = detectSearchQuerySchema.safeParse(body);

    if (!parsed.success) {
      return invalidRequest(context);
    }

    return context.json(await dependencies.search({ query: parsed.data.query }));
  });

  routes.post("/detect", async (context) => {
    const body = await context.req.json().catch(() => null);
    const parsed = detectSearchQuerySchema.safeParse(body);

    if (!parsed.success) {
      return invalidRequest(context);
    }

    return context.json({
      query: detectSearchQuery(parsed.data.query)
    });
  });

  return routes;
}

function invalidRequest(context: Context) {
  return context.json(
    {
      error: {
        code: "invalid_request",
        message: "Поле query должно быть строкой."
      }
    },
    400
  );
}

const searchService = new SearchService({
  repository: new DrizzleSearchRepository(),
  storage: new LocalObjectStorage({ rootDir: env.REPORT_STORAGE_LOCAL_DIR }),
  originalRetentionDays: env.REPORT_ORIGINAL_RETENTION_DAYS
});

export const searchRoutes = createSearchRoutes({
  search: (input) => searchService.search(input)
});
