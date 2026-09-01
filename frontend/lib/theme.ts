"use client";

import { crtPalette } from "./crtPalette";

// Theme state rides on <html>: data-skin picks the structural dressing,
// data-theme the palette, and a few tokens are tuned live. Persisted per
// viewer; every storage access is guarded so a locked-down store never breaks
// the page.
export type Skin = "crt" | "win95" | "sketch" | "pixel";

/* A palette is either one the daemon ships (by theme name) or the CRT hue
   generator. The skin brings the shape; the palette only swaps tokens. */
export type Palette = string;

/* The colours a palette is made of. Empty unless something was changed by hand:
   what is not in here comes from the theme, so switching theme still works. */
export type Colours = Partial<Record<(typeof TOKENS)[number], string>>;

export interface ThemeState {
  skin: Skin;
  /* A theme name from the daemon, or "custom" for the generated CRT palette. */
  palette: Palette;
  /* Switched, not baked into a skin, so they work in all of them. */
  seethrough: boolean;
  gradient: boolean;
  glowOn: boolean;
  flickerOn: boolean;
  /* How macOS meets what is behind the window. Not a stylesheet setting: the
     window is built with it, so changing it restarts the window. */
  backdrop: "clear" | "frosted" | "glass";
  /* How wide the docked panels are, in rem. Kept with everything else that is
     remembered, so a second window opens the way the first one was left. */
  settingsWidth: number;
  scanOn: boolean;
  /* Colours changed by hand, on top of whatever the palette says. */
  colours: Colours;
  /* How much of the window and its panels is left standing, in percent, and
     how hard what is behind them is blurred. Numbers, not a switch: "a bit
     see-through" is a different thing from "barely there". */
  /* How much of the palette's own colour is washed over the frost. The frost
     itself is grey — this is what makes it read as glass of a colour. */
  tint: number;
  windowSolid: number;
  panelSolid: number;
  blur: number;
  gradientStrength: number;
  glow: number;
  scan: number;
  size: number;
  termSize: number;
  /* The CRT skin is one theme with a colour: hue drives the whole palette. */
  hue: number;
  brightness: number;
  saturation: number;
}

export const DEFAULTS: ThemeState = {
  skin: "crt", palette: "green",
  seethrough: true, gradient: true, glowOn: true, scanOn: true,
  tint: 14, windowSolid: 46, panelSolid: 62, blur: 1.375, gradientStrength: 7,
  colours: {},
  flickerOn: false,
  backdrop: "frosted",
  settingsWidth: 26,
  glow: 0.35, scan: 0.09, size: 0.9375, termSize: 0.8125,
  // Brightness is the value of the picked colour now, not a contrast target,
  // so 50 would be a genuinely dim screen. 74 is the tube as it looked before.
  hue: 140, brightness: 74, saturation: 100,
};
const KEY = "plxr.theme";

export function load(): ThemeState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ThemeState>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/* Where the look is kept.
 *
 * Not in the window's own storage alone: in the native window that storage is
 * written nowhere the app can find again, so every restart came up on the
 * defaults and looked like a bug in whatever had just been changed. The daemon
 * holds the copy that lasts; localStorage stays as the immediate one, so the
 * skin is already right on the first paint instead of flashing.
 */
export function save(state: ThemeState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — the daemon copy below still keeps it */
  }
  void keep(state);
}

// Set by App once the daemon has answered, so a save before that cannot write
// the defaults over what is stored.
let keep: (state: ThemeState) => Promise<void> = async () => {};

export function persistVia(fn: (state: ThemeState) => Promise<void>): void {
  keep = fn;
}

// Take the daemon's copy as this window's own, without writing it back — it
// came from there. Without this the settings panel would still show what this
// window happened to have stored, next to a screen dressed in something else.
export function adopt(state: ThemeState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* nothing to adopt it into; the applied look is still correct */
  }
}

const TOKENS = [
  "bg", "panel", "fg", "accent", "dim", "dead", "line",
  "working", "waiting", "blocked", "onAccent", "term-bg", "term-fg",
] as const;

/* Palettes the daemon serves, keyed by theme name. Filled once at startup so
   apply() stays synchronous. */
let served: Record<string, Record<string, string>> = {};

// Which skin each served palette was made for. Kept, because a palette applied
// to the wrong skin is the defect below.
let belongsTo: Record<string, string> = {};

export function rememberThemes(themes: { name: string; skin?: string; palette: Record<string, string> }[]): void {
  served = Object.fromEntries(themes.map((t) => [t.name, t.palette]));
  belongsTo = Object.fromEntries(themes.map((t) => [t.name, t.skin ?? ""]));
}

