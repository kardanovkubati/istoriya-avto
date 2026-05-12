import { FormEvent, useMemo, useState } from "react";
import { ArrowRight, BadgeCheck, Bell, FileUp, Search } from "lucide-react";
import { detectSearchQuery, type SearchDetectionResponse } from "./lib/api";

type DetectionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: SearchDetectionResponse }
  | { status: "error"; message: string };

const examples = ["A123BC777", "XTA210990Y2765432", "https://auto.ru/cars/used/sale/"];

const kindLabels: Record<SearchDetectionResponse["query"]["kind"], string> = {
  vin: "VIN",
  plate: "Госномер",
  listing_url: "Ссылка объявления",
  unsupported_url: "Неподдерживаемая ссылка",
  unknown: "Нужны уточнения"
};

function App() {
  const [query, setQuery] = useState("");
  const [detection, setDetection] = useState<DetectionState>({ status: "idle" });

  const trimmedQuery = query.trim();
  const canSubmit = trimmedQuery.length > 0 && detection.status !== "loading";

  const statusCopy = useMemo(() => {
    if (detection.status === "loading") {
      return {
        label: "Проверяем формат",
        title: "Определяем тип запроса",
        body: "Сейчас поймем, это VIN, госномер или ссылка объявления."
      };
    }

    if (detection.status === "success") {
      const { query: detected } = detection.data;
      return {
        label: kindLabels[detected.kind],
        title: detected.normalized,
        body: detected.host
          ? `Источник: ${detected.host}. Исходный запрос сохранен для дальнейшей проверки.`
          : "Запрос распознан и готов к следующему шагу проверки."
      };
    }

    if (detection.status === "error") {
      return {
        label: "Ошибка",
        title: "Не удалось проверить запрос",
        body: detection.message
      };
    }

    return {
      label: "Быстрый старт",
      title: "Введите ссылку, VIN или госномер",
      body: "Мы аккуратно определим тип запроса и подготовим основу для отчета."
    };
  }, [detection]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!trimmedQuery) {
      setDetection({
        status: "error",
        message: "Введите ссылку объявления, VIN или госномер."
      });
      return;
    }

    setDetection({ status: "loading" });

    try {
      const data = await detectSearchQuery(trimmedQuery);
      setDetection({ status: "success", data });
    } catch (error) {
      setDetection({
        status: "error",
        message: error instanceof Error ? error.message : "Не удалось проверить запрос."
      });
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar" aria-label="Основная навигация">
        <a className="brand" href="/" aria-label="История Авто">
          <span className="brand-mark">ИА</span>
          <span>История Авто</span>
        </a>
        <button className="account-pill" type="button">
          <Bell aria-hidden="true" size={16} />
          <span>Кабинет</span>
        </button>
      </header>

      <section className="search-section" aria-labelledby="search-title">
        <div className="section-copy">
          <p className="eyebrow">Проверка перед покупкой</p>
          <h1 id="search-title">История автомобиля начинается с одного запроса</h1>
          <p>
            Вставьте ссылку объявления, VIN или госномер. Сервис определит формат и
            подготовит проверку без лишних шагов.
          </p>
        </div>

        <form className="smart-input" onSubmit={handleSubmit}>
          <label htmlFor="search-query">Ссылка, VIN или госномер</label>
          <div className="input-row">
            <Search aria-hidden="true" size={20} />
            <input
              id="search-query"
              autoComplete="off"
              inputMode="text"
              placeholder="A123BC777 или ссылка объявления"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit" disabled={!canSubmit} aria-label="Проверить запрос">
              <ArrowRight aria-hidden="true" size={20} />
            </button>
          </div>
          <div className="examples" aria-label="Примеры запросов">
            {examples.map((example) => (
              <button key={example} type="button" onClick={() => setQuery(example)}>
                {example}
              </button>
            ))}
          </div>
        </form>
      </section>

      <section className={`status-panel status-${detection.status}`} aria-live="polite">
        <span>{statusCopy.label}</span>
        <h2>{statusCopy.title}</h2>
        <p>{statusCopy.body}</p>
      </section>

      <section className="quick-actions" aria-label="Быстрые действия">
        <article className="action-card">
          <FileUp aria-hidden="true" size={22} />
          <div>
            <h2>Загрузить документы</h2>
            <p>Добавьте фото СТС или ПТС, когда будет готов модуль проверки.</p>
          </div>
        </article>
        <article className="action-card">
          <BadgeCheck aria-hidden="true" size={22} />
          <div>
            <h2>Следить за отчетом</h2>
            <p>Получайте статус проверки и сохраняйте найденные автомобили.</p>
          </div>
        </article>
      </section>
    </main>
  );
}

export default App;
