/* Does the editor half of the window actually work?
 *
 * Everything the folders view does — the tree, the search, the changes, the
 * branches, saving a file — went in without a single check looking at it. So
 * the person who found the faults was the one using it: a bar that mangled
 * itself with four folders open, files that were all the same dot, a column
 * whose width could not be changed, a count of changed files that could not be
 * clicked, and a save that had never once written to disk.
 *
 * This makes claims about the running window and holds them against the disk
 * and against the daemon, in a home of its own so nobody's real plxr is
 * touched. No dependencies: the browser already on the machine, over its
 * debugging protocol, the way clicked.mjs and geometry.mjs do it.
 */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GATEKIT } from "./gatekit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/* The labels below are the English ones only.
 *
 * With no language set the window speaks English — that is what
 * chosenLanguage() decides and what this check therefore meets. Matching both
 * languages would put German into a source file, which german.py reads too,
 * and it caught exactly that. */
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

/* A home and a folder of its own.
 *
 * Never the daemon somebody is working in: this types into an editor and stages
 * files. clicked.mjs learned that lesson the hard way and refuses to run
 * against a foreign build; here there is nothing to refuse, because the daemon
 * is started for the check and killed after it. */
const home = mkdtempSync(join(tmpdir(), "plxr-editor-home-"));
const work = join(home, "folder");
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
writeFileSync(join(work, "notes.md"), "a line to look for: FINDTHISWORD\nand another\n");
writeFileSync(join(work, "inner", "deep.txt"), "nothing special\n");
// Two files with the same name, in different folders — the editor must keep an
// undo history apart for each, and not carry one file's edits into the other.
mkdirSync(join(work, "one"), { recursive: true });
mkdirSync(join(work, "two"), { recursive: true });
writeFileSync(join(work, "one", "same.txt"), "ONE original\n");
writeFileSync(join(work, "two", "same.txt"), "TWO original\n");
// A branch name of the length people actually use, because a short one hides
// a bar that cannot cope.
const repo = git("init", "-q", "-b", "feature/mobile-ui", ".") && git("add", "-A") && git("commit", "-qm", "start");
if (repo) {
  writeFileSync(join(work, "a.go"), "package main\n\nfunc main() { /* changed */ }\n");
  writeFileSync(join(work, "fresh.txt"), "not committed\n");
}

