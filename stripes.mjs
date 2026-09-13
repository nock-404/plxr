/* Do the tool windows do what they say?
 *
 * A tool — the file tree, what has changed, the inbox, the usage — used to be
 * a panel like any document: a tab with an × in the grid, split beside the
 * work, closed and lost. Now each is a window at an edge of the dock, shown
 * and hidden, never closed, and main between the edges holds documents only.
 * That is a set of promises about boxes on a screen, and every one of them can
 * be broken without the code saying so. So each is driven the way somebody
 * drives it — through the gate kit, which clicks today's rail — and measured:
 *
 *   a tool opens at its edge, main gives up exactly its width and nothing else
 *     moves; the same click hides it and main takes the room back;
 *   a second tool on the same edge swaps into the same box;
 *   an edge dragged wider keeps that width through hide, show, another edge
 *     and a reload, and hiding alone is saved;
 *   a tool window has no ×, the middle button closes nothing in it, ⌘W from
 *     inside it hides it and ⇧⌘T does not bring it back as a tab; its header
 *     names it, its — hides it, its ⋮ offers Hide with the edge's chord;
 *   ⌘B ⌥⌘B ⌘J show and hide their edge and an empty edge changes nothing;
 *     ⌘2 shows the Inbox with the keyboard in it, gives the keyboard back to
 *     it, and puts it away from inside it; ⇧⎋ hides the window the keyboard
 *     is in and nothing else;
 *   a tool window is as wide as its edge whatever it holds, its — in reach;
 *   a file clicked in the Files tool opens in main, and a document dragged
 *     onto a tool window, its edges or the grid's outer edge stays in main;
 *   main's splits keep their proportions whatever order the edges go in;
 *   a hidden tool asks the service for nothing;
 *   main is never narrower than its floor, nor under a tool window, while the
 *     window is wide enough for both;
 *   an arrangement saved by the old window comes up with its tools on their
 *     edges, its documents in main, and the old region choices read across.
 *
 * Held against a service started from this build, the way tabs.mjs does it;
 * the session and the folder it needs are made for the check and taken away
 * afterwards, and the settings the service had are put back.
 */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GATEKIT } from "./gatekit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.PLXR_HOME || join(process.env.HOME, ".plxr");
const BROWSERS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

let info;
try {
  info = JSON.parse(readFileSync(join(HOME, "daemon.json"), "utf8"));
} catch {
  console.log(`  no service under ${HOME} — this check needs a live window`);
  process.exit(1);
}
const browser = BROWSERS.find((p) => {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
});
if (!browser) {
  console.log("  no chromium-based browser found — cannot check the window");
  process.exit(1);
}

const base = `http://127.0.0.1:${info.port}`;
const api = (path, init = {}) =>
  fetch(base + path, {
    ...init,
    headers: { "X-Plxr-Token": info.token, "Content-Type": "application/json", ...(init.headers ?? {}) },
  }).then((r) => (r.status === 204 ? null : r.json()));

// The page the service serves is held against the page this build produced —
// see clicked.mjs for why.
{
  let mine = "";
  let theirs = "";
  try {
    mine = readFileSync(join(HERE, "frontend", "out", "index.html"), "utf8");
    theirs = await fetch(`${base}/?token=${info.token}`).then((r) => r.text());
  } catch {
    /* compared below */
  }
  if (!mine || theirs.trim() !== mine.trim()) {
    console.log(`  the service on port ${info.port} does not serve this build — build the frontend and start its service first`);
    process.exit(1);
  }
}

/* The window starts from a known arrangement: where a tool opens and how wide
   depends on what was saved, so what the service had is put aside for the run
   and written back at the end. */
const KEYS = ["dock", "dockSizes", "toolLayout", "dockRegions", "dockPresets", "dockActivity"];
const before = await api("/api/prefs").catch(() => ({}));
const held = Object.fromEntries(KEYS.map((k) => [k, before?.[k] ?? null]));
const fresh = Object.fromEntries(KEYS.map((k) => [k, null]));
await api("/api/prefs", { method: "PUT", body: JSON.stringify(fresh) }).catch(() => undefined);

const fixtures = JSON.parse(readFileSync(join(HERE, "frontend", "lib", "layoutMigrate.fixtures.json"), "utf8"));

/* Where each tool sits is read off the arrangement the window saved, not off
   the page: dockview takes a tool that is not in front of its edge out of the
   page once that edge has been shown, so counting windows on screen would
   count only the ones in front. */
const TOOL_IDS = ["archive", "changes", "files", "inbox", "notes", "ports", "review", "search", "usage"];
const leafViews = (node) => (!node ? [] : node.type === "leaf" ? node.data?.views ?? [] : (node.data ?? []).flatMap(leafViews));
const placed = (dock) => ({
  edges: Object.values(dock?.edgeGroups ?? {}).flatMap((e) => e?.group?.views ?? []),
  main: [...leafViews(dock?.grid?.root), ...(dock?.floatingGroups ?? []).flatMap((f) => f?.data?.views ?? [])],
});
const onceEach = (p) => JSON.stringify([...p.edges].sort()) === JSON.stringify(TOOL_IDS) && !p.main.some((v) => TOOL_IDS.includes(v));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9100 + Math.floor(Number(process.pid) % 400);
const profile = mkdtempSync(join(tmpdir(), "plxr-stripes-"));
/* 1600 wide, the window the edges were measured in: both sides and main have
   room, and a side squeezed against its minimum proves nothing about the size
   it is meant to keep. Its own process group, so one kill ends the renderers
   with it. */
const child = spawn(
  browser,
  ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--use-mock-keychain", "--password-store=basic", "--no-default-browser-check", "--window-size=1600,1000", "about:blank"],
  { stdio: "ignore", detached: true },
);

// The check's own folder, with files for the tree to open.
const work = mkdtempSync(join(tmpdir(), "plxr-stripes-work-"));
writeFileSync(join(work, "alpha.txt"), "one\ntwo\nthree\n");
writeFileSync(join(work, "beta.txt"), "four\nfive\n");
writeFileSync(join(work, "gamma.txt"), "six\n");
/* And what no tool window is wide enough for: a chain of folders whose names
   alone are wider than the window, and a line far longer than any window. */
{
  let deep = work;
  for (let i = 1; i <= 6; i++) {
    deep = join(deep, `a-folder-with-a-long-name-that-keeps-going-level-${i}`);
    mkdirSync(deep);
    writeFileSync(join(deep, `a-file-whose-name-is-longer-than-the-window-level-${i}.txt`), "x\n");
  }
  writeFileSync(join(work, "wide.txt"), `const wide = "${"w".repeat(300)}needle-far-out${"w".repeat(300)}";\n`);
}
let made = null;

