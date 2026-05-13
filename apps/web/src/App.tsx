import { FormEvent, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  CarFront,
  FileUp,
  Gauge,
  LockKeyhole,
  MapPin,
  ReceiptText,
  Search,
  Upload,
  WalletCards
} from "lucide-react";
import { createUnlockIntent, searchVehicles, type SearchResultResponse } from "./lib/api";

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: SearchResultResponse }
  | { status: "error"; message: string };

type UnlockState =
  | { status: "idle" }
  | { status: "loading"; candidateId: string }
  | { status: "success"; candidateId: string; message: string; warning: string }
  | { status: "error"; candidateId: string; message: string };

type Candidate = SearchResultResponse["candidates"][number];

const examples = ["A123BC777", "XTA210990Y2765432", "https://site.ru/listing/123456"];

const kindLabels: Record<SearchResultResponse["query"]["kind"], string> = {
  vin: "VIN",
  plate: "Госномер",
  listing_url: "Ссылка",
  unknown: "Запрос"
};

const numberFormatter = new Intl.NumberFormat("ru-RU");

function App() {
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({ status: "idle" });
  const [unlockState, setUnlockState] = useState<UnlockState>({ status: "idle" });

  const trimmedQuery = query.trim();
  const canSubmit = trimmedQuery.length > 0 && searchState.status !== "loading";

  const statusCopy = useMemo(() => {
    if (searchState.status === "loading") {
      return {
        label: "Поиск",
        title: "Ищем совпадения",
        body: "Проверяем запрос и собираем безопасное превью доступных вариантов."
      };
    }

    if (searchState.status === "error") {
      return {
        label: "Ошибка",
        title: "Не удалось выполнить поиск",
        body: searchState.message
      };
    }

    return {
      label: "Быстрый старт",
      title: "Введите ссылку, VIN или госномер",
      body: "Мы покажем только безопасные данные превью и предложим следующий шаг."
    };
  }, [searchState]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!trimmedQuery) {
      setSearchState({
        status: "error",
        message: "Введите ссылку объявления, VIN или госномер."
      });
      return;
    }

    setUnlockState({ status: "idle" });
    setSearchState({ status: "loading" });

    try {
      const data = await searchVehicles(trimmedQuery);
      setSearchState({ status: "success", data });
    } catch (error) {
      setSearchState({
        status: "error",
        message: error instanceof Error ? error.message : "Не удалось выполнить поиск."
      });
    }
  }

  async function handleUnlock(candidate: Candidate) {
    if (!candidate.unlock.canRequestUnlock) return;

    setUnlockState({ status: "loading", candidateId: candidate.id });

    try {
      if (searchState.status === "success" && searchState.data.query.kind === "vin") {
        const data = await createUnlockIntent(searchState.data.query.normalized);

        if (data.unlock.status === "locked") {
          setUnlockState({
            status: "success",
            candidateId: candidate.id,
            message: data.unlock.message,
            warning: data.unlock.warning
          });
          return;
        }

        setUnlockState({
          status: "success",
          candidateId: candidate.id,
          message: "Отчет уже открыт для просмотра.",
          warning: candidate.unlock.warning
        });
        return;
      }

      setUnlockState({
        status: "success",
        candidateId: candidate.id,
        message: "Списание баллов и подписочных лимитов появится на следующем этапе.",
        warning: candidate.unlock.warning
      });
    } catch (error) {
      setUnlockState({
        status: "error",
        candidateId: candidate.id,
        message: error instanceof Error ? error.message : "Не удалось подготовить открытие отчета."
      });
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar" aria-label="Основная навигация">
        <a className="brand" href="/" aria-label="История Авто">
          <span className="brand-mark">ИА</span>
          <span>История Авто</span>
        </a>
        <button className="account-pill" type="button" aria-label="Открыть кабинет">
          <Bell aria-hidden="true" size={16} />
          <span>Кабинет</span>
        </button>
      </header>

      <section className="search-section" aria-labelledby="search-title">
        <div className="section-copy">
          <p className="eyebrow">Проверка перед покупкой</p>
          <h1 id="search-title">История автомобиля начинается с одного запроса</h1>
          <p>
            Вставьте ссылку объявления, VIN или госномер. Сервис найдет совпадения и
            покажет безопасное превью перед открытием отчета.
          </p>
        </div>

        <form className="smart-input" onSubmit={handleSubmit}>
          <label htmlFor="search-query">Ссылка, VIN или госномер</label>
          <div className="input-row">
            <Search aria-hidden="true" size={20} />
            <input
              id="search-query"
              autoComplete="off"
              inputMode="text"
              placeholder="A123BC777 или ссылка объявления"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit" disabled={!canSubmit} aria-label="Найти автомобиль">
              <ArrowRight aria-hidden="true" size={20} />
            </button>
          </div>
          <div className="examples" aria-label="Примеры запросов">
            {examples.map((example) => (
              <button key={example} type="button" onClick={() => setQuery(example)}>
                {example}
              </button>
            ))}
          </div>
        </form>
      </section>

      {searchState.status !== "success" && (
        <section className={`status-panel status-${searchState.status}`} aria-live="polite">
          <span>{statusCopy.label}</span>
          <h2>{statusCopy.title}</h2>
          <p>{statusCopy.body}</p>
        </section>
      )}

      {searchState.status === "success" && (
        <section className="results-section" aria-labelledby="results-title" aria-live="polite">
          <div className="results-heading">
            <span>{kindLabels[searchState.data.query.kind]}</span>
            <h2 id="results-title">Найденные варианты</h2>
          </div>

          {searchState.data.candidates.length > 0 ? (
            <div className="candidate-list">
              {searchState.data.candidates.map((candidate) => (
                <CandidateCard
                  candidate={candidate}
                  key={candidate.id}
                  onUnlock={handleUnlock}
                  unlockState={unlockState}
                />
              ))}
            </div>
          ) : (
            <EmptyState state={searchState.data.emptyState} />
          )}
        </section>
      )}

      <section className="quick-actions" aria-label="Быстрые действия">
        <article className="action-card">
          <FileUp aria-hidden="true" size={22} />
          <div>
            <h2>Загрузить отчет</h2>
            <p>PDF или публичная ссылка на отчет пополнят базу и могут дать 1 балл.</p>
          </div>
        </article>
        <article className="action-card">
          <BadgeCheck aria-hidden="true" size={22} />
          <div>
            <h2>Открытые отчеты</h2>
            <p>Доступ к купленному отчету по VIN остается навсегда.</p>
          </div>
        </article>
        <article className="action-card">
          <Bell aria-hidden="true" size={22} />
          <div>
            <h2>Уведомления</h2>
            <p>Telegram и Max сообщат, когда появятся новые данные.</p>
          </div>
        </article>
      </section>
    </main>
  );
}

