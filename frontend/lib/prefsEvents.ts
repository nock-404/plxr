"use client";

import { api } from "./api";

/* Two windows, one prefs blob — announced.
 *
 * The shell watches the service's prefs revision and re-reads the blob when
 * it moves (App.tsx). The look, the terminal, the editor and the keymap take
 * their keys from that re-read through adoptPrefs; a panel that keeps its own
 * key in the same blob — the notes, the session grid's density — has no such
 * wire, so each window would show whatever it last wrote until a restart.
 *
 * So the re-read is announced once, with the whole blob as the detail, and
 * any panel that keeps a key in it listens. A window's own write comes back
 * through the same wire a moment later; a listener with an edit in flight
 * leaves its copy alone, so nothing is typed over. */
export const PREFS_CHANGED = "plxr:prefs";

export function announcePrefs(prefs: Record<string, unknown>): void {
  try {
    window.dispatchEvent(new CustomEvent(PREFS_CHANGED, { detail: prefs }));
  } catch {
    /* no window yet — nothing is drawn, so nothing needs telling */
  }
}

/* The overview's density, set from outside the panel — the MENU's and the
   palette's "Session grid" open the overview packed tight. Written to prefs
   for the other windows and the next start, and announced here so the panel
   switches at once whether or not it was already on screen. */
export const OVERVIEW_DENSE = "plxr:overview-dense";

export function setDense(on: boolean): void {
  void api.setPrefs({ overviewDense: on }).catch(() => undefined);
  try {
    window.dispatchEvent(new CustomEvent(OVERVIEW_DENSE, { detail: on }));
  } catch {
    /* no window yet */
  }
}
