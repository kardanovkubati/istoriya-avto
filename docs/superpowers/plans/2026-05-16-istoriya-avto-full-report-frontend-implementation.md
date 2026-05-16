# Full Report Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перестроить полный сводный отчет Истории Авто под утвержденный дизайн: "история машины" с dossier-профилем, негативными сигналами, экспертным взглядом, timeline, графиком пробега и нейтральной подачей фактов.

**Architecture:** Сначала расширяем API presentation model так, чтобы frontend не вычислял смысловые блоки из разрозненных секций. Затем выносим report UI из `components/FullReportScreen.tsx` в `features/report/*`, оставляя `App.tsx` только уровнем маршрутизации/композиции. Визуализация строится на Tailwind + текущих shadcn-like primitives, без случайных stock-заглушек: если фото нет в данных, показываем честное no-photo состояние.

**Tech Stack:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui-style primitives, lucide-react, Bun, существующий API на Hono/TypeScript, `bun:test`.

---

## Входные документы

- `docs/product_brief.md`
- `docs/superpowers/specs/2026-05-16-istoriya-avto-full-report-frontend-design.md`
- `docs/superpowers/plans/2026-05-15-istoriya-avto-frontend-design-system-reset.md`
- `AGENTS.md`

## Scope

В этом плане делаем только полный отчет, share view и связанные frontend/report presentation contracts.

Не делаем:

- редизайн первого экрана поиска;
- OCR, Drom parser, Auto.ru parser;
- загрузку реальных фотографий из внешних источников;
- копирование структуры, текстов, цветов, иконок или фирменных решений Автотеки;
- новые платежные или auth-сценарии;
- раскрытие full report без access service.

## Материалы и ограничения

Backend на момент планирования не отдает реальные фотографии автомобиля в full report: `VehiclePreviewReadModel.photo` равен `null`, а `VehicleFullReportReadModel` вообще не содержит photo/gallery. Поэтому первая реализация должна:

- показывать честное no-photo состояние в dossier;
- не использовать случайные stock-фото в отчете;
- пометить визуальную галерею как готовую к данным, но не выдумывать фото;
- запросить у владельца продукта реальные/разрешенные фото перед финальным demo с фотографиями.

Если перед execution пользователь предоставит разрешенные изображения и правила их использования, добавить отдельную задачу на demo assets. Без этого задача с фото считается no-photo MVP.

## Целевая структура файлов

### Backend

- Modify: `apps/api/src/modules/reports/report-presentation.ts`
  - Добавить поля верхнего summary: негативные сигналы, экспертные проверки, нейтральные факты.
  - Сохранить source-brand leak guard.
- Modify: `apps/api/src/modules/reports/report-presentation.test.ts`
  - Tests-first покрыть новую presentation model, запрет оценочных слов и share actions.
- Modify: `apps/web/src/lib/api.ts`
  - Синхронизировать TypeScript contracts с backend presentation.

### Frontend report feature

- Create: `apps/web/src/features/report/report-types.ts`
  - Локальные derived types и helpers для report feature.
- Create: `apps/web/src/features/report/report-copy.ts`
  - Утвержденные формулировки без оценочного языка.
- Create: `apps/web/src/features/report/report-visual-status.ts`
  - Mapping tone/status -> CSS, label, semantic intent.
- Create: `apps/web/src/features/report/FullReportPage.tsx`
  - Entry point owner/share report page.
- Create: `apps/web/src/features/report/ReportDossier.tsx`
  - Фото/no-photo, паспорт, доступ, actions.
- Create: `apps/web/src/features/report/ReportSummary.tsx`
  - Негативные сигналы, экспертный взгляд, нейтральные факты.
- Create: `apps/web/src/features/report/ReportTimeline.tsx`
  - Timeline истории машины.
- Create: `apps/web/src/features/report/MileageChart.tsx`
  - SVG-график пробега с accessible summary.
- Create: `apps/web/src/features/report/LegalStatusMatrix.tsx`
  - Матрица юридических статусов.
- Create: `apps/web/src/features/report/DamageAndRepairSection.tsx`
  - Визуальная секция ДТП/ремонта.
- Create: `apps/web/src/features/report/ListingsHistory.tsx`
  - Лента объявлений.
- Create: `apps/web/src/features/report/ReportBasis.tsx`
  - Основа сводного отчета.
- Modify: `apps/web/src/components/FullReportScreen.tsx`
  - Заменить на тонкий compatibility wrapper или удалить после перевода imports.
- Modify: `apps/web/src/App.tsx`
  - Импортировать `FullReportPage` из feature module.

### Verification assets

- Use existing browser plugin for screenshots.
- Save screenshots under `.local/screenshots/` only. Do not commit screenshots.

## Task 1: Backend presentation contract for report summary

**Files:**
- Modify: `apps/api/src/modules/reports/report-presentation.test.ts`
- Modify: `apps/api/src/modules/reports/report-presentation.ts`
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Write failing tests for negative-first summary**

Add tests to `apps/api/src/modules/reports/report-presentation.test.ts`:

```ts
it("builds negative-first summary without purchase recommendations", () => {
  const presentation = buildReportPresentation({
    report: fullReport({
      accidentsAndRepairs: {
        accidents: { status: "found", checkedAt: "2026-05-01T00:00:00.000Z" },
        repairCalculations: { status: "found", checkedAt: "2026-05-01T00:00:00.000Z" }
      },
      mileage: {
        readings: [
          { observedAt: "2026-01-01T00:00:00.000Z", mileageKm: 120000, context: "listing" },
          { observedAt: "2026-04-01T00:00:00.000Z", mileageKm: 98000, context: "report" }
        ],
        hasRollbackSignals: true
      }
    }),
    mode: "owner"
  });

  expect(presentation.summarySignals.headline).toBe("Найдены сигналы, которые стоит проверить перед осмотром");
  expect(presentation.summarySignals.negativeSignals.map((signal) => signal.label)).toEqual([
    "ДТП",
    "Расчеты ремонта",
    "Пробег"
  ]);
  expect(presentation.summarySignals.expertChecks.map((check) => check.label)).toEqual([
    "Кузов",
    "Пробег"
  ]);
  expect(JSON.stringify(presentation)).not.toMatch(/можно брать|рекомендуем|хорошо|чисто|машина нормальная|прозрачн/i);
});

it("keeps neutral facts factual when risks are not found", () => {
  const presentation = buildReportPresentation({ report: fullReport(), mode: "owner" });

  expect(presentation.summarySignals.neutralFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Ограничения", value: "не найдены", tone: "good" }),
        expect.objectContaining({ label: "Залог", value: "не найден", tone: "good" }),
        expect.objectContaining({ label: "Розыск", value: "не найден", tone: "good" }),
        expect.objectContaining({ label: "Объявления", value: "1 запись", tone: "default" })
      ])
  );
  expect(presentation.summarySignals.negativeSignals).toEqual([]);
  expect(JSON.stringify(presentation)).not.toMatch(/хорошо|чисто|прозрачн/i);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
bun run --cwd apps/api test src/modules/reports/report-presentation.test.ts
```

Expected: FAIL because `presentation.summarySignals` does not exist.

- [ ] **Step 3: Implement presentation types and builder**

Modify `apps/api/src/modules/reports/report-presentation.ts`:

```ts
export type ReportSummarySignal = {
  label: string;
  value: string;
  tone: "default" | "good" | "warning" | "danger";
  sectionId?: ReportSectionId;
};

export type ReportExpertCheck = {
  label: "Кузов" | "Пробег" | "Документы" | "Юридические статусы";
  reason: string;
};

export type ReportSummarySignals = {
  headline: string;
  negativeSignals: ReportSummarySignal[];
  expertChecks: ReportExpertCheck[];
  neutralFacts: ReportSummarySignal[];
};

export type ReportPresentation = {
  generatedAt: string;
  noindex: true;
  disclaimer: string;
  watermark: string;
  actions: { canShare: boolean; canDownloadPdf: boolean };
  summarySignals: ReportSummarySignals;
  sections: ReportPresentationSection[];
};
```

Inside `buildReportPresentation`, add:

```ts
summarySignals: buildSummarySignals(input.report),
```

Add helper functions:

```ts
function buildSummarySignals(report: VehicleFullReportReadModel): ReportSummarySignals {
  const negativeSignals: ReportSummarySignal[] = [
    riskSignal("ДТП", report.accidentsAndRepairs.accidents, "accidents_repairs"),
    riskSignal("Расчеты ремонта", report.accidentsAndRepairs.repairCalculations, "accidents_repairs"),
    riskSignal("Ограничения", report.legalRisks.restrictions, "legal_risks"),
    riskSignal("Залог", report.legalRisks.pledge, "legal_risks"),
    riskSignal("Розыск", report.legalRisks.wanted, "legal_risks"),
    report.mileage.hasRollbackSignals
      ? { label: "Пробег", value: "есть расхождение", tone: "warning" as const, sectionId: "mileage" as const }
      : null,
    ...report.conflicts
      .filter((conflict) => conflict.severity === "critical")
      .map((conflict) => ({
        label: "Расхождение данных",
        value: conflict.message,
        tone: "danger" as const,
        sectionId: "data_quality" as const
      }))
  ].filter((signal): signal is ReportSummarySignal => signal !== null);

  const neutralFacts: ReportSummarySignal[] = [
    neutralRiskFact("Ограничения", report.legalRisks.restrictions, "legal_risks", "не найдены"),
    neutralRiskFact("Залог", report.legalRisks.pledge, "legal_risks", "не найден"),
    neutralRiskFact("Розыск", report.legalRisks.wanted, "legal_risks", "не найден"),
    report.listings.length > 0
      ? {
          label: "Объявления",
          value: pluralize(report.listings.length, "запись", "записи", "записей"),
          tone: "default" as const,
          sectionId: "listings" as const
        }
      : null,
    report.mileage.readings.length > 0
      ? {
          label: "Пробег",
          value: `зафиксирован в ${pluralize(report.mileage.readings.length, "точке", "точках", "точках")}`,
          tone: report.mileage.hasRollbackSignals ? "warning" as const : "default" as const,
          sectionId: "mileage" as const
        }
      : null,
    report.summary.freshnessWarning === null
      ? {
          label: "Обновление",
          value: report.summary.lastUpdatedAt === null ? "дата не указана" : formatDate(report.summary.lastUpdatedAt),
          tone: "default" as const,
          sectionId: "update_history" as const
        }
      : {
          label: "Актуальность",
          value: report.summary.freshnessWarning,
          tone: "warning" as const,
          sectionId: "update_history" as const
        }
  ].filter((signal): signal is ReportSummarySignal => signal !== null);

  return {
    headline:
      negativeSignals.length > 0
        ? "Найдены сигналы, которые стоит проверить перед осмотром"
        : "Сводная история собрана по доступным данным",
    negativeSignals,
    expertChecks: expertChecksFor(negativeSignals),
    neutralFacts
  };
}

function riskSignal(
  label: string,
  risk: ReportRiskFact,
  sectionId: ReportSectionId
): ReportSummarySignal | null {
  if (risk.status !== "found") return null;
  return { label, value: "найдено", tone: "danger", sectionId };
}

function neutralRiskFact(
  label: string,
  risk: ReportRiskFact,
  sectionId: ReportSectionId,
  value: string
): ReportSummarySignal | null {
  if (risk.status !== "not_found") return null;
  return { label, value, tone: "good", sectionId };
}

function expertChecksFor(signals: ReportSummarySignal[]): ReportExpertCheck[] {
  const checks = new Map<ReportExpertCheck["label"], string>();

  for (const signal of signals) {
    if (signal.sectionId === "accidents_repairs") {
      checks.set("Кузов", "Проверить следы ремонта, окрасы и геометрию кузова.");
    }
    if (signal.sectionId === "mileage") {
      checks.set("Пробег", "Сверить пробег с диагностикой, сервисными записями и состоянием салона.");
    }
    if (signal.sectionId === "legal_risks") {
      checks.set("Юридические статусы", "Проверить актуальные ограничения и документы перед сделкой.");
    }
    if (signal.sectionId === "data_quality") {
      checks.set("Документы", "Сверить VIN, ПТС и факты из разных документов.");
    }
  }

  return Array.from(checks, ([label, reason]) => ({ label, reason }));
}

function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${formatNumber(count)} ${word}`;
}
```

Also update `summarySection()` so presentation/PDF no longer expose the old "Оценка прозрачности" copy:

```ts
function summarySection(report: VehicleFullReportReadModel): ReportPresentationSection {
  return ready("summary", "Сводка", true, [
    { label: "Основа истории", value: report.summary.historyBasisText },
    ...(
      report.summary.freshnessWarning === null
        ? []
        : [
            {
              label: "Актуальность",
              value: report.summary.freshnessWarning,
              tone: "warning" as const
            }
          ]
    )
  ]);
}
```

- [ ] **Step 4: Update frontend API contract**

Modify `apps/web/src/lib/api.ts` by extracting `ReportSectionId` and updating `ReportPresentation`:

```ts
export type ReportSectionId =
  | "summary"
  | "passport"
  | "legal_risks"
  | "accidents_repairs"
  | "mileage"
  | "owners_registrations"
  | "listings"
  | "commercial_use"
  | "maintenance"
  | "data_quality"
  | "update_history";

export type ReportPresentation = {
  generatedAt: string;
  noindex: true;
  disclaimer: string;
  watermark: string;
  actions: { canShare: boolean; canDownloadPdf: boolean };
  summarySignals: {
    headline: string;
    negativeSignals: Array<{
      label: string;
      value: string;
      tone: "default" | "good" | "warning" | "danger";
      sectionId?: ReportSectionId;
    }>;
    expertChecks: Array<{
      label: "Кузов" | "Пробег" | "Документы" | "Юридические статусы";
      reason: string;
    }>;
    neutralFacts: Array<{
      label: string;
      value: string;
      tone: "default" | "good" | "warning" | "danger";
      sectionId?: ReportSectionId;
    }>;
  };
  sections: Array<{
    id: ReportSectionId;
    title: string;
    critical: boolean;
    state: "ready" | "empty";
    emptyText?: "данных не найдено на дату обновления";
    items: Array<{
      label: string;
      value: string;
      tone?: "default" | "good" | "warning" | "danger";
      date?: string | null;
    }>;
  }>;
};
```

- [ ] **Step 5: Run targeted checks**

Run:

```bash
bun run --cwd apps/api test src/modules/reports/report-presentation.test.ts
bun run --cwd apps/web typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/reports/report-presentation.ts apps/api/src/modules/reports/report-presentation.test.ts apps/web/src/lib/api.ts
git commit -m "feat: add report summary presentation signals"
```

## Task 2: Report feature scaffolding and visual status helpers

**Files:**
- Create: `apps/web/src/features/report/report-visual-status.ts`
- Create: `apps/web/src/features/report/report-copy.ts`
- Create: `apps/web/src/features/report/report-types.ts`

- [ ] **Step 1: Create visual status helper**

Create `apps/web/src/features/report/report-visual-status.ts`:

```ts
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
```

- [ ] **Step 2: Create approved copy constants**

Create `apps/web/src/features/report/report-copy.ts`:

```ts
export const REPORT_COPY = {
  noPhotoTitle: "Фото автомобиля нет в сводной истории",
  noPhotoBody: "Когда в данных появятся фотографии объявлений или отчетов, они будут показаны здесь.",
  expertTitle: "Нужен взгляд эксперта",
  noNegativeSignals: "Негативные сигналы не выделены в доступных данных.",
  noMileageData: "Данных о пробеге нет на дату обновления.",
  noListingsData: "История объявлений не найдена в доступных данных.",
  noDamageData: "Данных о ДТП и ремонте нет на дату обновления.",
  noTimelineData: "История обновлений пока не содержит событий.",
  accessForever: "Открыт навсегда по VIN"
} as const;