function CandidateCard({
  candidate,
  onUnlock,
  unlockState
}: {
  candidate: Candidate;
  onUnlock: (candidate: Candidate) => void;
  unlockState: UnlockState;
}) {
  const listing = candidate.preview.lastListing;
  const isUnlockLoading = unlockState.status === "loading";
  const isCurrentCandidate = unlockState.status !== "idle" && unlockState.candidateId === candidate.id;

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
          className="unlock-button"
          type="button"
          disabled={!candidate.unlock.canRequestUnlock || isUnlockLoading}
          onClick={() => onUnlock(candidate)}
        >
          <LockKeyhole aria-hidden="true" size={17} />
          <span>{candidate.unlock.canRequestUnlock ? "Открыть отчет" : "Загрузить отчет"}</span>
        </button>

        {isCurrentCandidate && unlockState.status === "success" && (
          <div className="unlock-panel">
            <WalletCards aria-hidden="true" size={18} />
            <div>
              <p>{unlockState.message}</p>
              <small>{unlockState.warning}</small>
            </div>
          </div>
        )}

        {isCurrentCandidate && unlockState.status === "error" && (
          <div className="unlock-panel unlock-panel-error">
            <WalletCards aria-hidden="true" size={18} />
            <p>{unlockState.message}</p>
          </div>
        )}
      </div>
    </article>
  );
}

function EmptyState({ state }: { state: SearchResultResponse["emptyState"] }) {
  return (
    <div className="empty-state">
      <ReceiptText aria-hidden="true" size={24} />
      <div>
        <h3>{state?.title ?? "Отчета пока нет"}</h3>
        <p>{state?.message ?? "Загрузите отчет, и он может дать 1 балл на будущий просмотр."}</p>
      </div>
      <button type="button">
        <Upload aria-hidden="true" size={17} />
        <span>{state?.action.label ?? "Загрузить отчет"}</span>
      </button>
    </div>
  );
}

function formatRub(value: number): string {
  return `${numberFormatter.format(value)} ₽`;
}

function formatKm(value: number): string {
  return `${numberFormatter.format(value)} км`;
}

export default App;
