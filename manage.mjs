/* Can files be managed from the tree, and can the project be searched?
 *
 * A daily driver makes, renames, moves and deletes files without a terminal,
 * and finds a word across the project and lands in the editor on that line.
 * Both went in as panels; this holds them against the disk and the running
 * window, in a home of its own so nobody's real plxr is touched. No
 * dependencies: the browser already on the machine, over its debugging
 * protocol, the way editor.mjs and changes.mjs do it.
 *
 * Every step goes through the interface — the row's context menu, the
 * dialog, the search box — and is then checked on disk or through the API,
 * never only in the DOM: a tree can show a row for a file that was never
 * written.
 */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GATEKIT } from "./gatekit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/* English labels only: with no language set the window speaks English, and
   matching the other language would put it into a source file german.py
   reads. */
const BROWSERS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

const browser = BROWSERS.find((p) => existsSync(p));
if (!browser) {
  console.log("  no chromium-based browser found — cannot check the window");
  process.exit(1);
}
if (!existsSync(join(HERE, "frontend", "out", "index.html"))) {
  console.log("  this build has no frontend/out — run ./build.sh first");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = [];
const claim = (what, ok, detail = "") => claims.push({ what, ok: Boolean(ok), detail });

// A home and a repository of its own.
const home = mkdtempSync(join(tmpdir(), "plxr-manage-home-"));
const work = join(home, "project");
mkdirSync(join(work, "inner"), { recursive: true });
const git = (...args) => {
  try {
    execFileSync("git", ["-C", work, ...args], {
      stdio: "ignore",
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    });
    return true;
  } catch {
    return false;
  }
};
writeFileSync(join(work, "a.go"), "package main\n\nfunc main() {}\n");
writeFileSync(join(work, "notes.md"), "first line\nthe NEEDLE is on line two\nthird line\n");
/* Long enough that landing on the line means scrolling to it: a hit at line
   three of a three-line file is on screen whatever the editor does. */
const deep = [];
for (let i = 1; i <= 200; i++) deep.push(i === 150 ? "line 150 holds the NEEDLE too" : `line ${i}`);
writeFileSync(join(work, "inner", "deep.txt"), deep.join("\n") + "\n");
const repo = git("init", "-q", "-b", "main", ".") && git("add", "-A") && git("commit", "-qm", "start");

const APP = process.env.PLXR_APP || "/tmp/plxr3-app";
if (!existsSync(APP)) {
  console.log(`  ${APP} is not there — run ./build.sh first`);
  process.exit(1);
}
const app = spawn(APP, ["daemon"], { env: { ...process.env, PLXR_HOME: home }, stdio: "ignore" });

/* Everything this run starts is ended from wherever it stops.
 *
 * A crash, an unhandled rejection or ^C used to leave the browser and the
 * service running: fourteen headless browsers holding 4.6 GB were found on
 * one machine, most from gates that had crashed before their cleanup. The
 * service detaches itself, so the process that listens is the one named in
 * daemon.json — this gate never ended that one at all, only the launcher.
 * Registered the moment there is something to end; the browser and its
 * profile do not exist yet at first, and reaching for them then throws,
 * which is caught. */
/* Chrome writes its profile until it has exited, so a profile removed right
 * after the kill came back as a folder of 88K. Waited for synchronously — an
 * exit handler cannot await — by asking ps: a child that has exited stays a
 * zombie until the event loop collects it, and that loop does not run here. */
const browserExited = (proc) => {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    try {
      if (execFileSync("ps", ["-o", "stat=", "-p", String(proc.pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).includes("Z")) return;
    } catch { return; /* ps knows no such process */ }
    const t = Date.now() + 50; while (Date.now() < t);
  }
};
let gateEnded = false;
const endEverything = () => {
  if (gateEnded) return;
  gateEnded = true;
  try { chrome.kill(); browserExited(chrome); } catch { /* not started yet, or gone */ }
  try { process.kill(JSON.parse(readFileSync(join(home, "daemon.json"), "utf8")).pid); } catch { /* gone */ }
  try { app.kill(); } catch { /* gone */ }
  for (let i = 0; i < 20; i++) {
    try { rmSync(profile, { recursive: true, force: true }); break; }
    catch (e) { if (e instanceof ReferenceError) break; const until = Date.now() + 100; while (Date.now() < until); }
  }
  try { rmSync(home, { recursive: true, force: true }); } catch { /* later */ }
};
process.on("exit", endEverything);
for (const bad of ["uncaughtException", "unhandledRejection"]) {
  process.on(bad, (why) => { console.log(`  ${bad}: ${why?.stack ?? why}`); process.exit(1); });
}
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

let info = null;
for (let i = 0; i < 80 && !info; i++) {
  try {
    info = JSON.parse(readFileSync(join(home, "daemon.json"), "utf8"));
  } catch {
    await sleep(250);
  }
}
if (!info) {
  console.log("  the service did not come up");
  process.exit(1);
}
const api = (path, opts = {}) =>
  fetch(`http://127.0.0.1:${info.port}${path}`, {
    ...opts,
    headers: { "X-Plxr-Token": info.token, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
for (let i = 0; i < 80; i++) {
  try {
    if ((await api("/api/version")).ok) break;
  } catch {
    /* not yet */
  }
  await sleep(250);
}
const folder = await (await api("/api/workspaces", { method: "POST", body: JSON.stringify({ path: work }) })).json();
// A plain shell in the folder, so the search panel has a session to follow.
const sess = await (await api("/api/sessions", { method: "POST", body: JSON.stringify({ cwd: work, cmd: [], name: "project", account: "" }) })).json();

const profile = mkdtempSync(join(tmpdir(), "plxr-manage-"));
const port = 9900 + (process.pid % 300);
const chrome = spawn(browser, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--use-mock-keychain",
  "--password-store=basic",
  "--no-default-browser-check",
  "--window-size=1500,900",
  "about:blank",
], { stdio: "ignore" });

function stop(code) {
  endEverything();
  process.exit(code);
}

let wsUrl = null;
for (let i = 0; i < 80 && !wsUrl; i++) {
  try {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
    wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch { /* not up */ }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) {
  console.log("  the browser did not come up");
  stop(1);
}

const cdp = await new Promise((resolve, reject) => {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const p = waiting.get(m.id);
    if (p) { waiting.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  };
  ws.onerror = () => reject(new Error("cannot speak to the browser"));
  ws.onopen = () => resolve({
    send: (method, params = {}) => new Promise((res, rej) => {
      const n = ++id;
      waiting.set(n, { resolve: res, reject: rej });
      ws.send(JSON.stringify({ id: n, method, params }));
    }),
  });
});
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");

const run = async (expression) => {
  const r = await cdp.send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    // What held before the page threw, so a crash still says what worked.
    for (const c of claims) console.log(`      ${c.ok ? "ok " : "NO "} ${c.what}${c.detail ? " — " + c.detail : ""}`);
    console.log(`  the page threw: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`.trim());
    stop(1);
  }
  return r.result?.value;
};

let up = 0;
for (let i = 0; i < 40 && !up; i++) {
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${info.port}/?token=${info.token}` });
  await sleep(700);
  up = await run(`${GATEKIT} return appUp();`).catch(() => 0);
}
if (!up) {
  console.log("  the interface did not render");
  stop(1);
}

const HELPERS = `${GATEKIT}
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const set = (el, v) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true })); };
  const byText = (sel, re) => [...document.querySelectorAll(sel)].find(e => re.test(e.textContent.trim()));
  /* The EditorView behind a .cm-content: CodeMirror hangs its tile on the
     element (cmTile since 6.43; cmView before), and the root tile holds the
     view — what EditorView.findFromDOM does, without the module in hand. */
  const cmViewOf = (content) => {
    let t = content?.cmTile ?? content?.cmView ?? null;
    if (!t) return null;
    while (t && !t.view && t.parent) t = t.parent;
    return t?.view ?? null;
  };
  const row = (re) => [...document.querySelectorAll('.frow')].find(r => re.test(r.querySelector('.fname')?.textContent ?? ''));
  // The row's own menu, at the pointer, and the item in it.
  const menuOf = async (r) => {
    const b = r.getBoundingClientRect();
    r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(b.x + 20), clientY: Math.round(b.y + 8) }));
    await wait(300);
    return [...document.querySelectorAll('.menu .menuItem')];
  };
  const pick = async (r, re) => {
    const items = await menuOf(r);
    const it = items.find(i => re.test(i.textContent.trim()));
    if (!it) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return { err: 'no menu item ' + re + ' among ' + items.map(i => i.textContent.trim()).join(', ') }; }
    it.click(); await wait(400);
    return { ok: true };
  };
  const answer = async (text) => {
    const box = document.querySelector('.ask .input');
    if (!box) return { err: 'the dialog asked nothing' };
    set(box, text);
    const yes = document.querySelector('.ask .btn.primary');
    if (!yes) return { err: 'the dialog had no way to say yes' };
    yes.click(); await wait(1200);
    return { ok: true };
  };
