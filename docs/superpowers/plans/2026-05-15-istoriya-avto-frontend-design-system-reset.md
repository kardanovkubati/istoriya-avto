# План перезапуска frontend design system

> **Для агентной реализации:** обязательный режим перед выполнением - `superpowers:subagent-driven-development` или `superpowers:executing-plans`. План выполняется маленькими задачами с чекбоксами (`- [ ]`) и review gate после каждого шага.

**Цель:** заменить текущую handmade frontend-реализацию Milestone 5 на серьезную продуктовую основу: Tailwind CSS, shadcn/ui primitives, feature-модули и явные границы дизайн-системы.

**Важно:** этот документ пока фиксирует архитектурный reset и технический способ привести frontend в порядок. Визуальное направление продукта должно быть согласовано отдельно до начала реализации: через вопросы, варианты подхода и утвержденную design spec.

**Архитектура:** backend Milestone 5 для полного отчета, share links и PDF export оставляем как есть. Перестраиваем только frontend-слой: `App.tsx` становится уровнем маршрутизации/композиции, feature state живет в hooks, UI primitives живут в `components/ui`, а продуктовые сценарии - в `features/*`. Tailwind/shadcn становятся базовой frontend-основой для серьезных продуктовых поверхностей.

**Стек:** React, Vite, TypeScript, Tailwind CSS, shadcn/ui, lucide-react, Bun, существующие API contracts.

---

## Почему нужен reset

Первая frontend-реализация Milestone 5 была сделана слишком быстро. Она показала продуктовый сценарий, но не заложила архитектуру, которую ожидаешь от серьезного продукта:

- слишком много ответственности оказалось в `App.tsx`;
- UI primitives были сделаны вручную вместо стандартизированной основы;
- не было явной границы дизайн-системы;
- компоненты full report/search/share были разделены постфактум, а не спроектированы заранее;
- Tailwind + shadcn/ui не были обсуждены до сборки новой продуктовой поверхности.

Этот reset рассматривает frontend как продуктовую инфраструктуру, а не demo-код.

## Нельзя менять без обсуждения

- Не менять утвержденную продуктовую логику.
- Не менять backend API Milestone 5, кроме случаев, когда найден и покрыт тестом баг.
- Не раскрывать full report без доступа.
- Не показывать названия сторонних сервисов как источники конкретных фактов.
- Не хранить и не рендерить персональные данные людей в пользовательском отчете.
- Использовать Tailwind + shadcn/ui для серьезных frontend поверхностей.
- Не собирать новый большой god component.
- Не начинать реализацию, пока не утверждены:
  - визуальное направление;
  - UX-flow;
  - component boundaries;
  - этот implementation plan.

## Целевая структура

```text
apps/web/src
├── app
│   ├── App.tsx
│   └── routes.tsx
├── components
│   └── ui
│       ├── badge.tsx
│       ├── button.tsx
│       ├── card.tsx
│       ├── dialog.tsx
│       ├── separator.tsx
│       ├── sheet.tsx
│       ├── skeleton.tsx
│       └── tabs.tsx
├── features
│   ├── account
│   │   ├── AccountStatusBar.tsx
│   │   └── account-types.ts
│   ├── report
│   │   ├── FullReportPage.tsx
│   │   ├── ReportActions.tsx
│   │   ├── ReportHero.tsx
│   │   ├── ReportSection.tsx
│   │   ├── ShareReportPage.tsx
│   │   ├── useReportView.ts
│   │   └── report-types.ts
│   └── search
│       ├── CandidateCard.tsx
│       ├── EmptySearchState.tsx
│       ├── SearchPage.tsx
│       ├── SearchResults.tsx
│       ├── UnlockPanel.tsx
│       ├── useSearchFlow.ts
│       └── search-types.ts
├── lib
│   ├── api.ts
│   ├── format.ts
│   ├── seo.ts
│   └── utils.ts
├── index.css
└── main.tsx
```

## Визуальное направление: не утверждено

Дизайн еще нельзя считать выбранным, потому что не были заданы вопросы владельцу продукта. Предварительная гипотеза для обсуждения:

- продукт - рабочий инструмент для проверки автомобиля перед покупкой;
- интерфейс должен быть серьезным, спокойным и читаемым;
- отчет должен ощущаться как профессиональный dossier/workbench, а не как landing page;
- мобильный сценарий важен, но desktop также должен быть удобен для внимательного анализа;
- визуальная система должна помогать быстро понять риск, статус доступа, остатки лимита/баллов и действия по отчету.

Перед реализацией нужно выбрать один из подходов:

1. **Операционный кабинет.** Плотная, спокойная, таблично-секционная подача. Лучше для регулярного использования и доверия.
2. **Премиальный отчет.** Более editorial presentation, крупнее типографика, отчет выглядит как ценный документ. Лучше для first impression и PDF/share.
3. **Диагностический workbench.** Сильнее акцент на risk signals, timeline, unlock/access state и быстрые решения. Лучше для практической проверки перед покупкой.

Моя предварительная рекомендация: гибрид `Операционный кабинет + Премиальный отчет`. Поиск и account/status должны быть спокойными и рабочими, а full report - выглядеть как качественный документ, который не стыдно отправить покупателю/партнеру.

Избегать:

- oversized hero-only composition для app flow;
- декоративных gradient/orb backgrounds;
- one-off custom controls там, где подходят shadcn primitives;
- длинных объясняющих текстов внутри интерфейса;
- card-inside-card layouts;
- визуальной “игрушечности” и demo-ощущения.

Использовать:

- shadcn buttons, badges, tabs/sheets/dialogs/skeletons;
- сдержанные report sections;
- предсказуемое место для действий;
- sticky или легко доступные actions на mobile;
- понятные empty/loading/error states;
- отдельную визуальную систему для severity/status: спокойно, без крикливости.

