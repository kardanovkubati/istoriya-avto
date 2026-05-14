import { type Context, Hono } from "hono";
import { setCookie } from "hono/cookie";
import { z } from "zod";
import type { AccountService } from "./account-service";
import { USER_COOKIE_NAME, getRequestIdentity } from "../context/request-context";

const authProviderSchema = z.enum(["phone", "telegram", "max"]);
const authPayloadSchema = z.object({
  provider: authProviderSchema,
  providerUserId: z.string().min(1),
  displayName: z.string().max(120).optional()
});

export type AuthRoutesDependencies = {
  accountService: AccountService;
  secureCookies?: boolean;
};

export function createAuthRoutes(dependencies: AuthRoutesDependencies): Hono {
  const routes = new Hono();

  routes.post("/login", async (context) => {
    const payload = await parseAuthPayload(context.req.json());
    if (payload === null) {
      return invalidRequest(context);
    }

    const identity = getRequestIdentity(context);

    try {
      const result = await dependencies.accountService.loginOrCreate({
        provider: payload.provider,
        providerUserId: payload.providerUserId,
        displayName: payload.displayName ?? null,
        guestSessionId: identity.kind === "guest" ? identity.guestSessionId : null
      });

      setCookie(context, USER_COOKIE_NAME, result.sessionToken, {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        expires: result.sessionExpiresAt,
        ...(dependencies.secureCookies === true ? { secure: true } : {})
      });

      return context.json({
        account: result.account,
        transferredGuestContext: result.transferredGuestContext
      });
    } catch (error) {
      if (isInvalidIdentity(error)) {
        return invalidIdentity(context);
      }
      throw error;
    }
  });

  routes.post("/link", async (context) => {
    const identity = getRequestIdentity(context);
    if (identity.kind !== "user") {
      return context.json(
        {
          error: {
            code: "auth_required",
            message: "Войдите, чтобы привязать способ входа."
          }
        },
        401
      );
    }

    const payload = await parseAuthPayload(context.req.json());
    if (payload === null) {
      return invalidRequest(context);
    }

    try {
      const result = await dependencies.accountService.linkIdentity({
        userId: identity.userId,
        provider: payload.provider,
        providerUserId: payload.providerUserId,
        displayName: payload.displayName ?? null
      });

      if (!result.ok) {
        return context.json(
          {
            error: {
              code: "identity_already_linked",
              message: "Этот способ входа уже привязан к другому аккаунту."
            }
          },
          409
        );
      }

      return context.json({
        account: result.account
      });
    } catch (error) {
      if (isInvalidIdentity(error)) {
        return invalidIdentity(context);
      }
      throw error;
    }
  });

  return routes;
}

async function parseAuthPayload(jsonPromise: Promise<unknown>) {
  const json = await jsonPromise.catch(() => null);
  const result = authPayloadSchema.safeParse(json);
  return result.success ? result.data : null;
}

function invalidRequest(context: Context) {
  return context.json(
    {
      error: {
        code: "invalid_request",
        message: "Передайте корректные данные входа."
      }
    },
    400
  );
}

function isInvalidIdentity(error: unknown): boolean {
  return error instanceof Error && error.message === "invalid_identity";
}

function invalidIdentity(context: Context) {
  return context.json(
    {
      error: {
        code: "invalid_identity",
        message: "Передайте корректный способ входа."
      }
    },
    400
  );
}
