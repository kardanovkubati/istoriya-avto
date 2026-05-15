import type { VehicleFullReportResponse } from "./api";

export const numberFormatter = new Intl.NumberFormat("ru-RU");

export function formatRub(value: number): string {
  return `${numberFormatter.format(value)} ₽`;
}

export function formatKm(value: number): string {
  return `${numberFormatter.format(value)} км`;
}

export function formatGuestExpiry(value: string): string {
  const datePart = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (datePart === null) {
    return value;
  }

  return `${datePart[3]}.${datePart[2]}`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC" }).format(date);
}

export function reportTitle(data: VehicleFullReportResponse): string {
  return [data.report.passport.make, data.report.passport.model, data.report.passport.year]
    .filter((value) => value !== null && value !== undefined)
    .join(" ") || "Автомобиль";
}
