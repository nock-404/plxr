"use client";

import { useSyncExternalStore } from "react";

/* Where the cursor stands in each open editor, for the status bar.
 *
 * The editor is a closed box inside a dock panel and the status bar is at the
 * foot of the window, two trees apart; threading a line number up through the
 * dock would re-render every panel on every arrow key. So each editor writes
 * its cursor here under its panel's id, and the status bar reads the one for
 * the panel in front.
 */
export type Caret = {
  line: number;
  col: number;
  // How the file ends its lines, as it was read: "LF", "CRLF" or "CR".
  eol: string;
  // What the file is written in. The service hands out only valid UTF-8 as
  // text — anything else arrives as binary and never reaches an editor.
  encoding: string;
};

const carets = new Map<string, Caret>();
const listeners = new Set<() => void>();

function tell(): void {
  for (const l of listeners) l();
}

// setCaret records the cursor of one editor panel; null when it closes.
export function setCaret(panelId: string, caret: Caret | null): void {
  const was = carets.get(panelId);
  if (!caret) {
    if (!was) return;
    carets.delete(panelId);
  } else {
    if (was && was.line === caret.line && was.col === caret.col && was.eol === caret.eol && was.encoding === caret.encoding) return;
    carets.set(panelId, caret);
  }
  tell();
}

function subscribe(changed: () => void): () => void {
  listeners.add(changed);
  return () => listeners.delete(changed);
}

// useCaret reads the cursor of one panel, or null when it is no editor.
export function useCaret(panelId: string): Caret | null {
  return useSyncExternalStore(
    subscribe,
    () => carets.get(panelId) ?? null,
    () => null,
  );
}

// lineEndings says how a text ends its lines, by the first ending in it.
export function lineEndings(text: string): string {
  const at = text.search(/\r\n|\r|\n/);
  if (at < 0) return "LF";
  if (text[at] === "\n") return "LF";
  return text[at + 1] === "\n" ? "CRLF" : "CR";
}
