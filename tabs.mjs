/* Do the documents of main and their tabs do what they say?
 *
 * Main is the part of the window that is worked in: the terminals, the board,
 * the folders, the settings, and the documents opened from them — editors,
 * diffs, previews. The tools are not here any more; they are windows at the
 * dock's edges, and stripes.mjs holds them to their promises. What is left for
 * main is a set of promises of its own, every one of them broken once in a way
 * nobody noticed from the code — a close that threw work away, a document that
 * opened over the tree it was clicked in, a floating panel that docked back
 * somewhere else. So each is driven the way somebody drives it and measured on
 * the screen:
 *
 *   the tab menu carries close, close others, close group, float or dock, the
 *     two splits, maximise and the title, in that order;
 *   float lifts a panel out and dock puts it back into main;
 *   a file clicked in the folders' tree, or in a session's own tree, opens
 *     beside the work and never over it, and the next files join it;
 *   split, close others in group, close group;
 *   every tab carries its mark, and the one in front its bar;
 *   ⌘W goes through the guard, a clean document closes without asking, and so
 *     do its × and the middle button;
 *   ⌥⌘← → walk the panels of a group, ⌥⌘↑ ↓ the groups of main.
 *
 * Held against a service started from this build, the way clicked.mjs does it;
 * the session and the folder it needs are made for the check and taken away
 * afterwards, and the arrangement the service had is put back.
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
async function servesThisBuild() {
  let mine;
  try {
    mine = readFileSync(join(HERE, "frontend", "out", "index.html"), "utf8");
  } catch {
    return { ok: false, why: "this build has no frontend/out — build the frontend first" };
  }
  let theirs;
  try {
    theirs = await fetch(`${base}/?token=${info.token}`).then((r) => r.text());
  } catch {
    return { ok: false, why: "the service did not answer" };
  }
  if (theirs.trim() !== mine.trim()) {
    return { ok: false, why: `the service on port ${info.port} serves a different build than this one` };
  }
  return { ok: true };
}

const identity = await servesThisBuild();
if (!identity.ok) {
  console.log(`  ${identity.why}`);
  process.exit(1);
}

/* The window this check drives starts from a known arrangement.
 *
 * Every claim below is about where a panel lands, and where a panel lands
 * depends on what is already on screen — so a leftover arrangement from the
 * last window would decide half of them. The saved one is put aside for the
 * run and written back at the end, so the service is left as it was found. */
const KEYS = ["dock", "dockSizes", "toolLayout", "dockRegions"];
const before = await api("/api/prefs").catch(() => ({}));
const held = Object.fromEntries(KEYS.map((k) => [k, before?.[k] ?? null]));
await api("/api/prefs", { method: "PUT", body: JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, null]))) }).catch(() => undefined);

const port = 9500 + Math.floor(Number(process.pid) % 400);
const profile = mkdtempSync(join(tmpdir(), "plxr-tabs-"));
/* 1600 wide because that is the window main was measured in: a group squeezed
   against its minimum would prove nothing about the sizes it is supposed to
   keep. */
const child = spawn(
  browser,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--use-mock-keychain",
    "--password-store=basic",
    "--no-default-browser-check",
    "--window-size=1600,1000",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A folder of this check's own, so an editor with unsaved work in it is on
   hand — the thing a close must not throw away. */
const work = mkdtempSync(join(tmpdir(), "plxr-tabs-work-"));
mkdirSync(work, { recursive: true });
writeFileSync(join(work, "alpha.txt"), "one\ntwo\nthree\n");
writeFileSync(join(work, "beta.txt"), "four\nfive\n");
writeFileSync(join(work, "gamma.txt"), "six\n");

let made = null;
let space = null;

/* A crash, an unhandled rejection or ^C goes through stop() too, so the
 * service gets its arrangement back; and whatever cannot even get that far,
 * the exit still ends the browser. Fourteen headless browsers holding 4.6 GB
 * were found on one machine, most from gates that had crashed before their
 * cleanup. A second failure while stopping does not wait for the first. */
let stopping = false;
const bail = (code) => {
  if (stopping) process.exit(code);
  stopping = true;
  void stop(code);
};
/* Chrome writes its profile until it has exited. stop() waits for that; the
 * exit handler cannot await, so it asks ps — a child that has exited stays a
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
process.on("exit", () => {
  try { child.kill(); browserExited(child); } catch { /* already gone */ }
  try { rmSync(work, { recursive: true, force: true, maxRetries: 3 }); } catch { /* it lives in the temp directory */ }
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* it lives in the temp directory */ }
});
for (const bad of ["uncaughtException", "unhandledRejection"]) {
  process.on(bad, (why) => { console.log(`  ${bad}: ${why?.stack ?? why}`); bail(1); });
}
process.on("SIGINT", () => bail(130));
process.on("SIGTERM", () => bail(143));