`;

const listing = async (dir = "") => (await (await api(`/api/files/${folder.id}?dir=${encodeURIComponent(dir)}`)).json()).map((e) => e.rel);

// ---- the tree, in the folders view ----------------------------------------
const opened = await run(`${HELPERS}
  openSession('project'); await wait(1500);
  openDoc('folders'); await wait(2500);
  return { names: [...document.querySelectorAll('.fname')].map(n => n.textContent.trim()),
           menu: (await menuOf(row(/^a\\.go$/))).map(i => i.textContent.trim()) };
`);
await run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return 1");
claim("the tree lists the folder", opened.names.includes("a.go") && opened.names.includes("notes.md"), opened.names.join(", "));
claim("a row's menu offers new file, rename, move and delete",
  ["+ FILE", "RENAME", "MOVE", "DELETE"].every((w) => opened.menu.includes(w)), opened.menu.join(", "));

// ---- create, from the menu of a top-level file -----------------------------
const made = await run(`${HELPERS}
  const r = row(/^a\\.go$/); if (!r) return { err: 'no row for a.go' };
  const p = await pick(r, /^\\+ FILE$/); if (p.err) return p;
  const a = await answer('made.txt'); if (a.err) return a;
  await wait(600);
  const made = row(/^made\\.txt$/);
  return { inTree: Boolean(made), mark: made?.getAttribute('data-git') ?? null };
