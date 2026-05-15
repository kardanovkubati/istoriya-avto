# AGENTS.md

## Язык и коммуникация

- Всегда отвечать на русском.
- Перед серьезными продуктовыми, frontend, backend или архитектурными изменениями сначала читать roadmap/spec и предлагать план.
- Не оптимизировать серьезную работу под быстрый demo-эффект.
- Если задача неоднозначна, сначала классифицировать режим работы:
  - `быстрый фикс`;
  - `серьезная продуктовая фича`;
  - `архитектура / дизайн-система`;
  - `рефакторинг`;
  - `исследование без изменений`.

## Режимы работы

### Быстрый фикс

Использовать для узких багов, текстовых правок, небольших config/test правок.

- Делать минимальное безопасное изменение.
- Не менять архитектуру.
- Не добавлять новые framework/dependency без обсуждения.
- Запускать targeted tests/typecheck по затронутой области.

### Серьезный продуктовый режим

Использовать для новых пользовательских сценариев, экранов, auth/billing/access/report/admin/SEO/legal, схемы данных и интеграций.

- Не начинать с кода.
- Сначала читать roadmap, specs, существующую реализацию.
- Писать или обновлять implementation plan.
- Явно фиксировать продуктовые ограничения и open questions.
- Делить работу на маленькие тестируемые задачи и небольшие коммиты.
- Поведение реализовывать tests-first.
- Перед фразой “готово” запускать обязательные проверки и указывать команды.

### Архитектура и frontend design system

Использовать для новых frontend экранов и крупных UI-flow.

- Не делать handmade UI для серьезных продуктовых поверхностей без явного согласования.
- Product frontend должен идти через Tailwind + shadcn/ui, если отдельно не утвержден другой стек.
- Сначала согласовать:
  - user flow;
  - layout structure;
  - component boundaries;
  - design-system primitives;
  - empty/loading/error states;
  - accessibility и responsive behavior.
- `App.tsx` должен быть composition/orchestration layer, а не god component.
- Организация frontend:
  - `components/ui` для shadcn primitives;
  - `features/search`;
  - `features/report`;
  - `features/account`;
  - `lib`;
  - `types` только для shared frontend contracts.
- Компоненты должны иметь одну понятную причину меняться.
- Нельзя смешивать API orchestration, formatting helpers, layout sections и feature UI в одном большом файле.

## Backend standards

- Не менять утвержденную продуктовую логику без обсуждения.
- Держать service/repository boundaries.
- Не раскрывать raw artifacts, parser internals, source brands или персональные данные людей в пользовательских responses.
- Idempotency, access boundaries и billing/points logic покрывать тестами до реализации.

## Git discipline

- Работать в feature branch, не в `master`, если пользователь явно не попросил другое.
- Коммиты должны быть маленькими и логичными.
- Не трогать unrelated/untracked файлы.
- Если в рабочем дереве есть чужие изменения, не перетирать их и явно упоминать в статусе.

## Definition of Done

Для серьезной работы:

- План создан или обновлен.
- Тесты добавлены/обновлены до реализации поведения.
- `bun run test` проходит.
- `bun run typecheck` проходит.
- `bun run --cwd apps/web build` проходит, если менялся frontend.
- `bun run --cwd apps/api db:generate` проходит, если менялась schema.
- Код организован под поддержку, а не только под демонстрацию.
