"use client";

// The daemon hands the token over once through the address bar. We stash it in
// sessionStorage, scrub it from the URL, and send it as a header from then on —
// exactly the handshake the daemon expects.
let cached: string | null = null;

export function base(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

export function token(): string {
  if (cached !== null) return cached;
  if (typeof window === "undefined") return "";
  const fromUrl = new URLSearchParams(window.location.search).get("token");
  if (fromUrl) {
    try {
      sessionStorage.setItem("plxr.token", fromUrl);
    } catch {
      /* private mode — the header still works for this page load */
    }
    window.history.replaceState(null, "", window.location.pathname);
    cached = fromUrl;
  } else {
    try {
      cached = sessionStorage.getItem("plxr.token") ?? "";
    } catch {
      cached = "";
    }
  }
  return cached;
}

export function wsUrl(path: string): string {
  const b = base().replace(/^http/, "ws");
  const sep = path.includes("?") ? "&" : "?";
  return `${b}${path}${sep}token=${encodeURIComponent(token())}`;
}