`);
claim("+ FILE from a row's menu writes the file to disk", existsSync(join(work, "made.txt")), made.err ?? "");
claim("the new file appears in the tree", made.inTree, JSON.stringify(made));
claim("the service lists it too", (await listing()).includes("made.txt"));
if (repo) claim("its git mark says untracked", made.mark === "untracked", `mark ${made.mark}`);

// ---- rename ----------------------------------------------------------------
const renamed = await run(`${HELPERS}
  const r = row(/^made\\.txt$/); if (!r) return { err: 'no row for made.txt' };
  const p = await pick(r, /^RENAME$/); if (p.err) return p;
  const a = await answer('renamed.txt'); if (a.err) return a;
  await wait(600);
  return { old: Boolean(row(/^made\\.txt$/)), fresh: Boolean(row(/^renamed\\.txt$/)) };
`);
claim("RENAME renames it on disk", !existsSync(join(work, "made.txt")) && existsSync(join(work, "renamed.txt")), renamed.err ?? "");
claim("the tree shows the new name and not the old", renamed.fresh && !renamed.old, JSON.stringify(renamed));

// ---- move, through the folder picker ---------------------------------------
const moved = await run(`${HELPERS}
  const r = row(/^renamed\\.txt$/); if (!r) return { err: 'no row for renamed.txt' };
  const p = await pick(r, /^MOVE$/); if (p.err) return p;
  const pickOpen = Boolean(document.querySelector('.folderpick'));
  const folders = [...document.querySelectorAll('.folderpick .folderrow')].map(b => b.getAttribute('data-path'));
  const inner = document.querySelector('.folderpick .folderrow[data-path="inner"]');
  if (!inner) return { err: 'inner is not offered', pickOpen, folders };
  inner.click(); await wait(600);
  const where = document.querySelector('.folderpick .cardButtons .notice')?.textContent.trim();
  const go = document.querySelector('.folderpick .btn[data-do="move-here"]');
  if (!go) return { err: 'no MOVE HERE', pickOpen, folders };
  go.click(); await wait(1400);
  // Open the folder it went into.
  const gone = !row(/^renamed\\.txt$/);
  row(/^inner$/)?.click(); await wait(1000);
  const there = row(/^renamed\\.txt$/);
  return { pickOpen, folders, where, gone, there: Boolean(there), rel: there?.getAttribute('data-path') ?? '' };
