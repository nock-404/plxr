/* A click on a notification, arriving through the settings.
 *
 * The plxr window posts the notifications from its own process, and a click
 * there has no wire into this page: the page loads the service's address, so
 * nothing the window pushes at it is ever run. What both sides share is the
 * service, so the window writes {focusSession: {id, seq}} into the settings
 * and every page reads it on the revision watch it already keeps.
 *
 * The seq is what makes a request a new one. A page that just started reads
 * the last seq without opening anything — a reload must not open the session
 * the last click opened an hour ago — and from then on opens the session
 * whenever the seq changes. Two windows both open it; that is what a click
 * means.
 */
import type { FocusRequest } from "./types";

// requestedFocus reads the request out of the settings, or null when there
// is none or it is not shaped as one.
export function requestedFocus(prefs: unknown): FocusRequest | null {
  if (!prefs || typeof prefs !== "object") return null;
  const raw = (prefs as { focusSession?: unknown }).focusSession;
  if (!raw || typeof raw !== "object") return null;
  const { id, seq } = raw as { id?: unknown; seq?: unknown };
  if (typeof id !== "string" || !id || typeof seq !== "number" || !Number.isFinite(seq)) return null;
  return { id, seq };
}

// freshFocus says which session to open now: the requested one, when its seq
// is not the one this page has already seen. A page that has seen none yet
// (the first read failed) opens it — better one session opened twice than a
// click that did nothing.
export function freshFocus(prefs: unknown, seen: number | undefined): FocusRequest | null {
  const f = requestedFocus(prefs);
  if (!f || f.seq === seen) return null;
  return f;
}
