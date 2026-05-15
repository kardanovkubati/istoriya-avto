import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  CarFront,
  ChevronLeft,
  Download,
  ExternalLink,
  FileUp,
  Gauge,
  LockKeyhole,
  MapPin,
  ReceiptText,
  Search,
  Share2,
  Upload,
  WalletCards
} from "lucide-react";
import {
  createShareLink,
  createUnlockIntent,
  createUnlockIntentByVehicleId,
  fetchContext,
  fetchFullReportByVehicleId,
  fetchSharedReport,
  reportPdfUrl,
  searchVehicles,
  unlockVehicleReport,
  type ContextResponse,
  type CreateShareLinkResponse,
  type ReportPresentation,
  type SearchResultResponse,
  type UnlockCommitResponse,
  type UnlockIntentResponse,
  type VehicleFullReportResponse
} from "./lib/api";

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: SearchResultResponse }
  | { status: "error"; message: string };

type ContextState =
  | { status: "loading" }
  | { status: "success"; data: ContextResponse }
  | { status: "error"; message: string };

type CandidateUnlockState =
  | { status: "intent_loading" }
  | { status: "intent"; unlock: UnlockIntentResponse["unlock"] }
  | { status: "commit_loading"; unlock: Extract<UnlockIntentResponse["unlock"], { status: "ready" }> }
  | { status: "unlocked"; warning: string | undefined }
  | { status: "error"; message: string };

type UnlockStates = Record<string, CandidateUnlockState>;

type Candidate = SearchResultResponse["candidates"][number];

type ReportViewState =
  | { status: "closed" }
  | { status: "loading"; vehicleId: string }
  | { status: "ready"; vehicleId: string; data: VehicleFullReportResponse; mode: "owner" | "share" }
  | { status: "error"; vehicleId: string | null; message: string };

type ShareState =
  | { status: "idle" }
  | { status: "creating" }
  | { status: "ready"; share: CreateShareLinkResponse["share"] }
  | { status: "error"; message: string };

const examples = ["A123BC777", "XTA210990Y2765432", "https://site.ru/listing/123456"];

const kindLabels: Record<SearchResultResponse["query"]["kind"], string> = {
  vin: "VIN",
  plate: "Госномер",
  listing_url: "Ссылка",
  unknown: "Запрос"
};

const numberFormatter = new Intl.NumberFormat("ru-RU");
const unlockOptionLabels: Record<"upload_report" | "choose_plan", string> = {
  upload_report: "Загрузить отчет",
  choose_plan: "Выбрать тариф"
};

