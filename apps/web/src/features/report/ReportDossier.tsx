import { CameraOff, ChevronLeft, Download, Share2 } from "lucide-react";
import type { VehicleFullReportResponse } from "@/lib/api";
import { formatDate, reportTitle } from "@/lib/format";
import type { ShareState } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { REPORT_COPY } from "./report-copy";

export function ReportDossier({
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
  const reportDate = data.report.summary.lastUpdatedAt ?? data.report.generatedAt;

  return (
    <aside className="grid gap-4 lg:sticky lg:top-6 lg:self-start">
      <Card className="overflow-hidden border-slate-300 bg-slate-950 text-white">
        <div className="grid min-h-72 place-items-center bg-slate-900 p-6">
          <div className="grid max-w-72 justify-items-center gap-3 text-center">
            <div className="grid size-14 place-items-center rounded-full bg-white/10">
              <CameraOff aria-hidden="true" size={26} />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-normal">{REPORT_COPY.noPhotoTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">{REPORT_COPY.noPhotoBody}</p>
            </div>
          </div>
        </div>
        <CardContent className="grid gap-4 p-5">
          <div>
            <Badge className="mb-3" variant="secondary">
              {mode === "share" ? "Share-отчет" : REPORT_COPY.accessForever}
            </Badge>
            <h1 className="text-2xl font-black leading-tight tracking-normal">{reportTitle(data)}</h1>
            <p className="mt-2 text-sm text-slate-300">Обновлено: {formatDate(reportDate)}</p>
          </div>
          <div className="grid gap-2 text-sm">
            <DossierRow label="VIN" value={data.report.vin} />
            <DossierRow label="Кузов" value={data.report.passport.bodyType} />
            <DossierRow label="Цвет" value={data.report.passport.color} />
            <DossierRow label="Двигатель" value={data.report.passport.engine} />
            <DossierRow label="КПП" value={data.report.passport.transmission} />
            <DossierRow label="Привод" value={data.report.passport.driveType} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <Button type="button" variant="secondary" onClick={onBack}>
              <ChevronLeft aria-hidden="true" />
              <span>{mode === "share" ? "На главную" : "К поиску"}</span>
            </Button>
            {data.presentation.actions.canShare && (
              <Button
                type="button"
                variant="outline"
                onClick={onShare}
                disabled={shareState.status === "creating"}
                className="border-white/20 bg-white/10 text-white hover:bg-white/15"
              >
                <Share2 aria-hidden="true" />
                <span>{shareState.status === "creating" ? "Создаем" : "Поделиться"}</span>
              </Button>
            )}
            {data.presentation.actions.canDownloadPdf && (
              <Button type="button" onClick={onDownloadPdf}>
                <Download aria-hidden="true" />
                <span>Скачать PDF</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </aside>
  );
}

function DossierRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;

  return (
    <div className="flex items-start justify-between gap-3 border-t border-white/10 pt-2 first:border-t-0 first:pt-0">
      <span className="text-slate-400">{label}</span>
      <strong className="min-w-0 text-right font-semibold text-white">{value}</strong>
    </div>
  );
}
