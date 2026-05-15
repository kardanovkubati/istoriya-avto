import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Bell, ChevronLeft } from "lucide-react";
import { AccountStatusStrip } from "./components/AccountStatusStrip";
import { FullReportScreen } from "./components/FullReportScreen";
import { SearchExperience } from "./components/SearchExperience";
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
  type UnlockCommitResponse,
  type UnlockIntentResponse
} from "./lib/api";
import { ensureRobotsMeta, shareTokenFromHash } from "./lib/seo";
import type {
  Candidate,
  ContextState,
  ReportViewState,
  SearchState,
  ShareState,
  UnlockStates
} from "./types";

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
      if (nextSearchRunId === searchRunIdRef.current) {
        setSearchState({ status: "success", data });
      }
    } catch (error) {
      if (nextSearchRunId === searchRunIdRef.current) {
        setSearchState({
          status: "error",
          message: error instanceof Error ? error.message : "Не удалось выполнить поиск."
        });
      }
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
      if (requestSearchRunId !== searchRunIdRef.current) return;

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
      if (requestSearchRunId !== searchRunIdRef.current) return;

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
      const unlockResult = await unlockVehicleReport(unlockInputFor(candidate));
      if (requestSearchRunId !== searchRunIdRef.current) return;

      applyUnlockedEntitlements(unlockResult);
      void openFullReport(unlockResult.access.vehicleId);

      setUnlockStates((current) => ({
        ...current,
        [candidate.id]: { status: "unlocked", warning: readyUnlock.warning }
      }));

      void refreshContextSoft(requestSearchRunId);
    } catch (error) {
      if (requestSearchRunId !== searchRunIdRef.current) return;

      setUnlockStates((current) => ({
        ...current,
        [candidate.id]: {
          status: "error",
          message: error instanceof Error ? error.message : "Не удалось открыть отчет."
        }
      }));
    }
  }

  function unlockInputFor(candidate: Candidate) {
    const isVinQuery = searchState.status === "success" && searchState.data.query.kind === "vin";
    return isVinQuery && searchState.status === "success"
      ? {
          vin: searchState.data.query.normalized,
          idempotencyKey: `unlock:${candidate.id}`
        }
      : {
          vehicleId: candidate.preview.vehicleId ?? undefined,
          idempotencyKey: `unlock:${candidate.id}`
        };
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

        {reportView.status === "loading" && <ReportLoadingState />}
        {reportView.status === "error" && <ReportErrorState message={reportView.message} />}
        {reportView.status === "ready" && (
          <FullReportScreen
            data={reportView.data}
            mode={reportView.mode}
            shareState={shareState}
            onBack={() => setReportView({ status: "closed" })}
            onShare={() => handleCreateShare(reportView.vehicleId)}
            onDownloadPdf={() => window.location.assign(reportPdfUrl(reportView.vehicleId))}
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
      <SearchExperience
        query={query}
        canSubmit={canSubmit}
        searchState={searchState}
        unlockStates={unlockStates}
        onQueryChange={setQuery}
        onSubmit={handleSubmit}
        onUnlock={handleUnlock}
        onConfirmUnlock={handleConfirmUnlock}
      />
    </main>
  );
}

function ReportLoadingState() {
  return (
    <section className="status-panel status-loading" aria-live="polite">
      <span>Отчет</span>
      <h1>Собираем полный отчет</h1>
      <p>Проверяем доступ и готовим сводные разделы.</p>
    </section>
  );
}

function ReportErrorState({ message }: { message: string }) {
  return (
    <section className="status-panel status-error" aria-live="polite">
      <span>Отчет</span>
      <h1>Не удалось открыть отчет</h1>
      <p>{message}</p>
    </section>
  );
}

function getUnlockWarning(unlock: UnlockIntentResponse["unlock"]): string | undefined {
  return "warning" in unlock ? unlock.warning : undefined;
}

export default App;
