"use client";

import { api } from "./api";
import { setKeymap } from "./keymap";
import { THEME_CHANGED } from "./theme";

/* The terminal's and the editor's own settings.
 *
 * They ride on the same prefs blob as the look — the service merges by key,
 * so `terminal`, `editor` and `keymap` are three more top-level keys beside
 * `theme` and `dock`, and a second window picks a change up through the same
 * revision watch. No endpoint of their own.
 *
 * Held here in memory so the terminal and the editor can read them
 * synchronously when they are built, and announced over THEME_CHANGED when
 * they change so a running terminal or editor takes them at once — the same
 * wire the palette already travels on.
 */
export type TerminalPrefs = {
  scrollback: number;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  /* How the cursor is drawn while the terminal does not have the keyboard —
     an outline by default, so a pane that is not being typed in says so. */
  cursorInactive: "outline" | "block" | "bar" | "underline" | "none";
  /* The typeface's weight for plain and for bold text, as xterm names them. */
  fontWeight: TerminalWeight;
  fontWeightBold: TerminalWeight;
  /* Row pitch as a multiple of the font size, and the room added between
     characters in rem — the same unit as every other size in the window;
     xterm is handed the pixel value at apply time. */
  lineHeight: number;
  letterSpacing: number;
  /* The smallest contrast xterm may draw text at; 1 leaves the palette alone. */
  minContrast: number;
  /* Bold text takes the bright half of the palette, the way most terminals do. */
  boldBright: boolean;
  /* The sound a BEL plays, from the notification sounds; empty for none. The
     frame flashes either way. */
  bellSound: string;
};

export type TerminalWeight = "300" | "normal" | "500" | "600" | "bold";
export const TERMINAL_WEIGHTS: TerminalWeight[] = ["300", "normal", "500", "600", "bold"];
export const CURSOR_INACTIVE: TerminalPrefs["cursorInactive"][] = ["outline", "block", "bar", "underline", "none"];

export type EditorPrefs = {
  /* Which keymap the editor answers to: the full default set, the smaller
     standard set without the ⌥ bindings, or the emacs-style one. */
  keymap: "default" | "standard" | "emacs";
  wrap: boolean;
  tabSize: 2 | 4 | 8;
};

export const DEFAULT_TERMINAL: TerminalPrefs = {
  scrollback: 10000,
  cursorStyle: "block",
  cursorBlink: true,
  cursorInactive: "outline",
  fontWeight: "normal",
  fontWeightBold: "bold",
  lineHeight: 1.15,
  letterSpacing: 0,
  minContrast: 1,
  boldBright: true,
  bellSound: "",
};
export const DEFAULT_EDITOR: EditorPrefs = { keymap: "default", wrap: true, tabSize: 2 };

let terminal: TerminalPrefs = DEFAULT_TERMINAL;
let editor: EditorPrefs = DEFAULT_EDITOR;

/* The ceiling on the five-hour spend, in tokens — the user's own target, not
   the plan's real cap, which plxr cannot see. Zero means none is set. It rides
   the same blob under `paceLimit`; the service reads the same key to say one
   word when the spend crosses it, so nothing here is the only copy. Announced
   on its own wire, so the readout in every window recolours when a second
   window moves it. */
export const PACE_LIMIT_CHANGED = "plxr:pace-limit";
let limit = 0;

export function paceLimit(): number {
  return limit;
}

