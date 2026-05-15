import { type Context, Hono } from "hono";
import type { ReportAccessRepository } from "../access/report-access-repository";
import type { AccountRepository } from "../auth/account-repository";
import { getRequestIdentity } from "./request-context";

export type ContextRoutesDependencies = {
  accountRepository: AccountRepository;
  reportAccessRepository: ReportAccessRepository;
  now?: () => Date;
};

export function createContextRoutes(dependencies: ContextRoutesDependencies): Hono {
  const routes = new Hono();
  const now = dependencies.now ?? (() => new Date());

  routes.get("/", async (context) => {
    context.header("Cache-Control", "no-store");

    const identity = getRequestIdentity(context);

    if (identity.kind === "guest") {
      return context.json({
        session: {
          kind: "guest",
          expiresAt: identity.expiresAt.toISOString()
        },
        account: null,
        entitlements: {
          plan: null,
          remainingReports: 0,
          points: 0
        }
      });
    }

    const account = await dependencies.accountRepository.findAccountById(identity.userId);
    if (account === null) {
      return authRequired(context);
    }

    const [identities, entitlements] = await Promise.all([
      dependencies.accountRepository.listIdentityProviders(identity.userId),
      dependencies.reportAccessRepository.getEntitlements({
        userId: identity.userId,
        now: now()
      })
    ]);

    return context.json({
      session: { kind: "user" },
      account: {
        id: account.id,
        primaryContactProvider: account.primaryContactProvider,
        identities
      },
      entitlements
    });
  });

  return routes;
}

function authRequired(context: Context) {
  return context.json(
    {
      error: {
        code: "auth_required",
        message: "Войдите, чтобы продолжить."
      }
    },
    401
  );
}
