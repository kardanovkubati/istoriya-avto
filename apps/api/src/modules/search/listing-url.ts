export type ListingUrlIdentity =
  | {
      kind: "avito";
      listingId: string;
      canonicalUrl: string;
    }
  | {
      kind: "recognized_uncaptured";
      family: "auto_ru" | "drom";
    }
  | {
      kind: "unsupported";
    };

const AVITO_HOSTS = new Set(["avito.ru", "www.avito.ru"]);
const AUTO_RU_HOSTS = new Set(["auto.ru", "www.auto.ru"]);
const DROM_HOSTS = new Set(["drom.ru", "www.drom.ru", "auto.drom.ru"]);

export function parseSupportedListingUrl(value: string): ListingUrlIdentity {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { kind: "unsupported" };
  }

  const host = url.host.toLowerCase();
  if (AUTO_RU_HOSTS.has(host)) return { kind: "recognized_uncaptured", family: "auto_ru" };
  if (DROM_HOSTS.has(host)) return { kind: "recognized_uncaptured", family: "drom" };

  if (!AVITO_HOSTS.has(host)) return { kind: "unsupported" };

  const listingId = url.pathname.match(/_(\d{6,})(?:\/)?$/)?.[1] ?? null;
  if (listingId === null) return { kind: "unsupported" };

  return {
    kind: "avito",
    listingId,
    canonicalUrl: `${url.origin}${url.pathname.replace(/\/$/, "")}`
  };
}