export const FORBIDDEN_REPORT_COPY = [
  "хорошо",
  "отлично",
  "чисто",
  "можно брать",
  "машина нормальная",
  "рекомендуем",
  "прозрачность"
] as const;
```

- [ ] **Step 3: Create report feature types**

Create `apps/web/src/features/report/report-types.ts`:

```ts
import type { ReportPresentation, VehicleFullReportResponse } from "@/lib/api";

export type ReportSection = ReportPresentation["sections"][number];
export type ReportItem = ReportSection["items"][number];
export type ReportMode = "owner" | "share";

export type ReportPageData = VehicleFullReportResponse;

export function sectionById(data: ReportPageData, id: ReportSection["id"]): ReportSection | undefined {
  return data.presentation.sections.find((section) => section.id === id);
}
```

- [ ] **Step 4: Run web typecheck**

Run:

```bash
bun run --cwd apps/web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/report
git commit -m "chore: add report feature helpers"
```

## Task 3: Dossier profile

**Files:**
- Create: `apps/web/src/features/report/ReportDossier.tsx`
- Modify later consumer in Task 7.

- [ ] **Step 1: Create ReportDossier component**

Create `apps/web/src/features/report/ReportDossier.tsx`:

```tsx
import { CameraOff, ChevronLeft, Download, Share2 } from "lucide-react";
import type { VehicleFullReportResponse } from "@/lib/api";
import { formatDate, reportTitle } from "@/lib/format";
import type { ShareState } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { REPORT_COPY } from "./report-copy";