async function stop(code) {
  /* The profile is removed once the browser has let go of it. Removed while it
     was still writing, a run left fifty megabytes behind in the temp directory
     every time — on a disk that was full by the afternoon. */
  const exited = new Promise((r) => (child.exitCode !== null || child.signalCode !== null ? r() : child.once("exit", r)));
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  await Promise.race([exited, sleep(5000)]);
  if (made) await api(`/api/sessions/${encodeURIComponent(made.id)}`, { method: "DELETE" }).catch(() => undefined);
  if (space) await api(`/api/workspaces/${encodeURIComponent(space.id)}`, { method: "DELETE" }).catch(() => undefined);
  // The arrangement the service had before this ran, back where it was.
  await api("/api/prefs", { method: "PUT", body: JSON.stringify(held) }).catch(() => undefined);
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* it lives in the temp directory */
  }
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* the browser is still letting go; it lives in the temp directory */
  }
  process.exit(code);
}

async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === "page");
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
      const pending = msg.id ? waiting.get(msg.id) : undefined;
      if (pending) {
        waiting.delete(msg.id);
        msg.error ? pending.reject(new Error(msg.error.message)) : pending.resolve(msg.result);
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

const run = async (expression) => {
  const r = await cdp.send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
};
const mouse = (type, x, y, extra = {}) => cdp.send("Input.dispatchMouseEvent", { type, x: Math.round(x), y: Math.round(y), ...extra });

const claims = [];
const claim = (what, ok, detail = "") => claims.push({ what, ok: Boolean(ok), detail });
/* Something that could not be driven at all is not a pass and not a silent
   skip: it is a claim nobody could measure, and it says so. */
const unmeasured = (what, why) => claims.push({ what, ok: false, detail: `could not be measured: ${why}` });

// A session of this check's own, a plain shell, so a "running session" is
// on hand whatever else the service holds.
made = await api("/api/sessions", {
  method: "POST",
  body: JSON.stringify({ cwd: work, cmd: [], name: "plxr-tabs-check", account: "" }),
}).catch(() => null);
if (!made?.id) {
  console.log("  could not start a session for the check");
  await stop(1);
}
// And the folder, so the file tree has something to open.
space = await api("/api/workspaces", { method: "POST", body: JSON.stringify({ path: work }) }).catch(() => null);

async function load() {
  await cdp.send("Page.navigate", { url: `${base}/?token=${info.token}` });
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    const up = await run(`${GATEKIT} return appUp();`).catch(() => 0);
    if (up) {
      // The arrangement settles a beat after the panels appear.
      await sleep(900);
      return true;
    }
  }
  return false;
}

if (!(await load())) {
  console.log("  the interface did not render — nothing to check");
  await stop(1);
}

/* The helpers the page-side steps share.
 *
 * A tab's name is its title and nothing else — the glyph beside it is an
 * element of its own, and the close is drawn by the skin — so names are read
 * off .panelTabName rather than off the tab's text. A floating group is
 * rendered outside .plxrDock, so tabs are looked for in the whole document,
 * leaving out the tool windows at the edges, whose tab strips are hidden; the
 * grid's groups are looked for inside the dock. A right-click is the
 * contextmenu event on the tab's own element, and keys are keydown events on
 * whatever has focus, read by the same window listener a real key reaches.
 */
const HELPERS = `${GATEKIT}
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const box = el => { const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const nameOf = t => (t.querySelector('.panelTabName') || { textContent: '' }).textContent.trim();
  const tabs = () => [...document.querySelectorAll('.dv-tab')].filter(t => !t.closest('.dv-groupview-edge'));
  const tabNamed = n => tabs().find(t => nameOf(t) === n);
  const tabLike = re => tabs().find(t => re.test(nameOf(t)));
  const names = () => tabs().map(nameOf);
  const groups = () => [...document.querySelectorAll('.plxrDock .dv-groupview')].filter(g => !g.closest('.dv-resize-container'));
  const groupOf = n => { const t = tabNamed(n); return t ? t.closest('.dv-groupview') : null; };
  const tabsIn = n => { const g = groupOf(n); return g ? [...g.querySelectorAll('.panelTabName')].map(e => e.textContent.trim()) : []; };
  const boxOf = n => { const g = groupOf(n); return g ? box(g) : null; };
  const shot = () => groups().map(g => ({ tabs: [...g.querySelectorAll('.panelTabName')].map(e => e.textContent.trim()), b: box(g) }));
  const columns = () => [...new Set(groups().map(g => Math.round(g.getBoundingClientRect().left)))].length;
  const floatingGroups = () => document.querySelectorAll('.dv-resize-container:not(.dv-hidden) .dv-groupview').length;
  const isFloating = n => { const t = tabNamed(n); return Boolean(t && t.closest('.dv-resize-container')); };
  /* A document of main brought to the front, opened when it is not there —
     through the gate kit, which knows what opens it. */
  const showDoc = async (id, n, ms) => {
    const t = tabNamed(n);
    if (t) { await activate(t); return tabNamed(n); }
    openDoc(id); await wait(ms || 900);
    return tabNamed(n);
  };
  const rightClick = async tab => {
    const el = tab.querySelector('.panelTab') || tab;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 8, button: 2 }));
    await wait(250);
  };
  /* The menu as it reads: the headers and the rules between the groups of
     rows are part of the order and are reported with them. */
  const menuRows = () => [...document.querySelectorAll('body > .menu > *')].map(e =>
    e.classList.contains('menuSep') ? { rule: true }
    : e.classList.contains('menuHeader') ? { header: e.textContent.trim() }
    : { label: e.querySelector('.menuLabel').textContent.trim(),
        checked: e.getAttribute('aria-checked'), disabled: Boolean(e.disabled) });
  const menuShape = () => menuRows().map(r => r.rule ? '---' : r.header ? ('# ' + r.header) : r.label);
  const pick = async (label, ms) => {
    const b = [...document.querySelectorAll('body > .menu .menuItem')].find(x => x.querySelector('.menuLabel').textContent.trim() === label);
    if (!b) throw new Error('no menu entry ' + label);
    b.click();
    await wait(ms || 800);
  };
  const closeMenu = async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(150); };
  // Dockview activates a tab on pointerdown, not on click.
  const activate = async tab => {
    tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    tab.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    await wait(250);
  };
  const key = async (k, mods) => {
    const target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, mods || {})));
    await wait(350);
  };
  const activeTab = () => { const t = document.querySelector('.plxrDock .dv-groupview.dv-active-group .dv-tab.dv-active-tab'); return t ? nameOf(t) : ''; };
  const activeGroupTabs = () => { const g = document.querySelector('.plxrDock .dv-groupview.dv-active-group');
    return g ? [...g.querySelectorAll('.panelTabName')].map(e => e.textContent.trim()) : []; };
  const byText = (sel, re) => [...document.querySelectorAll(sel)].find(e => re.test(e.textContent.trim()));
`;

