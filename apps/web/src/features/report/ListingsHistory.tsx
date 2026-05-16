import { Images } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { REPORT_COPY } from "./report-copy";
import type { ReportSection } from "./report-types";

export function ListingsHistory({ section }: { section: ReportSection | undefined }) {
  const items = section?.items ?? [];

  return (
    <Card id={section?.id ?? "listings"}>
      <CardContent className="grid gap-4 p-5">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <Images aria-hidden="true" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-normal">История объявлений</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Цена, пробег и город по доступным фиксациям.
            </p>
          </div>
        </div>

        {items.length > 0 ? (
          <div className="grid gap-3">
            {items.map((item, index) => (
              <div
                className="grid min-w-0 gap-3 rounded-md border bg-background p-3 sm:grid-cols-[112px_minmax(0,1fr)]"
                key={`${item.label}:${item.value}:${item.date ?? "no-date"}:${index}`}
              >
                <div className="grid min-h-24 place-items-center rounded-md border border-dashed bg-muted/40 px-3 text-center text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                  фото нет
                </div>
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{item.label}</h3>
                    {item.date && (
                      <time className="shrink-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {formatDate(item.date)}
                      </time>
                    )}
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed bg-background p-4 text-sm text-muted-foreground">
            {REPORT_COPY.noListingsData}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