export function ReportDossier({
  data,
  mode,
  shareState,
  onBack,
  onShare,
  onDownloadPdf
}: {
  data: VehicleFullReportResponse;
  mode: "owner" | "share";
  shareState: ShareState;
  onBack: () => void;
  onShare: () => void;
  onDownloadPdf: () => void;
}) {
  const reportDate = data.report.summary.lastUpdatedAt ?? data.report.generatedAt;

  return (
    <aside className="grid gap-4 lg:sticky lg:top-6 lg:self-start">
      <Card className="overflow-hidden border-slate-300 bg-slate-950 text-white">
        <div className="grid min-h-72 place-items-center bg-slate-900 p-6">
          <div className="grid max-w-72 justify-items-center gap-3 text-center">
            <div className="grid size-14 place-items-center rounded-full bg-white/10">
              <CameraOff aria-hidden="true" size={26} />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-normal">{REPORT_COPY.noPhotoTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">{REPORT_COPY.noPhotoBody}</p>
            </div>
          </div>
        </div>
        <CardContent className="grid gap-4 p-5">
          <div>
            <Badge className="mb-3" variant="secondary">
              {mode === "share" ? "Share-отчет" : REPORT_COPY.accessForever}
            </Badge>
            <h1 className="text-2xl font-black leading-tight tracking-normal">{reportTitle(data)}</h1>
            <p className="mt-2 text-sm text-slate-300">Обновлено: {formatDate(reportDate)}</p>
          </div>
          <div className="grid gap-2 text-sm">
            <DossierRow label="VIN" value={data.report.vin} />
            <DossierRow label="Кузов" value={data.report.passport.bodyType} />
            <DossierRow label="Цвет" value={data.report.passport.color} />
            <DossierRow label="Двигатель" value={data.report.passport.engine} />
            <DossierRow label="КПП" value={data.report.passport.transmission} />
            <DossierRow label="Привод" value={data.report.passport.driveType} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <Button type="button" variant="secondary" onClick={onBack}>
              <ChevronLeft aria-hidden="true" />
              <span>{mode === "share" ? "На главную" : "К поиску"}</span>
            </Button>
            {data.presentation.actions.canShare && (
              <Button type="button" variant="outline" onClick={onShare} disabled={shareState.status === "creating"} className="border-white/20 bg-white/10 text-white hover:bg-white/15">
                <Share2 aria-hidden="true" />
                <span>{shareState.status === "creating" ? "Создаем" : "Поделиться"}</span>
              </Button>
            )}
            {data.presentation.actions.canDownloadPdf && (
              <Button type="button" onClick={onDownloadPdf}>
                <Download aria-hidden="true" />
                <span>Скачать PDF</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </aside>
  );
}

function DossierRow({ label, value }: { label: string; value: string | number | null }) {
  if (value === null || value === "") return null;

  return (
    <div className="flex items-start justify-between gap-3 border-t border-white/10 pt-2 first:border-t-0 first:pt-0">
      <span className="text-slate-400">{label}</span>
      <strong className="min-w-0 text-right font-semibold text-white">{value}</strong>
    </div>
  );
}
```

- [ ] **Step 2: Run web typecheck**

Run:

```bash
bun run --cwd apps/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/report/ReportDossier.tsx
git commit -m "feat: add report dossier profile"
```

## Task 4: Negative-first summary

**Files:**
- Create: `apps/web/src/features/report/ReportSummary.tsx`

- [ ] **Step 1: Create ReportSummary component**

Create `apps/web/src/features/report/ReportSummary.tsx`:

```tsx
import { AlertTriangle, ClipboardCheck } from "lucide-react";
import type { VehicleFullReportResponse } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { REPORT_COPY } from "./report-copy";
import { toneClasses, toneDotClasses } from "./report-visual-status";

export function ReportSummary({ data }: { data: VehicleFullReportResponse }) {
  const summary = data.presentation.summarySignals;

  return (
    <Card className="border-slate-300">
      <CardContent className="grid gap-5 p-5 sm:p-6">
        <div className="grid gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <AlertTriangle aria-hidden="true" size={18} />
            <span>Сводка перед осмотром</span>
          </div>
          <h2 className="text-2xl font-black leading-tight tracking-normal">{summary.headline}</h2>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="grid gap-3">
            <h3 className="text-sm font-bold uppercase tracking-normal text-muted-foreground">Сигналы внимания</h3>
            {summary.negativeSignals.length > 0 ? (
              <div className="grid gap-2">
                {summary.negativeSignals.map((signal) => (
                  <a className={`grid gap-1 rounded-md border p-3 ${toneClasses(signal.tone)}`} href={signal.sectionId ? `#${signal.sectionId}` : undefined} key={`${signal.label}:${signal.value}`}>
                    <span className="flex items-center gap-2 text-sm font-bold">
                      <span className={`size-2 rounded-full ${toneDotClasses(signal.tone)}`} />
                      {signal.label}
                    </span>
                    <span className="text-sm">{signal.value}</span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed bg-background p-3 text-sm text-muted-foreground">{REPORT_COPY.noNegativeSignals}</div>
            )}
          </div>

          <div className="grid content-start gap-3 rounded-lg border bg-slate-950 p-4 text-white">
            <div className="flex items-center gap-2">
              <ClipboardCheck aria-hidden="true" size={18} />
              <h3 className="font-black tracking-normal">{REPORT_COPY.expertTitle}</h3>
            </div>
            {summary.expertChecks.length > 0 ? (
              <div className="grid gap-2">
                {summary.expertChecks.map((check) => (
                  <div className="rounded-md border border-white/10 bg-white/[0.04] p-3" key={check.label}>
                    <div className="font-semibold">{check.label}</div>
                    <p className="mt-1 text-sm leading-6 text-slate-300">{check.reason}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm leading-6 text-slate-300">Отдельные экспертные проверки не выделены по доступным данным.</p>
            )}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {summary.neutralFacts.map((fact) => (
            <a className={`rounded-md border p-3 ${toneClasses(fact.tone)}`} href={fact.sectionId ? `#${fact.sectionId}` : undefined} key={`${fact.label}:${fact.value}`}>
              <div className="text-xs text-muted-foreground">{fact.label}</div>
              <div className="mt-1 text-sm font-bold">{fact.value}</div>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Run web typecheck**

Run:

```bash
bun run --cwd apps/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/report/ReportSummary.tsx
git commit -m "feat: add negative-first report summary"
```

## Task 5: Timeline and mileage visualization

**Files:**
- Create: `apps/web/src/features/report/ReportTimeline.tsx`
- Create: `apps/web/src/features/report/MileageChart.tsx`

- [ ] **Step 1: Create ReportTimeline**

Create `apps/web/src/features/report/ReportTimeline.tsx`:

```tsx
import { Activity } from "lucide-react";
import { formatDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { REPORT_COPY } from "./report-copy";
import type { ReportSection } from "./report-types";

export function ReportTimeline({ section }: { section: ReportSection | undefined }) {
  const items = section?.items ?? [];

  return (
    <Card id={section?.id ?? "update_history"}>
      <CardContent className="grid gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md bg-slate-900 text-white">
            <Activity aria-hidden="true" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-normal">История машины</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">События и обновления, собранные в хронологию.</p>
          </div>
        </div>

        {items.length > 0 ? (
          <div className="grid gap-3">
            {items.map((item) => (
              <div className="grid gap-2 border-l-4 border-slate-900 bg-slate-50 p-3 sm:grid-cols-[150px_1fr]" key={`${item.label}:${item.value}:${item.date ?? ""}`}>
                <strong className="text-sm">{item.date ? formatDate(item.date) : item.label}</strong>
                <div>
                  <div className="text-sm font-semibold">{item.label}</div>
                  <div className="text-sm text-muted-foreground">{item.value}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed bg-background p-4 text-sm text-muted-foreground">{REPORT_COPY.noTimelineData}</div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create MileageChart**

Create `apps/web/src/features/report/MileageChart.tsx`:

```tsx
import { Gauge } from "lucide-react";
import { formatDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { REPORT_COPY } from "./report-copy";
import type { ReportSection } from "./report-types";

export function MileageChart({ section }: { section: ReportSection | undefined }) {
  const items = section?.items ?? [];
  const values = items
    .map((item) => ({
      label: item.date ? formatDate(item.date) : item.label,
      value: Number(item.value.replace(/\D/g, "")),
      tone: item.tone ?? "default"
    }))
    .filter((item) => Number.isFinite(item.value) && item.value > 0);
  const max = Math.max(...values.map((item) => item.value), 1);
  const points = values.map((item, index) => {
    const x = values.length === 1 ? 320 : 48 + (index * 544) / (values.length - 1);
    const y = 196 - (item.value / max) * 150;
    return { ...item, x, y };
  });

  return (
    <Card id={section?.id ?? "mileage"}>
      <CardContent className="grid gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md bg-slate-900 text-white">
            <Gauge aria-hidden="true" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-normal">Пробег</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Динамика значений по датам фиксации.</p>
          </div>
        </div>

        {points.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="h-72 rounded-md border bg-background p-4">
              <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 640 240" role="img" aria-label={`График пробега: ${values.length} точек`}>
                <line x1="48" y1="196" x2="616" y2="196" stroke="#d0d5dd" />
                <line x1="48" y1="150" x2="616" y2="150" stroke="#eaecf0" />
                <line x1="48" y1="104" x2="616" y2="104" stroke="#eaecf0" />
                <line x1="48" y1="58" x2="616" y2="58" stroke="#eaecf0" />
                <polyline fill="none" points={points.map((point) => `${point.x},${point.y}`).join(" ")} stroke="#111827" strokeWidth="4" />
                {points.map((point) => (
                  <circle cx={point.x} cy={point.y} fill={point.tone === "warning" ? "#f59e0b" : "#111827"} key={`${point.label}:${point.value}`} r="6" />
                ))}
              </svg>
            </div>
            <div className="overflow-hidden rounded-md border">
              {items.map((item) => (
                <div className="grid gap-1 border-b p-3 text-sm last:border-b-0" key={`${item.label}:${item.value}`}>
                  <span className="text-muted-foreground">{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed bg-background p-4 text-sm text-muted-foreground">{REPORT_COPY.noMileageData}</div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Run web typecheck**

Run:

```bash
bun run --cwd apps/web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/report/ReportTimeline.tsx apps/web/src/features/report/MileageChart.tsx
git commit -m "feat: add report timeline and mileage chart"
```

## Task 6: Status matrix, damage/repair, listings, and basis sections

**Files:**
- Create: `apps/web/src/features/report/LegalStatusMatrix.tsx`
- Create: `apps/web/src/features/report/DamageAndRepairSection.tsx`
- Create: `apps/web/src/features/report/ListingsHistory.tsx`
- Create: `apps/web/src/features/report/ReportBasis.tsx`

- [ ] **Step 1: Create LegalStatusMatrix**

Create `apps/web/src/features/report/LegalStatusMatrix.tsx`:

```tsx
import { Scale } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import type { ReportSection } from "./report-types";
import { toneClasses, toneLabel } from "./report-visual-status";

export function LegalStatusMatrix({ section }: { section: ReportSection | undefined }) {
  const items = section?.items ?? [];

  return (
    <Card id={section?.id ?? "legal_risks"}>
      <CardContent className="grid gap-4 p-5">
        <SectionHeader icon={Scale} title="Юридические статусы" subtitle="Каждый пункт показан как отдельный факт со статусом." />
        <div className="grid gap-2 sm:grid-cols-2">
          {items.length > 0 ? items.map((item) => (
            <div className={`grid gap-2 rounded-md border p-3 ${toneClasses(item.tone ?? "default")}`} key={`${item.label}:${item.value}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{item.label}</span>
                <Badge variant="outline">{toneLabel(item.tone ?? "default")}</Badge>
              </div>
              <div className="text-sm">{item.value}</div>
              {item.date && <small className="text-muted-foreground">Проверено: {formatDate(item.date)}</small>}
            </div>
          )) : (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Данных по юридическим статусам нет на дату обновления.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }: { icon: typeof Scale; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid size-10 shrink-0 place-items-center rounded-md bg-slate-900 text-white">
        <Icon aria-hidden="true" size={20} />
      </div>
      <div>
        <h2 className="text-xl font-black tracking-normal">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create DamageAndRepairSection**

Create `apps/web/src/features/report/DamageAndRepairSection.tsx`:

```tsx
import { FileWarning } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { REPORT_COPY } from "./report-copy";
import type { ReportSection } from "./report-types";
import { toneClasses } from "./report-visual-status";

export function DamageAndRepairSection({ section }: { section: ReportSection | undefined }) {
  const items = section?.items ?? [];

  return (
    <Card id={section?.id ?? "accidents_repairs"}>
      <CardContent className="grid gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md bg-slate-900 text-white">
            <FileWarning aria-hidden="true" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-normal">ДТП и ремонт</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">События ремонта и повреждений вынесены отдельно для проверки на осмотре.</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
          <div className="grid min-h-48 place-items-center rounded-md border bg-slate-50">
            <div className="relative h-36 w-24 rounded-[32px] border-2 border-slate-400 bg-white shadow-inner">
              <span className="absolute left-1/2 top-4 h-10 w-16 -translate-x-1/2 rounded border border-amber-500 bg-amber-100" />
              <span className="absolute bottom-5 left-1/2 h-5 w-16 -translate-x-1/2 rounded border border-slate-300 bg-slate-100" />
            </div>
          </div>
          {items.length > 0 ? (
            <div className="grid gap-2">
              {items.map((item) => (
                <div className={`rounded-md border p-3 ${toneClasses(item.tone ?? "default")}`} key={`${item.label}:${item.value}`}>
                  <div className="font-semibold">{item.label}</div>
                  <div className="mt-1 text-sm">{item.value}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed bg-background p-4 text-sm text-muted-foreground">{REPORT_COPY.noDamageData}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create ListingsHistory**

Create `apps/web/src/features/report/ListingsHistory.tsx`:

```tsx
import { Camera } from "lucide-react";
import { formatDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { REPORT_COPY } from "./report-copy";
import type { ReportSection } from "./report-types";

export function ListingsHistory({ section }: { section: ReportSection | undefined }) {
  const items = section?.items ?? [];

  return (
    <Card id={section?.id ?? "listings"}>
      <CardContent className="grid gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md bg-slate-900 text-white">
            <Camera aria-hidden="true" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-normal">История объявлений</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Цена, пробег и город по доступным фиксациям.</p>
          </div>
        </div>

        {items.length > 0 ? (
          <div className="grid gap-3">
            {items.map((item) => (
              <div className="grid gap-3 rounded-md border bg-white p-3 sm:grid-cols-[150px_minmax(0,1fr)]" key={`${item.label}:${item.value}:${item.date ?? ""}`}>
                <div className="grid min-h-24 place-items-center rounded bg-slate-100 text-xs font-semibold text-slate-500">фото нет</div>
                <div>
                  <div className="font-semibold">{item.label}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{item.value}</div>
                  {item.date && <div className="mt-2 text-xs text-muted-foreground">{formatDate(item.date)}</div>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed bg-background p-4 text-sm text-muted-foreground">{REPORT_COPY.noListingsData}</div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Create ReportBasis**

Create `apps/web/src/features/report/ReportBasis.tsx`:

```tsx
import { FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { VehicleFullReportResponse } from "@/lib/api";

export function ReportBasis({ data }: { data: VehicleFullReportResponse }) {
  return (
    <Card id="report_basis">
      <CardContent className="grid gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md bg-slate-900 text-white">
            <FileText aria-hidden="true" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-normal">Основа сводного отчета</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{data.report.summary.historyBasisText}</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <BasisFact label="Загруженные отчеты" value={String(data.report.summary.sourceUploadCount)} />
          <BasisFact label="Последнее обновление" value={data.report.summary.lastUpdatedAt ?? "дата не указана"} />
          <BasisFact label="Формат" value="сводная история Истории Авто" />
        </div>
      </CardContent>
    </Card>
  );
}

function BasisFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-slate-50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-bold">{value}</div>
    </div>
  );
}
```

- [ ] **Step 5: Run web typecheck**

Run:

```bash
bun run --cwd apps/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/report/LegalStatusMatrix.tsx apps/web/src/features/report/DamageAndRepairSection.tsx apps/web/src/features/report/ListingsHistory.tsx apps/web/src/features/report/ReportBasis.tsx
git commit -m "feat: add report detail sections"
```

## Task 7: Compose FullReportPage and replace old report screen

**Files:**
- Create: `apps/web/src/features/report/FullReportPage.tsx`
- Modify: `apps/web/src/components/FullReportScreen.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Create FullReportPage**

Create `apps/web/src/features/report/FullReportPage.tsx`:

```tsx
import { ExternalLink } from "lucide-react";
import type { VehicleFullReportResponse } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { ShareState } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { ReportDossier } from "./ReportDossier";
import { ReportSummary } from "./ReportSummary";
import { ReportTimeline } from "./ReportTimeline";
import { MileageChart } from "./MileageChart";
import { LegalStatusMatrix } from "./LegalStatusMatrix";
import { DamageAndRepairSection } from "./DamageAndRepairSection";
import { ListingsHistory } from "./ListingsHistory";
import { ReportBasis } from "./ReportBasis";
import { sectionById } from "./report-types";

export function FullReportPage({
  data,
  mode,
  shareState,
  onBack,
  onShare,
  onDownloadPdf
}: {
  data: VehicleFullReportResponse;
  mode: "owner" | "share";
  shareState: ShareState;
  onBack: () => void;
  onShare: () => void;
  onDownloadPdf: () => void;
}) {
  return (
    <section className="mx-auto grid max-w-7xl gap-6 py-6" aria-labelledby="full-report-title">
      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)]">
        <ReportDossier
          data={data}
          mode={mode}
          shareState={shareState}
          onBack={onBack}
          onShare={onShare}
          onDownloadPdf={onDownloadPdf}
        />
        <div className="grid min-w-0 gap-6">
          <ReportSummary data={data} />
          {shareState.status === "ready" && <ShareReadyCard shareState={shareState} />}
          {shareState.status === "error" && <ShareErrorCard message={shareState.message} />}
          <ReportTimeline section={sectionById(data, "update_history")} />
          <MileageChart section={sectionById(data, "mileage")} />
          <div className="grid gap-6 xl:grid-cols-2">
            <LegalStatusMatrix section={sectionById(data, "legal_risks")} />
            <DamageAndRepairSection section={sectionById(data, "accidents_repairs")} />
          </div>
          <ListingsHistory section={sectionById(data, "listings")} />
          <ReportBasis data={data} />
          <ReportFooter data={data} mode={mode} />
        </div>
      </div>
    </section>
  );
}

function ShareReadyCard({ shareState }: { shareState: Extract<ShareState, { status: "ready" }> }) {
  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardContent className="flex gap-3 p-4 text-sm text-blue-950">
        <ExternalLink aria-hidden="true" className="mt-0.5 shrink-0" size={18} />
        <div>
          <p className="font-semibold">{shareState.share.url}</p>
          <small>Действует до {formatDate(shareState.share.expiresAt)}</small>
        </div>
      </CardContent>
    </Card>
  );
}

function ShareErrorCard({ message }: { message: string }) {
  return (
    <Card className="border-rose-200 bg-rose-50">
      <CardContent className="p-4 text-sm text-rose-900">{message}</CardContent>
    </Card>
  );
}

function ReportFooter({ data, mode }: { data: VehicleFullReportResponse; mode: "owner" | "share" }) {
  return (
    <footer className="grid gap-1 border-t pt-5 text-sm text-muted-foreground">
      <p>{data.presentation.disclaimer}</p>
      <small>{data.presentation.watermark}</small>
      {mode === "share" && data.share && <small>Share действует до {formatDate(data.share.expiresAt)}</small>}
    </footer>
  );
}
```

- [ ] **Step 2: Replace old FullReportScreen with wrapper**

Modify `apps/web/src/components/FullReportScreen.tsx` to:

```tsx
export { FullReportPage as FullReportScreen } from "@/features/report/FullReportPage";
```

This preserves current `App.tsx` import for this task and reduces conflict risk.

- [ ] **Step 3: Run web typecheck and build**

Run:

```bash
bun run --cwd apps/web typecheck
bun run --cwd apps/web build
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/report/FullReportPage.tsx apps/web/src/components/FullReportScreen.tsx
git commit -m "feat: compose full report page"
```

## Task 8: Copy audit and forbidden wording test

**Files:**
- Create: `apps/web/src/features/report/report-copy.test.ts`
- Modify: `apps/web/package.json` only if test command cannot discover tests; otherwise leave it unchanged.

- [ ] **Step 1: Add frontend copy test**

Create `apps/web/src/features/report/report-copy.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { REPORT_COPY, FORBIDDEN_REPORT_COPY } from "./report-copy";

describe("report copy", () => {
  it("does not use recommendation-style wording in approved report copy", () => {
    const serialized = JSON.stringify(REPORT_COPY).toLowerCase();

    for (const forbidden of FORBIDDEN_REPORT_COPY) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
```

- [ ] **Step 2: Run frontend test directly**

Run:

```bash
bun test apps/web/src/features/report/report-copy.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/report/report-copy.test.ts
git commit -m "test: guard report copy wording"
```

## Task 9: Browser verification and visual fixes

**Files:**
- Modify only report feature files as needed.

- [ ] **Step 1: Start local web dev server**

Run:

```bash
bun run --cwd apps/web dev --host 127.0.0.1
```

Expected: Vite prints a local URL, usually `http://127.0.0.1:5173/`.

- [ ] **Step 2: Open report state in Browser**

Use the app flow or existing seeded state to open a full report. If API/database is not available, do not fake success silently. Stop and report exactly what is missing:

- running API;
- database;
- seeded vehicle/report;
- auth/access cookie.

If full end-to-end report cannot be opened, run static frontend build verification and ask the user for the missing runtime setup or fixture.

- [ ] **Step 3: Capture desktop screenshot**

Browser viewport:

- width: `1440`
- height: `900`

Save screenshot to:

```text
.local/screenshots/full-report-redesign-desktop.png
```

Check:

- dossier is left/sticky and readable;
- no-photo state is honest and not stock-like;
- summary puts negative signals before neutral facts;
- no text overlap;
- actions are visible and not duplicated awkwardly;
- report does not contain forbidden recommendation words.

- [ ] **Step 4: Capture mobile screenshot**

Browser viewport:

- width: `390`
- height: `844`

Save screenshot to:

```text
.local/screenshots/full-report-redesign-mobile.png
```

Check:

- order is photo/no-photo -> dossier -> signals -> expert -> timeline -> graph;
- actions do not cover content;
- VIN and long text wrap without breaking layout;
- graph remains readable.

- [ ] **Step 5: Fix visible issues**

Apply minimal scoped fixes in `apps/web/src/features/report/*`.

Run after every fix:

```bash
bun run --cwd apps/web typecheck
bun run --cwd apps/web build
```

- [ ] **Step 6: Commit visual fixes**

```bash
git add apps/web/src/features/report apps/web/src/components/FullReportScreen.tsx
git commit -m "fix: polish full report responsive layout"
```

## Task 10: Full verification

**Files:**
- No planned file changes unless verification finds a bug.

- [ ] **Step 1: Run full tests**

Run:

```bash
bun run test
```

Expected: all tests pass.

- [ ] **Step 2: Run full typecheck**

Run:

```bash
bun run typecheck
```

Expected: all typechecks pass.

- [ ] **Step 3: Run frontend build**

Run:

```bash
bun run --cwd apps/web build
```

Expected: build completes successfully.

- [ ] **Step 4: Run API db generate only if schema changed**

This plan does not change schema. Do not run `bun run --cwd apps/api db:generate` unless an implementation step unexpectedly changes database schema. If schema changes, stop and update this plan before proceeding.

- [ ] **Step 5: Manual product guards**

Verify and note result in final handoff:

- full report still requires access service;
- share mode has no PDF and no resharing;
- no source-brand leaks in report responses;
- no personal data is added to user-facing report UI;
- positive facts are neutral, not recommendation-like;
- no stock photos are used as if they were real vehicle photos.

- [ ] **Step 6: Final commit if verification fixes were needed**

If verification required changes:

```bash
git add <changed-files>
git commit -m "fix: complete full report redesign verification"
```

If no changes were needed, do not create an empty commit.

## Self-review checklist

- Spec coverage:
  - Dossier-profile covered by Task 3 and Task 7.
  - Negative-first summary covered by Task 1 and Task 4.
  - Neutral positive facts covered by Task 1 and Task 8.
  - Timeline covered by Task 5.
  - Mileage chart covered by Task 5.
  - Legal matrix covered by Task 6.
  - Damage/repair visual section covered by Task 6.
  - Listings history covered by Task 6.
  - Report basis covered by Task 6.
  - Share/PDF restrictions covered by Task 7 and Task 10.
  - Browser desktop/mobile verification covered by Task 9.
- No backend schema changes are planned.
- No real photo integration is planned because data/materials are missing; no-photo state is explicit.
- First screen search is intentionally out of scope.
