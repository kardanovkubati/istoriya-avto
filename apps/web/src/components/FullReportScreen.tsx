import { ChevronLeft, Download, ExternalLink, Share2 } from "lucide-react";
import type { ReportPresentation, VehicleFullReportResponse } from "../lib/api";
import { formatDate, reportTitle } from "../lib/format";
import type { ShareState } from "../types";

export function FullReportScreen({
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
