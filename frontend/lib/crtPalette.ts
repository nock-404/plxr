// The palette out of one picked colour.
//
// Four themes used to ship for this skin — amber, green, ice, plasma — and
// measured they differ in exactly one thing: the hue. Inside each of them every
// role carries the same hue and the same ladder underneath it. So it is not
// four themes but one, with a colour.
//
// The colour is picked the way colours are picked everywhere else: a hue, and a
// point in a square where across is saturation and down is brightness. That
// point is the text colour. Every other role sits at a fixed fraction of its
// brightness, so turning brightness down takes the whole screen with it —
// towards black, which is what turning brightness down means.
//
// An earlier version aimed each role at a contrast ratio instead, with a floor
// under it so text could never become hard to read. It could therefore never
// become dark either: the floor held the screen up no matter where the slider
// went. Readability is worth protecting, but not by ignoring the control.
//
// Its own file so the arithmetic can be tested without a browser.

export interface Palette {
  bg: string; panel: string; fg: string; accent: string; dim: string; dead: string;
  line: string; working: string; waiting: string; blocked: string; onAccent: string;
  "term-bg": string; "term-fg": string;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

// Hue in degrees, saturation and value in percent — the axes of the picker.
export function hsv(h: number, s: number, v: number): string {
  const sn = clamp(s) / 100;
  const vn = clamp(v) / 100;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const x = vn - vn * sn * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(x * 255).toString(16).padStart(2, "0");
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

const channelLuminance = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function luminanceOf(hex: string): number {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return 0;
  const [r, g, b] = m.slice(1).map((x) => channelLuminance(parseInt(x, 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Where each role sits, as a share of the picked brightness. Text is the point
// itself; the grounds are far below it and the accent is the one thing allowed
// above. Fractions rather than fixed values, so the whole ladder travels.
const LADDER = {
  bg: 0.09,
  panel: 0.17,
  line: 0.34,
  dead: 0.52,
  dim: 0.74,
  fg: 1,
  accent: 1.18,
} as const;

// The grounds keep some colour but never the full amount: a background at full
// saturation is a coloured wall, not a background.
const GROUND_SAT = 0.46;

export function crtPalette(hue: number, brightness = 74, saturation = 100): Palette {
  const h = ((Math.round(hue) % 360) + 360) % 360;
  const s = clamp(saturation);
  const v = clamp(brightness);
  const at = (share: number, sat = s) => hsv(h, sat, clamp(v * share));

  const bg = at(LADDER.bg, s * GROUND_SAT);
  const fg = at(LADDER.fg);
  const dim = at(LADDER.dim);
  const accent = at(LADDER.accent);
  return {
    bg,
    panel: at(LADDER.panel, s * GROUND_SAT),
    line: at(LADDER.line, s * GROUND_SAT),
    dead: at(LADDER.dead, s * 0.62),
    dim,
    fg,
    accent,
    working: accent,
    waiting: dim,
    // A hue of its own, well away from the rest: a warning carrying the same
    // colour as everything else is no warning. It rides the same ladder, so it
    // darkens along with the screen instead of staying behind as a bright spot.
    blocked: hsv((h + 150) % 360, clamp(Math.max(58, s)), clamp(v * LADDER.dim)),
    onAccent: bg,
    "term-bg": bg,
    "term-fg": fg,
  };
}