`);
claim("MOVE opens a picker of the folders in this tree", moved.pickOpen && (moved.folders ?? []).includes("inner"), moved.err ?? (moved.folders ?? []).join(", "));
claim("the picker walks into the chosen folder", moved.where === "inner", `at ${moved.where}`);
claim("MOVE HERE moves the file on disk",
  !existsSync(join(work, "renamed.txt")) && existsSync(join(work, "inner", "renamed.txt")), moved.err ?? "");
claim("the tree shows it under inner and no longer at the top", moved.gone && moved.there, JSON.stringify(moved));
claim("the service lists it under inner", (await listing("inner")).includes("inner/renamed.txt"));

// ---- delete, with the question first ---------------------------------------
const deleted = await run(`${HELPERS}
  const r = row(/^renamed\\.txt$/); if (!r) return { err: 'no row for inner/renamed.txt' };
  const p = await pick(r, /^DELETE$/); if (p.err) return p;
  const asked = Boolean(document.querySelector('.ask'));
  const stillThere = ${JSON.stringify(existsSync(join(work, "inner", "renamed.txt")))};
  const yes = document.querySelector('.ask .btn.danger');
  if (!yes) return { err: 'no way to say yes', asked };
  yes.click(); await wait(1200);
  return { asked, stillThere, gone: !row(/^renamed\\.txt$/) };
`);
claim("DELETE asks first, in plxr's own dialog", deleted.asked, deleted.err ?? "");
claim("and only after yes is the file gone from disk", !existsSync(join(work, "inner", "renamed.txt")), deleted.err ?? "");
claim("the tree no longer shows it", deleted.gone, JSON.stringify(deleted));
claim("the service no longer lists it", !(await listing("inner")).includes("inner/renamed.txt"));

// ---- the search panel, following the session -------------------------------
const searched = await run(`${HELPERS}
  openTool('search');
  // Wait for the panel, not for a fixed moment: under the load of the whole
  // suite the panel took longer than the old 1.5 s and the claim flipped.
  let panel = null;
  for (let i = 0; i < 32 && !panel; i++) { await wait(250); panel = document.querySelector('.searchPanel'); }
  if (!panel) return { err: 'no search panel',
    tabs: [...document.querySelectorAll('.plxrDock .panelTabName')].map(e => e.textContent.trim()),
    rail: stripeIcons().map(e => e.dataset.view) };
  const following = panel.querySelector('.notice')?.textContent.trim() ?? '';
  /* The folders opened at the start are a tab of main, in front of the
     session, and the dock renders only the tab in front — so the session is
     brought forward before the terminal is measured beside the search. */
  const sessionTab = document.querySelector('.plxrDock .panelTab[data-kind="session"]')?.closest('.dv-tab');
  if (sessionTab) {
    sessionTab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    sessionTab.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    await wait(800);
  }
  const sessionGroup = document.querySelector('.session')?.closest('.dv-groupview');
  const beside = Boolean(sessionGroup) && panel.closest('.dv-groupview') !== sessionGroup;
  const terminalWide = (document.querySelector('.session')?.getBoundingClientRect().width ?? 0) > 200;
  const box = panel.querySelector('.input[data-do="find-what"]');
  if (!box) return { err: 'no search box', following };
  set(box, 'NEEDLE');
  panel.querySelector('.btn[data-do="find-go"]').click();
  await wait(2500);
  const files = [...panel.querySelectorAll('.findfile')].map(f => ({
    path: f.getAttribute('data-path'),
    lines: [...f.querySelectorAll('.findline')].map(l => Number(l.getAttribute('data-line'))),
  }));
  const marks = [...panel.querySelectorAll('.findmark')].map(m => m.textContent);
  return { following, beside, terminalWide, files, marks, count: panel.querySelector('.hitSmall')?.textContent.trim() ?? '' };
