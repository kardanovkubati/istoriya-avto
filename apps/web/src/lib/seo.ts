export function shareTokenFromHash(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const match = /^#\/share\/([^/?#]+)/.exec(window.location.hash);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function ensureRobotsMeta(): HTMLMetaElement {
  const existing = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (existing !== null) {
    return existing;
  }

  const meta = document.createElement("meta");
  meta.setAttribute("name", "robots");
  document.head.append(meta);
  return meta;
}