/* A tab dragged the way the browser drags it: CDP intercepts the drag a press
   and a move start, and the drag events are dispatched at the target. */
async function tabDrag(name, target) {
  const src = await run(`${HELPERS} const t = tabNamed(${JSON.stringify(name)}); return t ? box(t) : null;`);
  if (!src) return false;
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
  await sleep(700);
  return Boolean(ev);
}

// ---- the tab menu ----------------------------------------------------------------
/* Two documents of main in one group, so every row of the menu applies. */
const menu = await run(`${HELPERS}
  await showDoc('overview', 'Overview', 900);
  await showDoc('folders', 'Folders', 2200);
  await showDoc('overview', 'Overview', 400);
  const t = tabNamed('Overview');
  if (!t) return { why: 'the overview did not open' };
  await rightClick(t);
  const shape = menuShape();
  await closeMenu();
  return { shape, together: JSON.stringify(tabsIn('Overview')) };
`);
if (menu.why) {
  unmeasured("the tab menu reads close, close others, close group, float, the two splits, maximise, copy title", menu.why);
} else {
  claim(
    "the tab menu reads close, close others, close group, float, the two splits, maximise, copy title",
    JSON.stringify(menu.shape) ===
      JSON.stringify(["Close", "Close others in group", "Close group", "---", "Float", "---", "Split to the right", "Split downwards", "---", "Maximise", "---", "Copy title"]),
    `${menu.shape.join(" | ")} · on a group holding ${menu.together}`,
  );
}

// ---- float, and dock back into main ----------------------------------------------
const floated = await run(`${HELPERS}
  const settings = await showDoc('settings', 'Settings', 1200);
  if (!settings) return { why: 'the settings did not open' };
  const mainBefore = boxOf('Settings');
  await rightClick(tabNamed('Settings'));
  await pick('Float', 1200);
  const up = { count: floatingGroups(), floating: isFloating('Settings') };
  await rightClick(tabNamed('Settings'));
  const shape = menuShape();
  await pick('Dock', 1200);
  const back = { floating: isFloating('Settings'), inMain: Boolean(groupOf('Settings')) && !isFloating('Settings'), left: floatingGroups(),
    inTool: Boolean(tabNamed('Settings')?.closest('.dv-groupview-edge')) };
  // Out of the way again for what follows.
  tabNamed('Settings')?.querySelector('.panelTabClose')?.click();
  await wait(500);
  return { mainBefore, up, shape, back };
`);
if (floated.why) {
  unmeasured("float lifts the panel out of the grid into a floating group", floated.why);
} else {
  claim(
    "float lifts the panel out of the grid into a floating group",
    floated.up.count === 1 && floated.up.floating,
    `${floated.up.count} floating group(s), the panel is in one: ${floated.up.floating}`,
  );
  claim("a floating panel's menu offers dock instead of float", floated.shape.includes("Dock") && !floated.shape.includes("Float"), floated.shape.join(" | "));
  claim(
    "dock puts it back into main, not into a tool window",
    floated.back.inMain && !floated.back.inTool && floated.back.left === 0,
    JSON.stringify(floated.back),
  );
}

// ---- a document never covers the work it was opened from ----------------------
/* "Why does the tree close when I open a file?" The folders are a tab of main,
   and a file clicked in their tree became a tab of that same group, in front
   of the tree it was clicked in. The session's own tree beside its terminal
   did the same to the terminal. So both are driven the way he drives them —
   a click on a row — and the groups are measured afterwards: the work keeps
   its group and stays in front of it, the document stands in a group of its
   own to the right, half as wide as the work was, and the next files join
   that group instead of splitting again. */
