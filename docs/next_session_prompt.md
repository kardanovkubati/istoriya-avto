# Prompt For Next Session

Скопируй этот промпт в новую сессию Codex.

```text
Мы продолжаем проект "История Авто" в локальном репозитории:
/Users/kubatikardanov/dev-kubati/Новая папка

Текущая дата прошлого этапа: 2026-05-12.
Текущая ветка после merge: master.

Контекст продукта:
- Это РФ web-сервис проверки истории автомобиля.
- Пользователь ищет авто по ссылке объявления, VIN или госномеру.
- Пользователь видит только preview для распознавания машины.
- Полный отчет открывается за 1 балл или по подписке.
- 1 балл / 1 подписочный лимит открывает сводный отчет по VIN навсегда, включая будущие обновления.
- Пользователи загружают свои купленные отчеты PDF или authless-ссылки на отчет.
- Мы не показываем оригинальные отчеты Автотеки/Авито/Авто.ру/Дрома, а строим свой сводный отчет из нормализованных фактов.
- В пользовательском отчете не указываем названия сторонних сервисов как источники конкретных фактов.
- Главный источник для MVP: Авито/Автотека. Auto.ru и Drom позже, Drom не должен тормозить MVP.

Ключевые документы:
- MVP spec: docs/superpowers/specs/2026-05-12-istoriya-avto-mvp-design.md
- Foundation implementation plan: docs/superpowers/plans/2026-05-12-istoriya-avto-foundation-implementation.md
- MVP roadmap: docs/mvp_roadmap.md

Что уже реализовано и смерджено в master:
- TypeScript/Bun monorepo:
  - apps/api
  - apps/web
  - packages/shared
- Hono API:
  - GET /health
  - POST /api/search/detect
- Shared query detection:
  - VIN
  - российский госномер
  - Avito/Auto.ru/Drom URLs, включая auto.drom.ru
- PostgreSQL/Drizzle schema + первая миграция.
- Env parsing, server entry, DB client.
- Points policy:
  - 0-90 дней: валидный отчет дает 1 балл.
  - 91-180 дней: первый отчет по VIN дает 1 балл.
  - старше 180 дней: без автоначисления.
  - один пользователь получает балл за один VIN только один раз навсегда.
  - один report_fingerprint автоматически дает балл максимум 3 разным пользователям.
  - invalid dates/counts/future dates уходят в manual_review.
- React/Vite mobile-first shell с умным полем.
- Локальная CORS поддержка для localhost:5173 и 127.0.0.1:5173.

Последние успешные проверки на master:
- bun run test: 36 tests, 0 failures.
- bun run typecheck: passed.
- bun run --cwd apps/web build: passed.
- bun run --cwd apps/api db:generate: no schema changes.

Важные правила процесса:
- Не начинать кодить до чтения docs/mvp_roadmap.md и MVP spec.
- Следующий крупный этап: Milestone 1, Report Ingestion And Autoteka Parser.
- Сначала создать детальный implementation plan для Milestone 1, затем выполнять через subagent-driven development или пошагово с review gates.
- Не менять уже утвержденную продуктовую логику без явного обсуждения.
- Не хранить персональные данные людей в пользовательском отчете.
- Оригинальные PDF/HTML храним закрыто до 6 месяцев.
- OCR в MVP не делаем.
- В MVP поддерживаем текстовые PDF и authless-ссылки.

Что нужно сделать дальше:
1. Прочитать docs/mvp_roadmap.md и MVP spec.
2. Составить implementation plan для Milestone 1:
   Report Ingestion And Autoteka Parser.
3. План должен покрыть:
   - upload API для PDF;
   - storage abstraction;
   - PDF text extraction без OCR;
   - report_fingerprint;
   - parser fixtures/golden tests;
   - Autoteka parser v1;
   - создание report_upload;
   - статус manual_review для частичных/подозрительных отчетов;
   - подключение points policy к parse result без полноценного UI начисления.
4. После утверждения плана начать реализацию маленькими тестируемыми задачами.

Перед любыми утверждениями о готовности запускать:
- bun run test
- bun run typecheck
- bun run --cwd apps/web build, если менялся frontend
- bun run --cwd apps/api db:generate, если менялась schema
```