/* A palette belongs to a skin, and only that skin.
 *
 * The list of palettes is filtered by the skin that is on — but changing the
 * skin left whatever palette was already chosen standing. Pick Windows 95, pick
 * its palette, go back to the tube: the tube then got painted with Windows 95's
 * greys, a combination the list would never have offered and which came out as
 * a window with no colour in it anywhere. It looked like the palette had broken.
 *
 * So the pairing is made valid wherever a state is taken on, rather than only
 * where it is offered.
 */
export function fitPalette(state: ThemeState): ThemeState {
  if (state.palette === "custom") return state;
  // The tube brings two of its own that are not served as files.
  if (state.skin === "crt" && (state.palette === "green" || state.palette === "amber")) return state;
  if (belongsTo[state.palette] === state.skin) return state;
  const own = Object.keys(belongsTo).find((name) => belongsTo[name] === state.skin);
  return { ...state, palette: (state.skin === "crt" ? "green" : own) ?? "custom" };
}

export function apply(state: ThemeState): void {
  const root = document.documentElement;
  root.setAttribute("data-skin", state.skin);
  root.setAttribute("data-theme", state.palette);

  // The page behind everything: a gradient, and the window being see-through.
  // Both live here rather than in a skin, so every skin can have them.
  const page = [state.seethrough ? "seethrough" : "", state.gradient ? "gradient" : ""]
    .filter(Boolean)
    .join(" ");
  if (page) root.setAttribute("data-pagebg", page);
  else root.removeAttribute("data-pagebg");

  root.setAttribute("data-glow", state.glowOn ? "on" : "off");
  root.setAttribute("data-scan", state.scanOn ? "on" : "off");
  root.setAttribute("data-flicker", state.flickerOn ? "on" : "off");
  root.style.setProperty("--tintStrength", String(state.tint));
  root.style.setProperty("--bgSolid", `${state.windowSolid}%`);
  root.style.setProperty("--panelSolid", `${state.panelSolid}%`);
  root.style.setProperty("--blur", `${state.blur}rem`);
  root.style.setProperty("--gradient", String(state.gradientStrength));
  root.style.setProperty("--glow", `${state.glowOn ? state.glow : 0}rem`);
  root.style.setProperty("--scan-alpha", String(state.scanOn ? state.scan : 0));
  root.style.setProperty("--settings-w", `${state.settingsWidth}rem`);
  root.style.setProperty("--size", `${state.size}rem`);
  root.style.setProperty("--term-size", `${state.termSize}rem`);

  // Clear first, so switching back to a palette that leaves a role unset really
  // falls back to the skin's own value instead of keeping the last one.
  for (const key of TOKENS) root.style.removeProperty(`--${key}`);

  if (state.palette === "custom") {
    const p = crtPalette(state.hue, state.brightness, state.saturation);
    for (const key of TOKENS) root.style.setProperty(`--${key}`, p[key]);
    for (const [key, value] of Object.entries(state.colours ?? {})) {
      if (value) root.style.setProperty(`--${key}`, value);
    }
    announce();
    return;
  }
  const palette = served[state.palette];
  if (palette) {
    for (const [key, value] of Object.entries(palette)) {
      if ((TOKENS as readonly string[]).includes(key)) root.style.setProperty(`--${key}`, value);
    }
  }

  // What was changed by hand wins over the palette, and only that — everything
  // untouched still follows the theme.
  for (const [key, value] of Object.entries(state.colours ?? {})) {
    if (value) root.style.setProperty(`--${key}`, value);
  }
  announce();
}

/* Everything CSS reaches is now correct. Not everything is reached by CSS.
 *
 * The terminal is drawn on a canvas by xterm, which is handed its colours and
 * its font size once, when it is created, and never looks at them again. So a
 * new palette, a new skin or a new size changed the whole window except the one
 * part of it that fills most of the screen — the terminal kept whatever it had
 * been born with until it was closed and opened again. Every one of those knobs
 * looked broken, and from where anybody was sitting it was.
 *
 * So the change is announced, and whoever draws outside CSS listens. */
export const THEME_CHANGED = "plxr:theme";

function announce(): void {
  try {
    window.dispatchEvent(new CustomEvent(THEME_CHANGED));
  } catch {
    /* no window yet — nothing is drawn, so nothing needs telling */
  }
}

// What a colour currently is, whether it came from the palette, a hand change
// or the skin's own default. The editor needs a value to show, not a blank.
export function currentColour(key: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${key}`).trim();
  return v || "#000000";
}

export const COLOUR_KEYS = TOKENS;
