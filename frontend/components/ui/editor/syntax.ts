"use client";

/* The colours code is written in.
 *
 * The editor used to draw every kind of token in one of four colours the skin
 * already had — text, accent, "working" and dim — so a string, a number, a type
 * and a function name all came out the same. Measured in a Go file: three
 * different colours on screen in all. Code read as one grey block, which is
 * what he meant by the editor being no good.
 *
 * A skin may say what code looks like, token by token, with --code-* variables.
 * Where it says nothing, the colours are worked out from the palette itself:
 * the accent's hue is the anchor and the rest sit at fixed distances around the
 * circle, at the palette's own saturation and lightness. So every skin keeps
 * its character — green tube, grey Windows, pencil on paper — and code is still
 * told apart at a glance.
 */

export type CodeColours = {
  keyword: string;
  string: string;
  number: string;
  comment: string;
  type: string;
  func: string;
  variable: string;
  operator: string;
  invalid: string;
};

// The eight kinds, and where each sits from the accent, in degrees.
const TURN: Record<keyof Omit<CodeColours, "invalid">, number> = {
  keyword: 0,
  func: 40,
  type: 80,
  string: 130,
  number: 175,
  variable: 210,
  operator: 300,
  comment: 0,
};

const hex = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");

/* Whatever a skin wrote, in numbers.
 *
 * A palette says its colours the way a person writes them: "#000", "navy",
 * "color-mix(…)". Reading those by hand means knowing every form CSS has, and
 * the one form that was missing — the colour name — left Windows 95 with the
 * four colours it had before. The browser knows them all, so it is asked: the
 * value is put on a span that is in the page but not seen, and read back. */
let probe: HTMLSpanElement | null = null;
function asRgb(colour: string): string {
  if (typeof document === "undefined" || !document.body) return colour;
  if (!probe || !probe.isConnected) {
    probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.display = "none";
    document.body.appendChild(probe);
  }
  probe.style.color = "";
  probe.style.color = colour;
  // Nothing took: the value is not a colour this browser knows.
  if (!probe.style.color) return "";
  return getComputedStyle(probe).color || colour;
}

/* A colour as the browser hands it back — rgb(), color(srgb …) or a hex — read
   into three numbers 0…1. Anything it cannot read comes back null, and the
   caller keeps what the skin had. */
function read(colour: string): [number, number, number] | null {
  const trimmed = asRgb(colour).trim();
  if (!trimmed) return null;
  const rgb = /rgba?\(([^)]+)\)/.exec(trimmed);
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
  }
  const wide = /color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/.exec(trimmed);
  if (wide) return [Number(wide[1]), Number(wide[2]), Number(wide[3])];
  const short = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (short) return [0, 1, 2].map((i) => parseInt(short[1][i] + short[1][i], 16) / 255) as [number, number, number];
  const long = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (long) return [0, 2, 4].map((i) => parseInt(long[1].slice(i, i + 2), 16) / 255) as [number, number, number];
  return null;
}

function toHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function toHex([h, s, l]: [number, number, number]): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${hex((r + m) * 255)}${hex((g + m) * 255)}${hex((b + m) * 255)}`;
}

/* The colours for one skin. `token` reads a --variable off the root, the way
   the editor reads the rest of its look. */
export function codeColours(token: (name: string, fallback: string) => string): CodeColours {
  const accent = read(token("accent", "#8cf"));
  const fg = read(token("fg", "#dddddd"));
  const base: CodeColours = {
    keyword: token("accent", "#8cf"),
    string: token("working", "#6c6"),
    number: token("working", "#6c6"),
    comment: token("dim", "#888"),
    type: token("working", "#6c6"),
    func: token("accent", "#8cf"),
    variable: token("fg", "#ddd"),
    operator: token("dim", "#888"),
    invalid: token("blocked", "#f66"),
  };
  if (accent) {
    const [hue, sat, light] = toHsl(accent);
    const text = fg ? toHsl(fg) : null;
    /* Saturated enough to tell apart, light enough to read on the skin's own
       ground: the text's lightness is what the skin thinks is readable, and
       the accent's saturation is how loud it likes its colours. */
    const s = Math.max(0.35, Math.min(0.85, sat));
    const l = text ? Math.max(0.42, Math.min(0.78, text[2])) : light;
    for (const [kind, turn] of Object.entries(TURN) as [keyof typeof TURN, number][]) {
      base[kind] = toHex([(hue + turn) % 360, kind === "comment" ? s * 0.35 : s, kind === "comment" ? l * 0.72 : l]);
    }
    base.variable = token("fg", base.variable);
  }
  // Whatever a skin says itself wins over all of it.
  for (const kind of Object.keys(base) as (keyof CodeColours)[]) {
    const own = token(`code-${kind}`, "");
    if (own) base[kind] = own;
  }
  return base;
}
