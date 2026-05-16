import { Gauge } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { REPORT_COPY } from "./report-copy";
import type { ReportSection } from "./report-types";

type MileagePoint = {
  cx: number;
  cy: number;
  item: ReportSection["items"][number];
  value: number;
};

export function MileageChart({ section }: { section: ReportSection | undefined }) {
  const items = section?.items ?? [];
  const readings = items
    .map((item) => ({
      item,
      value: Number(item.value.replace(/\D/g, ""))
    }))
    .filter(({ value }) => Number.isFinite(value) && value > 0);
  const max = Math.max(...readings.map(({ value }) => value), 1);
  const points: MileagePoint[] = readings.map(({ item, value }, index) => ({
    item,
    value,
    cx: readings.length === 1 ? 320 : 48 + (index * 544) / (readings.length - 1),
    cy: 196 - (value / max) * 150
  }));
  const polylinePoints = points.map((point) => `${point.cx},${point.cy}`).join(" ");

  return (
    <Card id={section?.id ?? "mileage"}>
      <CardContent className="grid gap-4 p-5">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <Gauge aria-hidden="true" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-normal">Пробег</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Зафиксированные значения по датам из доступных данных.
            </p>
          </div>
        </div>

        {items.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-h-64 rounded-md border bg-background p-4">
              {points.length > 0 ? (
                <svg
                  aria-label={`График пробега: ${points.length} точек`}
                  className="h-full min-h-56 w-full"
                  preserveAspectRatio="none"
                  role="img"
                  viewBox="0 0 640 240"
                >
                  <line x1="48" y1="196" x2="616" y2="196" stroke="#d0d5dd" />
                  <line x1="48" y1="150" x2="616" y2="150" stroke="#eaecf0" />
                  <line x1="48" y1="104" x2="616" y2="104" stroke="#eaecf0" />
                  <line x1="48" y1="58" x2="616" y2="58" stroke="#eaecf0" />
                  <line x1="48" y1="46" x2="48" y2="196" stroke="#d0d5dd" />
                  {points.length > 1 && (
                    <polyline fill="none" points={polylinePoints} stroke="#1f2937" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
                  )}
                  {points.map((point, index) => (
                    <circle
                      cx={point.cx}
                      cy={point.cy}
                      fill={point.item.tone === "warning" ? "#d97706" : "#1f2937"}
                      key={`${point.item.label}:${point.item.value}:${point.item.date ?? "no-date"}:${index}`}
                      r="6"
                    />
                  ))}
                  {points.map((point, index) =>
                    point.item.date ? (
                      <text fill="#667085" fontSize="13" key={`${point.item.date}:label:${index}`} textAnchor="middle" x={point.cx} y="226">
                        {formatDate(point.item.date)}
                      </text>
                    ) : null
                  )}
                </svg>
              ) : (
                <div className="grid h-full min-h-56 place-items-center text-center text-sm text-muted-foreground">
                  {REPORT_COPY.noMileageData}
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-md border">
              {items.map((item, index) => (
                <div className="grid gap-1 border-b p-3 last:border-b-0" key={`${item.label}:${item.value}:${item.date ?? "no-date"}:${index}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">{item.label}</span>
                    {item.date && <time className="shrink-0 text-xs text-muted-foreground">{formatDate(item.date)}</time>}
                  </div>
                  <strong className="text-sm [overflow-wrap:anywhere]">{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed bg-background p-4 text-sm text-muted-foreground">
            {REPORT_COPY.noMileageData}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
