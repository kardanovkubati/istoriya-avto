# История Авто: MVP Roadmap

Дата: 2026-05-15
Статус: рабочая дорожная карта после Milestone 4

## Текущее состояние

Готов foundation-слой:

- TypeScript/Bun monorepo: `apps/api`, `apps/web`, `packages/shared`.
- Hono API: `/health`, `/api/search/detect`, `/api/search`.
- React/Vite mobile-first shell с умным полем, results flow и preview cards.
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

Готов Milestone 2:

- Observation model поверх `report_uploads.raw_data.parseResult`.
- Нормализация фактов по VIN из parsed uploads.
- Merge/aggregation service с rebuild snapshot после успешной загрузки.
- Хранение конфликтов фактов без молчаливого затирания.
- Preview API и full report read model.
- Базовая оценка прозрачности истории.
- Source-brand leak guard для пользовательского report response.

Готов Milestone 3:

- Search API `POST /api/search` по VIN, внутреннему госномеру и ссылке объявления.
- Authless Avito listing snapshot ingestion для публичного HTML с bounded fetch.
- Internal-only поведение для госномера до подключения внешних lookup-источников.
- Candidate preview cards без госномера, без source-brand leak и без раскрытия full report.
- Frontend search results flow, empty state и unlock boundary.
- `GET /api/vehicles/:vin/report` закрыт без access grant; реальное списание баллов и подписок оставлено на Milestone 4.

Готов Milestone 4:

- Guest session на 7 дней через HttpOnly cookie и request context.
- Development-friendly auth assertion routes для phone, Telegram и Max как каналов аккаунта.
- Уникальность phone/telegram/max identity без автоматического merge аккаунтов.
- Перенос guest context в аккаунт: временные баллы, uploads и selected unlock intent.
- Idempotent points ledger для начислений, списаний и корректировок.
- Ограничения автоначисления: один пользователь/VIN один раз навсегда, один пользователь/fingerprint один раз, один `report_fingerprint` автоматически дает балл максимум 3 пользователям.
- Upload flow начисляет реальные guest/user points через ledger boundary.
- Real access service: уже открытые VIN бесплатны, затем тратится подписочный лимит, затем 1 балл.
- Один балл или один подписочный лимит открывает сводный отчет по VIN навсегда, включая будущие обновления.
- Unlock intent и unlock flow подключены к реальному доступу.
- Full report route не раскрывает отчет без доступа и не читает full report до access grant.
- UI показывает auth/access status: тариф, остаток новых отчетов, баллы, locked/unlocked states.
- Проверки на `master`: `bun run test`, `bun run typecheck`, `bun run --cwd apps/web build`, `bun run --cwd apps/api db:generate`.

Главная следующая цель: построить полноценный Full Report UI, share-ссылки и PDF export в Milestone 5.

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

Статус: готов на `master` 2026-05-13.

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

Статус: готов на `master` 2026-05-14.

Цель: главный пользовательский сценарий начинает работать на данных.

Готово:

- Search API по VIN/госномеру/ссылке.
- Snapshot объявления по authless Avito URL с приватным хранением raw HTML metadata.
- Candidate preview cards.
- Preview rules: фото если безопасно, марка/модель/год, цена/пробег, частично скрытый VIN, без госномера.
- Empty state: отчета пока нет, загрузите отчет.
- UI экран результатов и preview-карточек.
- Unlock boundary без реального списания баллов/подписок.
- Full report API закрыт без access grant.
- Source-brand leak guard для search/report пользовательских responses.
- Bounded authless fetch: timeout, content-type guard, content-length guard, streamed max byte limit.

MVP-ограничения:

- Госномер ищется только по внутренним `vehicle_identifiers`; внешние lookup-источники появятся позже.
- Authless Avito URL используется только для preview snapshot; названия сторонних сервисов не показываются как источники конкретных фактов.
- Auto.ru и Drom URL распознаются, но parser/capture не входят в Milestone 3.
- Ledger, auth, подписки и настоящее списание доступа остаются в Milestone 4.

Exit criteria:

- Пользователь вводит VIN/госномер/ссылку и видит кандидатов.
- Full report не раскрывается без доступа.
- Ошибочный выбор кандидата не создает возврат балла.
- `bun run test`, `bun run typecheck`, `bun run --cwd apps/web build`, `bun run --cwd apps/api db:generate` зеленые.

## Milestone 4: Auth, Guest Session, Points Ledger

Статус: готов на `master` 2026-05-15.

Цель: гость может начать сценарий без регистрации, затем закрепить доступ в аккаунте.

Готово:

- Guest session на 7 дней.
- Auth через Telegram, Max, телефон как каналы аккаунта в MVP assertion-режиме.
- Уникальность phone/telegram/max identity.
- Перенос guest context в аккаунт.
- Points ledger: начисления, списания, корректировки, idempotency.
- Access service: подписочный лимит сначала, потом баллы.
- UI статуса: тариф/остаток новых отчетов/баллы.
- Unlock boundary подключен к реальному access service.
- Full report защищен реальным доступом.

MVP-ограничения:

- Real Telegram/Max bot callbacks, SMS OTP и billing provider integration остаются для следующих milestones.
- Guests не видят full report; unlock intent сохраняется до входа.
- OCR, Auto.ru parser и Drom parser не входят.

Exit criteria:

- Гость может загрузить отчет, получить временный балл и после входа сохранить его.
- Один пользователь не получает балл за один VIN больше одного раза.
- Один `report_fingerprint` автоматически дает балл максимум 3 разным пользователям.
- Повторный unlock уже открытого VIN не тратит подписочный лимит или баллы.
- Новый unlock тратит подписочный лимит раньше баллов.
- Full report не раскрывается без доступа.

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

Следующая сессия должна начать с Milestone 5.

Первый рабочий результат следующей сессии:

1. Создать implementation plan для `Full Report UI, Share, And PDF Export`.
2. Сверить утвержденный порядок разделов full report с текущим read model и определить недостающие поля.
3. Построить защищенный full report экран: доступ только после access grant, без брендов источников конкретных фактов и без персональных данных людей.
4. Добавить явные empty states: критичные пустые разделы показывают `данных не найдено на дату обновления`, старые данные помечаются датой.
5. Спроектировать share-ссылку на 7 дней: token access, noindex, без PDF download и без resharing.
6. Спроектировать PDF export в нашем оформлении, без копирования сторонних отчетов и без раскрытия закрытых raw artifacts.
7. Подготовить tests-first план и review gates для API, UI, share expiry, noindex и report-data leak guards.