## Вопросы перед реализацией

Перед Task 1 нужно получить ответы хотя бы на эти вопросы:

- Кто главный пользователь первой версии: частный покупатель, перекуп/дилер, автоподборщик или смешанный сценарий?
- Какой тон бренда нужен: строгий государственно-реестровый, премиальный экспертный, техничный диагностический или дружелюбный consumer?
- Что должно быть главным первым экраном: поиск по VIN/госномеру, список найденных авто, unlock screen или личный кабинет/статус доступа?
- Full report должен выглядеть ближе к dashboard, PDF-документу или расследовательскому dossier?
- Нужно ли проектировать mobile-first как основной сценарий или desktop для аналитики равнозначен?
- Какие 2-3 продукта/сервиса визуально нравятся как ориентир, а какие точно не нравятся?

## Task 1: Установить Tailwind и shadcn foundation

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/main.tsx`
- Create: `apps/web/src/index.css`
- Create: `apps/web/components.json`
- Create: `apps/web/tailwind.config.ts`
- Modify: `apps/web/vite.config.ts`, если нужен path alias

- [ ] Добавить Tailwind, PostCSS/autoprefixer при необходимости, `class-variance-authority`, `clsx`, `tailwind-merge`, `tailwindcss-animate`.
- [ ] Настроить alias `@/*` на `apps/web/src`.
- [ ] Добавить helper `cn()` в `apps/web/src/lib/utils.ts`.
- [ ] Добавить базовые CSS variables для shadcn theme.
- [ ] Запустить `bun run --cwd apps/web typecheck`.
- [ ] Запустить `bun run --cwd apps/web build`.
- [ ] Commit: `chore: add tailwind shadcn foundation`.

## Task 2: Добавить shadcn UI primitives

**Files:**
- Create: `apps/web/src/components/ui/button.tsx`
- Create: `apps/web/src/components/ui/badge.tsx`
- Create: `apps/web/src/components/ui/card.tsx`
- Create: `apps/web/src/components/ui/dialog.tsx`
- Create: `apps/web/src/components/ui/sheet.tsx`
- Create: `apps/web/src/components/ui/separator.tsx`
- Create: `apps/web/src/components/ui/skeleton.tsx`
- Create: `apps/web/src/components/ui/tabs.tsx`

- [ ] Добавить только primitives, которые нужны текущим flow.
- [ ] Не добавлять большой component dump.
- [ ] Проверить, что imports используют `@/components/ui/*`.
- [ ] Запустить web typecheck/build.
- [ ] Commit: `chore: add frontend ui primitives`.

## Task 3: Перенести search flow в feature module

**Files:**
- Create/modify files в `apps/web/src/features/search`
- Modify: `apps/web/src/app/App.tsx`

- [ ] Перенести orchestration состояния поиска в `useSearchFlow.ts`.
- [ ] Перенести presentational UI в `SearchPage.tsx`, `SearchResults.tsx`, `CandidateCard.tsx`, `UnlockPanel.tsx`.
- [ ] Использовать shadcn `Button`, `Badge`, `Skeleton` там, где они подходят.
- [ ] Сохранить текущее поведение candidate unlock.
- [ ] Запустить web typecheck/build.
- [ ] Commit: `refactor: move search flow into feature module`.

## Task 4: Перенести full report и share в feature module

**Files:**
- Create/modify files в `apps/web/src/features/report`
- Modify: `apps/web/src/app/App.tsx`

- [ ] Перенести orchestration отчета в `useReportView.ts`.
- [ ] Разделить owner и share entry points: `FullReportPage.tsx`, `ShareReportPage.tsx`.
- [ ] Использовать общие `ReportHero`, `ReportActions`, `ReportSection`.
- [ ] Сохранить поведение `noindex,nofollow`.
- [ ] Сохранить ограничения share mode: без PDF и без resharing.
- [ ] Запустить web typecheck/build.
- [ ] Commit: `refactor: move report flow into feature module`.

## Task 5: Заменить handmade CSS на Tailwind classes

**Files:**
- Modify/remove: `apps/web/src/styles.css`
- Modify: feature/components files

- [ ] Заменить широкий handmade CSS на Tailwind/shadcn styling.
- [ ] Оставить в `index.css` только global theme/base rules.
- [ ] Избегать page-level CSS selectors для feature internals.
- [ ] Проверить, что responsive layouts не перекрываются на mobile widths.
- [ ] Запустить web build.
- [ ] Commit: `refactor: replace handmade frontend css`.

## Task 6: Verification and review

**Files:**
- Без broad production changes, кроме исправлений, найденных в verification.

- [ ] Запустить `bun run test`.
- [ ] Запустить `bun run typecheck`.
- [ ] Запустить `bun run --cwd apps/web build`.
- [ ] Если schema не менялась, не запускать db generate, кроме случаев, когда финальный checklist требует это явно.
- [ ] Запустить local browser smoke, когда доступен Docker/local server.
- [ ] Проверить:
  - нет god components;
  - feature boundaries соблюдены;
  - shadcn primitives используются последовательно;
  - full report остается закрытым без доступа;
  - share mode не может PDF/reshare;
  - source-brand leak guards не изменились.
- [ ] Закоммитить финальные исправления, если нужны.

## Acceptance criteria

- `App.tsx` - только composition/routing/orchestration.
- Search и report flows живут в `features/*`.
- UI primitives живут в `components/ui`.
- Tailwind + shadcn являются frontend foundation.
- Нет регрессии продуктового поведения Milestone 5 backend/API.
- Required checks проходят.
