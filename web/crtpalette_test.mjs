/* Does a freely picked colour still give a readable interface?

   That is the whole risk of this idea. Four hand-made palettes could be looked
   at; a colour picker cannot — whoever drags it to yellow-green gets a hue
   whose lightness behaves nothing like the blue one two degrees of the wheel
   away. So it is not checked for four colours but for all of them.
*/
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {}, Math, Number, String, Object, Array, JSON };
sandbox.globalThis = sandbox;
runInContext(readFileSync(join(here, 'crtpalette.js'), 'utf8'), createContext(sandbox));

const { crt, luminanceOf } = sandbox.window.plxrPalette;
const contrast = (a, b) => {
  const x = luminanceOf(a), y = luminanceOf(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

let failed = 0;
const check = (ok, what) => { if (!ok) { failed = 1; console.error(`  FAILED: ${what}`); } };

/* Every degree of the wheel. Cheap, and a hole three degrees wide is exactly
   what a handful of samples walks past. */
let worstText = 99, worstQuiet = 99, worstAt = 0;
for (let hue = 0; hue < 360; hue++) {
  const p = crt(hue);
  for (const role of ['fg', 'accent', 'dim', 'dead', 'blocked', 'working', 'waiting']) {
    const onPanel = contrast(p[role], p.panel);
    const onBg = contrast(p[role], p.bg);
    if (Math.min(onPanel, onBg) < 4.5) {
      check(false, `hue ${hue}: --${role} ${p[role]} only reaches ${Math.min(onPanel, onBg).toFixed(2)}:1`);
    }
    if (role === 'fg' && onPanel < worstText) { worstText = onPanel; worstAt = hue; }
    if (role === 'dead' && onPanel < worstQuiet) worstQuiet = onPanel;
  }
  /* The ladder has to survive as a ladder: text brighter than the quiet roles,
     accent brighter than text. Otherwise every hue is readable and the
     interface still looks flat. */
  check(luminanceOf(p.fg) > luminanceOf(p.dim), `hue ${hue}: text is not brighter than the quiet colour`);
  check(luminanceOf(p.accent) >= luminanceOf(p.fg), `hue ${hue}: accent is not brighter than the text`);
  check(luminanceOf(p.panel) > luminanceOf(p.bg), `hue ${hue}: the panel does not stand out from the page`);
  /* Text on the accent surface: onAccent is the background, and it has to hold
     against a bright accent. */
  check(contrast(p.onAccent, p.accent) >= 4.5, `hue ${hue}: text on the accent only reaches ${contrast(p.onAccent, p.accent).toFixed(2)}:1`);
}

/* Turned all the way down it still has to be readable. That is the point of
   the floor: brightness is a dial, not a way to break the interface. */
for (let hue = 0; hue < 360; hue += 7) {
  for (const b of [0, 25, 50, 75, 100]) {
    const p = crt(hue, b);
    for (const role of ['fg', 'dim', 'dead', 'blocked']) {
      const worst = Math.min(contrast(p[role], p.panel), contrast(p[role], p.bg));
      check(worst >= 4.5, `hue ${hue} at brightness ${b}: --${role} only reaches ${worst.toFixed(2)}:1`);
    }
    check(luminanceOf(p.accent) >= luminanceOf(p.fg),
      `hue ${hue} at brightness ${b}: accent is not brighter than the text`);
  }
}
/* And it has to actually do something — a dial that changes nothing is worse
   than none. */
check(luminanceOf(crt(40, 100).fg) > luminanceOf(crt(40, 0).fg) * 1.5,
  'brightness barely changes the text colour');

/* A counter-test, otherwise this would pass with every value set to white:
   a warning has to be a different colour from the rest, not just readable. */
const amber = crt(40);
const hueOf = (hex) => {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/g).map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
};
const apart = Math.abs(hueOf(amber.blocked) - hueOf(amber.fg));
check(Math.min(apart, 360 - apart) > 60,
  `the warning colour sits only ${Math.round(apart)}° from the text colour`);

if (failed) { console.error('  crt palette: FAILED'); process.exit(1); }
console.log(`  360 hues, all readable (weakest text ${worstText.toFixed(2)}:1 at ${worstAt}°, weakest quiet ${worstQuiet.toFixed(2)}:1)`);
