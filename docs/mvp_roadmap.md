# История Авто: MVP Roadmap

Дата: 2026-05-13
Статус: рабочая дорожная карта после Milestone 2

## Текущее состояние

Готов foundation-слой:

- TypeScript/Bun monorepo: `apps/api`, `apps/web`, `packages/shared`.
- Hono API: `/health`, `/api/search/detect`.
- React/Vite mobile-first shell с умным полем.
- Shared query detection: VIN, госномер, Avito/Auto.ru/Drom URLs.
- PostgreSQL/Drizzle schema и первая миграция.
- Points policy с тестами и edge-case hardening.

Готов Milestone 1:

- Upload API `POST /api/uploads/report-pdf` для текстовых PDF.
- Локальное private storage abstraction для оригиналов отчетов с retention metadata.
- PDF text extraction без OCR через `pdfjs-dist`.
- `report_fingerprint` по нормализованному тексту отчета.
- Autoteka parser v1 с 3 обезличенными text/golden fixtures.
- Минимальный parse result: VIN, дата отчета, паспорт авто, объявления/пробеги, рисковые блоки.
- `report_upload` creation через ingestion service и Drizzle repository.
- `manual_review` для пустого текстового слоя, частичных, подозрительных и policy-risk отчетов.
- Подключение points policy к parse result без начисления пользовательского баланса и без ledger mutation.
- Upload route hardening: обязательный `Content-Length`, max-size guard, PDF magic-byte check, запрет client-supplied identity fields.
- Проверки на `master`: `bun run test`, `bun run typecheck`, `bun run --cwd apps/api db:generate`.

Главная следующая цель: запустить пользовательский путь поиска, preview и unlock flow на данных Milestone 2.

## Milestone 1: Report Ingestion And Autoteka Parser

Статус: готов на `master` 2026-05-13.

Цель: пользователь или админ может загрузить текстовый PDF Автотеки, система извлекает VIN, дату формирования, базовые блоки и создает `report_upload`.

Входит:

- Upload API для PDF-файла.
- Локальное/S3-compatible storage abstraction для оригинала.
- PDF text extraction без OCR.
- `report_fingerprint`.
- Autoteka parser v1 для первых обезличенных fixtures.
- Parser fixtures и golden tests.
- Минимальный parse result: VIN, дата отчета, паспорт авто, объявления/пробеги, рисковые блоки если найдены.
- Подключение points policy к результату парсинга без реального пользовательского UI начисления.

Не входит:

- OCR.
- Auto.ru/Drom parser.
- Полная админка.
- Auth.

Exit criteria:

- Есть 3 обезличенных текстовых fixtures с golden JSON.
- Parser tests проходят стабильно.
- Невалидный/частичный/подозрительный отчет уходит в статус `manual_review`.
- `bun run test`, `bun run typecheck`, `bun run --cwd apps/api db:generate` зеленые на `master`.

## Milestone 2: Vehicle Aggregation And Report Read Model

Статус: готов к merge на `master` 2026-05-13.

Цель: из одного или нескольких `report_upload` строится один сводный отчет по VIN.

Готово:

- Observation model поверх `report_uploads.raw_data.parseResult`.
- Нормализация фактов по VIN из parsed uploads.
- Merge/aggregation service с rebuild snapshot после успешной загрузки.
- Хранение конфликтов фактов без молчаливого затирания.
- Preview и full report API.
- Базовая оценка прозрачности истории.
- Source-brand leak guard для пользовательского report response.

Входит:

- Vehicle observation model поверх текущей схемы.
- Нормализация фактов из parse result.
- Merge/aggregation service.
- Конфликты фактов: сохраняем версии, не затираем молча.
- Report read model для API.
- Базовая оценка прозрачности истории: число или `Недостаточно данных`.
- API для preview и full report.

Exit criteria:

- По VIN можно получить единый сводный JSON.
- Несколько загрузок по одному VIN объединяются.
- Конфликты видны в read model.
- Нет упоминания брендов источников в пользовательском report response.

## Milestone 3: Search, Preview, And Unlock Flow

Цель: главный пользовательский сценарий начинает работать на данных.

Входит:

- Search API по VIN/госномеру/ссылке.
- Snapshot объявления по authless URL, сначала Avito как приоритет.
- Candidate preview cards.
- Preview rules: фото, марка/модель/год, цена/пробег из объявления, частично скрытый VIN, без госномера.
- Empty state: отчета пока нет, загрузите отчет и получите балл на будущее.
- UI экран результатов и preview-карточек.

Exit criteria:

- Пользователь вводит VIN/госномер/ссылку и видит кандидатов.
- Full report не раскрывается без доступа.
- Ошибочный выбор кандидата не создает возврат балла.

