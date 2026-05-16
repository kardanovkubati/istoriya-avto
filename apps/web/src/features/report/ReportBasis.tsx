import { FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import type { VehicleFullReportResponse } from "@/lib/api";

export function ReportBasis({ data }: { data: VehicleFullReportResponse }) {
  const facts = [
    { label: "Загруженные отчеты", value: String(data.report.summary.sourceUploadCount) },
    {
      label: "Последнее обновление",
      value: data.report.summary.lastUpdatedAt ? formatDate(data.report.summary.lastUpdatedAt) : "дата не указана"
    },
    { label: "Формат", value: "сводная история Истории Авто" }
  ];

  return (
    <Card id="report_basis">
      <CardContent className="grid gap-4 p-5">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <FileText aria-hidden="true" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-normal">Основа сводного отчета</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
              {data.report.summary.historyBasisText}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {facts.map((fact, index) => (
            <div className="grid min-w-0 gap-1 rounded-md border bg-background p-3" key={`${fact.label}:${index}`}>
              <span className="text-xs font-semibold uppercase tracking-normal text-muted-foreground [overflow-wrap:anywhere]">
                {fact.label}
              </span>
              <strong className="text-sm [overflow-wrap:anywhere]">{fact.value}</strong>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
