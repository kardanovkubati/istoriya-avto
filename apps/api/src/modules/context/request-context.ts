import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { GuestSessionService } from "../guest/guest-session-service";

export type UserSessionResolver = {
  resolveUserSession(token: string | null): Promise<{ userId: string } | null>;
};

export type RequestIdentity =
  | { kind: "guest"; guestSessionId: string; expiresAt: Date }
  | { kind: "user"; userId: string };

export const REQUEST_IDENTITY_KEY = "requestIdentity";
export const GUEST_COOKIE_NAME = "ia_guest";
export const USER_COOKIE_NAME = "ia_user";

export function createRequestContextMiddleware(options: {
  guestSessionService: GuestSessionService;
  userSessionResolver?: UserSessionResolver;
  secureCookies?: boolean;
}): MiddlewareHandler {
  return async (context, next) => {
    const userToken = getCookie(context, USER_COOKIE_NAME) ?? null;
    const userSession = await options.userSessionResolver?.resolveUserSession(userToken);

    if (userSession !== undefined && userSession !== null) {
      context.set(REQUEST_IDENTITY_KEY, {
        kind: "user",
        userId: userSession.userId
      });
      await next();
      return;
    }

    const guestToken = getCookie(context, GUEST_COOKIE_NAME) ?? null;
    const guestSession = await options.guestSessionService.resolveGuestSession(guestToken);

    if (guestSession !== null) {
      context.set(REQUEST_IDENTITY_KEY, {
        kind: "guest",
        guestSessionId: guestSession.id,
        expiresAt: guestSession.expiresAt
      });
      await next();
      return;
    }

    const createdGuestSession = await options.guestSessionService.createGuestSession();
    setCookie(context, GUEST_COOKIE_NAME, createdGuestSession.token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      expires: createdGuestSession.expiresAt,
      ...(options.secureCookies === true ? { secure: true } : {})
    });
    context.set(REQUEST_IDENTITY_KEY, {
      kind: "guest",
      guestSessionId: createdGuestSession.session.id,
      expiresAt: createdGuestSession.expiresAt
    });
    await next();
  };
}

export function getRequestIdentity(context: Context): RequestIdentity {
  const identity = context.get(REQUEST_IDENTITY_KEY);

  if (identity === undefined) {
    throw new Error("request_identity_missing");
  }

  return identity as RequestIdentity;
}