let browserGone = false;
const killBrowser = () => {
  if (browserGone) return;
  browserGone = true;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    try {
      if (execFileSync("ps", ["-o", "stat=", "-p", String(child.pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).includes("Z")) break;
    } catch {
      break;
    }
    const t = Date.now() + 50;
    while (Date.now() < t);
  }
};
process.on("exit", () => {
  killBrowser();
  try { rmSync(work, { recursive: true, force: true, maxRetries: 3 }); } catch { /* in the temp directory */ }
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* in the temp directory */ }
});
let stopping = false;
const bail = (code) => {
  if (stopping) process.exit(code);
  stopping = true;
  void stop(code);
};
for (const bad of ["uncaughtException", "unhandledRejection"]) {
  process.on(bad, (why) => {
    console.log(`  ${bad}: ${why?.stack ?? why}`);
    bail(1);
  });
}
process.on("SIGINT", () => bail(130));
process.on("SIGTERM", () => bail(143));

async function stop(code) {
  killBrowser();
  if (made) await api(`/api/sessions/${encodeURIComponent(made.id)}`, { method: "DELETE" }).catch(() => undefined);
  await api("/api/prefs", { method: "PUT", body: JSON.stringify(held) }).catch(() => undefined);
  try { rmSync(work, { recursive: true, force: true, maxRetries: 3 }); } catch { /* in the temp directory */ }
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* in the temp directory */ }
  process.exit(code);
}

async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  return null;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const waiting = new Map();
    const listeners = new Map();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && waiting.has(msg.id)) {
        const p = waiting.get(msg.id);
        waiting.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      } else if (msg.method) {
        for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
      }
    };
    ws.onerror = () => reject(new Error("cannot speak to the browser"));
    ws.onopen = () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((res, rej) => {
            const next = ++id;
            waiting.set(next, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id: next, method, params }));
          }),
        on: (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]),
        once: (method, ms) =>
          new Promise((res) => {
            const fn = (p) => {
              listeners.set(method, (listeners.get(method) ?? []).filter((x) => x !== fn));
              clearTimeout(timer);
              res(p);
            };
            const timer = setTimeout(() => {
              listeners.set(method, (listeners.get(method) ?? []).filter((x) => x !== fn));
              res(null);
            }, ms);
            listeners.set(method, [...(listeners.get(method) ?? []), fn]);
          }),
        close: () => ws.close(),
      });
  });
}