## Milestone 4: Auth, Guest Session, Points Ledger

Цель: гость может начать сценарий без регистрации, затем закрепить доступ в аккаунте.

Входит:

- Guest session на 7 дней.
- Auth через Telegram, Max, телефон как каналы аккаунта.
- Уникальность phone/telegram/max identity.
- Перенос guest context в аккаунт.
- Points ledger: начисления, списания, корректировки.
- Access service: подписочный лимит сначала, потом баллы.
- UI статуса: тариф/остаток новых отчетов/баллы.

Exit criteria:

- Гость может загрузить отчет, получить временный балл и после входа сохранить его.
- Один пользователь не получает балл за один VIN больше одного раза.
- Один `report_fingerprint` автоматически дает балл максимум 3 разным пользователям.

## Milestone 5: Full Report UI, Share, And PDF Export

Цель: пользователь видит полноценный сводный отчет и может безопасно поделиться им.

Входит:

- Full report UI по утвержденному порядку разделов.
- Критичные пустые разделы показывают `данных не найдено на дату обновления`.
- Старые данные явно помечаются датой.
- История объявлений с фото.
- Share-ссылка на 7 дней.
- Share view без авторизации, без PDF download и resharing.
- PDF export в нашем оформлении.

Exit criteria:

- Открытый VIN доступен пользователю навсегда.
- Share link работает по токену и истекает.
- Full report и share страницы `noindex`.

## Milestone 6: Admin MVP

Цель: основатель может разбирать спорные загрузки, жалобы и обращения без прямого доступа к базе.

Входит:

- Desktop-first admin shell.
- Очереди: manual review uploads, parser errors, suspicious duplicates, complaints, support tickets.
- Просмотр оригинала отчета до 6 месяцев.
- Подтвердить/отклонить загрузку.
- Начислить/не начислить/отозвать балл с причиной.
- Скрыть фото/событие/спорный блок.
- Audit events для действий админа.

Exit criteria:

- Все risky states из ingestion flow имеют админский путь разбора.
- Жалобы на персональные данные/права на фото могут скрывать контент сразу.

## Milestone 7: Billing And Subscriptions

Цель: платный доступ работает по тарифам и биллинговому периоду.

Входит:

- Payment provider abstraction.
- Первый провайдер: ЮKassa или CloudPayments.
- Тарифы:
  - Start: 399 ₽ / 50 новых отчетов.
  - Pro: 999 ₽ / 200 новых отчетов.
  - Max: 1990 ₽ / 500 новых отчетов.
- Автопродление по умолчанию.
- Выключение автопродления.
- Email для чека.
- Подписочные лимиты сгорают, баллы не сгорают.

Exit criteria:

- Пользователь может оплатить тариф и открыть новые отчеты в пределах лимита.
- Повторный просмотр купленного VIN не тратит лимит.

## Milestone 8: Notifications And Support Bots

Цель: Telegram и Max становятся каналами входа, уведомлений и поддержки.

Входит:

- Telegram bot adapter.
- Max bot adapter.
- Привязка аккаунта через deep-link/code.
- Уведомления: отчет появился, проверка завершена, ответ поддержки, подписка скоро закончится.
- Support ticket flow через бота и форму.

Exit criteria:

- Пользователь может подключить Telegram/Max.
- Админ отвечает из админки, пользователь получает ответ в мессенджере.

## Milestone 9: SEO, Legal, And Launch Hardening

Цель: закрытый MVP можно показать первым пользователям без очевидных дыр.

Входит:

- SEO pages вручную в коде: главная, VIN, госномер, ссылка объявления, тарифы, FAQ, документы, контакты.
- `robots.txt`, `sitemap.xml`.
- `noindex` для отчетов, share, поиска, кабинета, админки.
- Правовые страницы-заготовки для юриста.
- Yandex SmartCaptcha при подозрительном поведении.
- Rate limits и антискрейпинг.
- 30-дневные технические логи.
- Ежедневные backup checks.
- Railway deploy для закрытого MVP.

Exit criteria:

- Закрытый production-like контур доступен.
- Основные документы и дисклеймеры на месте.
- Бэкапы и секреты настроены.

## Recommended Next Session

Следующая сессия должна начать с Milestone 3.

Первый рабочий результат следующей сессии:

1. Создать implementation plan для `Search, Preview, And Unlock Flow`.
2. Спроектировать search API по VIN/госномеру/ссылке поверх текущего read model.
3. Связать preview карточки с существующим `/api/vehicles/:vin/preview`.
4. Подготовить unlock boundary без реального списания баллов до Milestone 4.