`);
claim("the SEARCH panel opens from the rail and follows the session", /searching project/.test(searched.following ?? ""),
  searched.err ? `${searched.err} · tabs ${(searched.tabs ?? []).join(", ")} · rail ${(searched.rail ?? []).join(", ")}` : searched.following);
claim("it opens beside the terminal, not over it", searched.beside && searched.terminalWide, JSON.stringify({ beside: searched.beside, wide: searched.terminalWide }));
const byPath = Object.fromEntries((searched.files ?? []).map((f) => [f.path, f.lines]));
claim("hits are grouped by file, one group per file that has the word",
  (searched.files ?? []).length === 2 && byPath["notes.md"] && byPath["inner/deep.txt"], JSON.stringify(searched.files));
claim("each hit carries the right line number",
  JSON.stringify(byPath["notes.md"]) === "[2]" && JSON.stringify(byPath["inner/deep.txt"]) === "[150]", JSON.stringify(byPath));
claim("the matched word is lit in the preview", (searched.marks ?? []).length === 2 && searched.marks.every((m) => m === "NEEDLE"), (searched.marks ?? []).join(", "));
claim("the count says two lines in two files", /2 lines in 2 files/.test(searched.count), searched.count);

// ---- a hit opens the editor on that line -----------------------------------
const landed = await run(`${HELPERS}
  const hit = document.querySelector('.searchPanel .findfile[data-path="inner/deep.txt"] .findline[data-line="150"]');
  if (!hit) return { err: 'no hit to click' };
  hit.click();
  // The editor is built empty and the file arrives after; the jump waits for it.
  for (let i = 0; i < 30; i++) { await wait(300); if (document.querySelector('.editorPanel .cm-content')) break; }
  await wait(1200);
  const content = document.querySelector('.editorPanel .cm-content');
  if (!content) return { err: 'no editor opened' };
  const view = cmViewOf(content);
  if (!view) return { err: 'no CodeMirror view on the content element' };
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head).number;
  const scroller = document.querySelector('.editorPanel .cm-scroller');
  const dom = view.domAtPos(view.state.doc.line(150).from).node;
  const el = dom.nodeType === 3 ? dom.parentElement : dom;
  const lr = el.closest('.cm-line')?.getBoundingClientRect();
  const sr = scroller.getBoundingClientRect();
  const visible = Boolean(lr) && lr.top >= sr.top && lr.bottom <= sr.bottom;
  const name = document.querySelector('.editorPanel .overlayName')?.textContent.trim();
  const still = Boolean(document.querySelector('.searchPanel'));
  /* Read before the tabs are switched below: the dock takes a tab that is not
     in front out of the page, and an element put back has lost its scroll. */
  const scrollTop = Math.round(scroller.scrollTop);
  /* The editor is a tab of main and opens in front of the session, which the
     dock then stops rendering. Nothing was closed: the session's tab is still
     there, and brought forward its terminal is on screen again. Then the
     editor goes back to the front for the step after this one. */
  const pointer = t => {
    t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
  };
  const sessionTab = document.querySelector('.plxrDock .panelTab[data-kind="session"]')?.closest('.dv-tab');
  let terminal = false;
  let scrollBack = null;
  if (sessionTab) {
    pointer(sessionTab); await wait(800);
    terminal = (document.querySelector('.session')?.getBoundingClientRect().width ?? 0) > 200;
    const editorTab = byText('.plxrDock .panelTabName', /^deep\\.txt$/)?.closest('.dv-tab');
    if (editorTab) {
      pointer(editorTab); await wait(800);
      // Measured, not claimed: whether the editor keeps its place when its tab was away.
      scrollBack = Math.round(document.querySelector('.editorPanel .cm-scroller')?.scrollTop ?? -1);
    }
  }
  return { name, line, lines: view.state.doc.lines, scrollTop, scrollBack, visible,
           still, sessionTab: Boolean(sessionTab), terminal };
