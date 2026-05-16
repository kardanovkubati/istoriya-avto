import { Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { REPORT_COPY } from "./report-copy";
import type { ReportSection } from "./report-types";
import { toneClasses, toneLabel } from "./report-visual-status";

export function DamageAndRepairSection({ section }: { section: ReportSection | undefined }) {
  const items = section?.items ?? [];

  return (
    <Card id={section?.id ?? "accidents_repairs"}>
      <CardContent className="grid gap-4 p-5">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <Wrench aria-hidden="true" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-normal">ДТП и ремонт</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              События ремонта и повреждений вынесены отдельно для проверки на осмотре.
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="rounded-md border bg-muted/30 p-4">
            <div aria-hidden="true" className="relative mx-auto h-44 max-w-64">
              <div className="absolute left-8 right-8 top-16 h-14 rounded-[28px] border border-slate-300 bg-white shadow-sm" />
              <div className="absolute left-16 right-16 top-10 h-12 rounded-t-3xl border border-b-0 border-slate-300 bg-slate-100" />
              <div className="absolute left-12 top-24 size-9 rounded-full border-4 border-slate-700 bg-background" />
              <div className="absolute right-12 top-24 size-9 rounded-full border-4 border-slate-700 bg-background" />
              <div className="absolute left-5 top-[84px] h-7 w-8 rounded-l-full border border-slate-300 bg-amber-100" />
              <div className="absolute right-5 top-[84px] h-7 w-8 rounded-r-full border border-slate-300 bg-rose-100" />
              <div className="absolute left-16 right-16 top-[124px] h-px bg-slate-300" />
              <div className="absolute left-1/2 top-7 h-30 w-px -translate-x-1/2 bg-slate-200" />
            </div>
          </div>

          {items.length > 0 ? (
            <div className="grid gap-3">
              {items.map((item, index) => {
                const tone = item.tone ?? "default";

                return (
                  <div
                    className={`grid min-w-0 gap-2 rounded-md border p-3 ${toneClasses(tone)}`}
                    key={`${item.label}:${item.value}:${item.date ?? "no-date"}:${index}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{item.label}</h3>
                      <Badge className="shrink-0 bg-white/70 text-current" variant="outline">
                        {toneLabel(tone)}
                      </Badge>
                    </div>
                    <p className="text-sm leading-6 [overflow-wrap:anywhere]">{item.value}</p>
                    {item.date && (
                      <time className="text-xs text-current/70 [overflow-wrap:anywhere]">{formatDate(item.date)}</time>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed bg-background p-4 text-sm text-muted-foreground">
              {REPORT_COPY.noDamageData}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
