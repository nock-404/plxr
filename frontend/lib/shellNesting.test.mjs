/* The tripwire under components/dock/shellNesting.ts.
 *
 * That file puts the bottom tool window under the left one, main and the right
 * one by rebuilding dockview's shell on the live instance, through fields and
 * call paths dockview does not promise to keep. Should any of them change, the
 * guard there leaves the bottom window under main, which is exactly what he
 * complained about, and only a browser gate would notice.
 *
 * So the installed dockview is read here, the file Turbopack loads, and every
 * assumption is held against its source: the version, the ten members of the
 * middle column the shell calls, the one place the outer splitview is laid
 * out and every way into it, the fields the rebuild reads, and what it builds
 * with. Any change to dockview fails this before the window is ever opened.
 */
import { readFileSync } from "node:fs";

const modules = new URL("../node_modules/", import.meta.url);
const read = (path) => readFileSync(new URL(path, modules), "utf8");
const pkg = (name) => JSON.parse(read(`${name}/package.json`));

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
const count = (text, needle) => text.split(needle).length - 1;
const between = (text, from, to) => {
  const start = text.indexOf(from);
  const end = start < 0 ? -1 : text.indexOf(to, start + from.length);
  return start < 0 || end < 0 ? "" : text.slice(start, end);
};

// ---- the version, and the file that is bundled -------------------------------
const core = pkg("dockview-core");
for (const name of ["dockview-core", "dockview", "dockview-react"]) {
  const version = pkg(name).version;
  claim(version === "8.3.1", `${name} is ${version}, and shellNesting.ts was written against 8.3.1`);
}
const entry = core.exports?.["."]?.import;
claim(entry === "./dist/package/main.esm.mjs", `dockview-core's import entry is ${entry}, not the file read here`);
const src = read(`dockview-core/${entry ?? "dist/package/main.esm.mjs"}`);
claim(read("dockview-react/dist/package/main.esm.mjs").includes('export * from "dockview"'), "dockview-react no longer passes dockview's exports on");
claim(read("dockview/dist/package/main.esm.mjs").includes('export * from "dockview-core"'), "dockview no longer passes dockview-core's exports on");

// ---- what the rebuild is made of ----------------------------------------------
const exported = (src.match(/^export \{([^}]*)\};?$/m)?.[1] ?? "").split(",").map((s) => s.trim());
for (const name of ["Splitview", "Sizing", "Orientation", "LayoutPriority", "Emitter as DockviewEmitter"]) {
  claim(exported.includes(name), `dockview-core no longer exports ${name}`);
}
const splitview = between(src, "var Splitview = class {", "//#region");
claim(splitview !== "", "no Splitview class in dockview-core");
// The row is dockview's own splitview moved into the new column: a splitview
// that went back to the element it was made in would pull it out again.
claim(count(splitview, "this.container") === 2 && splitview.includes("this.container = container;") && splitview.includes("this.container.appendChild(this.element);"),
  "Splitview uses the element it was made in after it is made");
