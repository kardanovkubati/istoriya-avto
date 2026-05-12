export type SearchDetectionResponse = {
  query: {
    kind: "vin" | "plate" | "listing_url" | "unsupported_url" | "unknown";
    normalized: string;
    original: string;
    host?: string;
  };
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export async function detectSearchQuery(query: string): Promise<SearchDetectionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/search/detect`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    throw new Error("Не удалось проверить запрос.");
  }

  return response.json() as Promise<SearchDetectionResponse>;
}
