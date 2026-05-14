import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { GuestSessionService } from "../guest/guest-session-service";

export type UserSessionResolver = {
  resolveUserSession(token: string | null): Promise<{ userId: string } | null>;
};

export type RequestIdentity =
  | { kind: "guest"; guestSessionId: string; expiresAt: Date }
  | { kind: "user"; userId: string };

export type RequestGuestSession = {
  guestSessionId: string;
  expiresAt: Date;
};

export const REQUEST_IDENTITY_KEY = "requestIdentity";
export const REQUEST_GUEST_SESSION_KEY = "requestGuestSession";
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
      await resolveExistingGuestSession(context, options.guestSessionService, {
        userId: userSession.userId
      });
      context.set(REQUEST_IDENTITY_KEY, {
        kind: "user",
        userId: userSession.userId
      });
      await next();
      return;
    }

    const guestSession = await resolveExistingGuestSession(
      context,
      options.guestSessionService
    );

    if (guestSession !== null) {
      context.set(REQUEST_IDENTITY_KEY, {
        kind: "guest",
        guestSessionId: guestSession.guestSessionId,
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
    context.set(REQUEST_GUEST_SESSION_KEY, {
      guestSessionId: createdGuestSession.session.id,
      expiresAt: createdGuestSession.expiresAt
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

export function getOptionalGuestSession(context: Context): RequestGuestSession | null {
  return (context.get(REQUEST_GUEST_SESSION_KEY) as RequestGuestSession | undefined) ?? null;
}

async function resolveExistingGuestSession(
  context: Context,
  guestSessionService: GuestSessionService,
  options: { userId?: string } = {}
): Promise<RequestGuestSession | null> {
  const guestToken = getCookie(context, GUEST_COOKIE_NAME) ?? null;
  if (guestToken === null) {
    return null;
  }

  const guestSession =
    options.userId === undefined
      ? await guestSessionService.resolveGuestSession(guestToken)
      : await guestSessionService.resolveGuestSessionForUserTransfer(
          guestToken,
          options.userId
        );
  if (guestSession === null) {
    return null;
  }

  const requestGuestSession = {
    guestSessionId: guestSession.id,
    expiresAt: guestSession.expiresAt
  };
  context.set(REQUEST_GUEST_SESSION_KEY, requestGuestSession);
  return requestGuestSession;
}