claim(/\n\tlayout\(size, orthogonalSize\) \{/.test(splitview) && splitview.includes("setViewVisible(index, visible) {") && splitview.includes("getViewCachedVisibleSize(index) {"),
  "Splitview's layout, setViewVisible or getViewCachedVisibleSize changed");

// ---- the shell ----------------------------------------------------------------
claim(count(src, "var ShellManager = class {") === 1, "ShellManager is not one class any more");
claim(count(src, "new ShellManager(") === 1, "ShellManager is made in more than one place, or none");
const dockviewApi = between(src, "var DockviewApi = class {", "//#endregion");
claim(/\n\tconstructor\(component\) \{\n\t\tthis\.component = component;/.test(dockviewApi), "DockviewApi no longer keeps the component as component");
claim(count(src, "this._shellManager = new ShellManager(") === 1, "the component no longer keeps its shell as _shellManager");
const shell = between(src, "var ShellManager = class {", "//#region src/dockview/dockviewComponent.ts");
claim(shell !== "", "no ShellManager region to read");

const expected = ["addBottomView", "addTopView", "axisSize", "getViewCachedVisibleSize", "getViewSize", "isViewVisible", "removeView", "resizeView", "setViewVisible", "updateMargin"];
const members = [...new Set([...shell.matchAll(/this\._middleColumn\.(\w+)/g)].map((m) => m[1]))].sort();
claim(JSON.stringify(members) === JSON.stringify(expected), `the shell calls ${members.join(", ")} on its middle column, and the facade covers ${expected.join(", ")}`);
// Besides those calls: made, put in the outer splitview, handed to the disposables.
claim([...shell.matchAll(/_middleColumn(?!\.)/g)].length === 3, "the shell uses its middle column somewhere the facade does not see");
const outside = src.replace(shell, "");
claim(!outside.includes("_middleColumn") && !outside.includes("_outerSplitview"), "something outside the shell reaches its middle column or its outer splitview");

claim(count(src, "_outerSplitview.layout(") === 1, "the outer splitview is laid out in more than one place");
claim(/\n\tlayout\(width, height\) \{\n\t\tthis\._outerSplitview\.layout\(width, height\);\n\t\tthis\._flushPendingSizes\(\);\n\t\}/.test(shell), "ShellManager.layout is no longer: lay out the outer splitview, flush the pending sizes");
claim(count(shell, "this.layout(") === 2, `the shell lays itself out in ${count(shell, "this.layout(")} places, and two are known: its resize observer and updateTheme`);
claim(/watchElementResize\(this\._shellElement, \(entry\) => \{[\s\S]*?this\.layout\(width, height\);\n\t\t\}\), this\._outerSplitview, this\._middleColumn, centerView\);/.test(shell), "the shell's resize observer no longer calls this.layout");
claim(shell.includes("if (this._currentWidth > 0 && this._currentHeight > 0) this.layout(this._currentWidth, this._currentHeight);"), "updateTheme no longer calls this.layout");
claim(/this\.updateTheme\(this\._gap, this\._defaultCollapsedSize\);\n\t\treturn view;/.test(shell), "addEdgeView no longer lays out through updateTheme");
claim(count(src, "_shellManager.layout(") === 1 && src.includes("if (this._shellManager && !this._inShellLayout) this._shellManager.layout(width, height);"), "the dock no longer lays its shell out through one call to layout");

for (const field of [
  'this._shellElement = document.createElement("div");',
  "this._disposables = new CompositeDisposable();",
  "this._gap = gap;",
  "this._currentWidth = 0;",
  "this._middleColumn = new MiddleColumnView(centerView, gap);",
  "this._outerSplitview = new Splitview(this._shellElement, {",
  "container.appendChild(this._shellElement);",
]) claim(shell.includes(field), `the shell's constructor no longer has: ${field}`);
claim(/\n\tget element\(\) \{\n\t\treturn this\._shellElement;\n\t\}/.test(shell), "the shell's element is no longer its _shellElement");
claim(shell.includes("_flushPendingSizes() {") && shell.includes("hasEdgeGroup(position) {"), "the shell lost _flushPendingSizes or hasEdgeGroup");
claim(/case "bottom":\n\t\t\t\tthis\._middleColumn\.addBottomView\(view, initialSize\);/.test(shell) && shell.includes('this._middleColumn.removeView("bottom");'), "the bottom edge is no longer added and removed through the middle column");
claim(shell.includes('case "bottom": return this._middleColumn.isViewVisible(position);') && shell.includes('this._middleColumn.getViewSize("bottom"), this._middleColumn.getViewCachedVisibleSize("bottom")'), "the bottom edge's visibility and stored size are no longer read through the middle column");

// ---- the views either side ------------------------------------------------------
const middle = between(src, "var MiddleColumnView = class {", "var ShellManager = class {");
claim(middle.includes("this.minimumSize = 100;") && middle.includes('orientation: "VERTICAL",'), "the middle column's floor or orientation changed");
const edge = between(src, "var EdgeGroupView = class {", "var CenterView = class {");
claim(edge.includes('this.priority = "low";') && edge.includes("else this._group.layout(orthogonalSize, size);"), "an edge group no longer gives way first, or lays a vertical group out differently");

// ---- the floor: the bottom section in two halves --------------------------------
/* The right half of the bottom section is dockview's own top edge group, laid
   out beside the bottom one instead of above main. What that rests on: the
   top edge going through the same middle column, an edge view for a top or a
   bottom edge being built for a vertical splitview (so both halves have their
   lengths swapped back on the way into a horizontal one), a top edge carrying
   its size as a height whatever that size means, one group per position, and
   an empty edge folding itself away to a strip. */
claim(/case "top":\n\t\t\t\tthis\._middleColumn\.addTopView\(view, initialSize\);/.test(shell) && shell.includes('this._middleColumn.removeView("top");'),
  "the top edge is no longer added and removed through the middle column");
claim(shell.includes('case "top":\n\t\t\tcase "bottom":\n\t\t\t\tthis._middleColumn.setViewVisible(position, visible);'),
  "the top edge's visibility no longer goes through the middle column");
claim(shell.includes('const isHorizontal = position === "left" || position === "right";') && shell.includes('const orientation = isHorizontal ? "horizontal" : "vertical";'),
  "an edge view for the top or the bottom is no longer built for a vertical splitview");
claim(src.includes('const size = position === "left" || position === "right" ? event.width : event.height;'),
  "a top or bottom edge group no longer carries the size asked for as a height");
claim(src.includes("dockview: edge group already exists at position") || src.includes("dockview: edge group already registered at position"),
  "dockview no longer keeps one group per edge position, which is why the right half is the top one");
claim(src.includes("else this.setEdgeGroupCollapsed(group, true);"), "an emptied edge group no longer folds itself away, and the floor's height would follow it down");
const split = between(src, "var Splitview = class {", "//#region");
for (const name of ["distributeViewSizes() {", "resizeView(index, size) {", "removeView(index", "isViewVisible(index) {", "getViewSize(index) {"])
  claim(split.includes(name), `Splitview lost ${name.replace(/\(.*/, "")}, which the floor is built on`);

if (failed) {
  console.error(`  ${failed} claims failed — dockview changed under components/dock/shellNesting.ts`);
  process.exit(1);
}
console.log(`  ${held} claims hold`);
