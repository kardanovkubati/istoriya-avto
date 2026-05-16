import { ExternalLink } from "lucide-react";
import type { VehicleFullReportResponse } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { ShareState } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { ReportDossier } from "./ReportDossier";
import { ReportSummary } from "./ReportSummary";
import { ReportTimeline } from "./ReportTimeline";
import { MileageChart } from "./MileageChart";
import { LegalStatusMatrix } from "./LegalStatusMatrix";
import { DamageAndRepairSection } from "./DamageAndRepairSection";
import { ListingsHistory } from "./ListingsHistory";
import { ReportBasis } from "./ReportBasis";
import { ReportNavigation } from "./ReportNavigation";
import { sectionById } from "./report-types";

export function FullReportPage({
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
  return (
    <section className="mx-auto grid max-w-7xl gap-6 py-6" aria-labelledby="full-report-title">
      <h1 id="full-report-title" className="sr-only">
        Полный отчет автомобиля
      </h1>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)]">
        <ReportDossier
          data={data}
          mode={mode}
          shareState={shareState}
          onBack={onBack}
          onShare={onShare}
          onDownloadPdf={onDownloadPdf}
        />

        <div className="grid min-w-0 gap-6">
          <ReportSummary data={data} />
          <ReportNavigation presentation={data.presentation} />
          {shareState.status === "ready" && <ShareReadyCard shareState={shareState} />}
          {shareState.status === "error" && <ShareErrorCard message={shareState.message} />}
          <ReportTimeline section={sectionById(data, "update_history")} />
          <MileageChart section={sectionById(data, "mileage")} />
          <div className="grid gap-6 xl:grid-cols-2">
            <LegalStatusMatrix section={sectionById(data, "legal_risks")} />
            <DamageAndRepairSection section={sectionById(data, "accidents_repairs")} />
          </div>
          <ListingsHistory section={sectionById(data, "listings")} />
          <ReportBasis data={data} />
          <ReportFooter data={data} mode={mode} />
        </div>
      </div>
    </section>
  );
}

function ShareReadyCard({ shareState }: { shareState: Extract<ShareState, { status: "ready" }> }) {
  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardContent className="flex gap-3 p-4 text-sm text-blue-950">
        <ExternalLink aria-hidden="true" className="mt-0.5 shrink-0" size={18} />
        <div className="min-w-0">
          <p className="font-semibold [overflow-wrap:anywhere]">{shareState.share.url}</p>
          <small className="[overflow-wrap:anywhere]">
            Действует до {formatDate(shareState.share.expiresAt)}
          </small>
        </div>
      </CardContent>
    </Card>
  );
}

function ShareErrorCard({ message }: { message: string }) {
  return (
    <Card className="border-rose-200 bg-rose-50">
      <CardContent className="p-4 text-sm text-rose-900 [overflow-wrap:anywhere]">{message}</CardContent>
    </Card>
  );
}

function ReportFooter({ data, mode }: { data: VehicleFullReportResponse; mode: "owner" | "share" }) {
  return (
    <footer className="grid gap-1 border-t pt-5 text-sm text-muted-foreground [overflow-wrap:anywhere]">
      <p>{data.presentation.disclaimer}</p>
      <small>{data.presentation.watermark}</small>
      {mode === "share" && data.share && <small>Share действует до {formatDate(data.share.expiresAt)}</small>}
    </footer>
  );
}