const groupFacts = `
  const groupFacts = (n) => {
    const g = groupOf(n);
    if (!g) return null;
    const front = g.querySelector('.dv-tab.dv-active-tab');
    return { b: box(g), tabs: [...g.querySelectorAll('.panelTabName')].map(e => e.textContent.trim()), front: front ? nameOf(front) : '' };
  };
  const seen = (el, within) => {
    if (!el || el.offsetParent === null) return null;
    const b = box(el);
    return { b, inside: Boolean(within) && b.w > 0 && b.h > 0 && b.x >= within.x - 1 && b.x + b.w <= within.x + within.w + 1 };
  };
`;
const fromFolders = await run(`${HELPERS}${groupFacts}
  await showDoc('overview', 'Overview', 900);
  await showDoc('folders', 'Folders', 2500);
  const work = groupFacts('Folders');
  const row = n => [...document.querySelectorAll('.foldersbody .frow')].find(r => (r.querySelector('.fname') || { textContent: '' }).textContent.trim() === n);
  if (!row('alpha.txt')) return { why: 'alpha.txt is not in the folders\\u2019 tree' };
  const groupsBefore = groups().length;
  row('alpha.txt').click(); await wait(2200);
  const one = { folders: groupFacts('Folders'), doc: groupFacts('alpha.txt'), apart: groupOf('alpha.txt') !== groupOf('Folders'),
                tree: seen(row('beta.txt'), groupFacts('Folders') && groupFacts('Folders').b), groups: groups().length };
  if (row('beta.txt')) { row('beta.txt').click(); await wait(1800); }
  const two = { folders: groupFacts('Folders'), doc: groupFacts('beta.txt'), withAlpha: groupOf('beta.txt') === groupOf('alpha.txt'), groups: groups().length, columns: columns() };
  if (row('gamma.txt')) { row('gamma.txt').click(); await wait(1800); }
  const three = { folders: groupFacts('Folders'), doc: groupFacts('gamma.txt'), withAlpha: groupOf('gamma.txt') === groupOf('alpha.txt'), groups: groups().length };
  return { work, groupsBefore, one, two, three };
`);
// Looked at, not only measured: the tree and the three files side by side.
if (process.env.PLXR_SHOTS) {
  mkdirSync(process.env.PLXR_SHOTS, { recursive: true });
  const png = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(process.env.PLXR_SHOTS, "documents-from-folders.png"), Buffer.from(png.data, "base64"));
}
if (!fromFolders.why) {
  Object.assign(fromFolders, await run(`${HELPERS}${groupFacts}
    const row = n => [...document.querySelectorAll('.foldersbody .frow')].find(r => (r.querySelector('.fname') || { textContent: '' }).textContent.trim() === n);
    // The first file again: already open, it comes to the front where it is.
    row('alpha.txt').click(); await wait(900);
    const again = { doc: groupFacts('alpha.txt'), groups: groups().length, count: tabs().filter(t => nameOf(t) === 'alpha.txt').length };
    // Work of main asked for while a document is in front goes to the work.
    await activate(tabNamed('alpha.txt'));
    openDoc('settings'); await wait(1200);
    const settings = { withFolders: groupOf('Settings') === groupOf('Folders'), withDocs: groupOf('Settings') === groupOf('alpha.txt'), docs: groupFacts('alpha.txt') };
    tabNamed('Settings')?.querySelector('.panelTabClose')?.click();
    await wait(500);
    return { again, settings };
  `));
}
if (fromFolders.why) {
  unmeasured("a file clicked in the folders' tree opens beside the folders", fromFolders.why);
} else {
  const { work, one, two, three, again, settings } = fromFolders;
  claim(
    "a file clicked in the folders' tree leaves the folders in front of their own group",
    one.folders && one.folders.front === "Folders" && !one.folders.tabs.includes("alpha.txt"),
    `the folders' group holds ${JSON.stringify(one.folders?.tabs)} with ${one.folders?.front} in front`,
  );
  claim(
    "and the tree is still on screen, inside that group",
    one.tree && one.tree.inside,
    `a tree row at ${one.tree?.b.x}+${one.tree?.b.w}, the group at ${one.folders?.b.x}+${one.folders?.b.w}`,
  );
  claim(
    "the editor stands in a group of its own, to the right of the folders, in front there",
    one.apart && one.doc && one.doc.front === "alpha.txt" && one.doc.b.x >= one.folders.b.x + one.folders.b.w - 2 &&
      Math.abs(one.doc.b.y - one.folders.b.y) <= 2 && one.groups === fromFolders.groupsBefore + 1,
    `folders ${one.folders?.b.x}+${one.folders?.b.w} · editor ${one.doc?.b.x}+${one.doc?.b.w} holding ${JSON.stringify(one.doc?.tabs)} · groups ${fromFolders.groupsBefore} → ${one.groups}`,
  );
  claim(
    "taking half of the width the folders had",
    one.doc && one.folders && Math.abs(one.doc.b.w - work.b.w / 2) <= 4 && Math.abs(one.folders.b.w - work.b.w / 2) <= 4,
    `the folders were ${work.b.w} wide, now ${one.folders?.b.w} beside an editor of ${one.doc?.b.w}`,
  );
  claim(
    "a second and a third file join the editor's group, with the folders still in front of theirs",
    two.withAlpha && three.withAlpha && two.groups === one.groups && three.groups === one.groups &&
      two.folders?.front === "Folders" && three.folders?.front === "Folders" && three.doc?.front === "gamma.txt",
    `the editor's group holds ${JSON.stringify(three.doc?.tabs)} with ${three.doc?.front} in front · groups ${one.groups} → ${two.groups} → ${three.groups} · folders in front: ${two.folders?.front}, ${three.folders?.front}`,
  );
  claim(
    "a file that is already open comes to the front where it is",
    again.doc?.front === "alpha.txt" && again.count === 1 && again.groups === three.groups,
    `${again.count} tab(s) called alpha.txt, ${again.doc?.front} in front of ${JSON.stringify(again.doc?.tabs)}, groups ${again.groups}`,
  );
  claim(
    "work of main asked for while a document is in front goes to the work, not over the documents",
    settings.withFolders && !settings.withDocs && !(settings.docs?.tabs ?? []).includes("Settings"),
    `settings beside the folders ${settings.withFolders}, among the documents ${settings.withDocs}`,
  );
}

