import type { ReportPresentation } from "@/lib/api";

export type ReportTone = NonNullable<ReportPresentation["sections"][number]["items"][number]["tone"]>;

export function toneLabel(tone: ReportTone): string {
  if (tone === "good") return "не найдено";
  if (tone === "warning") return "проверить";
  if (tone === "danger") return "найдено";
  return "факт";
}

export function toneClasses(tone: ReportTone): string {
  if (tone === "good") return "border-emerald-200 bg-emerald-50 text-emerald-950";
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-950";
  if (tone === "danger") return "border-rose-200 bg-rose-50 text-rose-950";
  return "border-slate-200 bg-white text-slate-950";
}

export function toneDotClasses(tone: ReportTone): string {
  if (tone === "good") return "bg-emerald-500";
  if (tone === "warning") return "bg-amber-500";
  if (tone === "danger") return "bg-rose-500";
  return "bg-slate-400";
}
