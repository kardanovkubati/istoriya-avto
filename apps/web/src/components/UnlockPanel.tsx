import { BadgeCheck, WalletCards } from "lucide-react";
import type { UnlockIntentResponse } from "../lib/api";

const unlockOptionLabels: Record<"upload_report" | "choose_plan", string> = {
  upload_report: "Загрузить отчет",
  choose_plan: "Выбрать тариф"
};

export function UnlockPanel({
  unlock,
  fallbackWarning,
  onConfirm,
  isConfirming = false
}: {
  unlock: UnlockIntentResponse["unlock"];
  fallbackWarning: string;
  onConfirm?: () => void;
  isConfirming?: boolean;
}) {
  const view = unlockView(unlock, fallbackWarning);

  return (
    <div className={`unlock-panel${view.tone === "warning" ? " unlock-panel-warning" : ""}`}>
      <WalletCards aria-hidden="true" size={18} />
      <div>
        <p>{view.message}</p>
        {view.detail && <small>{view.detail}</small>}
        {(onConfirm || isConfirming) && (
          <button className="unlock-confirm-button" type="button" onClick={onConfirm} disabled={isConfirming}>
            <BadgeCheck aria-hidden="true" size={16} />
            <span>{isConfirming ? "Открываем" : "Подтвердить открытие"}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function unlockView(
  unlock: UnlockIntentResponse["unlock"],
  fallbackWarning: string
): { message: string; detail: string; tone: "default" | "warning" } {
  if (unlock.status === "auth_required") {
    return {
      message: "Войти: Telegram / Max / Телефон",
      detail: unlock.warning,
      tone: "warning"
    };
  }

  if (unlock.status === "payment_required") {
    return {
      message: unlock.message,
      detail: unlock.options.map((option) => unlockOptionLabels[option]).join(" / "),
      tone: "warning"
    };
  }

  if (unlock.status === "ready") {
    return {
      message: unlock.spendOrder === "subscription" ? "Сначала лимит тарифа" : "Будет списан 1 балл",
      detail: unlock.warning,
      tone: "default"
    };
  }

  if (unlock.status === "already_opened") {
    return {
      message: "Открыт навсегда",
      detail: "Доступ закреплен за аккаунтом.",
      tone: "default"
    };
  }

  return {
    message: "Отчет не найден",
    detail: fallbackWarning,
    tone: "warning"
  };
}