function App() {
  const [query, setQuery] = useState("");
  const [contextState, setContextState] = useState<ContextState>({ status: "loading" });
  const [searchState, setSearchState] = useState<SearchState>({ status: "idle" });
  const [unlockStates, setUnlockStates] = useState<UnlockStates>({});
  const [reportView, setReportView] = useState<ReportViewState>({ status: "closed" });
  const [shareState, setShareState] = useState<ShareState>({ status: "idle" });
  const searchRunIdRef = useRef(0);

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

  useEffect(() => {
    const token = shareTokenFromHash();
    if (token === null) return;

    setReportView({ status: "loading", vehicleId: "share" });
    fetchSharedReport(token)
      .then((data) => {
        setReportView({ status: "ready", vehicleId: data.report.vehicleId, data, mode: "share" });
      })
      .catch((error) => {
        setReportView({
          status: "error",
          vehicleId: null,
          message: error instanceof Error ? error.message : "Ссылка недоступна."
        });
      });
  }, []);

  useEffect(() => {
    const robots = ensureRobotsMeta();
    if (reportView.status === "ready" || reportView.status === "loading") {
      robots.setAttribute("content", "noindex,nofollow");
    }
  }, [reportView.status]);

  useEffect(() => {
    let isActive = true;

    fetchContext()
      .then((data) => {
        if (isActive) {
          setContextState({ status: "success", data });
        }
      })
      .catch((error) => {
        if (isActive) {
          setContextState({
            status: "error",
            message: error instanceof Error ? error.message : "Не удалось загрузить статус аккаунта."
          });
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!trimmedQuery) {
      setSearchState({
        status: "error",
        message: "Введите ссылку объявления, VIN или госномер."
      });
      return;
    }

    const nextSearchRunId = searchRunIdRef.current + 1;
    searchRunIdRef.current = nextSearchRunId;
    setUnlockStates({});
    setSearchState({ status: "loading" });

    try {
      const data = await searchVehicles(trimmedQuery);
      if (nextSearchRunId !== searchRunIdRef.current) {
        return;
      }
      setSearchState({ status: "success", data });
    } catch (error) {
      if (nextSearchRunId !== searchRunIdRef.current) {
        return;
      }

      setSearchState({
        status: "error",
        message: error instanceof Error ? error.message : "Не удалось выполнить поиск."
      });
    }
  }

  async function handleUnlock(candidate: Candidate) {
    if (!candidate.unlock.canRequestUnlock) return;
    const requestSearchRunId = searchRunIdRef.current;

    setUnlockStates((current) => ({
      ...current,
      [candidate.id]: { status: "intent_loading" }
    }));

    try {
      const data = await createUnlockIntentForCandidate(candidate);
      if (requestSearchRunId !== searchRunIdRef.current) {
        return;
      }

      if (data.unlock.status === "already_opened") {
        setUnlockStates((current) => ({
          ...current,
          [candidate.id]: { status: "unlocked", warning: getUnlockWarning(data.unlock) }
        }));
        void openFullReport(data.unlock.vehicleId);
        return;
      }

      setUnlockStates((current) => ({
        ...current,
        [candidate.id]: { status: "intent", unlock: data.unlock }
      }));
    } catch (error) {
      if (requestSearchRunId !== searchRunIdRef.current) {
        return;
      }

      setUnlockStates((current) => ({
        ...current,
        [candidate.id]: {
          status: "error",
          message: error instanceof Error ? error.message : "Не удалось подготовить открытие отчета."
        }
      }));
    }
  }

  async function createUnlockIntentForCandidate(candidate: Candidate): Promise<UnlockIntentResponse> {
    if (searchState.status === "success" && searchState.data.query.kind === "vin") {
      return createUnlockIntent(searchState.data.query.normalized);
    }

    if (candidate.preview.vehicleId !== null) {
      return createUnlockIntentByVehicleId(candidate.preview.vehicleId);
    }

    throw new Error("Не удалось определить отчет.");
  }

  async function handleConfirmUnlock(candidate: Candidate) {
    const state = unlockStates[candidate.id];
    if (state?.status !== "intent" || state.unlock.status !== "ready") return;
    const readyUnlock = state.unlock;
    const requestSearchRunId = searchRunIdRef.current;

    setUnlockStates((current) => ({
      ...current,
      [candidate.id]: { status: "commit_loading", unlock: readyUnlock }
    }));

    try {
      const isVinQuery = searchState.status === "success" && searchState.data.query.kind === "vin";
      const unlockInput = isVinQuery && searchState.status === "success"
        ? {
            vin: searchState.data.query.normalized,
            idempotencyKey: `unlock:${candidate.id}`
          }
        : {
            vehicleId: candidate.preview.vehicleId ?? undefined,
            idempotencyKey: `unlock:${candidate.id}`
          };

      const unlockResult = await unlockVehicleReport(unlockInput);
      if (requestSearchRunId !== searchRunIdRef.current) {
        return;
      }

      applyUnlockedEntitlements(unlockResult);
      void openFullReport(unlockResult.access.vehicleId);

      setUnlockStates((current) => ({
        ...current,
        [candidate.id]: { status: "unlocked", warning: readyUnlock.warning }
      }));

      void refreshContextSoft(requestSearchRunId);
    } catch (error) {
      if (requestSearchRunId !== searchRunIdRef.current) {
        return;
      }

      setUnlockStates((current) => ({
        ...current,
        [candidate.id]: {
          status: "error",
          message: error instanceof Error ? error.message : "Не удалось открыть отчет."
        }
      }));
    }
  }

  function applyUnlockedEntitlements(result: UnlockCommitResponse) {
    setContextState((current) => {
      if (current.status !== "success" || current.data.session.kind !== "user") {
        return current;
      }

      return {
        status: "success",
        data: {
          ...current.data,
          entitlements: result.entitlements
        }
      };
    });
  }

  async function refreshContextSoft(requestSearchRunId: number) {
    try {
      const context = await fetchContext();
      if (requestSearchRunId === searchRunIdRef.current) {
        setContextState({ status: "success", data: context });
      }
    } catch {
      // The unlock commit already succeeded; keep the committed entitlements visible.
    }
  }

  async function openFullReport(vehicleId: string) {
    setShareState({ status: "idle" });
    setReportView({ status: "loading", vehicleId });

    try {
      const data = await fetchFullReportByVehicleId(vehicleId);
      setReportView({ status: "ready", vehicleId, data, mode: "owner" });
    } catch (error) {
      setReportView({
        status: "error",
        vehicleId,
        message: error instanceof Error ? error.message : "Не удалось загрузить полный отчет."
      });
    }
  }

  async function handleCreateShare(vehicleId: string) {
    setShareState({ status: "creating" });

    try {
      const share = await createShareLink(vehicleId);
      setShareState({ status: "ready", share: share.share });
    } catch (error) {
      setShareState({
        status: "error",
        message: error instanceof Error ? error.message : "Не удалось создать share-ссылку."
      });
    }
  }

  function handleDownloadPdf(vehicleId: string) {
    window.location.assign(reportPdfUrl(vehicleId));
  }

  if (reportView.status !== "closed") {
    return (
      <main className="app-shell report-app-shell">
        <header className="topbar" aria-label="Основная навигация">
          <a className="brand" href="/" aria-label="История Авто">
            <span className="brand-mark">ИА</span>
            <span>История Авто</span>
          </a>
          {reportView.status === "ready" && reportView.mode === "share" ? (
            <span className="account-pill">Share</span>
          ) : (
            <button className="account-pill" type="button" onClick={() => setReportView({ status: "closed" })}>
              <ChevronLeft aria-hidden="true" size={16} />
              <span>К поиску</span>
            </button>
          )}
        </header>

        {reportView.status === "loading" && (
          <section className="status-panel status-loading" aria-live="polite">
            <span>Отчет</span>
            <h1>Собираем полный отчет</h1>
            <p>Проверяем доступ и готовим сводные разделы.</p>
          </section>
        )}

        {reportView.status === "error" && (
          <section className="status-panel status-error" aria-live="polite">
            <span>Отчет</span>
            <h1>Не удалось открыть отчет</h1>
            <p>{reportView.message}</p>
          </section>
        )}

        {reportView.status === "ready" && (
          <FullReportScreen
            data={reportView.data}
            mode={reportView.mode}
            shareState={shareState}
            onBack={() => setReportView({ status: "closed" })}
            onShare={() => handleCreateShare(reportView.vehicleId)}
            onDownloadPdf={() => handleDownloadPdf(reportView.vehicleId)}
          />
        )}
      </main>
    );
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

      <AccountStatusStrip contextState={contextState} />

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
                  onConfirmUnlock={handleConfirmUnlock}
                  unlockState={unlockStates[candidate.id]}
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

function FullReportScreen({
  data,
  mode,
  shareState,
  onBack,
  onShare,
  onDownloadPdf
}: {
  data: VehicleFullReportResponse;
  mode: "owner" | "share";
  shareState: ShareState;
  onBack: () => void;
  onShare: () => void;
  onDownloadPdf: () => void;
}) {
  const title = reportTitle(data);
  const score = data.report.summary.transparency;

  return (
    <section className="report-screen" aria-labelledby="full-report-title">
      <div className="report-toolbar">
        <button type="button" onClick={onBack}>
          <ChevronLeft aria-hidden="true" size={17} />
          <span>{mode === "share" ? "На главную" : "К поиску"}</span>
        </button>
        {data.presentation.actions.canShare && (
          <button type="button" onClick={onShare} disabled={shareState.status === "creating"}>
            <Share2 aria-hidden="true" size={17} />
            <span>{shareState.status === "creating" ? "Создаем" : "Ссылка"}</span>
          </button>
        )}
        {data.presentation.actions.canDownloadPdf && (
          <button type="button" onClick={onDownloadPdf}>
            <Download aria-hidden="true" size={17} />
            <span>PDF</span>
          </button>
        )}
      </div>

      <div className="report-hero">
        <p className="eyebrow">{mode === "share" ? "Отчет по share-ссылке" : "Открытый отчет"}</p>
        <h1 id="full-report-title">{title}</h1>
        <div className="report-hero-grid">
          <div>
            <span>VIN</span>
            <strong>{data.report.vin}</strong>
          </div>
          <div>
            <span>Оценка</span>
            <strong>
              {score.kind === "score" ? `${score.value} / ${score.max}` : "Недостаточно данных"}
            </strong>
          </div>
          <div>
            <span>Обновление</span>
            <strong>{formatDate(data.report.summary.lastUpdatedAt ?? data.report.generatedAt)}</strong>
          </div>
        </div>
        <p>{data.report.summary.historyBasisText}</p>
        {data.report.summary.freshnessWarning && (
          <p className="report-warning">{data.report.summary.freshnessWarning}</p>
        )}
      </div>

      {shareState.status === "ready" && (
        <div className="share-result">
          <ExternalLink aria-hidden="true" size={18} />
          <div>
            <p>{shareState.share.url}</p>
            <small>Действует до {formatDate(shareState.share.expiresAt)}</small>
          </div>
        </div>
      )}
      {shareState.status === "error" && <p className="report-warning">{shareState.message}</p>}

      <div className="report-section-list">
        {data.presentation.sections.map((section) => (
          <ReportSection key={section.id} section={section} />
        ))}
      </div>

      <footer className="report-footer">
        <p>{data.presentation.disclaimer}</p>
        <small>{data.presentation.watermark}</small>
        {mode === "share" && data.share && <small>Share действует до {formatDate(data.share.expiresAt)}</small>}
      </footer>
    </section>
  );
}

function ReportSection({ section }: { section: ReportPresentation["sections"][number] }) {
  const toneClass = section.items.some((item) => item.tone === "danger")
    ? " report-section-danger"
    : section.items.some((item) => item.tone === "warning")
      ? " report-section-warning"
      : "";

  return (
    <article className={`report-section${toneClass}`}>
      <div className="report-section-heading">
        <h2>{section.title}</h2>
        {section.critical && <span>Критичный блок</span>}
      </div>

      {section.state === "empty" ? (
        <p className="report-empty">{section.emptyText ?? "Данных нет"}</p>
      ) : (
        <dl className="report-fact-list">
          {section.items.map((item) => (
            <div className={`report-fact report-fact-${item.tone ?? "default"}`} key={`${item.label}:${item.value}`}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
              {item.date && <small>{formatDate(item.date)}</small>}
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}

function CandidateCard({
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

function AccountStatusStrip({ contextState }: { contextState: ContextState }) {
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

function UnlockPanel({
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

function formatGuestExpiry(value: string): string {
  const datePart = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (datePart === null) {
    return value;
  }

  return `${datePart[3]}.${datePart[2]}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC" }).format(date);
}

function reportTitle(data: VehicleFullReportResponse): string {
  return [data.report.passport.make, data.report.passport.model, data.report.passport.year]
    .filter((value) => value !== null && value !== undefined)
    .join(" ") || "Автомобиль";
}

function shareTokenFromHash(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const match = /^#\/share\/([^/?#]+)/.exec(window.location.hash);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function ensureRobotsMeta(): HTMLMetaElement {
  const existing = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (existing !== null) {
    return existing;
  }

  const meta = document.createElement("meta");
  meta.setAttribute("name", "robots");
  document.head.append(meta);
  return meta;
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

function getUnlockWarning(unlock: UnlockIntentResponse["unlock"]): string | undefined {
  return "warning" in unlock ? unlock.warning : undefined;
}

export default App;