/* The same from a session: its FILES tree stands beside its terminal, and a
   file picked there must leave the terminal on screen. The documents from the
   folders are closed first, so the editor has no group to join and has to
   make its own beside the terminal. */
const fromSession = await run(`${HELPERS}${groupFacts}
  const alpha = tabNamed('alpha.txt');
  if (alpha) { await rightClick(alpha); await pick('Close group', 1100); }
  if (!openSession(/plxr-tabs-check/)) return { why: 'the check\\u2019s session is not offered' };
  await wait(1800);
  const tab = tabLike(/plxr-tabs-check/);
  if (!tab) return { why: 'the session panel did not open' };
  await activate(tab);
  const name = nameOf(tab);
  const session = () => [...document.querySelectorAll('.plxrDock .session')].find(s => s.offsetParent !== null);
  // The bar keeps an unseen copy of its buttons to measure them; the one clicked is the one on screen.
  const filesButton = session() && [...session().querySelectorAll('.sessbar button')].find(b => b.textContent.trim() === 'FILES' && !b.closest('.obarMeasureBox'));
  if (!filesButton) return { why: 'no FILES button in the session bar' };
  filesButton.click(); await wait(1500);
  const row = n => session() && [...session().querySelectorAll('.frow')].find(r => (r.querySelector('.fname') || { textContent: '' }).textContent.trim() === n);
  if (!row('alpha.txt')) return { why: 'alpha.txt is not in the session\\u2019s tree' };
  const work = groupFacts(name);
  const groupsBefore = groups().length;
  row('alpha.txt').click(); await wait(2200);
  const terminal = () => session() && session().querySelector('.xterm');
  const one = { session: groupFacts(name), doc: groupFacts('alpha.txt'), apart: groupOf('alpha.txt') !== groupOf(name),
                terminal: seen(terminal(), groupFacts(name) && groupFacts(name).b), tree: seen(row('beta.txt'), groupFacts(name) && groupFacts(name).b), groups: groups().length };
  if (row('beta.txt')) { row('beta.txt').click(); await wait(1800); }
  const two = { session: groupFacts(name), doc: groupFacts('beta.txt'), withAlpha: groupOf('beta.txt') === groupOf('alpha.txt'), groups: groups().length,
                terminal: seen(terminal(), groupFacts(name) && groupFacts(name).b) };
  return { name, work, groupsBefore, one, two };
`);
if (process.env.PLXR_SHOTS) {
  const png = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(process.env.PLXR_SHOTS, "documents-from-session.png"), Buffer.from(png.data, "base64"));
}
/* The session reads its files under its own id and the folders under theirs,
   so these are other panels than the folders' alpha.txt and beta.txt, with the
   same names. They go again, or the steps below find two of each. */