// The binary build.sh leaves behind, wherever this is run from.
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
  console.log("  the daemon did not come up");
  process.exit(1);
}
const api = (path, opts = {}) =>
  fetch(`http://127.0.0.1:${info.port}${path}`, {
    ...opts,
    headers: { "X-Plxr-Token": info.token, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
// Answering, not merely started.
for (let i = 0; i < 80; i++) {
  try {
    if ((await api("/api/version")).ok) break;
  } catch {
    /* not yet */
  }
  await sleep(250);
}
await api("/api/workspaces", { method: "POST", body: JSON.stringify({ path: work }) });

const profile = mkdtempSync(join(tmpdir(), "plxr-editor-"));
const port = 9600 + (process.pid % 300);
const chrome = spawn(browser, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--use-mock-keychain",
  "--password-store=basic",
  "--no-default-browser-check",
  "--window-size=1400,900",
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
  // The text alone reads "Uncaught"; the description says what was thrown.
  if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`.trim());
  return r.result?.value;
};

// Waited for, not slept through.
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
  /* The folders are a tab of main, and every file opens as a tab of main in
     front of them. The dock renders only the tab in front, so the folder bar
     and the tree are not in the page until the folders' tab is brought
     forward — on the pointer, which is where dockview makes a tab active. */
  const folders = async () => {
    const t = byText('.plxrDock .panelTabName', /^Folders$/)?.closest('.dv-tab');
    if (!t) return;
    t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    await wait(500);
  };
`;

// ---- the view opens, with the folder in it ---------------------------------
const opened = await run(`${HELPERS}
  openDoc('folders');
  await wait(2500);
  return {
    tabs: [...document.querySelectorAll('.folderTab')].map(t => t.textContent.trim()),
    names: [...document.querySelectorAll('.fname')].map(n => n.textContent.trim()),
    kinds: [...document.querySelectorAll('.ficon')].map(i => i.getAttribute('data-kind')),
    branch: document.querySelector('.foldergit .branchname')?.textContent.trim() ?? '',
  };
`);
claim("the folders view opens with the folder in it", opened.tabs.length === 1, opened.tabs.join(", "));
claim("the tree lists what is in the folder",
  opened.names.includes("a.go") && opened.names.includes("notes.md"),
  opened.names.join(", "));
claim("files are marked by kind, not all alike",
  new Set(opened.kinds).size >= 3, [...new Set(opened.kinds)].join(", "));
if (repo) claim("the bar says which branch the folder is on", opened.branch === "feature/mobile-ui", opened.branch);

// ---- the bar survives four folders ----------------------------------------
/* Names of the length that actually turn up.
 *
 * With three folders called one, two and three everything fitted on a single
 * row and the check passed on a bar that was known to be unreadable. The names
 * here are the ones from the window where it went wrong. */
for (const extra of ["node_modules", "mta360-frontend-new", "keycloak-theme"]) {
  const dir = join(home, extra);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "x.txt"), "x\n");
  await api("/api/workspaces", { method: "POST", body: JSON.stringify({ path: dir }) });
}
// Reloaded through the protocol, not with location.reload() inside the page:
// navigating from in there tears down the evaluation that asked for it.
const reload = async () => {
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${info.port}/?token=${info.token}` });
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    if (await run(`${GATEKIT} return appUp();`).catch(() => 0)) return;
  }
};
await reload();
const bar = await run(`${HELPERS}
  openDoc('folders'); await wait(2000);
  const box = document.querySelector('.folderbar').getBoundingClientRect();
  const visible = e => e.offsetParent !== null && !e.closest('.obarMeasureBox');
  const out = [...document.querySelectorAll('.folderbar *')]
    .filter(visible)
    .filter(e => e.getBoundingClientRect().right > box.right + 2 || e.getBoundingClientRect().bottom > box.bottom + 2)
    .map(e => e.textContent.trim().slice(0, 24));
  /* Squeezed counts as broken.
   *
   * Nothing spilling out is not the same as everything readable: on one row the
   * flex box simply crushed the tabs and the buttons until they fitted, which
   * is what made the bar unreadable in the first place. A piece of text narrower
   * than a few characters is a piece of text nobody can read. */
  const squeezed = [...document.querySelectorAll('.folderTab, .folderbar .branchname, .folderbar .obarItems button')]
    .filter(visible)
    .filter(e => e.textContent.trim().length > 2 && e.getBoundingClientRect().width < 28)
    .map(e => e.textContent.trim().slice(0, 24) + ' (' + Math.round(e.getBoundingClientRect().width) + 'px)');
  return { tabs: document.querySelectorAll('.folderTab').length, spilled: out, squeezed };
`);
claim("four folders fit in the bar without spilling out of it",
  bar.tabs === 4 && bar.spilled.length === 0,
  `${bar.tabs} tabs, spilled: ${bar.spilled.join(" | ") || "nothing"}`);
claim("with four folders open, nothing in the bar is squeezed to nothing",
  bar.squeezed.length === 0, bar.squeezed.join(" | ") || "nothing squeezed");

/* And in a narrow window, which is where it actually went wrong.
 *
 * At 1400px four folders and five buttons fit on one row, so a bar that could
 * not cope still passed. The window it broke in was narrower, with a folder
 * whose branch name is long. That is the condition, so that is what is asked. */
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 900, height: 800, deviceScaleFactor: 1, mobile: false,
});
const narrow = await run(`${HELPERS}
  byText('.folderTab', /^folder$/).click(); await wait(2000);
  const box = document.querySelector('.folderbar').getBoundingClientRect();
  const visible = e => e.offsetParent !== null && !e.closest('.obarMeasureBox');
  const parts = [...document.querySelectorAll('.folderTab, .folderbar .branchname, .folderbar .obarItems button')].filter(visible);
  return {
    branch: document.querySelector('.foldergit .branchname')?.textContent.trim() ?? '',
    spilled: parts.filter(e => e.getBoundingClientRect().right > box.right + 2)
      .map(e => e.textContent.trim().slice(0, 20)),
    squeezed: parts.filter(e => e.textContent.trim().length > 2 && e.getBoundingClientRect().width < 28)
      .map(e => e.textContent.trim().slice(0, 20) + ' (' + Math.round(e.getBoundingClientRect().width) + 'px)'),
  };
`);
await cdp.send("Emulation.clearDeviceMetricsOverride");
claim("the bar still holds together in a narrow window",
  narrow.spilled.length === 0 && narrow.squeezed.length === 0,
  `branch ${narrow.branch || "none"}; spilled ${narrow.spilled.join(",") || "nothing"}; squeezed ${narrow.squeezed.join(",") || "nothing"}`);

// ---- a file opens, is changed, and lands on disk ---------------------------
const saved = await run(`${HELPERS}
  byText('.folderTab', /folder$/).click(); await wait(2000);
  const row = byText('.frow', /notes\\.md/);
  if (!row) return { err: 'notes.md is not in the tree' };
  row.click(); await wait(2000);
  const cm = document.querySelector('.cm-content');
  if (!cm) return { err: 'the editor did not open' };
  const dirtyBefore = !!document.querySelector('.dirty');
  cm.focus();
  const sel = window.getSelection(); const range = document.createRange();
  range.selectNodeContents(cm); range.collapse(false); sel.removeAllRanges(); sel.addRange(range);
  document.execCommand('insertText', false, 'WRITTENBYTHECHECK\\n');
  await wait(500);
  const save = byText('.editorPanel button', /^SAVE$/);
  if (!save) return { err: 'no save button', dirtyBefore };
  save.click(); await wait(1800);
  return { dirtyBefore, dirtyAfter: !!document.querySelector('.dirty') };
`);
claim("a freshly opened file is not offered as unsaved", saved.dirtyBefore === false, JSON.stringify(saved));
const onDisk = existsSync(join(work, "notes.md")) ? readFileSync(join(work, "notes.md"), "utf8") : "";
claim("what was typed in the editor is on disk afterwards",
  onDisk.includes("WRITTENBYTHECHECK"), saved.err ?? `file is now ${JSON.stringify(onDisk.slice(-40))}`);

/* ---- undo must not undo the file itself --------------------------------- */
const undone = await run(`${HELPERS}
  byText('.editorPanel button', /^CLOSE$/)?.click(); await wait(600);
  await folders();
  byText('.folderbarLow button', /^FILES$/)?.click(); await wait(700);
  const row = byText('.frow', /a\\.go/);
  if (!row) return { err: 'a.go is not in the tree' };
  row.click(); await wait(2000);
  const cm = document.querySelector('.cm-content');
  if (!cm) return { err: 'no editor' };
  cm.focus();
  return { before: cm.innerText.trim().slice(0, 24) };
`);

/* A real key, through the protocol.
 *
 * execCommand('undo') asks the browser, and CodeMirror keeps its own history
 * behind its own keymap — so the check passed on an editor that did empty
 * itself when somebody actually pressed the keys. */
if (!undone.err) {
  for (const type of ["keyDown", "keyUp"]) {
    await cdp.send("Input.dispatchKeyEvent", {
      type, key: "z", code: "KeyZ", text: type === "keyDown" ? "z" : undefined,
      windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90,
      modifiers: 4, // meta
      commands: type === "keyDown" ? ["undo"] : undefined,
    });
  }
  await sleep(700);
  const after = await run(`
    const cm = document.querySelector('.cm-content');
    return { after: cm ? cm.innerText.trim().slice(0, 24) : '(gone)',
             dirty: !!document.querySelector('.dirty') };
  `);
  undone.after = after.after;
  undone.dirty = after.dirty;
}
claim("undo does not undo the arrival of the file",
  undone.after === undone.before && undone.dirty === false, JSON.stringify(undone));

/* ---- unsaved edits are not thrown away in silence ------------------------ */
/* Open a file, change it without saving, click another file. The window has to
 * keep the change — it used to switch and lose it without a word. Every file
 * is a dock panel of its own now, so the second file opens beside the first
 * and the first keeps its edit; back on its tab, the edit is still there. */
const guarded = await run(`${HELPERS}
  byText('.editorPanel button', /^CLOSE$/)?.click(); await wait(600);
  await folders();
  byText('.folderbarLow button', /^FILES$/)?.click(); await wait(700);
  const rowFor = (suffix) => [...document.querySelectorAll('.frow')].find(r => (r.dataset.path || '').endsWith(suffix));
  const expand = (name) => { const f = [...document.querySelectorAll('.frow')].find(r => r.querySelector('.fname')?.textContent.trim() === name); if (f) f.click(); };
  expand('one'); await wait(600);
  const first = rowFor('one/same.txt');
  if (!first) return { err: 'one/same.txt not in the tree', paths: [...document.querySelectorAll('.frow')].map(r=>r.dataset.path) };
  first.click(); await wait(1800);
  const cm = document.querySelector('.cm-content');
  if (!cm) return { err: 'editor did not open' };
  cm.focus();
  const sel = window.getSelection(); const range = document.createRange();
  range.selectNodeContents(cm); range.collapse(false); sel.removeAllRanges(); sel.addRange(range);
  document.execCommand('insertText', false, 'UNSAVEDEDIT');
  await wait(400);
  const dirty = !!document.querySelector('.dirty');
  // now click the other same-named file, still unsaved — from the tree, which
  // went behind the editor that just opened
  await folders();
  expand('two'); await wait(600);
  const other = rowFor('two/same.txt');
  if (other) other.click();
  await wait(1200);
  // Two tabs called same.txt, one per file; the first opened is the edited one.
  // A tab switches on the pointer, not on click.
  const shown = () => [...document.querySelectorAll('.editorPanel')].find(e => e.offsetParent !== null);
  const otherShown = (shown()?.querySelector('.cm-content')?.innerText || '');
  // A tab's text carries its icon beside the title; the title is .panelTabName.
  const tabs = [...document.querySelectorAll('.dv-tab')].filter(t => (t.querySelector('.panelTabName')?.textContent || '').trim() === 'same.txt');
  const firstTab = tabs[0];
  if (firstTab) { firstTab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 })); firstTab.click(); }
  await wait(600);
  return { dirty, tabs: tabs.length, otherClean: !otherShown.includes('UNSAVEDEDIT'),
           stillOne: (shown()?.querySelector('.cm-content')?.innerText || '').includes('UNSAVEDEDIT'),
           stillDirty: !!shown()?.querySelector('.dirty') };
