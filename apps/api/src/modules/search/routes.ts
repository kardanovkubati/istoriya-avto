import { detectSearchQuery } from "@istoriya-avto/shared";
import { Hono } from "hono";
import { z } from "zod";

const detectSearchQuerySchema = z.object({
  query: z.string()
});

export const searchRoutes = new Hono();

searchRoutes.post("/detect", async (context) => {
  const body = await context.req.json().catch(() => null);
  const parsed = detectSearchQuerySchema.safeParse(body);

  if (!parsed.success) {
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

  return context.json({
    query: detectSearchQuery(parsed.data.query)
  });
});
