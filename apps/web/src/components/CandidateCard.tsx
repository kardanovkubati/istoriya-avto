import { BadgeCheck, CarFront, Gauge, LockKeyhole, MapPin, WalletCards } from "lucide-react";
import { formatKm, formatRub } from "../lib/format";
import type { Candidate, CandidateUnlockState } from "../types";
import { UnlockPanel } from "./UnlockPanel";

export function CandidateCard({
  candidate,
  onUnlock,
  onConfirmUnlock,
  unlockState
}: {
  candidate: Candidate;
  onUnlock: (candidate: Candidate) => void;
  onConfirmUnlock: (candidate: Candidate) => void;
  unlockState: CandidateUnlockState | undefined;
}) {
  const listing = candidate.preview.lastListing;
  const isUnlockLoading =
    unlockState?.status === "intent_loading" || unlockState?.status === "commit_loading";
  const isUnlocked = unlockState?.status === "unlocked";

  return (
    <article className="candidate-card">
      <div className="candidate-photo">
        {candidate.preview.photo ? (
          <img src={candidate.preview.photo.url} alt={candidate.preview.photo.alt ?? "Фото автомобиля"} />
        ) : (
          <CarFront aria-hidden="true" size={34} />
        )}
      </div>

      <div className="candidate-body">
        <div className="candidate-title-row">
          <h3>{candidate.preview.title}</h3>
          <span>{candidate.reportStatus === "available" ? "Отчет есть" : "Отчета нет"}</span>
        </div>

        <div className="candidate-facts" aria-label="Данные превью">
          {candidate.preview.year !== null && <span>{candidate.preview.year}</span>}
          {listing?.priceRub !== null && listing?.priceRub !== undefined && (
            <span>{formatRub(listing.priceRub)}</span>
          )}
          {listing?.mileageKm !== null && listing?.mileageKm !== undefined && (
            <span>
              <Gauge aria-hidden="true" size={15} />
              {formatKm(listing.mileageKm)}
            </span>
          )}
          {listing?.city && (
            <span>
              <MapPin aria-hidden="true" size={15} />
              {listing.city}
            </span>
          )}
          {candidate.preview.vinMasked && <span>{candidate.preview.vinMasked}</span>}
        </div>

        <p className="candidate-warning">{candidate.unlock.warning}</p>

        <button
          className={`unlock-button${isUnlocked ? " unlock-button-opened" : ""}`}
          type="button"
          disabled={!candidate.unlock.canRequestUnlock || isUnlockLoading || isUnlocked}
          onClick={() => onUnlock(candidate)}
        >
          <LockKeyhole aria-hidden="true" size={17} />
          <span>{unlockButtonLabel(candidate, unlockState)}</span>
        </button>

        {unlockState?.status === "intent" && (
          <UnlockPanel
            unlock={unlockState.unlock}
            fallbackWarning={candidate.unlock.warning}
            {...(unlockState.unlock.status === "ready"
              ? { onConfirm: () => onConfirmUnlock(candidate) }
              : {})}
          />
        )}

        {unlockState?.status === "commit_loading" && (
          <UnlockPanel unlock={unlockState.unlock} fallbackWarning={candidate.unlock.warning} isConfirming />
        )}

        {unlockState?.status === "unlocked" && (
          <div className="unlock-panel unlock-panel-opened">
            <BadgeCheck aria-hidden="true" size={18} />
            <div>
              <p>Открыт навсегда</p>
              <small>{unlockState.warning ?? "Доступ закреплен за аккаунтом."}</small>
            </div>
          </div>
        )}

        {unlockState?.status === "error" && (
          <div className="unlock-panel unlock-panel-error">
            <WalletCards aria-hidden="true" size={18} />
            <p>{unlockState.message}</p>
          </div>
        )}
      </div>
    </article>
  );
}

function unlockButtonLabel(candidate: Candidate, unlockState?: CandidateUnlockState): string {
  if (!candidate.unlock.canRequestUnlock) {
    return "Загрузить отчет";
  }

  if (unlockState?.status === "intent_loading") {
    return "Проверяем доступ";
  }

  if (unlockState?.status === "commit_loading") {
    return "Открываем";
  }

  if (unlockState?.status === "unlocked") {
    return "Открыт навсегда";
  }

  return "Открыть отчет";
}
