/* The CRT palette out of one colour.

   Four themes were shipped for this skin — amber, green, ice, plasma — and
   measured they differ in exactly one thing: the hue. Inside each of them
   every role carries the same hue (amber 36-42°, green 130-138°), and the
   ladder of lightness is all but identical across the four: background at 3,
   panel at 7, lines at 16, text in the middle, accent at the top.

   So it is not four themes but one, with a colour. Four entries in a list for
   that is four times the same decision.

   Its own file so the arithmetic can be tested without a browser: app.js needs
   a document, a daemon and a language file before it will even load, and a
   check that has to boot all of that to divide two numbers is a check nobody
   runs.
*/
(() => {
  'use strict';

  const channelLuminance = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const contrastOf = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  function crtPalette(hue, brightness = 50, saturation = 100) {
    const h = ((Math.round(hue) % 360) + 360) % 360;
    /* How much colour is in it. The picker offers a whole square and only the
       hue strip used to do anything — an area you can drag that changes
       nothing is worse than no area. Sideways is this. */
    const sat = (v) => Math.round(v * Math.max(0, Math.min(100, saturation)) / 100);
    /* How hard the tube glows. 0 is a dim screen in a bright room, 100 a fresh
       one in the dark; 50 lands where the four hand-made palettes sat.

       It is a target contrast, not a lightness — a yellow at a given lightness
       is bright and a blue at the same one is not, so a lightness slider would
       mean something different at every hue. Whatever comes out, the quiet
       roles never fall below the readability floor: this can be turned down,
       not turned into an unreadable screen. */
    const b = Math.max(0, Math.min(100, brightness));
    const textTarget = 6 + (b / 100) * 10;          // 6 … 16, 11 in the middle
    const accentTarget = Math.min(17, textTarget * 1.25);
    const bg = hsl(h, sat(45), 3.5);
    const panel = hsl(h, sat(48), 7);
    const grounds = [bg, panel];
    /* Text first and brightest, then the quieter roles below it — each one only
       as bright as it has to be, so the ladder survives. */
    /* The middle of the range is measured, not picked: off the four palettes
       this replaces, where text sat at about 11 to 1 against the panel and the
       accent at 14. Aiming at the readability floor instead gave a noticeably
       darker, more saturated picture than the amber everyone knows. */
    const fg = lightEnough(h, sat(100), grounds, textTarget);
    const accent = lightEnough(h, sat(100), grounds, accentTarget);
    const dim = lightEnough(h, sat(62), grounds, 4.7);
    const dead = lightEnough(h, sat(45), grounds, 4.6);
    return {
      bg, panel, fg, accent, dim, dead,
      line: hsl(h, sat(50), 16),
      working: accent,
      waiting: dim,
      // A hue of its own, well away from the rest: a warning that carries the
      // same colour as everything else is no warning.
      blocked: lightEnough((h + 150) % 360, Math.max(60, sat(100)), grounds, 4.6),
      onAccent: bg,
      'term-bg': bg,
      'term-fg': fg,
    };
  }

  const hsl = (h, s, l) => {
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const v = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
      return Math.round(v * 255).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };

  /* The lowest lightness at which this hue still clears `need` on every ground.
     Walked rather than calculated, because the answer depends on the hue and a
     formula for it would be longer than the loop. */
  function lightEnough(h, s, grounds, need) {
    for (let l = 20; l <= 96; l += 1.5) {
      const colour = hsl(h, s, l);
      if (grounds.every((g) => contrastOf(luminanceOf(colour), luminanceOf(g)) >= need)) {
        return colour;
      }
    }
    return hsl(h, s, 96);
  }

  function luminanceOf(hex) {
    const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return 0;
    const [r, g, b] = m.slice(1).map((x) => channelLuminance(parseInt(x, 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  window.plxrPalette = { crt: crtPalette, hsl, lightEnough, luminanceOf };
})();
