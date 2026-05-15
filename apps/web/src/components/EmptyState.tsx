import { ReceiptText, Upload } from "lucide-react";
import type { SearchResultResponse } from "../lib/api";

export function EmptyState({ state }: { state: SearchResultResponse["emptyState"] }) {
  return (
    <div className="empty-state">
      <ReceiptText aria-hidden="true" size={24} />
      <div>
        <h3>{state?.title ?? "Отчета пока нет"}</h3>
        <p>{state?.message ?? "Загрузите отчет, и он может дать 1 балл на будущий просмотр."}</p>
      </div>
      <button type="button">
        <Upload aria-hidden="true" size={17} />
        <span>{state?.action.label ?? "Загрузить отчет"}</span>
      </button>
    </div>
  );
}
