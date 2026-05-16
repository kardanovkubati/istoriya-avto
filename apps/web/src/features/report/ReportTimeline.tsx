import { Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { REPORT_COPY } from "./report-copy";
import type { ReportSection } from "./report-types";

export function ReportTimeline({ section }: { section: ReportSection | undefined }) {
  const items = section?.items ?? [];

  return (
    <Card id={section?.id ?? "update_history"}>
      <CardContent className="grid gap-4 p-5">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <Activity aria-hidden="true" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-normal">История машины</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              События и обновления, собранные в хронологию.
            </p>
          </div>
        </div>

        {items.length > 0 ? (
          <div className="grid gap-3">
            {items.map((item) => (
              <div
                className="grid gap-2 border-l-4 border-slate-400 bg-muted/40 p-3 sm:grid-cols-[140px_minmax(0,1fr)]"
                key={`${item.label}:${item.value}:${item.date ?? "no-date"}`}
              >
                <time className="text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
                  {item.date ? formatDate(item.date) : item.label}
                </time>
                <div className="grid min-w-0 gap-1">
                  {item.date && (
                    <span className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">{item.label}</span>
                  )}
                  <span className="text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{item.value}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed bg-background p-4 text-sm text-muted-foreground">
            {REPORT_COPY.noTimelineData}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
