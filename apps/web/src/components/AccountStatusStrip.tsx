import { formatGuestExpiry, numberFormatter } from "../lib/format";
import type { ContextState } from "../types";

export function AccountStatusStrip({ contextState }: { contextState: ContextState }) {
  if (contextState.status === "loading") {
    return (
      <section className="account-strip" aria-label="Статус аккаунта">
        <span>Статус аккаунта</span>
      </section>
    );
  }

  if (contextState.status === "error") {
    return (
      <section className="account-strip account-strip-error" aria-label="Статус аккаунта">
        <span>Статус недоступен</span>
      </section>
    );
  }

  const context = contextState.data;

  if (context.session.kind === "guest") {
    return (
      <section className="account-strip" aria-label="Статус аккаунта">
        <span>Гость до {formatGuestExpiry(context.session.expiresAt)}</span>
        <span>Войти: Telegram / Max / Телефон</span>
      </section>
    );
  }

  return (
    <section className="account-strip" aria-label="Статус аккаунта">
      <span>Тариф: {context.entitlements.plan?.name ?? "нет"}</span>
      <span>Новые отчеты: {numberFormatter.format(context.entitlements.remainingReports)}</span>
      <span>Баллы: {numberFormatter.format(context.entitlements.points)}</span>
    </section>
  );
}
