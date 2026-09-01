/* The two axes do what their names say.
 *
 * This is the whole reason the arithmetic sits in its own file. The control was
 * once called brightness while aiming at a contrast ratio with a floor beneath
 * it, so the screen could not be made dark however far the slider went — and
 * nothing anywhere said so. A test that walks the axis and watches every role
 * would have said so on the first run.
 */
import { crtPalette, luminanceOf } from "./crtPalette.ts";

let failed = 0;
const claim = (ok, what) => {
  if (!ok) {
    console.error("  " + what);
    failed++;
  }
};

for (const hue of [0, 30, 120, 210, 300]) {
  // Down the square: every role darkens, none brightens.
  let above = null;
  for (let v = 100; v >= 0; v -= 5) {
    const p = crtPalette(hue, v, 100);
    if (above) {
      for (const role of Object.keys(p)) {
        claim(
          luminanceOf(p[role]) <= luminanceOf(above[role]) + 1e-9,
          `hue ${hue}: ${role} grew brighter going from ${v + 5} down to ${v}`,
        );
      }
    }
    above = p;
  }

  // The bottom edge is black. Dark means towards black, not towards dim.
  const bottom = crtPalette(hue, 0, 100);
  for (const role of Object.keys(bottom)) {
    claim(bottom[role] === "#000000", `hue ${hue}: ${role} is ${bottom[role]} at the bottom of the square, not black`);
  }

  // The left edge is grey — with one exception, on purpose: a warning that is
  // grey among greys is not a warning, so `blocked` keeps a floor of colour.
  const left = crtPalette(hue, 74, 0);
  for (const [role, colour] of Object.entries(left)) {
    if (role === "blocked") continue;
    const [r, g, b] = colour.slice(1).match(/../g).map((x) => parseInt(x, 16));
    claim(r === g && g === b, `hue ${hue}: ${role} is ${colour} at the left edge, not a grey`);
  }
  claim(left.blocked !== "#000000", `hue ${hue}: the warning colour vanished at the left edge`);

  // The ladder holds wherever there is light at all: text above its ground.
  for (const v of [15, 40, 74, 100]) {
    const p = crtPalette(hue, v, 100);
    claim(luminanceOf(p.fg) > luminanceOf(p.bg), `hue ${hue} at brightness ${v}: text is not above its background`);
    claim(luminanceOf(p.panel) > luminanceOf(p.bg), `hue ${hue} at brightness ${v}: the panel is not above the background`);
    claim(luminanceOf(p.accent) >= luminanceOf(p.fg), `hue ${hue} at brightness ${v}: the accent sits below the text`);
  }

  // Out-of-range values are clamped rather than producing a broken colour.
  for (const p of [crtPalette(hue, 200, 400), crtPalette(hue, -50, -50)]) {
    for (const [role, colour] of Object.entries(p)) {
      claim(/^#[0-9a-f]{6}$/.test(colour), `hue ${hue}: ${role} came out as ${colour}`);
    }
  }
}

console.log(failed ? `  ${failed} claims failed` : "  brightness reaches black, saturation reaches grey, the ladder holds");
process.exit(failed ? 1 : 0);
