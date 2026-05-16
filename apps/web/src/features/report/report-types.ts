import type { ReportPresentation, VehicleFullReportResponse } from "@/lib/api";

export type ReportSection = ReportPresentation["sections"][number];
export type ReportItem = ReportSection["items"][number];
export type ReportMode = "owner" | "share";

export type ReportPageData = VehicleFullReportResponse;

export function sectionById(data: ReportPageData, id: ReportSection["id"]): ReportSection | undefined {
  return data.presentation.sections.find((section) => section.id === id);
}