await run(`${HELPERS}
  if (tabNamed('alpha.txt')) { await rightClick(tabNamed('alpha.txt')); await pick('Close group', 1100); }
`);
if (fromSession.why) {
  unmeasured("a file clicked in a session's tree opens beside the terminal", fromSession.why);
} else {
  const { name, work, one, two } = fromSession;
  claim(
    "a file clicked in a session's tree leaves the session in front of its group, the terminal on screen",
    one.session?.front === name && !one.session.tabs.includes("alpha.txt") && one.terminal?.inside && one.terminal.b.w > 0 && one.tree?.inside,
    `the session's group holds ${JSON.stringify(one.session?.tabs)} with ${one.session?.front} in front · terminal ${one.terminal?.b.x}+${one.terminal?.b.w} inside ${one.session?.b.x}+${one.session?.b.w}: ${one.terminal?.inside} · tree inside: ${one.tree?.inside}`,
  );
  claim(
    "the editor stands in a group of its own to the right of the terminal, half as wide as the session was",
    one.apart && one.doc?.front === "alpha.txt" && one.doc.b.x >= one.session.b.x + one.session.b.w - 2 &&
      one.groups === fromSession.groupsBefore + 1 && Math.abs(one.doc.b.w - work.b.w / 2) <= 4,
    `session was ${work.b.w} wide, now ${one.session?.b.x}+${one.session?.b.w} · editor ${one.doc?.b.x}+${one.doc?.b.w} · groups ${fromSession.groupsBefore} → ${one.groups}`,
  );
  claim(
    "a second file from the same tree joins the editor, and the terminal stays",
    two.withAlpha && two.groups === one.groups && two.session?.front === name && two.terminal?.inside,
    `the editor's group holds ${JSON.stringify(two.doc?.tabs)} · groups ${one.groups} → ${two.groups} · terminal inside its group: ${two.terminal?.inside}`,
  );
}

// ---- close others, close group, and the two splits ---------------------------
/* Two tabs of one group are needed: two of the files the editor opens. */
const setup = await run(`${HELPERS}
  await showDoc('folders', 'Folders', 2500);
  const alpha = byText('.foldersbody .frow', /alpha\\.txt/);
  if (!alpha) return { why: 'alpha.txt is not in the tree' };
  alpha.click(); await wait(2200);
  await showDoc('folders', 'Folders', 900);
  const beta = byText('.foldersbody .frow', /beta\\.txt/);
  if (!beta) return { why: 'beta.txt is not in the tree' };
  beta.click(); await wait(2200);
  const before = tabsIn('alpha.txt');
  // The split first, while there is more than one tab to split off from.
  await rightClick(tabNamed('beta.txt'));
  await pick('Split to the right', 1100);
  const split = { apart: groupOf('beta.txt') !== groupOf('alpha.txt'), beta: boxOf('beta.txt'), alpha: boxOf('alpha.txt') };
  const g = groupOf('alpha.txt').querySelector('.dv-content-container');
  const r = g.getBoundingClientRect();
  return { before, split, target: { x: r.left + r.width / 2, y: r.top + r.height / 2 } };
`);
if (setup.why) {
  unmeasured("close others in group leaves one tab", setup.why);
} else {
  // And back, by the tab's own drag onto the other group, so what follows is about one group again.
  const dragged = await tabDrag("beta.txt", setup.target);
  const many = await run(`${HELPERS}
    const rejoined = tabsIn('alpha.txt');
    await rightClick(tabNamed('alpha.txt'));
    await pick('Close others in group', 1100);
    return { rejoined, after: tabsIn('alpha.txt') };
  `);
  claim(
    "split to the right puts the panel beside the one it was tabbed with",
    setup.split.apart && setup.split.beta && setup.split.alpha && setup.split.beta.x >= setup.split.alpha.x + setup.split.alpha.w - 2,
    `alpha ${setup.split.alpha?.x}+${setup.split.alpha?.w}, beta ${setup.split.beta?.x}+${setup.split.beta?.w}`,
  );
  claim(
    "a tab dragged onto another group of main joins it",
    dragged && many.rejoined.includes("alpha.txt") && many.rejoined.includes("beta.txt"),
    `drag intercepted ${dragged} · the group holds ${JSON.stringify(many.rejoined)}`,
  );
  claim(
    "close others in group leaves one tab",
    setup.before.length >= 2 && many.after.length === 1 && many.after[0] === "alpha.txt",
    `${JSON.stringify(setup.before)} → ${JSON.stringify(many.after)}`,
  );
}

/* A second file is opened into the documents group again for it to hold more
   than one panel — and the work beside it is held to still being there. */
const grouped = await run(`${HELPERS}
  await showDoc('folders', 'Folders', 900);
  const beta = byText('.foldersbody .frow', /beta\\.txt/);
  if (beta) { beta.click(); await wait(1800); }
  const before = tabsIn('alpha.txt');
  await rightClick(tabNamed('alpha.txt'));
  await pick('Close group', 1100);
  return { before, left: names(), gone: before.filter(n => tabNamed(n)), foldersStay: Boolean(tabNamed('Folders')), overviewStays: Boolean(tabNamed('Overview')) };
`);
claim(
  "close group closes every panel of the group, and nothing beside it",
  grouped.before.length >= 2 && grouped.gone.length === 0 && grouped.foldersStay && grouped.overviewStays,
  `${JSON.stringify(grouped.before)} → what is left: ${JSON.stringify(grouped.left)}`,
);

// ---- what every tab wears ----------------------------------------------------
/* The mark of what it is, the kind beside it for the skin to colour, whether
   it holds unsaved work, and — on the one in front — a bar along the edge
   where the tab meets its panel, which is its bottom. */