`);
claim("clicking a hit opens the file in an editor panel", landed.name === "deep.txt", landed.err ?? `opened ${landed.name}`);
claim("the cursor sits on the hit's line", landed.line === 150, `line ${landed.line} of ${landed.lines}`);
claim("the editor scrolled so that line is on screen", landed.scrollTop > 0 && landed.visible, `scrollTop ${landed.scrollTop}, visible ${landed.visible} · after its tab was away and back: scrollTop ${landed.scrollBack}`);
claim("the search panel stays open, and the session is still there behind the editor, its terminal back when its tab comes forward",
  landed.still && landed.sessionTab && landed.terminal, JSON.stringify({ still: landed.still, sessionTab: landed.sessionTab, terminal: landed.terminal }));

// ---- a second hit in the same file moves the same editor -------------------
writeFileSync(join(work, "inner", "deep.txt"), deep.map((l, i) => (i === 19 ? "line 20 NEEDLE again" : l)).join("\n") + "\n");
const again = await run(`${HELPERS}
  const panel = document.querySelector('.searchPanel');
  panel.querySelector('.btn[data-do="find-go"]').click(); await wait(2500);
  const hit = panel.querySelector('.findfile[data-path="inner/deep.txt"] .findline[data-line="20"]');
  if (!hit) return { err: 'no hit at line 20', lines: [...panel.querySelectorAll('.findline')].map(l => l.getAttribute('data-line')) };
  hit.click(); await wait(1500);
  const editors = document.querySelectorAll('.editorPanel').length;
  const view = cmViewOf(document.querySelector('.editorPanel .cm-content'));
  return { editors, line: view ? view.state.doc.lineAt(view.state.selection.main.head).number : 0 };
`);
claim("a second hit in the same file moves the one editor, not a second one", again.editors === 1 && again.line === 20, again.err ?? JSON.stringify(again));

// ---- reachable from the palette and the menu -------------------------------
const reach = await run(`${HELPERS}
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  await wait(400);
  const inp = document.querySelector('.palette input');
  if (inp) set(inp, 'search');
  await wait(300);
  const rows = [...document.querySelectorAll('.paletteRow .paletteLabel')].map(l => l.textContent.trim());
  document.querySelector('.paletteScrim')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await wait(300);
  document.querySelector('.btn[data-do="menu"]')?.click(); await wait(300);
  const menu = [...document.querySelectorAll('.menu .menuItem')].map(i => i.querySelector('.menuLabel')?.textContent.trim() ?? i.textContent.trim());
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  return { rows, menu };
`);
claim("⌘K offers Open Search", (reach.rows ?? []).includes("Open Search"), (reach.rows ?? []).join(", "));
claim("the header MENU lists Search under Views", (reach.menu ?? []).includes("Search"), (reach.menu ?? []).join(", "));

// ---- report ---------------------------------------------------------------
const failed = claims.filter((c) => !c.ok);
for (const c of claims) if (c.ok && process.argv.includes("-v")) console.log(`      ok  ${c.what}${c.detail ? " — " + c.detail : ""}`);
for (const c of failed) console.log(`      ${c.what}${c.detail ? " — " + c.detail : ""}`);
if (failed.length) {
  console.log(`  ${failed.length} of ${claims.length} claims failed`);
  stop(1);
}
console.log(`  ${claims.length} claims about file management and search hold`);
stop(0);
