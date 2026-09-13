"use client";

/* Which session this page has in front, told to the service.
 *
 * A notification about the session somebody is already looking at is not one
 * they need. The service holds it back while a page that has focus shows that
 * session in its active panel — so the page says which session that is when
 * the active panel changes, when the page gains or loses focus, when it is
 * hidden, and again every fifteen seconds while it has focus. The service
 * forgets a page that has been quiet for 45 seconds, so a page that went away
 * without a word stops holding anything back soon after.
 *
 * Focus is the document's: a plxr window behind another application, or a
 * browser tab in the background, has none, and its session is said as usual.
 */
import { api } from "./api";

const REPEAT = 15000;

// Random per page load. Not a secret, only a name for this page's word, so
// the service can replace it rather than pile it up.
const page = Math.random().toString(36).slice(2) + Date.now().toString(36);

let session = "";
let said = "";
let started = false;

function focused(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

function say(again = false): void {
  const now = `${session} ${focused()}`;
  if (!again && now === said) return;
  said = now;
  void api.notifyFront(page, session, focused()).catch(() => {
    // Said again on the next change or the next repeat.
    said = "";
  });
}

function start(): void {
  if (started) return;
  started = true;
  window.addEventListener("focus", () => say());
  window.addEventListener("blur", () => say());
  document.addEventListener("visibilitychange", () => say());
  window.addEventListener("pagehide", () => {
    void api.notifyFront(page, "", false).catch(() => undefined);
  });
  window.setInterval(() => {
    if (session && focused()) say(true);
  }, REPEAT);
}

// showFront records the session in this page's active panel, "" for none.
export function showFront(id: string): void {
  if (typeof window === "undefined") return;
  start();
  session = id;
  say();
}