`);
claim("unsaved edits are kept when another file is opened: each file is its own panel",
  guarded.err ? false : (guarded.dirty === true && guarded.tabs === 2 && guarded.otherClean && guarded.stillOne && guarded.stillDirty), JSON.stringify(guarded));

// ---- the search finds a word and lands on its line -------------------------
const found = await run(`${HELPERS}
  byText('.editorPanel button', /^CLOSE$/)?.click(); await wait(600);
  await folders();
  byText('.folderbarLow button', /^FIND$/).click(); await wait(800);
  const box = document.querySelector('.filesearch input');
  set(box, 'FINDTHISWORD'); await wait(200);
  byText('.filesearch button', /FIND/).click(); await wait(2500);
  const hit = document.querySelector('.findline');
  if (!hit) return { err: 'nothing found', shown: document.querySelector('.filesearch')?.innerText.slice(0, 120) };
  const line = Number(hit.querySelector('.findno').textContent.trim());
  const path = document.querySelector('.findpath').textContent.trim();
  hit.click(); await wait(2500);
  const scroller = document.querySelector('.cm-scroller');
  const mark = [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
    .find(e => e.textContent.trim() === String(line));
  const visible = mark && scroller
    ? mark.getBoundingClientRect().top >= scroller.getBoundingClientRect().top - 4
    : false;
  return { path, line, opened: document.querySelector('.overlayName')?.textContent.trim(), visible };
`);
claim("the search finds a word that is in the folder",
  found.path === "notes.md" && found.line > 0, JSON.stringify(found));
claim("clicking a hit opens that file on that line",
  found.opened === "notes.md" && found.visible, JSON.stringify(found));

// ---- the changed count is a way in, not a boast ---------------------------
if (repo) {
  const changes = await run(`${HELPERS}
    byText('.editorPanel button', /^CLOSE$/)?.click(); await wait(600);
    await folders();
    byText('.folderbarLow button', /^FILES$/).click(); await wait(900);
    const count = document.querySelector('.branchword');
    if (!count) return { err: 'no count in the bar' };
    const text = count.textContent.trim();
    count.click(); await wait(2500);
    return { text, landed: !!document.querySelector('.changes'),
             listed: [...document.querySelectorAll('.changepath')].map(p => p.textContent.trim()),
             groups: [...document.querySelectorAll('.changegroup .uhead')].map(h => h.textContent.trim()) };
  `);
  claim("the count of changed files leads to the list of them",
    changes.landed && changes.listed.length > 0, JSON.stringify(changes).slice(0, 200));
  claim("staged, unstaged and new files are kept apart",
    (changes.groups || []).length >= 2, (changes.groups || []).join(" / "));

  const branches = await run(`${HELPERS}
    await folders();
    byText('.folderbarLow button', /^BRANCHES$/).click(); await wait(2000);
    const rows = [...document.querySelectorAll('.branchrow')];
    return { first: rows[0]?.querySelector('.branchname')?.textContent.trim(),
             current: rows[0]?.querySelector('.branchname')?.getAttribute('data-on'),
             count: rows.length };
  `);
  claim("the branch you are on is listed first",
    branches.count >= 1 && branches.current === "yes", JSON.stringify(branches));
}

// ---- the column can be made wider ----------------------------------------
const width = await run(`${HELPERS}
  await folders();
  byText('.folderbarLow button', /^FILES$/).click(); await wait(800);
  const w = () => getComputedStyle(document.documentElement).getPropertyValue('--files-w').trim();
  const before = w();
  const s = document.querySelector('.foldersbody .splitter');
  if (!s) return { err: 'no handle to drag' };
  s.focus();
  s.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await wait(400);
  return { before, after: w() };
`);
claim("the column beside the editor can be made wider",
  width.after && width.before !== width.after, `${width.before} -> ${width.after}${width.err ? " " + width.err : ""}`);

// ---- report ---------------------------------------------------------------
const failed = claims.filter((c) => !c.ok);
for (const c of failed) console.log(`      ${c.what}${c.detail ? " — " + c.detail : ""}`);
if (failed.length) {
  console.log(`  ${failed.length} of ${claims.length} claims failed`);
  stop(1);
}
console.log(`  ${claims.length} claims about the editor hold`);
stop(0);
