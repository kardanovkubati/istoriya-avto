import { AlertTriangle, ClipboardCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { VehicleFullReportResponse } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { REPORT_COPY } from "./report-copy";
import { toneClasses, toneDotClasses } from "./report-visual-status";

type SummarySignals = VehicleFullReportResponse["presentation"]["summarySignals"];
type SummarySignal = SummarySignals["negativeSignals"][number];
type SummaryFact = SummarySignals["neutralFacts"][number];

export function ReportSummary({ data }: { data: VehicleFullReportResponse }) {
  const summary = data.presentation.summarySignals;

  return (
    <Card className="border-slate-300" id="summary">
      <CardContent className="grid gap-5 p-5 sm:p-6">
        <div className="grid gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <AlertTriangle aria-hidden="true" size={18} />
            <span>Сводка перед осмотром</span>
          </div>
          <h2 className="text-2xl font-black leading-tight tracking-normal">{summary.headline}</h2>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="grid gap-3">
            <h3 className="text-sm font-bold uppercase tracking-normal text-muted-foreground">Сигналы внимания</h3>
            {summary.negativeSignals.length > 0 ? (
              <div className="grid gap-2">
                {summary.negativeSignals.map((signal) => (
                  <SignalCard key={`${signal.label}:${signal.value}`} signal={signal} />
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed bg-background p-3 text-sm text-muted-foreground">
                {REPORT_COPY.noNegativeSignals}
              </div>
            )}
          </div>

          <div className="grid content-start gap-3 rounded-lg border bg-slate-950 p-4 text-white">
            <div className="flex items-center gap-2">
              <ClipboardCheck aria-hidden="true" size={18} />
              <h3 className="font-black tracking-normal">{REPORT_COPY.expertTitle}</h3>
            </div>
            {summary.expertChecks.length > 0 ? (
              <div className="grid gap-2">
                {summary.expertChecks.map((check) => (
                  <div className="rounded-md border border-white/10 bg-white/[0.04] p-3" key={check.label}>
                    <div className="font-semibold [overflow-wrap:anywhere]">{check.label}</div>
                    <p className="mt-1 text-sm leading-6 text-slate-300 [overflow-wrap:anywhere]">{check.reason}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm leading-6 text-slate-300">
                Отдельные экспертные проверки не выделены по доступным данным.
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {summary.neutralFacts.map((fact) => (
            <FactCard key={`${fact.label}:${fact.value}`} fact={fact} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SignalCard({ signal }: { signal: SummarySignal }) {
  return (
    <LinkedSummaryItem className={`grid gap-1 rounded-md border p-3 ${toneClasses(signal.tone)}`} sectionId={signal.sectionId}>
      <div className="flex items-center gap-2 text-sm font-semibold [overflow-wrap:anywhere]">
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${toneDotClasses(signal.tone)}`} />
        <span>{signal.label}</span>
      </div>
      <p className="text-sm leading-6 [overflow-wrap:anywhere]">{signal.value}</p>
    </LinkedSummaryItem>
  );
}

function FactCard({ fact }: { fact: SummaryFact }) {
  return (
    <LinkedSummaryItem className={`rounded-md border p-3 ${toneClasses(fact.tone)}`} sectionId={fact.sectionId}>
      <div className="flex items-center gap-2 text-sm font-semibold [overflow-wrap:anywhere]">
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${toneDotClasses(fact.tone)}`} />
        <span>{fact.label}</span>
      </div>
      <p className="mt-1 text-sm leading-6 [overflow-wrap:anywhere]">{fact.value}</p>
    </LinkedSummaryItem>
  );
}

function LinkedSummaryItem({
  children,
  className,
  sectionId
}: {
  children: ReactNode;
  className: string;
  sectionId: SummarySignal["sectionId"];
}) {
  const interactiveClassName = sectionId
    ? `${className} transition hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
    : className;

  if (!sectionId) {
    return <div className={interactiveClassName}>{children}</div>;
  }

  return (
    <a className={interactiveClassName} href={`#${sectionId}`}>
      {children}
    </a>
  );
}
