/* A saved arrangement from before the tools had edges, taken apart before it
 * is loaded.
 *
 * The four arrangements in layoutMigrate.fixtures.json were written by the old
 * window itself, driven by hand into the shapes people have: tools tabbed in
 * main, a folder's tree in front on the left, the usage split under the inbox,
 * and an editor moved into the left group. What has to hold for each: no tool
 * and no folder tree is left outside the edges, the tools that were in front
 * are named, every document stays where it was, and a second run changes
 * nothing. The cases after them are built from the same arrangements.
 */
import "./resolveTs.mjs";
import { readFileSync } from "node:fs";

const { migrateLayout } = await import("./layoutMigrate.ts");
const { isTool } = await import("./tools.ts");
const fixtures = JSON.parse(readFileSync(new URL("./layoutMigrate.fixtures.json", import.meta.url), "utf8"));

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
const copy = (v) => structuredClone(v);

const groupsOf = (node) => (node.type === "leaf" ? [node.data] : node.data.flatMap(groupsOf));
const hosted = (h) => (h.data ? [h.data] : h.grid ? groupsOf(h.grid.root) : []);
const gridGroups = (l) => [...groupsOf(l.grid.root), ...(l.floatingGroups ?? []).flatMap(hosted), ...(l.popoutGroups ?? []).flatMap(hosted)];
const edgeGroups = (l) => Object.values(l.edgeGroups ?? {}).flatMap((e) => (e.group ? [e.group] : []));
const outOfPlace = (id) => id === "rail" || isTool(id) || id.startsWith("files:");
const editorId = Object.keys(fixtures.editorOnTheLeft.panels).find((id) => id.startsWith("editor:"));

// What every migrated arrangement has to be, whatever it came from.
function sound(name, layout) {
  const inGrid = gridGroups(layout).flatMap((g) => g.views);
  const atEdges = edgeGroups(layout).flatMap((g) => g.views);
  claim(!inGrid.some(outOfPlace), `${name}: a tool, a folder tree or the menu is still outside the edges: ${inGrid.filter(outOfPlace)}`);
  claim(atEdges.every(isTool), `${name}: something that is not a tool is at an edge: ${atEdges.filter((v) => !isTool(v))}`);
  claim(
    Object.keys(layout.panels).every((id) => !outOfPlace(id) || (isTool(id) && atEdges.includes(id))),
    `${name}: a panel is kept for something that left: ${Object.keys(layout.panels).filter(outOfPlace)}`,
  );
  claim([...inGrid, ...atEdges].every((id) => id in layout.panels), `${name}: a group names a view that has no panel`);
  claim(
    [...gridGroups(layout), ...edgeGroups(layout)].every((g) => g.views.length === 0 || g.views.includes(g.activeView)),
    `${name}: a group has nothing in front, or something in front it does not hold`,
  );
  claim(groupsOf(layout.grid.root).every((g) => g.views.length > 0), `${name}: an empty group is left in the grid`);
  const ids = [...gridGroups(layout), ...edgeGroups(layout)].map((g) => g.id);
  claim(layout.activeGroup === undefined || ids.includes(layout.activeGroup), `${name}: the group in front is one that went: ${layout.activeGroup}`);
}

function migrated(name, input, openTools) {
  const before = JSON.stringify(input);
  const out = migrateLayout(input);
  claim(JSON.stringify(input) === before, `${name}: the arrangement passed in was changed`);
  claim(out.layout !== null, `${name}: nothing came back`);
  if (!out.layout) return null;
  sound(name, out.layout);
  claim(same(out.openTools, openTools), `${name}: the tools in front came out as ${JSON.stringify(out.openTools)}, not ${JSON.stringify(openTools)}`);
  const again = migrateLayout(out.layout);
  claim(same(again.layout, out.layout) && again.openTools.length === 0, `${name}: a second run changed it: ${JSON.stringify(again)}`);
  return out.layout;
}

