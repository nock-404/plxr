/* The tool layout: which tool stands on which edge, in which order.
 *
 * What has to hold: every tool is in a layout exactly once, whatever was
 * saved; the region choices of the old window come across once; a move puts a
 * tool where it was dropped and nowhere else; and a pointer between two icons
 * lands between them.
 */
import "./resolveTs.mjs";

const { TOOLS, EDGES, CHORD_ORDER, isTool, defaultToolLayout, normalizeToolLayout, fromRegions, edgeOf, moveInLayout, dropIndex, chordOf } =
  await import("./tools.ts");

let failed = 0;
let held = 0;
const claim = (ok, what) => {
  if (ok) {
    held++;
    return;
  }
  console.error("  " + what);
  failed++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ids = TOOLS.map((t) => t.id);
// Every tool exactly once across the three edges, and nothing else.
const complete = (layout) => {
  const all = EDGES.flatMap((e) => layout.order[e]);
  return all.length === ids.length && ids.every((id) => all.filter((x) => x === id).length === 1);
};

// ---- the default --------------------------------------------------------------
const def = defaultToolLayout();
claim(def.v === 1, "the default layout is not version 1");
claim(complete(def), `the default layout does not hold every tool exactly once: ${JSON.stringify(def.order)}`);
claim(same(def.order.left, ["files", "changes", "search", "review"]), `the left edge starts wrong: ${def.order.left}`);
claim(same(def.order.right, ["inbox", "usage", "ports", "archive", "notes"]), `the right edge starts wrong: ${def.order.right}`);
claim(def.order.bottom.length === 0, `the bottom edge does not start empty: ${def.order.bottom}`);
claim(defaultToolLayout() !== def && defaultToolLayout().order.left !== def.order.left, "two defaults share their lists");
claim(isTool("files") && isTool("notes") && !isTool("overview") && !isTool("session:abc") && !isTool(""), "isTool says the wrong thing");
claim(new Set(ids).size === ids.length && ids.length === 9, `the registry does not list nine different tools: ${ids}`);

// ---- normalizing what was saved -----------------------------------------------
const messy = normalizeToolLayout({
  v: 1,
  order: {
    left: ["changes", "nonsense", "changes", 7, "files"],
    right: ["inbox", "files", "overview"],
    bottom: ["usage"],
  },
});
claim(complete(messy), `a messy layout did not come out with every tool once: ${JSON.stringify(messy.order)}`);
claim(same(messy.order.left, ["changes", "files", "search", "review"]), `unknown ids and duplicates were not dropped on the left, or a missing tool not appended: ${messy.order.left}`);
claim(same(messy.order.right, ["inbox", "ports", "archive", "notes"]), `a tool named twice was not kept where it was named first: ${messy.order.right}`);
claim(same(messy.order.bottom, ["usage"]), `a tool he put at the bottom did not stay there: ${messy.order.bottom}`);
const partial = normalizeToolLayout({ v: 1, order: { right: ["notes"] } });
claim(complete(partial) && same(partial.order.right, ["notes", "inbox", "usage", "ports", "archive"]), `missing edges and tools were not filled in: ${JSON.stringify(partial.order)}`);
for (const junk of [null, undefined, 3, "left", [], {}, { v: 2, order: { bottom: ["inbox"] } }, { v: 1, order: "left" }]) {
  claim(same(normalizeToolLayout(junk), def), `${JSON.stringify(junk)} did not come out as the default layout`);
}
claim(same(normalizeToolLayout(def), def), "a clean layout did not come through unchanged");

// ---- the old region choices ---------------------------------------------------
const old = fromRegions({ inbox: "bottom", "editor:": "left", folders: "main", usage: "main" });
claim(complete(old), `the old regions did not make a complete layout: ${JSON.stringify(old.order)}`);
claim(same(old.order.bottom, ["inbox"]), `inbox moved to the bottom is not on the bottom: ${old.order.bottom}`);
claim(edgeOf(old, "usage") === "right" && !old.order.right.includes("inbox"), `usage kept in main did not stay on the right, or inbox is still there: ${old.order.right}`);
claim(same(old.order.left, def.order.left), `the editor's region or the folders changed the tools: ${old.order.left}`);
const across = fromRegions({ changes: "right", notes: "left", search: "left" });
claim(same(across.order.right, ["inbox", "usage", "ports", "archive", "changes"]), `a moved tool does not come after the tools that start there: ${across.order.right}`);
claim(same(across.order.left, ["files", "search", "review", "notes"]), `a region a tool already starts in moved it: ${across.order.left}`);
for (const junk of [null, undefined, "left", 5, { inbox: "sideways" }, { toString: "bottom" }]) {
  claim(same(fromRegions(junk), def), `old regions ${JSON.stringify(junk)} did not come out as the default layout`);
}

// ---- moving a tool ------------------------------------------------------------
const first = moveInLayout(def, "inbox", "left", 0);
claim(same(first.order.left, ["inbox", "files", "changes", "search", "review"]) && !first.order.right.includes("inbox"), `a move to the first index went wrong: ${JSON.stringify(first.order)}`);
const last = moveInLayout(def, "files", "right", 5);
claim(same(last.order.right, ["inbox", "usage", "ports", "archive", "notes", "files"]) && !last.order.left.includes("files"), `a move to the last index went wrong: ${JSON.stringify(last.order)}`);
const beyond = moveInLayout(def, "files", "bottom", 99);
claim(same(beyond.order.bottom, ["files"]), `an index past the end did not land at the end: ${beyond.order.bottom}`);
const below = moveInLayout(def, "files", "right", -3);
claim(below.order.right[0] === "files", `a negative index did not land first: ${below.order.right}`);
// Within one edge the index counts the icons without the one being moved.
const down = moveInLayout(def, "files", "left", 2);
claim(same(down.order.left, ["changes", "search", "files", "review"]), `a reorder down the same edge went wrong: ${down.order.left}`);
const up = moveInLayout(def, "review", "left", 0);
claim(same(up.order.left, ["review", "files", "changes", "search"]), `a reorder up the same edge went wrong: ${up.order.left}`);
claim([first, last, beyond, below, down, up].every(complete), "a move lost or doubled a tool");
claim(same(def, defaultToolLayout()), "a move changed the layout it was given");
claim(edgeOf(first, "inbox") === "left" && edgeOf(def, "inbox") === "right", "edgeOf does not follow the layout");

// ---- where a dropped icon lands -----------------------------------------------
const centres = [20, 60, 100];
claim(dropIndex(centres, 5) === 0, `before the first icon: ${dropIndex(centres, 5)}`);
claim(dropIndex(centres, 140) === 3, `after the last icon: ${dropIndex(centres, 140)}`);
claim(dropIndex(centres, 70) === 2, `between the second and the third: ${dropIndex(centres, 70)}`);
claim(dropIndex(centres, 40) === 1, `between the first and the second: ${dropIndex(centres, 40)}`);
claim(dropIndex([], 40) === 0, "on an empty stripe");

// ---- the chords ---------------------------------------------------------------
claim(CHORD_ORDER.length === 9 && CHORD_ORDER[0] === "overview", `the chord order is not nine long, the overview first: ${CHORD_ORDER}`);
claim(chordOf("inbox") !== "" && chordOf("inbox") !== chordOf("changes"), `inbox and changes do not have chords of their own: "${chordOf("inbox")}" "${chordOf("changes")}"`);
claim(chordOf("review") === "", `review has a chord it should not have: "${chordOf("review")}"`);

if (failed) {
  console.error(`  ${failed} claims failed`);
  process.exit(1);
}
console.log(`  ${held} claims hold`);
