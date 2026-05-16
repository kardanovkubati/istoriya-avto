import { Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import type { ReportSection } from "./report-types";
import { toneClasses, toneLabel } from "./report-visual-status";

export function LegalStatusMatrix({ section }: { section: ReportSection | undefined }) {
  const items = section?.items ?? [];

  return (
    <Card id={section?.id ?? "legal_risks"}>
      <CardContent className="grid gap-4 p-5">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <Scale aria-hidden="true" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-normal">Юридические статусы</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Каждый пункт показан как отдельный факт со статусом.
            </p>
          </div>
        </div>

        {items.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((item, index) => {
              const tone = item.tone ?? "default";

              return (
                <div
                  className={`grid min-w-0 gap-3 rounded-md border p-3 ${toneClasses(tone)}`}
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
            Данных по юридическим статусам нет на дату обновления.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