// ---- the four arrangements the old window wrote -------------------------------
{
  const l = migrated("tools tabbed in main", fixtures.tabbedInMain, ["inbox"]);
  const [g] = groupsOf(l.grid.root);
  claim(same(g.views, ["overview"]) && g.activeView === "overview", `tools tabbed in main: main holds ${g.views}, ${g.activeView} in front`);
  claim(same(Object.keys(l.panels), ["overview"]), `tools tabbed in main: panels ${Object.keys(l.panels)}`);
  claim(l.grid.root.data[0].size === fixtures.tabbedInMain.grid.root.data[0].size, "tools tabbed in main: main lost its size");
}
{
  const l = migrated("a folder tree in front on the left", fixtures.filesOnTheLeft, ["files"]);
  claim(l.grid.root.data.length === 1 && same(groupsOf(l.grid.root)[0].views, ["overview"]), `a folder tree in front on the left: the grid is ${JSON.stringify(l.grid.root)}`);
  claim(l.activeGroup === groupsOf(l.grid.root)[0].id, `a folder tree in front on the left: the tree's group stayed in front: ${l.activeGroup}`);
}
{
  const l = migrated("the usage split under the inbox", fixtures.usageUnderInbox, ["inbox", "usage"]);
  claim(l.grid.root.data.length === 1 && l.grid.root.data[0].type === "leaf", `the usage split under the inbox: the split is still there: ${JSON.stringify(l.grid.root)}`);
  claim(same(groupsOf(l.grid.root)[0].views, ["overview"]), "the usage split under the inbox: the overview is not what is left");
}
{
  const l = migrated("an editor in the left group", fixtures.editorOnTheLeft, []);
  const left = l.grid.root.data[0];
  const main = l.grid.root.data[1];
  claim(same(left.data.views, [editorId]) && left.data.activeView === editorId, `an editor in the left group: the editor did not keep its column: ${JSON.stringify(left)}`);
  claim(same(main.data.views, ["overview", "folders"]) && main.data.activeView === "folders", `an editor in the left group: main changed: ${JSON.stringify(main)}`);
  claim(left.size === fixtures.editorOnTheLeft.grid.root.data[0].size && main.size === fixtures.editorOnTheLeft.grid.root.data[1].size, "an editor in the left group: a column changed its size");
  claim(same(l.panels[editorId], fixtures.editorOnTheLeft.panels[editorId]), "an editor in the left group: the editor's panel changed");
}

// ---- built from them ----------------------------------------------------------
{
  // The menu as a panel, the way arrangements from before it left the grid still carry it.
  const input = copy(fixtures.tabbedInMain);
  input.panels.rail = { id: "rail", contentComponent: "rail", tabComponent: "props.defaultTabComponent", title: "plxr" };
  input.grid.root.data[0].data.views.unshift("rail");
  migrated("the old menu panel", input, ["inbox"]);
}
{
  // A split left with one side is that side, at the split's size.
  const input = copy(fixtures.usageUnderInbox);
  input.panels["session:abc"] = { id: "session:abc", contentComponent: "session", title: "abc", params: { id: "abc" } };
  input.grid.root.data[1].data[1].data.views.push("session:abc");
  const l = migrated("a split left with one side", input, ["inbox", "usage"]);
  const right = l.grid.root.data[1];
  claim(l.grid.root.data.length === 2 && right.type === "leaf" && same(right.data.views, ["session:abc"]), `a split left with one side: ${JSON.stringify(l.grid.root)}`);
  claim(right.size === input.grid.root.data[1].size, `a split left with one side: it has ${right.size}px, the split had ${input.grid.root.data[1].size}px`);
}
{
  // A root left holding one split becomes that split, and the grid turns.
  const input = copy(fixtures.usageUnderInbox);
  input.panels.archive = { id: "archive", contentComponent: "archive", title: "Archive" };
  input.panels["session:a"] = { id: "session:a", contentComponent: "session", title: "a" };
  input.panels["session:b"] = { id: "session:b", contentComponent: "session", title: "b" };
  input.grid.root.data[0].data = { views: ["archive"], activeView: "archive", id: "1" };
  input.grid.root.data[1].data[0].data = { views: ["session:a"], activeView: "session:a", id: "2" };
  input.grid.root.data[1].data[1].data = { views: ["usage", "session:b"], activeView: "session:b", id: "3" };
  const l = migrated("a root left with one split", input, ["archive"]);
  claim(l.grid.orientation === "VERTICAL", `a root left with one split: the grid still runs ${l.grid.orientation}`);
  claim(same(groupsOf(l.grid.root).map((g) => g.views), [["session:a"], ["session:b"]]) && l.grid.root.data.every((n) => n.type === "leaf"), `a root left with one split: ${JSON.stringify(l.grid.root)}`);
}
{
  // Floating groups and popout windows are the grid's too.
  const input = copy(fixtures.editorOnTheLeft);
  input.panels.usage = { id: "usage", contentComponent: "usage", title: "Usage" };
  input.panels.notes = { id: "notes", contentComponent: "notes", title: "Notes" };
  input.panels.ports = { id: "ports", contentComponent: "ports", title: "Ports" };
  input.panels["diff:x"] = { id: "diff:x", contentComponent: "diff", title: "x" };
  input.floatingGroups = [
    { data: { views: ["usage"], activeView: "usage", id: "9" }, position: { left: 10, top: 10, width: 300, height: 200 } },
    { data: { views: ["notes", "diff:x"], activeView: "notes", id: "10" }, position: { left: 40, top: 40, width: 300, height: 200 } },
  ];
  input.popoutGroups = [{ data: { views: ["ports"], activeView: "ports", id: "11" }, position: null }];
  const l = migrated("floating groups and popouts", input, ["usage", "notes", "ports"]);
  claim(l.floatingGroups.length === 1 && same(l.floatingGroups[0].data.views, ["diff:x"]) && l.floatingGroups[0].data.activeView === "diff:x", `floating groups and popouts: ${JSON.stringify(l.floatingGroups)}`);
  claim(l.popoutGroups.length === 0, `floating groups and popouts: the popout of ports is still there: ${JSON.stringify(l.popoutGroups)}`);
}
{
  // Tab groups keep only the panels still in their group.
  const input = copy(fixtures.tabbedInMain);
  input.grid.root.data[0].data.tabGroups = [
    { id: "t", collapsed: false, panelIds: ["inbox", "overview"] },
    { id: "u", collapsed: false, panelIds: ["changes"] },
  ];
  const l = migrated("tab groups", input, ["inbox"]);
  claim(same(groupsOf(l.grid.root)[0].tabGroups, [{ id: "t", collapsed: false, panelIds: ["overview"] }]), `tab groups: ${JSON.stringify(groupsOf(l.grid.root)[0].tabGroups)}`);
}