const wsUrl = await endpoint();
if (!wsUrl) {
  console.log("  the browser did not come up — nothing checked");
  await stop(1);
}
const cdp = await connect(wsUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Network.enable");

// What this window asks the service for, as the browser records it.
const traffic = [];
cdp.on("Network.requestWillBeSent", (p) => traffic.push({ at: Date.now(), kind: "http", url: p.request.url }));
cdp.on("Network.webSocketCreated", (p) => traffic.push({ at: Date.now(), kind: "ws", url: p.url, id: p.requestId }));
cdp.on("Network.webSocketClosed", (p) => traffic.push({ at: Date.now(), kind: "wsclosed", id: p.requestId }));

const run = async (expression) => {
  const r = await cdp.send("Runtime.evaluate", { expression: `(async () => { ${expression} })()`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
};
const mouse = (type, x, y, extra = {}) => cdp.send("Input.dispatchMouseEvent", { type, x: Math.round(x), y: Math.round(y), ...extra });

const claims = [];
const claim = (what, ok, detail = "") => claims.push({ what, ok: Boolean(ok), detail });
const unmeasured = (what, why) => claims.push({ what, ok: false, detail: `could not be measured: ${why}` });

made = await api("/api/sessions", { method: "POST", body: JSON.stringify({ cwd: work, cmd: [], name: "plxr-stripes-check", account: "" }) }).catch(() => null);
if (!made?.id) {
  console.log("  could not start a session for the check");
  await stop(1);
}

async function load() {
  await cdp.send("Page.navigate", { url: `${base}/?token=${info.token}` });
  for (let i = 0; i < 50; i++) {
    await sleep(400);
    if (await run(`${GATEKIT} return appUp();`).catch(() => 0)) {
      await sleep(1200);
      return true;
    }
  }
  return false;
}
const view = (w) => cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: 1000, deviceScaleFactor: 1, mobile: false });
await view(1600);
if (!(await load())) {
  console.log("  the interface did not render — nothing to check");
  await stop(1);
}

/* The helpers the page-side steps share.
 *
 * A tool window's box is its edge's box: a hidden edge keeps the window's
 * element, zero wide or high, so what is on screen is read off the group the
 * window sits in, never off the window. Main is .plxrDock — dockview puts the
 * dock's class on the grid between the edges. */
const HELPERS = `${GATEKIT}
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(50); } return null; };
  const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const win = id => document.querySelector('.toolWindow[data-tool="' + id + '"]');
  const edgeBox = id => { const g = win(id)?.closest('.dv-groupview'); const b = box(g); return b && b.w > 0 && b.h > 0 ? b : null; };
  const showing = () => [...document.querySelectorAll('.toolWindow')].filter(w => edgeBox(w.dataset.tool)).map(w => w.dataset.tool);
  const grid = () => box(document.querySelector('.plxrDock'));
  const host = () => box(document.querySelector('.dockHost'));
  const gridGroups = () => [...document.querySelectorAll('.plxrDock .dv-groupview')].map(g => ({ tabs: [...g.querySelectorAll('.panelTabName')].map(e => e.textContent.trim()), b: box(g), el: g }));
  const gridTabs = () => [...document.querySelectorAll('.plxrDock .panelTabName')].map(e => e.textContent.trim());
  const tabNamed = n => [...document.querySelectorAll('.plxrDock .dv-tab')].find(t => (t.querySelector('.panelTabName') || {}).textContent?.trim() === n);
  const groupOfTab = n => tabNamed(n)?.closest('.dv-groupview') || null;
  const railName = id => (stripeIcon(id)?.querySelector('.rname') || {}).textContent?.trim() || '';
  const click = async (id, ms) => { stripeIcon(id).click(); await wait(ms || 700); };
  const key = async (k, mods) => { const t = document.activeElement || document.body; t.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, mods || {}))); await wait(450); };
  const hideAll = async () => { for (const t of showing()) { if (toolLit(t)) await click(t, 500); } };
  const menuRows = () => [...document.querySelectorAll('body > .menu > *')].map(e => e.classList.contains('menuSep') ? '---' : e.classList.contains('menuHeader') ? '# ' + e.textContent.trim() : ((e.querySelector('.menuLabel') || {}).textContent || '').trim() + ((e.querySelector('.menuHint') || {}).textContent ? ' [' + e.querySelector('.menuHint').textContent.trim() + ']' : ''));
  const closeMenu = async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(150); };
  const near = (a, b, t) => a !== null && b !== null && Math.abs(a - b) <= (t || 1);
  const TOOL_IDS = ['files', 'changes', 'search', 'review', 'inbox', 'usage', 'ports', 'archive', 'notes'];
`;

const near = (a, b, tol = 1) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;
const boxNear = (a, b, tol = 1) => Boolean(a && b) && near(a.x, b.x, tol) && near(a.y, b.y, tol) && near(a.w, b.w, tol) && near(a.h, b.h, tol);
const show = (b) => (b ? `${b.x},${b.y} ${b.w}×${b.h}` : "none");

// ---- a fresh window: every tool a window of its own, none of them showing ----
const start = await run(`${HELPERS}
  return { showing: showing(), gridTabs: gridTabs(), names: TOOL_IDS.map(railName), grid: grid(), host: host() };
`);
const startPlaced = placed((await api("/api/prefs")).dock);
claim(
  "every tool is at an edge of its own, exactly once, and none is a tab of main",
  onceEach(startPlaced) && !start.gridTabs.some((t) => start.names.includes(t)),
  `at the edges ${startPlaced.edges.join(", ")} · in main ${startPlaced.main.join(", ")} · main's tabs ${start.gridTabs.join(", ")}`,
);
claim("a fresh window shows no tool window, and main fills the dock", start.showing.length === 0 && boxNear(start.grid, start.host), `showing ${start.showing.join(", ") || "none"} · main ${show(start.grid)} · dock ${show(start.host)}`);

// ---- open, hide, swap --------------------------------------------------------
const opened = await run(`${HELPERS}
  const g0 = grid();
  await click('files');
  const lit = toolLit('files');
  const files = edgeBox('files');
  const g1 = grid();
  const others = { changes: edgeBox('changes'), inbox: edgeBox('inbox') };
  await click('files');
  const hidden = { lit: toolLit('files'), box: edgeBox('files'), icon: Boolean(stripeIcon('files')), grid: grid() };
  await click('files');
  const beforeSwap = { files: edgeBox('files'), grid: grid() };
  await click('changes');
  const swapped = { changes: edgeBox('changes'), files: edgeBox('files'), filesLit: toolLit('files'), changesLit: toolLit('changes'), grid: grid(), showing: showing() };
  return { g0, lit, files, g1, others, host: host(), hidden, beforeSwap, swapped };
`);
{
  const o = opened;
  claim(
    "clicking Files lights it and shows its window at the left of the dock",
    o.lit && o.files && near(o.files.x, o.host.x) && near(o.files.y, o.g0.y) && near(o.files.h, o.g0.h),
    `lit ${o.lit} · window ${show(o.files)} · dock from x ${o.host.x}`,
  );
  claim(
    "main gives up exactly the window's width and nothing else moves",
    o.files && near(o.g1.x, o.g0.x + o.files.w, 2) && near(o.g1.x + o.g1.w, o.g0.x + o.g0.w) && near(o.g1.y, o.g0.y) && near(o.g1.h, o.g0.h) && !o.others.changes && !o.others.inbox,
    `main ${show(o.g0)} → ${show(o.g1)} · window ${o.files?.w} wide · right and bottom showing: ${Boolean(o.others.inbox)}`,
  );
  claim(
    "clicking the lit icon hides the window, the icon stays and goes dark, and main is back where it was",
    !o.hidden.lit && !o.hidden.box && o.hidden.icon && boxNear(o.hidden.grid, o.g0),
    `lit ${o.hidden.lit} · window ${show(o.hidden.box)} · icon there ${o.hidden.icon} · main ${show(o.hidden.grid)} against ${show(o.g0)}`,
  );
  claim(
    "Changes on the same edge swaps into the same box, Files goes dark, and no column is added",
    boxNear(o.swapped.changes, o.beforeSwap.files) && !o.swapped.files && !o.swapped.filesLit && o.swapped.changesLit && boxNear(o.swapped.grid, o.beforeSwap.grid) && o.swapped.showing.length === 1,
    `files was ${show(o.beforeSwap.files)}, changes is ${show(o.swapped.changes)} · files lit ${o.swapped.filesLit} · main ${show(o.beforeSwap.grid)} → ${show(o.swapped.grid)} · showing ${o.swapped.showing.join(", ")}`,
  );
}

// ---- width memory: a sash drag, hide and show, another edge, a reload --------
const sash = await run(`${HELPERS}
  const w = edgeBox('changes');
  if (!w) return null;
  const s = [...document.querySelectorAll('.dockHost .dv-sash')].map(el => box(el)).filter(b => b.w > 0 && b.h > b.w && Math.abs(b.x + b.w / 2 - (w.x + w.w)) < 8 && b.y <= w.y + w.h / 2 && b.y + b.h >= w.y + w.h / 2);
  return s.length ? { x: s[0].x + s[0].w / 2, y: w.y + w.h / 2, width: w.w } : null;
`);
if (!sash) {
  unmeasured("a sash dragged to 400px holds that width", "no sash at the Changes window's edge");
} else {
  const to = sash.x + (400 - sash.width);
  await mouse("mouseMoved", sash.x, sash.y);
  await mouse("mousePressed", sash.x, sash.y, { button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 14; i++) {
    await mouse("mouseMoved", sash.x + ((to - sash.x) * i) / 14, sash.y, { button: "left", buttons: 1 });
    await sleep(16);
  }
  await mouse("mouseReleased", to, sash.y, { button: "left", buttons: 0, clickCount: 1 });
  await sleep(700);
  const widths = await run(`${HELPERS}
    const dragged = edgeBox('changes')?.w ?? null;
    await click('changes');
    const hiddenBox = edgeBox('changes');
    await click('changes');
    const again = edgeBox('changes')?.w ?? null;
    await click('inbox');
    const withRight = { left: edgeBox('changes')?.w ?? null, right: edgeBox('inbox')?.w ?? null };
    await wait(900);
    return { dragged, hidden: hiddenBox, again, withRight };
  `);
  await load();
  const reloaded = await run(`${HELPERS} return { left: edgeBox('changes')?.w ?? null, lit: toolLit('changes'), right: edgeBox('inbox')?.w ?? null, rightLit: toolLit('inbox') };`);
  claim("a sash dragged to 400px leaves the left window 400px wide", near(widths.dragged, 400), `${sash.width} → ${widths.dragged}`);
  claim("hidden and shown again, it comes back at 400px", !widths.hidden && near(widths.again, 400), `hidden ${show(widths.hidden)} · shown ${widths.again}`);
  claim("showing the right edge meanwhile leaves the left one at 400px", near(widths.withRight.left, 400) && widths.withRight.right > 0, `left ${widths.withRight.left} · right ${widths.withRight.right}`);
  claim("after a reload the left window is 400px and still lit, the right one too", near(reloaded.left, 400) && reloaded.lit && reloaded.rightLit && near(reloaded.right, widths.withRight.right), JSON.stringify(reloaded));
}

// Hiding and nothing else, then a reload: the hide was saved.
const hiddenSaved = await run(`${HELPERS} await click('changes'); await click('inbox'); await wait(1000); return { showing: showing() };`);
await load();
const afterHide = await run(`${HELPERS} return { showing: showing(), changes: toolLit('changes'), inbox: toolLit('inbox') };`);
claim(
  "hiding alone is saved: after a reload nothing is showing",
  hiddenSaved.showing.length === 0 && afterHide.showing.length === 0 && !afterHide.changes && !afterHide.inbox,
  `before the reload ${hiddenSaved.showing.join(", ") || "none"} · after ${afterHide.showing.join(", ") || "none"}`,
);

// ---- the window's header, its hide and its menu; nothing closes a tool -------
const header = await run(`${HELPERS}
  openSession(/plxr-stripes-check/);
  await wait(1500);
  await click('files', 900);
  const w = win('files');
  const title = w.querySelector('.toolTitle')?.textContent.trim() ?? '';
  const closes = [...document.querySelectorAll('.toolWindow')].map(t => t.closest('.dv-groupview')).filter(Boolean).reduce((n, g) => n + g.querySelectorAll('.panelTabClose').length, 0);
  const hideLabel = w.querySelector('[data-do="tool-hide"]')?.getAttribute('aria-label') ?? '';
  w.querySelector('[data-do="tool-more"]').click();
  await wait(300);
  const rows = menuRows();
  await closeMenu();
  // The middle button inside the window.
  const body = w.querySelector('.toolBody');
  body.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
  await wait(300);
  const afterMiddle = { lit: toolLit('files'), box: edgeBox('files') };
  // ⌘W with the keyboard in the window: the window itself, not a field in it.
  w.focus();
  const focused = Boolean(document.activeElement && document.activeElement.closest('.toolWindow[data-tool="files"]'));
  await key('w', { metaKey: true });
  const afterW = { lit: toolLit('files'), box: edgeBox('files'), icon: Boolean(stripeIcon('files')), gridTabs: gridTabs() };
  await key('T', { metaKey: true, shiftKey: true });
  const afterReopen = { lit: toolLit('files'), box: edgeBox('files'), gridTabs: gridTabs() };
  // The — in the header.
  await click('files', 900);
  const shownAgain = Boolean(edgeBox('files'));
  win('files').querySelector('[data-do="tool-hide"]').click();
  await wait(600);
  return { title, rail: railName('files'), closes, hideLabel, rows, afterMiddle, focused, afterW, afterReopen, shownAgain, afterHideButton: { lit: toolLit('files'), box: edgeBox('files') } };
`);
{
  const h = header;
  const chord = process.platform === "darwin" ? "⌘B" : "Ctrl+B";
  claim("the header names the tool the way its icon does", h.title !== "" && h.title.toLowerCase() === h.rail.toLowerCase(), `header "${h.title}" · rail "${h.rail}"`);
  claim("there is no × anywhere in a tool window", h.closes === 0, `${h.closes} closes in the edges`);
  claim(`⋮ offers Hide with the edge's chord, and nothing else`, JSON.stringify(h.rows) === JSON.stringify([`${h.hideLabel} [${chord}]`]), h.rows.join(" | "));
  claim("the middle button inside a tool window closes nothing", h.afterMiddle.lit && Boolean(h.afterMiddle.box), JSON.stringify(h.afterMiddle));
  claim("⌘W with the keyboard in the window hides it, and its icon stays", h.focused && !h.afterW.lit && !h.afterW.box && h.afterW.icon, JSON.stringify({ focused: h.focused, ...h.afterW }));
  claim("⇧⌘T does not bring the tool back, as a window or as a tab of main", !h.afterReopen.lit && !h.afterReopen.box && !h.afterReopen.gridTabs.includes(h.title), JSON.stringify(h.afterReopen));
  claim("the — in the header hides the window", h.shownAgain && !h.afterHideButton.lit && !h.afterHideButton.box, JSON.stringify(h.afterHideButton));
}

// ---- the keys -------------------------------------------------------------------
/* The edge chords, with the stripes still to come: the frame beside the dock
   keeps its width, main takes and gives the room, and an edge with nothing on
   it changes nothing at all. Keys are keydown events on whatever has focus,
   read by the same window listeners a real key reaches. */
const edges = await run(`${HELPERS}
  await hideAll();
  document.activeElement?.blur?.();
  const rail = () => box(document.querySelector('.railHost')).w;
  const g0 = grid(); const r0 = rail();
  const step = async (k, mods) => { await key(k, mods); await wait(300); return { showing: showing(), grid: grid(), rail: rail(),
    left: edgeBox('files') || edgeBox('changes'), right: edgeBox('inbox') || edgeBox('usage') }; };
  document.activeElement?.blur?.();
  const leftOn = await step('b', { metaKey: true });
  document.activeElement?.blur?.();
  const leftOff = await step('b', { metaKey: true });
  const rightOn = await step('b', { metaKey: true, altKey: true });
  document.activeElement?.blur?.();
  const rightOff = await step('b', { metaKey: true, altKey: true });
  const bottom = await step('j', { metaKey: true });
  return { g0, r0, leftOn, leftOff, rightOn, rightOff, bottom };
`);
{
  const e = edges;
  claim(
    "⌘B shows the left edge and main gives up its width; ⌘B again hides it and main takes it back",
    e.leftOn.left && near(e.leftOn.grid.x, e.g0.x + e.leftOn.left.w, 2) && e.leftOff.showing.length === 0 && boxNear(e.leftOff.grid, e.g0),
    `showing ${e.leftOn.showing.join(", ")} ${show(e.leftOn.left)} · main ${show(e.g0)} → ${show(e.leftOn.grid)} → ${show(e.leftOff.grid)}`,
  );
  claim(
    "⌥⌘B does the same for the right edge",
    e.rightOn.right && near(e.rightOn.grid.x + e.rightOn.grid.w, e.g0.x + e.g0.w - e.rightOn.right.w, 2) && e.rightOff.showing.length === 0 && boxNear(e.rightOff.grid, e.g0),
    `showing ${e.rightOn.showing.join(", ")} ${show(e.rightOn.right)} · main ${show(e.rightOn.grid)} → ${show(e.rightOff.grid)}`,
  );
  claim(
    "⌘J on the empty bottom edge changes no box, and the frame beside the dock keeps its width throughout",
    e.bottom.showing.length === 0 && boxNear(e.bottom.grid, e.g0) && [e.leftOn, e.leftOff, e.rightOn, e.rightOff, e.bottom].every((s) => s.rail === e.r0),
    `showing ${e.bottom.showing.join(", ") || "none"} · main ${show(e.bottom.grid)} · frame ${[e.r0, e.leftOn.rail, e.rightOn.rail, e.bottom.rail].join("/")}`,
  );
}

/* A tool's chord, the JetBrains way: the first press shows it and puts the
   keyboard in it, a press from inside it puts it away, and a press while it
   shows with the keyboard elsewhere gives the keyboard back to it. */
const chord = await run(`${HELPERS}
  await hideAll();
  document.activeElement?.blur?.();
  const inside = id => Boolean(document.activeElement?.closest?.('.toolWindow[data-tool="' + id + '"]'));
  const settle = () => wait(700);
  await key('2', { metaKey: true }); await settle();
  const first = { lit: toolLit('inbox'), shown: Boolean(edgeBox('inbox')), inside: inside('inbox') };
  await key('2', { metaKey: true }); await settle();
  const second = { lit: toolLit('inbox'), shown: Boolean(edgeBox('inbox')) };
  await key('2', { metaKey: true }); await settle();
  document.activeElement?.blur?.();
  const away = { inside: inside('inbox') };
  await key('2', { metaKey: true }); await settle();
  const back = { lit: toolLit('inbox'), shown: Boolean(edgeBox('inbox')), inside: inside('inbox') };
  await key('2', { metaKey: true }); await settle();
  const last = { lit: toolLit('inbox'), shown: Boolean(edgeBox('inbox')) };
  // ⌘3 is the file tree.
  document.activeElement?.blur?.();
  await key('3', { metaKey: true }); await settle();
  const files = { lit: toolLit('files'), shown: Boolean(edgeBox('files')), inside: inside('files') };
  // ⇧⎋ from inside it puts it away; from outside a window it hides nothing.
  await key('Escape', { shiftKey: true }); await settle();
  const escaped = { lit: toolLit('files'), shown: Boolean(edgeBox('files')), icon: Boolean(stripeIcon('files')) };
  await click('usage', 900);
  document.activeElement?.blur?.();
  await key('Escape', { shiftKey: true }); await settle();
  const outside = { lit: toolLit('usage'), shown: Boolean(edgeBox('usage')) };
  await click('usage', 500);
  return { first, second, away, back, last, files, escaped, outside };
`);
{
  const c = chord;
  claim("⌘2 shows the Inbox and puts the keyboard in it", c.first.lit && c.first.shown && c.first.inside, JSON.stringify(c.first));
  claim("⌘2 again, from inside it, puts it away", !c.second.lit && !c.second.shown, JSON.stringify(c.second));
  claim("⌘2 while it shows with the keyboard elsewhere gives it the keyboard and leaves it showing", !c.away.inside && c.back.lit && c.back.shown && c.back.inside, JSON.stringify({ away: c.away, back: c.back }));
  claim("and ⌘2 from inside it again puts it away", !c.last.lit && !c.last.shown, JSON.stringify(c.last));
  claim("⌘3 shows the Files tool with the keyboard in it", c.files.lit && c.files.shown && c.files.inside, JSON.stringify(c.files));
  claim("⇧⎋ with the keyboard in a tool window hides it and its icon stays", !c.escaped.lit && !c.escaped.shown && c.escaped.icon, JSON.stringify(c.escaped));
  claim("⇧⎋ with the keyboard outside every tool window hides nothing", c.outside.lit && c.outside.shown, JSON.stringify(c.outside));
}

// ---- documents open in main, and stay there -----------------------------------
const documents = await run(`${HELPERS}
  await click('files', 900);
  const row = n => [...(win('files')?.querySelectorAll('.frow') ?? [])].find(r => (r.querySelector('.fname') || {}).textContent?.trim() === n);
  if (!(await until(() => row('alpha.txt'), 6000))) return { why: 'alpha.txt is not in the Files tool' };
  const filesBefore = edgeBox('files');
  row('alpha.txt').click();
  await until(() => document.querySelector('.editorPanel'), 5000);
  await wait(900);
  const ed = document.querySelector('.editorPanel');
  const one = { inMain: Boolean(ed && ed.closest('.plxrDock')), inTool: Boolean(ed && ed.closest('.toolWindow')), files: edgeBox('files'), group: groupOfTab('alpha.txt') };
  row('beta.txt').click();
  await until(() => tabNamed('beta.txt'), 5000);
  await wait(900);
  const two = { together: Boolean(groupOfTab('beta.txt')) && groupOfTab('beta.txt') === groupOfTab('alpha.txt'), editors: document.querySelectorAll('.editorPanel').length,
    inTools: [...document.querySelectorAll('.toolWindow')].reduce((n, t) => n + t.closest('.dv-groupview').querySelectorAll('.editorPanel').length, 0), files: edgeBox('files') };
  return { filesBefore, one: { ...one, group: Boolean(one.group) }, two, groups: gridGroups().map(g => g.tabs.join('+')) };
`);
if (documents.why) {
  unmeasured("a file clicked in the Files tool opens in main", documents.why);
} else {
  const d = documents;
  claim("a file clicked in the Files tool opens in main, never in the tool's window", d.one.inMain && !d.one.inTool, JSON.stringify({ inMain: d.one.inMain, inTool: d.one.inTool, groups: d.groups }));
  claim("the second file joins the first one's group in main, and no editor is in an edge", d.two.together && d.two.inTools === 0, JSON.stringify({ together: d.two.together, inTools: d.two.inTools, groups: d.groups }));
  claim("the Files window keeps its width through both", boxNear(d.one.files, d.filesBefore) && boxNear(d.two.files, d.filesBefore), `${show(d.filesBefore)} → ${show(d.one.files)} → ${show(d.two.files)}`);
}

/* A tab dragged the way the browser drags it: CDP intercepts the drag a press
   and a move start, and the drag events are dispatched at the target. */
async function tabDrag(name, target) {
  const src = await run(`${HELPERS} const t = tabNamed(${JSON.stringify(name)}); return t ? box(t) : null;`);
  if (!src) return { error: `no tab ${name}` };
  const sx = src.x + src.w / 2;
  const sy = src.y + src.h / 2;
  await cdp.send("Input.setInterceptDrags", { enabled: true });
  const got = cdp.once("Input.dragIntercepted", 3000);
  await mouse("mouseMoved", sx, sy);
  await mouse("mousePressed", sx, sy, { button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 8; i++) {
    await mouse("mouseMoved", sx + i * 5, sy + i * 5, { button: "left", buttons: 1 });
    await sleep(10);
  }
  const ev = await got;
  if (ev) {
    await cdp.send("Input.dispatchDragEvent", { type: "dragEnter", x: Math.round(target.x), y: Math.round(target.y), data: ev.data });
    for (let i = 0; i < 4; i++) {
      await cdp.send("Input.dispatchDragEvent", { type: "dragOver", x: Math.round(target.x) + (i % 2), y: Math.round(target.y), data: ev.data });
      await sleep(50);
    }
    await cdp.send("Input.dispatchDragEvent", { type: "drop", x: Math.round(target.x), y: Math.round(target.y), data: ev.data });
  }
  await mouse("mouseReleased", target.x, target.y, { button: "left", buttons: 0, clickCount: 1 });
  await cdp.send("Input.setInterceptDrags", { enabled: false });
  await sleep(500);
  return run(`${HELPERS}
    return { intercepted: ${Boolean(ev)}, inMain: Boolean(tabNamed(${JSON.stringify(name)})),
      inTools: [...document.querySelectorAll('.toolWindow')].reduce((n, t) => n + t.closest('.dv-groupview').querySelectorAll('.editorPanel, .panelTab[data-kind]:not([data-kind="view"])').length, 0),
      groups: gridGroups().map(g => g.tabs.join('+')) };
  `);
}

if (!documents.why) {
  const drops = [];
  // The control: the same drag into main does move the tab, so a refusal below is a refusal.
  const control = await run(`${HELPERS} const s = groupOfTab('Overview') || gridGroups().find(g => !g.tabs.includes('alpha.txt'))?.el; const b = box(s?.querySelector('.dv-content-container')); return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;`);
  const moved = control ? await tabDrag("beta.txt", control) : { error: "no group to drop into" };
  const zones = await run(`${HELPERS}
    const b = edgeBox('files');
    if (!b) return null;
    const i = Math.max(6, Math.round(b.w * 0.06));
    return { centre: { x: b.x + b.w / 2, y: b.y + b.h / 2 }, inner: { x: b.x + b.w - i, y: b.y + b.h / 2 }, outer: { x: b.x + i, y: b.y + b.h / 2 }, top: { x: b.x + b.w / 2, y: b.y + i } };
  `);
  if (zones) for (const [zone, at] of Object.entries(zones)) drops.push({ zone, ...(await tabDrag("alpha.txt", at)) });
  // The grid's own outer edge, with the left window hidden so main reaches it.
  const outer = await run(`${HELPERS} if (toolLit('files')) await click('files', 700); const g = grid(); return { x: g.x + 4, y: g.y + g.h / 2 };`);
  drops.push({ zone: "grid's outer edge", ...(await tabDrag("alpha.txt", outer)) });
  claim(
    "the control: a tab dragged into a group of main does move there",
    moved.intercepted && moved.inMain && moved.groups?.some((g) => g.split("+").includes("beta.txt") && g.split("+").includes("Overview")),
    JSON.stringify(moved),
  );
  claim(
    "a document dragged onto a tool window's centre, its edges or the grid's outer edge stays in main, and every edge holds tools only",
    drops.length === 5 && drops.every((d) => d.intercepted && d.inMain && d.inTools === 0),
    drops.map((d) => `${d.zone}: in main ${d.inMain}, non-tools in edges ${d.inTools}`).join(" · "),
  );
}

// ---- a tool window is as wide as its edge, whatever it holds -------------------
/* dockview's content box is a flex item that grows to what is inside it, so a
   tree of long names made the Files window 743 pixels wide in a 320 pixel
   edge, its — out of reach and its body under main. Each tool is given the
   widest thing it can hold here, and its window and its — are read against the
   edge; the control takes the containment away and the same tree has to push
   the window wider, or the claim could not have seen the fault. */
const contained = await run(`${HELPERS}
  const measure = id => {
    const w = win(id); const g = w?.closest('.dv-groupview'); const hide = w?.querySelector('[data-do="tool-hide"]'); const body = w?.querySelector('.toolBody');
    const gr = g?.getBoundingClientRect(); const hr = hide?.getBoundingClientRect();
    return { edge: Math.round(gr?.width ?? 0), win: Math.round(w?.getBoundingClientRect().width ?? 0),
      widest: body ? Math.max(0, ...[...body.querySelectorAll('*')].map(e => e.scrollWidth)) : 0,
      hideInside: Boolean(hr && gr && hr.width > 0 && hr.left >= gr.left - 0.5 && hr.right <= gr.right + 0.5) };
  };
  const out = {};
  if (!toolLit('files')) await click('files', 900);
  for (let i = 0; i < 20; i++) {
    const closed = [...(win('files')?.querySelectorAll('.frow') ?? [])].filter(r => (r.dataset.path || '').includes('a-folder-with-a-long-name') && (r.querySelector('.fchev')?.innerHTML || '').includes('chevron-right'));
    if (!closed.length) break;
    closed[0].click(); await wait(300);
  }
  await wait(500);
  out.files = measure('files');
  const loose = document.createElement('style'); loose.textContent = '.toolWindow { contain: none !important; }'; document.head.appendChild(loose);
  await wait(300);
  out.control = measure('files');
  loose.remove(); await wait(300);
  await click('search', 900);
  const field = await until(() => win('search')?.querySelector('[data-do="find-what"]'), 6000);
  if (field) {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set.call(field, 'needle-far-out');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);
    win('search').querySelector('[data-do="find-go"]')?.click();
    await until(() => win('search')?.querySelector('.findline'), 6000);
    await wait(400);
  }
  out.search = measure('search');
  await click('usage', 1500);
  out.usage = measure('usage');
  await click('archive', 1500);
  out.archive = measure('archive');
  await click('archive', 500);
  await click('files', 900);
  return out;
`);
{
  const c = contained;
  const held = (m) => m && m.edge > 0 && near(m.win, m.edge) && m.hideInside;
  claim(
    "a tool window is as wide as its edge and its — stays inside it, whatever it holds: a tree of long names, a line of six hundred characters, the usage, the archive",
    ["files", "search", "usage", "archive"].every((k) => held(c[k])) && c.files.widest > c.files.edge && c.search.widest > c.search.edge,
    ["files", "search", "usage", "archive"].map((k) => `${k}: window ${c[k]?.win} in an edge of ${c[k]?.edge}, content ${c[k]?.widest} wide, — inside ${c[k]?.hideInside}`).join(" · "),
  );
  claim(
    "the control: uncontained, the same tree pushes the Files window wider than its edge",
    c.control.win > c.control.edge + 50 && !c.control.hideInside,
    `window ${c.control.win} in an edge of ${c.control.edge}, — inside ${c.control.hideInside}`,
  );
}

// ---- main split while both sides show ------------------------------------------
/* Main's floor is what main needs, and it needs more once it is split: two
   groups side by side each keep their minimum. A split made while both sides
   were showing had nothing after it to bring the floor round — no resize, no
   edge change — and at 1100 the second group lay 247 pixels under the right
   tool window. So at each width main is made one column, both sides are
   shown, and a file is opened from the tree, which splits main in two. */
const splitWhileOpen = [];
for (const w of [1600, 1100, 900]) {
  await view(w);
  await sleep(900);
  splitWhileOpen.push(
    await run(`${HELPERS}
      for (const name of ['alpha.txt', 'beta.txt']) { const t = tabNamed(name); if (t) { t.querySelector('.panelTabClose')?.click(); await wait(400); } }
      if (!toolLit('files')) await click('files', 900);
      if (!toolLit('usage')) await click('usage', 900);
      await wait(600);
      const px = v => Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v)) * parseFloat(getComputedStyle(document.documentElement).fontSize));
      const read = () => {
        const l = edgeBox('files'); const r = edgeBox('usage'); const gs = gridGroups().map(g => g.b).filter(b => b.w > 0);
        const left = Math.min(...gs.map(b => b.x)); const right = Math.max(...gs.map(b => b.x + b.w));
        return { shell: box(document.querySelector('.dv-shell')).w, left: l?.w ?? 0, main: grid().w, right: r?.w ?? 0, columns: new Set(gs.map(b => b.x)).size,
          under: Math.max(0, l ? l.x + l.w - left : 0, r ? right - r.x : 0) };
      };
      const before = read();
      const row = await until(() => [...(win('files')?.querySelectorAll('.frow') ?? [])].find(r => (r.querySelector('.fname') || {}).textContent?.trim() === 'alpha.txt'), 6000);
      row?.click();
      await until(() => tabNamed('alpha.txt'), 5000);
      await wait(1200);
      return { width: innerWidth, mainMin: px('--main-min'), sideMin: px('--side-min'), before, after: read() };
    `),
  );
}
{
  const need = (f) => 2 * f.sideMin + f.after.columns * f.mainMin;
  const roomy = (f) => f.after.shell >= need(f);
  claim(
    "main split in two while both sides show: wherever there is room nothing of main is under a tool window and main keeps both groups' floor",
    splitWhileOpen.every((f) => f.after.columns === 2 && (!roomy(f) || (f.after.under <= 1 && f.after.main >= f.after.columns * f.mainMin - 1))) &&
      splitWhileOpen.some((f) => roomy(f) && f.before.main < 2 * f.mainMin),
    splitWhileOpen
      .map((f) => `${f.width}px: sides ${f.before.left}+${f.before.right} → ${f.after.left}+${f.after.right} · main ${f.before.main} → ${f.after.main} (${f.after.columns} columns) · under a window ${f.after.under} · ${roomy(f) ? "room" : `no room, the shell is ${f.after.shell} and both sides at their minimum with two groups need ${need(f)}`}`)
      .join(" | "),
  );
}

// ---- main's floor, and never under a tool window ------------------------------
const floor = [];
await run(`${HELPERS} if (!toolLit('files')) await click('files', 700); if (!toolLit('usage')) await click('usage', 900);`);
for (const w of [1600, 1100, 900, 700, 1600]) {
  await view(w);
  await sleep(900);
  floor.push(
    await run(`${HELPERS}
      await wait(200);
      const g = grid(); const l = edgeBox('files'); const r = edgeBox('usage'); const shell = box(document.querySelector('.dv-shell'));
      const gs = gridGroups().map(x => x.b).filter(b => b.w > 0);
      const left = Math.min(...gs.map(b => b.x)); const right = Math.max(...gs.map(b => b.x + b.w));
      const remPx = v => Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v)) * parseFloat(getComputedStyle(document.documentElement).fontSize));
      return { width: innerWidth, shell: shell.w, left: l?.w ?? 0, main: g.w, right: r?.w ?? 0, columns: new Set(gs.map(b => b.x)).size,
        under: Math.max(0, l ? l.x + l.w - left : 0, r ? right - r.x : 0), mainMin: remPx('--main-min'), sideMin: remPx('--side-min') };
    `),
  );
}
{
  const [wide, mid, narrow, tiny, back] = floor;
  // Main needs its floor for every column it has side by side.
  const room = (f) => f.shell >= 2 * f.sideMin + f.columns * f.mainMin;
  const holds = (f) => f.main >= f.mainMin - 1 && f.under <= 1;
  claim(
    "main is never narrower than its floor, nor under a tool window, while the window has room for both sides at their minimum",
    [wide, mid, narrow, tiny].every((f) => !room(f) || holds(f)) && [wide, mid].some(room),
    floor.map((f) => `${f.width}px: left ${f.left} · main ${f.main} (${f.columns} columns, floor ${f.mainMin} each) · right ${f.right} · under a window ${f.under} · room ${room(f)}`).join(" | "),
  );
  claim("widened again, the sides come back to the widths they had", near(back.left, wide.left, 2) && near(back.right, wide.right, 2), `left ${wide.left} → ${back.left} · right ${wide.right} → ${back.right}`);
}

// ---- main's splits keep their proportions -------------------------------------
/* The bottom edge starts empty; the inbox is put there the way his placement
   is kept, in prefs, and the window is loaded again. */
await run(`${HELPERS} await hideAll();`);
await sleep(900);
await api("/api/prefs", { method: "PUT", body: JSON.stringify({ toolLayout: { v: 1, order: { left: ["files", "changes", "search", "review"], right: ["usage", "ports", "archive", "notes"], bottom: ["inbox"] } } }) });
await load();
/* Two splits in main: whatever group holds more than one tab gives up its
   last tab downwards, beside the column the drops above left. */
const splitSetup = await run(`${HELPERS}
  const crowded = gridGroups().find(g => g.tabs.length > 1);
  if (!crowded) return { why: 'no group of main with two tabs to split', groups: gridGroups().map(g => g.tabs.join('+')) };
  const el = tabNamed(crowded.tabs[crowded.tabs.length - 1]).querySelector('.panelTab'); const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 8, button: 2 }));
  await wait(250);
  const row = [...document.querySelectorAll('body > .menu .menuItem')].find(b => b.querySelector('.menuLabel')?.textContent.trim() === 'Split downwards');
  if (row) { row.click(); await wait(800); } else await closeMenu();
  return { groups: gridGroups().map(g => ({ tabs: g.tabs.join('+'), b: g.b })) };
`);
if (splitSetup.why || splitSetup.groups.length < 3) {
  unmeasured("main's splits keep their proportions whichever order the edges go in", splitSetup.why ?? `only ${splitSetup.groups.length} groups in main: ${JSON.stringify(splitSetup.groups)}`);
} else {
  const measure = `const gs = gridGroups().map(g => g.b); return gs;`;
  const hiddenBase = await run(`${HELPERS} await hideAll(); ${measure}`);
  const orders = [["files", "usage", "inbox"], ["files", "inbox", "usage"], ["usage", "files", "inbox"], ["usage", "inbox", "files"], ["inbox", "files", "usage"], ["inbox", "usage", "files"]];
  const shownBase = await run(`${HELPERS} for (const t of ${JSON.stringify(orders[0])}) await click(t, 500); await wait(300); ${measure}`);
  await run(`${HELPERS} await hideAll();`);
  let worst = 0;
  const seen = [];
  for (const order of orders) {
    const on = await run(`${HELPERS} for (const t of ${JSON.stringify(order)}) await click(t, 500); await wait(300); ${measure}`);
    const off = await run(`${HELPERS} for (const t of ${JSON.stringify(order)}) await click(t, 500); await wait(300); ${measure}`);
    const diff = (a, b) => Math.max(...a.map((x, i) => Math.max(Math.abs(x.x - b[i].x), Math.abs(x.y - b[i].y), Math.abs(x.w - b[i].w), Math.abs(x.h - b[i].h))));
    const d = Math.max(diff(on, shownBase), diff(off, hiddenBase));
    worst = Math.max(worst, d);
    seen.push(`${order.join("→")}: ${d}px`);
  }
  const bottomBox = await run(`${HELPERS} await click('inbox', 700); const b = edgeBox('inbox'); const g = grid(); await click('inbox', 500); return { b, g };`);
  claim(
    "main's splits keep their proportions whichever order the three edges are shown and hidden in",
    worst <= 2,
    `${splitSetup.groups.map((g) => g.tabs).join(" | ")} · worst drift ${worst}px · ${seen.join(" · ")}`,
  );
  claim("a tool on the bottom edge opens under main, between the side windows", bottomBox.b && near(bottomBox.b.y, bottomBox.g.y + bottomBox.g.h, 2) && near(bottomBox.b.x, bottomBox.g.x, 2), `bottom ${show(bottomBox.b)} · main ${show(bottomBox.g)}`);
}

// ---- a hidden tool asks for nothing --------------------------------------------
await run(`${HELPERS} await hideAll(); openSession(/plxr-stripes-check/); await wait(1200);`);
const openChanges = () => {
  const open = new Map();
  for (const t of traffic) {
    if (t.kind === "ws" && t.url.includes("/ws/changes/")) open.set(t.id, t.url);
    if (t.kind === "wsclosed") open.delete(t.id);
  }
  return open.size;
};
await sleep(1500);
const quietFrom = Date.now();
await sleep(5000);
const quiet = traffic.filter((t) => t.at >= quietFrom);
const asked = (list, re) => list.filter((t) => re.test(t.url ?? "")).length;
const idle = { usage: asked(quiet, /\/api\/usage\?/), ports: asked(quiet, /\/api\/ports/), changes: asked(quiet, /\/ws\/changes\//), openChanges: openChanges() };
const litFrom = Date.now();
await run(`${HELPERS} await click('changes', 400); await click('ports', 400); await click('usage', 400);`);
await sleep(5000);
const lit = traffic.filter((t) => t.at >= litFrom);
const busy = { usage: asked(lit, /\/api\/usage\?/), ports: asked(lit, /\/api\/ports/), changes: asked(lit, /\/ws\/changes\//), openChanges: openChanges() };
claim(
  "with every edge hidden for five seconds, the window asks for no usage, no ports and no changes",
  idle.usage === 0 && idle.ports === 0 && idle.changes === 0 && idle.openChanges === 0,
  JSON.stringify(idle),
);
claim("with Changes, Ports and Usage showing, each asks again", busy.usage > 0 && busy.ports > 0 && busy.changes > 0, JSON.stringify(busy));
await run(`${HELPERS} await hideAll();`);
await sleep(900);

// ---- arrangements the old window saved ------------------------------------------
/* Each recorded arrangement is loaded as the old window wrote it, with the old
   menu panel put back into it, the old region choice of the inbox beside it,
   and no placement of the tools yet. */
const withRail = (dock) => {
  const copy = structuredClone(dock);
  copy.panels.rail = { contentComponent: "rail", id: "rail", tabComponent: "props.defaultTabComponent", title: "plxr" };
  let leaf = copy.grid.root;
  while (leaf && leaf.type !== "leaf") leaf = leaf.data?.[0];
  leaf?.data?.views.unshift("rail");
  return copy;
};
const TOOL_TITLES = ["Files", "Changes", "Search", "Review", "Inbox", "Usage", "Ports", "Archive", "Notes"];
for (const [name, dock] of Object.entries(fixtures)) {
  await api("/api/prefs", {
    method: "PUT",
    body: JSON.stringify({ dock: withRail(dock), dockRegions: { inbox: "bottom" }, toolLayout: null, dockSizes: null, dockPresets: { dvMajor: 8, items: [{ name: "old", layout: dock }] } }),
  });
  await load();
  await sleep(1200);
  const got = await run(`${HELPERS}
    const tabs = gridTabs();
    const ids = [...document.querySelectorAll('.plxrDock .dv-tab')].map(t => t.querySelector('.panelTabName')?.textContent.trim());
    const out = { tabs, showing: showing(), editor: Boolean(document.querySelector('.plxrDock .editorPanel')) };
    const was = toolLit('inbox');
    openTool('inbox'); await wait(800);
    const b = edgeBox('inbox'); const g = grid();
    out.inboxBelow = Boolean(b) && near(b.y, g.y + g.h, 2);
    if (!was) await click('inbox', 500);
    return out;
  `);
  await sleep(900);
  const prefs = await api("/api/prefs");
  const views = JSON.stringify(dock);
  const wantEditor = /"editor:/.test(views);
  // Applied as a preset: the tools it names are put on their edges, never copied.
  const preset = await run(`${HELPERS}
    const button = [...document.querySelectorAll('.bar .btn')].find(b => /^LAYOUTS$/.test(b.textContent.trim()));
    if (!button) return { why: 'no LAYOUTS button' };
    button.click(); await wait(300);
    const row = [...document.querySelectorAll('body > .menu .menuItem')].find(b => b.querySelector('.menuLabel')?.textContent.trim() === 'Apply old');
    if (!row) { await closeMenu(); return { why: 'no Apply old row' }; }
    row.click(); await wait(1200);
    return { tabs: gridTabs() };
  `);
  await sleep(900);
  const afterPreset = preset.why ? null : placed((await api("/api/prefs")).dock);
  claim(
    `${name}: loaded, no tool, no folder tree and no old menu is left in main`,
    !got.tabs.some((t) => TOOL_TITLES.includes(t) || /^plxr$/i.test(t)) && !JSON.stringify(prefs.dock?.panels ?? {}).match(/"(files:[^"]*|rail)"/) && got.tabs.length > 0,
    `main holds ${got.tabs.join(", ")} · showing ${got.showing.join(", ") || "none"}`,
  );
  claim(
    `${name}: every tool is at an edge exactly once, the inbox on the bottom edge as the old region said, and the old key gone`,
    onceEach(placed(prefs.dock)) && got.inboxBelow && prefs.toolLayout?.order?.bottom?.[0] === "inbox" && !("dockRegions" in prefs),
    `at the edges ${placed(prefs.dock).edges.join(",")} · inbox below main ${got.inboxBelow} · toolLayout ${JSON.stringify(prefs.toolLayout?.order)} · dockRegions ${"dockRegions" in prefs}`,
  );
  if (wantEditor) claim(`${name}: the editor that sat beside the tools is in main`, got.editor, `editor in main ${got.editor}`);
  if (preset.why) unmeasured(`${name}: applied as a preset, no tool is copied`, preset.why);
  else
    claim(
      `${name}: applied as a preset, no tool is copied and none lands in main`,
      onceEach(afterPreset) && !preset.tabs.some((t) => TOOL_TITLES.includes(t)),
      `at the edges ${afterPreset.edges.join(",")} · in main ${afterPreset.main.join(", ")} · tabs ${preset.tabs.join(", ")}`,
    );
}

cdp.close();

// ---- the verdict ----------------------------------------------------------
if (claims.length === 0) {
  console.log("  checked nothing at all — the window did not load");
  await stop(1);
}
const failed = claims.filter((c) => !c.ok);
for (const c of claims) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.what}${c.detail ? `\n         ${c.detail}` : ""}`);
if (failed.length) {
  console.log(`\n  ${failed.length} of ${claims.length} claims failed`);
  await stop(1);
}
console.log(`\n  the tool windows do what they say — all ${claims.length} claims hold`);
await stop(0);