function fitPaceLimit(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function announcePaceLimit(): void {
  try {
    window.dispatchEvent(new CustomEvent(PACE_LIMIT_CHANGED, { detail: limit }));
  } catch {
    /* no window yet — nothing is drawn, so nothing needs telling */
  }
}

export function terminalPrefs(): TerminalPrefs {
  return terminal;
}

export function editorPrefs(): EditorPrefs {
  return editor;
}

function announce(): void {
  try {
    window.dispatchEvent(new CustomEvent(THEME_CHANGED));
  } catch {
    /* no window yet — nothing is drawn, so nothing needs telling */
  }
}

// A number within its range, or the default when it is missing or absurd.
function between(raw: unknown, low: number, high: number, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(high, Math.max(low, n)) : fallback;
}

function fitTerminal(raw: unknown): TerminalPrefs {
  const p = (raw ?? {}) as Partial<TerminalPrefs>;
  const scrollback = Number(p.scrollback);
  const weight = (w: unknown, fallback: TerminalWeight): TerminalWeight =>
    TERMINAL_WEIGHTS.includes(w as TerminalWeight) ? (w as TerminalWeight) : fallback;
  return {
    scrollback: Number.isFinite(scrollback) && scrollback >= 0 ? Math.min(200000, Math.round(scrollback)) : DEFAULT_TERMINAL.scrollback,
    cursorStyle: p.cursorStyle === "underline" || p.cursorStyle === "bar" ? p.cursorStyle : "block",
    cursorBlink: typeof p.cursorBlink === "boolean" ? p.cursorBlink : DEFAULT_TERMINAL.cursorBlink,
    cursorInactive: CURSOR_INACTIVE.includes(p.cursorInactive as TerminalPrefs["cursorInactive"])
      ? (p.cursorInactive as TerminalPrefs["cursorInactive"])
      : DEFAULT_TERMINAL.cursorInactive,
    fontWeight: weight(p.fontWeight, DEFAULT_TERMINAL.fontWeight),
    fontWeightBold: weight(p.fontWeightBold, DEFAULT_TERMINAL.fontWeightBold),
    lineHeight: between(p.lineHeight, 1, 2, DEFAULT_TERMINAL.lineHeight),
    letterSpacing: between(p.letterSpacing, 0, 0.25, DEFAULT_TERMINAL.letterSpacing),
    minContrast: between(p.minContrast, 1, 21, DEFAULT_TERMINAL.minContrast),
    boldBright: typeof p.boldBright === "boolean" ? p.boldBright : DEFAULT_TERMINAL.boldBright,
    bellSound: typeof p.bellSound === "string" ? p.bellSound : DEFAULT_TERMINAL.bellSound,
  };
}

function fitEditor(raw: unknown): EditorPrefs {
  const p = (raw ?? {}) as Partial<EditorPrefs>;
  return {
    keymap: p.keymap === "standard" || p.keymap === "emacs" ? p.keymap : "default",
    wrap: typeof p.wrap === "boolean" ? p.wrap : DEFAULT_EDITOR.wrap,
    tabSize: p.tabSize === 4 || p.tabSize === 8 ? p.tabSize : 2,
  };
}

/* adoptPrefs takes the service's copy — at startup and whenever the revision
   moves — and tells the drawn things only if something they read changed. */
export function adoptPrefs(prefs: Record<string, unknown>): void {
  const nextTerminal = fitTerminal(prefs.terminal);
  const nextEditor = fitEditor(prefs.editor);
  const moved = JSON.stringify(nextTerminal) !== JSON.stringify(terminal) || JSON.stringify(nextEditor) !== JSON.stringify(editor);
  terminal = nextTerminal;
  editor = nextEditor;
  setKeymap(prefs.keymap as Record<string, unknown> | undefined);
  if (moved) announce();
  const nextLimit = fitPaceLimit(prefs.paceLimit);
  if (nextLimit !== limit) {
    limit = nextLimit;
    announcePaceLimit();
  }
}

/* setPaceLimit writes the ceiling and tells this window at once; the other
   windows take it from the revision watch. Cleared (0) means the key is
   dropped from the blob rather than stored as a zero. */
export function setPaceLimit(n: number): number {
  limit = fitPaceLimit(n);
  void api.setPrefs({ paceLimit: limit > 0 ? limit : null }).catch(() => undefined);
  announcePaceLimit();
  return limit;
}

export function setTerminalPrefs(patch: Partial<TerminalPrefs>): TerminalPrefs {
  terminal = fitTerminal({ ...terminal, ...patch });
  void api.setPrefs({ terminal }).catch(() => undefined);
  announce();
  return terminal;
}

export function setEditorPrefs(patch: Partial<EditorPrefs>): EditorPrefs {
  editor = fitEditor({ ...editor, ...patch });
  void api.setPrefs({ editor }).catch(() => undefined);
  announce();
  return editor;
}

/* saveKeymap writes the rebound rows and applies them here at once, rather
   than waiting for the revision watch to hand them back. */
export function saveKeymap(overrides: Record<string, string>): void {
  setKeymap(overrides);
  void api.setPrefs({ keymap: overrides }).catch(() => undefined);
}