const worn = await run(`${HELPERS}
  /* Only the tab in front wears the bar, which says nothing unless a tab
     behind is on screen to not wear it. What the steps before left is not
     something to lean on, so two documents of main are put one behind the
     other. */
  await showDoc('overview', 'Overview', 900);
  await showDoc('settings', 'Settings', 1100);
  const all = [...document.querySelectorAll('.plxrDock .panelTab')];
  const front = document.querySelector('.plxrDock .dv-groupview.dv-active-group .dv-tab.dv-active-tab');
  const behind = [...document.querySelectorAll('.plxrDock .dv-tab:not(.dv-active-tab)')][0];
  const mark = front ? getComputedStyle(front, '::before') : null;
  const dim = behind ? getComputedStyle(behind, '::before') : null;
  return {
    count: all.length,
    icons: all.filter(p => p.querySelector('.panelTabIcon')).length,
    kinds: all.map(p => p.dataset.kind),
    dirty: all.map(p => p.dataset.dirty),
    front: front ? nameOf(front) : '',
    mark: mark ? { bottom: mark.bottom, height: mark.height, bg: mark.backgroundColor } : null,
    tabH: front ? Math.round(front.getBoundingClientRect().height) : -1,
    behindBg: dim ? dim.backgroundColor : '',
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    markH: Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tabmark-h')) * parseFloat(getComputedStyle(document.documentElement).fontSize)),
  };
`);
claim(
  "every tab carries its mark, its kind and whether it holds unsaved work",
  worn.count > 0 &&
    worn.icons === worn.count &&
    worn.kinds.every((k) => typeof k === "string" && k.length > 0) &&
    worn.dirty.every((d) => d === "yes" || d === "no"),
  `${worn.count} tabs, ${worn.icons} with a glyph · kinds ${JSON.stringify(worn.kinds)} · unsaved ${JSON.stringify(worn.dirty)}`,
);
if (!worn.behindBg) {
  unmeasured("the tab in front is marked by a bar along its bottom edge, in the accent", "no tab behind another was on screen to compare the front one with");
} else claim(
  "the tab in front is marked by a bar along its bottom edge, in the accent",
  worn.mark &&
    worn.mark.bottom === "0px" &&
    Math.round(parseFloat(worn.mark.height)) === worn.markH &&
    worn.mark.bg !== "rgba(0, 0, 0, 0)" &&
    worn.behindBg === "rgba(0, 0, 0, 0)",
  `"${worn.front}": bottom ${worn.mark?.bottom}, ${worn.mark?.height} of a ${worn.tabH}px tab, ${worn.mark?.bg} (accent ${worn.accent}); a tab behind draws ${worn.behindBg}`,
);

// ---- ⌘W through the guard ----------------------------------------------------
const guarded = await run(`${HELPERS}
  if (!openSession(/plxr-tabs-check/)) return { noSession: true };
  await wait(1800);
  const tab = tabLike(/plxr-tabs-check/);
  if (!tab) return { noTab: true };
  await activate(tab);
  const state = { active: activeTab(), focus: document.activeElement ? document.activeElement.tagName : '', covered: Boolean(document.querySelector('.backdrop, .paletteScrim')) };
  await key('w', { metaKey: true });
  const ask = document.querySelector('.ask');
  const buttons = ask ? [...ask.querySelectorAll('.cardButtons .btn')].map(b => b.textContent.trim()) : [];
  const cancel = ask ? [...ask.querySelectorAll('.cardButtons .btn')].find(b => b.textContent.trim() === 'CANCEL') : null;
  if (cancel) cancel.click();
  await wait(400);
  return { buttons, stillAsking: Boolean(document.querySelector('.ask')), stillThere: Boolean(tabLike(/plxr-tabs-check/)), state };
`);
const liveNow = (await api("/api/sessions")).find((s) => s.id === made.id)?.alive;
claim(
  "⌘W on a running session asks with three buttons",
  guarded.buttons?.length === 3,
  `${JSON.stringify(guarded.buttons)} ${JSON.stringify(guarded.state)} alive=${liveNow}`,
);
claim(
  "the three are cancel, terminate, keep running",
  JSON.stringify(guarded.buttons) === JSON.stringify(["CANCEL", "TERMINATE", "KEEP RUNNING"]),
);
claim("cancel keeps the panel", !guarded.stillAsking && guarded.stillThere);

const plain = await run(`${HELPERS}
  const settings = await showDoc('settings', 'Settings', 1200);
  if (!settings) return { noTab: true };
  await activate(settings);
  await key('w', { metaKey: true });
  return { asked: Boolean(document.querySelector('.ask')), gone: !tabNamed('Settings') };
`);
claim("⌘W on a clean document closes it without asking", !plain.noTab && !plain.asked && plain.gone, JSON.stringify(plain));

const closer = await run(`${HELPERS}
  const settings = await showDoc('settings', 'Settings', 1200);
  if (!settings) return { noTab: true };
  settings.querySelector('.panelTabClose').click();
  await wait(400);
  const closedByButton = !tabNamed('Settings');
  const again = await showDoc('settings', 'Settings', 1200);
  again.querySelector('.panelTab').dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
  await wait(400);
  return { closedByButton, closedByMiddle: !tabNamed('Settings'), asked: Boolean(document.querySelector('.ask')) };
`);
claim("the tab's close closes a clean document", !closer.noTab && closer.closedByButton && !closer.asked);
claim("so does the middle button", !closer.noTab && closer.closedByMiddle && !closer.asked);

