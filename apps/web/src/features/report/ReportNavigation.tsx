import { ListChecks } from "lucide-react";
import type { ReportPresentation } from "@/lib/api";
import { buildReportNavigation } from "./report-navigation";

export function ReportNavigation({ presentation }: { presentation: ReportPresentation }) {
  const groups = buildReportNavigation(presentation.sections);

  return (
    <nav
      aria-label="Навигация по полному отчету"
      className="grid gap-3 rounded-lg border border-slate-300 bg-white p-4 shadow-sm"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <ListChecks aria-hidden="true" size={18} />
        <span>Разделы отчета</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {groups.map((group) => (
          <div className="grid content-start gap-2" key={group.label}>
            <h2 className="text-xs font-bold uppercase tracking-normal text-muted-foreground">{group.label}</h2>
            <div className="flex flex-wrap gap-2">
              {group.items.map((item) => (
                <a
                  className="rounded-md border bg-background px-3 py-2 text-sm font-semibold transition hover:border-slate-400 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  href={`#${item.id}`}
                  key={item.id}
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}