// An arrangement already written with edges comes back exactly as it was.
const withEdges = copy(migrateLayout(fixtures.editorOnTheLeft).layout);
withEdges.panels.files = { id: "files", contentComponent: "files", title: "Files" };
withEdges.panels.changes = { id: "changes", contentComponent: "changes", title: "Changes" };
withEdges.panels.inbox = { id: "inbox", contentComponent: "inbox", title: "Inbox" };
withEdges.edgeGroups = {
  left: { size: 300, visible: true, group: { views: ["files", "changes"], activeView: "changes", id: "left" } },
  right: { size: 280, visible: false, group: { views: ["inbox"], activeView: "inbox", id: "right" } },
};
{
  const out = migrateLayout(withEdges);
  claim(same(out.layout, withEdges) && out.openTools.length === 0, `an arrangement with edges was changed: ${JSON.stringify(out)}`);
  sound("an arrangement with edges", out.layout);
}
{
  // A document found at an edge goes into the first group of the grid; a folder tree there goes.
  const input = copy(withEdges);
  input.panels["session:zz"] = { id: "session:zz", contentComponent: "session", title: "zz" };
  input.panels["files:old"] = { id: "files:old", contentComponent: "files", title: "old" };
  input.edgeGroups.left.group.views.push("session:zz", "files:old");
  input.edgeGroups.left.group.activeView = "session:zz";
  const l = migrated("a document at an edge", input, []);
  claim(same(l.edgeGroups.left.group.views, ["files", "changes"]) && l.edgeGroups.left.group.activeView === "files", `a document at an edge: the edge holds ${JSON.stringify(l.edgeGroups.left.group)}`);
  claim(same(groupsOf(l.grid.root)[0].views, [editorId, "session:zz"]), `a document at an edge: the first group holds ${groupsOf(l.grid.root)[0].views}`);
  claim("session:zz" in l.panels && !("files:old" in l.panels), "a document at an edge: the document lost its panel, or the folder tree kept one");
  claim(same(l.edgeGroups.right, withEdges.edgeGroups.right), "a document at an edge: the other edge changed");
}
{
  // With nothing left in the grid, a document from an edge gets a group of its own.
  const input = copy(fixtures.tabbedInMain);
  input.grid.root.data[0].data = { views: ["inbox", "changes"], activeView: "changes", id: "1" };
  delete input.panels.overview;
  delete input.panels.archive;
  input.panels["session:q"] = { id: "session:q", contentComponent: "session", title: "q" };
  input.edgeGroups = { bottom: { size: 200, visible: true, group: { views: ["session:q"], activeView: "session:q", id: "bottom" } } };
  const l = migrated("a document at an edge of an empty grid", input, ["changes"]);
  const groups = groupsOf(l.grid.root);
  claim(groups.length === 1 && same(groups[0].views, ["session:q"]) && groups[0].id !== "bottom", `a document at an edge of an empty grid: ${JSON.stringify(l.grid.root)}`);
  claim(same(l.edgeGroups.bottom.group.views, []), `a document at an edge of an empty grid: the edge holds ${l.edgeGroups.bottom.group.views}`);
}

// Nothing that is an arrangement: nothing to load.
for (const junk of [null, undefined, 7, "dock", [], {}, { grid: {} }, { grid: { root: { type: "leaf" } }, panels: {} }, { grid: fixtures.tabbedInMain.grid }]) {
  const out = migrateLayout(junk);
  claim(out.layout === null && out.openTools.length === 0, `${JSON.stringify(junk)} came out as an arrangement`);
}

if (failed) {
  console.error(`  ${failed} claims failed`);
  process.exit(1);
}
console.log(`  ${held} claims hold`);