// ---- the keys between panels and groups -------------------------------------
const walked = await run(`${HELPERS}
  /* Two panels in the session's group to walk between, and a second group of
     main made by a split to walk to. */
  await showDoc('overview', 'Overview', 900);
  if (openSession(/plxr-tabs-check/)) await wait(1500);
  const tab = tabLike(/plxr-tabs-check/);
  if (!tab) return { noSession: true };
  await activate(tab);
  const first = activeTab();
  const together = activeGroupTabs();
  if (together.length < 2) return { tooFew: together };
  await key('ArrowLeft', { metaKey: true, altKey: true });
  const left = activeTab();
  await key('ArrowRight', { metaKey: true, altKey: true });
  const right = activeTab();
  await rightClick(tabNamed('Overview'));
  await pick('Split to the right', 1000);
  await activate(tabLike(/plxr-tabs-check/));
  const groupBefore = activeGroupTabs();
  const count = groups().length;
  await key('ArrowDown', { metaKey: true, altKey: true });
  const groupAfter = activeGroupTabs();
  await key('ArrowUp', { metaKey: true, altKey: true });
  const groupBack = activeGroupTabs();
  return { first, left, right, groupBefore, groupAfter, groupBack, count };
`);
if (walked.noSession || walked.tooFew) {
  unmeasured("⌥⌘← → walk the panels of a group", walked.noSession ? "the session panel did not open" : `only ${JSON.stringify(walked.tooFew)} in the group`);
} else {
  claim("⌥⌘← moves to the previous panel of the group", walked.left !== walked.first, `${walked.first} → ${walked.left}`);
  claim("⌥⌘→ moves back to the next one", walked.right === walked.first, `${walked.left} → ${walked.right}`);
  claim(
    "⌥⌘↓ moves to the other group of main and ⌥⌘↑ comes back",
    walked.count >= 2 &&
      JSON.stringify(walked.groupBefore) !== JSON.stringify(walked.groupAfter) &&
      JSON.stringify(walked.groupBack) === JSON.stringify(walked.groupBefore),
    `${walked.count} groups · ${JSON.stringify(walked.groupBefore)} → ${JSON.stringify(walked.groupAfter)} → ${JSON.stringify(walked.groupBack)}`,
  );
}

// ---- keep running, then terminate ---------------------------------------------
const kept = await run(`${HELPERS}
  const tab = tabLike(/plxr-tabs-check/);
  if (!tab) return { noTab: true };
  await activate(tab);
  await key('w', { metaKey: true });
  const keep = [...document.querySelectorAll('.ask .cardButtons .btn')].find(b => b.textContent.trim() === 'KEEP RUNNING');
  if (!keep) return { noKeep: true };
  keep.click();
  await wait(500);
  return { gone: !tabLike(/plxr-tabs-check/), asking: Boolean(document.querySelector('.ask')) };
`);
const stillAlive = (await api("/api/sessions")).find((s) => s.id === made.id)?.alive === true;
claim(
  "keep running closes the panel and leaves the session alive",
  !kept.noKeep && !kept.noTab && kept.gone && !kept.asking && stillAlive,
  `panel gone ${kept.gone}, session alive ${stillAlive}`,
);

const ended = await run(`${HELPERS}
  if (!openSession(/plxr-tabs-check/)) return { noSession: true };
  await wait(1600);
  const tab = tabLike(/plxr-tabs-check/);
  if (!tab) return { noTab: true };
  await activate(tab);
  await key('w', { metaKey: true });
  const kill = [...document.querySelectorAll('.ask .cardButtons .btn')].find(b => b.textContent.trim() === 'TERMINATE');
  if (!kill) return { noKill: true };
  kill.click();
  await wait(900);
  return { gone: !tabLike(/plxr-tabs-check/), asking: Boolean(document.querySelector('.ask')) };
`);
// A shell ignores SIGTERM; the service follows up with SIGKILL after a grace
// period, so the end is waited for rather than expected at once.
let killed;
for (let i = 0; i < 40; i++) {
  killed = (await api("/api/sessions")).find((s) => s.id === made.id);
  if (!killed || killed.alive === false) break;
  await sleep(250);
}
claim(
  "terminate closes the panel and ends the session",
  !ended.noTab && !ended.noKill && ended.gone && !ended.asking && (!killed || killed.alive === false),
  JSON.stringify({ ...ended, alive: killed?.alive }),
);

cdp.close();

// ---- the verdict ----------------------------------------------------------
const failed = claims.filter((c) => !c.ok);
if (claims.length === 0) {
  console.log("  checked nothing at all — the window did not load");
  await stop(1);
}
for (const c of claims) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.what}${c.detail ? `\n         ${c.detail}` : ""}`);
if (failed.length) {
  console.log(`\n  ${failed.length} of ${claims.length} claims failed`);
  await stop(1);
}
console.log(`\n  main and its tabs do what they say — all ${claims.length} claims hold`);
await stop(0);
