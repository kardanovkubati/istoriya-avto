import type { FormEvent } from "react";
import { ArrowRight, BadgeCheck, Bell, FileUp, Search } from "lucide-react";
import type { SearchResultResponse } from "../lib/api";
import type { Candidate, SearchState, UnlockStates } from "../types";
import { CandidateCard } from "./CandidateCard";
import { EmptyState } from "./EmptyState";

const examples = ["A123BC777", "XTA210990Y2765432", "https://site.ru/listing/123456"];

const kindLabels: Record<SearchResultResponse["query"]["kind"], string> = {
  vin: "VIN",
  plate: "Госномер",
  listing_url: "Ссылка",
  unknown: "Запрос"
};

export function SearchExperience({
  query,
  canSubmit,
  searchState,
  unlockStates,
  onQueryChange,
  onSubmit,
  onUnlock,
  onConfirmUnlock
}: {
  query: string;
  canSubmit: boolean;
  searchState: SearchState;
  unlockStates: UnlockStates;
  onQueryChange: (query: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUnlock: (candidate: Candidate) => void;
  onConfirmUnlock: (candidate: Candidate) => void;
}) {
  const statusCopy = searchStatusCopy(searchState);

  return (
    <>
      <SearchHero
        query={query}
        canSubmit={canSubmit}
        onQueryChange={onQueryChange}
        onSubmit={onSubmit}
      />

      {searchState.status !== "success" && (
        <section className={`status-panel status-${searchState.status}`} aria-live="polite">
          <span>{statusCopy.label}</span>
          <h2>{statusCopy.title}</h2>
          <p>{statusCopy.body}</p>
        </section>
      )}

      {searchState.status === "success" && (
        <SearchResults
          data={searchState.data}
          unlockStates={unlockStates}
          onUnlock={onUnlock}
          onConfirmUnlock={onConfirmUnlock}
        />
      )}

      <QuickActions />
    </>
  );
}

function SearchHero({
  query,
  canSubmit,
  onQueryChange,
  onSubmit
}: {
  query: string;
  canSubmit: boolean;
  onQueryChange: (query: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="search-section" aria-labelledby="search-title">
      <div className="section-copy">
        <p className="eyebrow">Проверка перед покупкой</p>
        <h1 id="search-title">История автомобиля начинается с одного запроса</h1>
        <p>
          Вставьте ссылку объявления, VIN или госномер. Сервис найдет совпадения и
          покажет безопасное превью перед открытием отчета.
        </p>
      </div>

      <form className="smart-input" onSubmit={onSubmit}>
        <label htmlFor="search-query">Ссылка, VIN или госномер</label>
        <div className="input-row">
          <Search aria-hidden="true" size={20} />
          <input
            id="search-query"
            autoComplete="off"
            inputMode="text"
            placeholder="A123BC777 или ссылка объявления"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          <button type="submit" disabled={!canSubmit} aria-label="Найти автомобиль">
            <ArrowRight aria-hidden="true" size={20} />
          </button>
        </div>
        <div className="examples" aria-label="Примеры запросов">
          {examples.map((example) => (
            <button key={example} type="button" onClick={() => onQueryChange(example)}>
              {example}
            </button>
          ))}
        </div>
      </form>
    </section>
  );
}

function SearchResults({
  data,
  unlockStates,
  onUnlock,
  onConfirmUnlock
}: {
  data: SearchResultResponse;
  unlockStates: UnlockStates;
  onUnlock: (candidate: Candidate) => void;
  onConfirmUnlock: (candidate: Candidate) => void;
}) {
  return (
    <section className="results-section" aria-labelledby="results-title" aria-live="polite">
      <div className="results-heading">
        <span>{kindLabels[data.query.kind]}</span>
        <h2 id="results-title">Найденные варианты</h2>
      </div>

      {data.candidates.length > 0 ? (
        <div className="candidate-list">
          {data.candidates.map((candidate) => (
            <CandidateCard
              candidate={candidate}
              key={candidate.id}
              onUnlock={onUnlock}
              onConfirmUnlock={onConfirmUnlock}
              unlockState={unlockStates[candidate.id]}
            />
          ))}
        </div>
      ) : (
        <EmptyState state={data.emptyState} />
      )}
    </section>
  );
}

function QuickActions() {
  return (
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
  );
}

function searchStatusCopy(searchState: SearchState) {
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
}
