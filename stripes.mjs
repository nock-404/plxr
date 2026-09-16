/* Do the tool windows do what they say?
 *
 * A tool — the file tree, what has changed, the inbox, the usage — used to be
 * a panel like any document: a tab with an × in the grid, split beside the
 * work, closed and lost. Now each is a window at an edge of the dock, shown
 * and hidden, never closed, and main between the edges holds documents only.
 * That is a set of promises about boxes on a screen, and every one of them can
 * be broken without the code saying so. So each is driven the way somebody
 * drives it — through the gate kit, which clicks the icons on the stripes — and
 * measured:
 *
 *   the stripes stand at the frame, left, right and along the bottom, as thick
 *     as the frame declares, every tool's icon on them once, in his order and
 *     wearing its mark, and nothing of them inside the dock;
 *   a tool opens at its edge, main gives up exactly its width and nothing else
 *     moves; the same click hides it and main takes the room back;
 *   a second tool on the same edge swaps into the same box;
 *   the bottom window runs under all of it, from the left stripe to the right
 *     one, and the side windows end where it starts; hidden, they reach the
 *     bottom stripe again; its height holds through a hide, a reload, a
 *     maximised group and a preset, a window moved to it and back is the same
 *     element, documents are refused on it, and an arrangement saved while it
 *     still sat under main alone loads as it was stored;
 *   an edge dragged wider keeps that width through hide, show, another edge
 *     and a reload, and hiding alone is saved;
 *   a tool window has no ×, the middle button closes nothing in it, ⌘W from
 *     inside it hides it and ⇧⌘T does not bring it back as a tab; its header
 *     names it, its — hides it, its ⋮ offers Hide with the edge's chord;
 *   ⌘B ⌥⌘B ⌘J and the three edge buttons in the top bar show and hide their
 *     edge, the buttons pressed while it shows, and an empty edge changes no
 *     box and flashes its stripe; an icon's tooltip names it and its key;
 *   an icon carried to another stripe lands where it was let go and opens
 *     there, a stray release or Escape changes nothing and a press that does
 *     not move is a click; the placement survives a reload and a reset of the
 *     layout, a second window follows it, its key follows it, the ⋮ and the
 *     right button move a tool the same way, and Reset tool positions puts
 *     every tool back;
 *     ⌘2 shows the Inbox with the keyboard in it, gives the keyboard back to
 *     it, and puts it away from inside it; ⇧⎋ hides the window the keyboard
 *     is in and nothing else;
 *   a tool window is as wide as its edge whatever it holds, its — in reach;
 *   a file clicked in the Files tool opens in main, and a document dragged
 *     onto a tool window, its edges or the grid's outer edge stays in main;
 *   main's splits keep their proportions whatever order the edges go in;
 *   a hidden tool asks the service for nothing;
 *   main with every document closed offers the board, a new session and the
 *     commands, and each opens what it names;
 *   what a tool had on screen — a folder unfolded, a query and its hits, a
 *     filter, a place scrolled to — comes back through a hide and through an
 *     arrangement loaded again; a tool's own actions stand in its header, and
 *     no tool window carries a prompt;
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
// Screenshots of the moments worth looking at, when a folder is named.
const SHOTS = process.env.STRIPES_SHOTS || "";
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
const KEYS = ["dock", "dockSizes", "toolLayout", "dockRegions", "dockPresets", "dockActivity", "notes"];
const before = await api("/api/prefs").catch(() => ({}));
const held = Object.fromEntries(KEYS.map((k) => [k, before?.[k] ?? null]));
const fresh = Object.fromEntries(KEYS.map((k) => [k, null]));
await api("/api/prefs", { method: "PUT", body: JSON.stringify(fresh) }).catch(() => undefined);

const fixtures = JSON.parse(readFileSync(join(HERE, "frontend", "lib", "layoutMigrate.fixtures.json"), "utf8"));
/* What the window stored while dockview still kept the bottom edge under main
   alone, saved from that build: Files 400 px on the left, Usage on the right,
   Inbox 260 px at the bottom, all three shown. */
const oldNesting = JSON.parse(readFileSync(join(HERE, "frontend", "lib", "dock-bottom-under-main.fixture.json"), "utf8"));

/* Where each tool sits is read off the arrangement the window saved, not off
   the page: dockview takes a tool that is not in front of its edge out of the
   page once that edge has been shown, so counting windows on screen would
   count only the ones in front. */
const TOOL_IDS = ["accounts", "archive", "changes", "files", "inbox", "notes", "ports", "projects", "review", "search", "usage"];
/* A tool wears the mark of its own name, except where the registry says
   otherwise: the projects tool wears the folder, which is what a project is. */
const MARKS = { projects: "folder", accounts: "usage" };
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
  // A folder tall enough to scroll, every file of it a hit for one word.
  mkdirSync(join(work, "many"));
  for (let i = 1; i <= 120; i++) writeFileSync(join(work, "many", `row-${String(i).padStart(3, "0")}.txt`), `needle-row line ${i}\n`);
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
cdp.on("Network.requestWillBeSent", (p) => traffic.push({ at: Date.now(), kind: "http", url: p.request.url, method: p.request.method, body: p.request.postData ?? "" }));
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
async function snap(name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(shot.data, "base64"));
}
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
/* The stripes are checked against the frame they were built for: every tool on
   a side and the bottom empty, because half of what is measured here is how an
   empty bottom behaves. The window's own default puts the accounts at the
   bottom; that default is held in frontend/lib/tools.test.mjs, not here. */
await api("/api/prefs", { method: "PUT", body: JSON.stringify({ toolLayout: { v: 1, order: { left: ["projects", "files", "changes", "search", "review"], right: ["inbox", "usage", "accounts", "ports", "archive", "notes"], bottom: [], bottomRight: [] } } }) });
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
  const iconName = id => (stripeIcon(id)?.getAttribute('aria-label') || '').split(' · ')[0].trim();
  const click = async (id, ms) => { stripeIcon(id).click(); await wait(ms || 700); };
  const key = async (k, mods) => { const t = document.activeElement || document.body; t.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, mods || {}))); await wait(450); };
  const hideAll = async () => { for (const t of showing()) { if (toolLit(t)) await click(t, 500); } };
  const menuRows = () => [...document.querySelectorAll('body > .menu > *')].map(e => e.classList.contains('menuSep') ? '---' : e.classList.contains('menuHeader') ? '# ' + e.textContent.trim() : ((e.querySelector('.menuLabel') || {}).textContent || '').trim() + ((e.querySelector('.menuHint') || {}).textContent ? ' [' + e.querySelector('.menuHint').textContent.trim() + ']' : ''));
  const closeMenu = async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(150); };
  const near = (a, b, t) => a !== null && b !== null && Math.abs(a - b) <= (t || 1);
  const TOOL_IDS = ['projects', 'files', 'changes', 'search', 'review', 'inbox', 'usage', 'ports', 'archive', 'notes', 'accounts'];
  const order = e => [...document.querySelectorAll('.stripe[data-edge="' + e + '"] .stripeIcon[data-tool]')].map(i => i.dataset.tool);
  const menuChecked = () => [...document.querySelectorAll('body > .menu .menuItem[aria-checked="true"]')].map(e => ((e.querySelector('.menuLabel') || {}).textContent || '').trim());
`;

const near = (a, b, tol = 1) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;
const boxNear = (a, b, tol = 1) => Boolean(a && b) && near(a.x, b.x, tol) && near(a.y, b.y, tol) && near(a.w, b.w, tol) && near(a.h, b.h, tol);
const show = (b) => (b ? `${b.x},${b.y} ${b.w}×${b.h}` : "none");
/* His frame (translated): "left - main - right. under everything, the bottom".
   Read off boxes { L, R, B } — the left, right and bottom windows, null when
   hidden — and { lS, rS, bS }, the three stripes: the bottom window runs from
   the left stripe's inner edge to the right stripe's and stands on the bottom
   stripe, and a side window that shows ends where it starts. */
const acrossStripes = (m) => Boolean(m && m.B && m.lS && m.rS && m.bS) && near(m.B.x, m.lS.x + m.lS.w) && near(m.B.x + m.B.w, m.rS.x) && near(m.B.y + m.B.h, m.bS.y);
const sidesEndOnIt = (m) => Boolean(m && m.B) && (!m.L || (near(m.L.y + m.L.h, m.B.y, 2) && near(m.L.x, m.B.x))) && (!m.R || (near(m.R.y + m.R.h, m.B.y, 2) && near(m.R.x + m.R.w, m.B.x + m.B.w)));
const fullWidth = (m) => acrossStripes(m) && Boolean(m.L && m.R) && sidesEndOnIt(m);
const spanText = (m) => (m ? `bottom ${show(m.B)} · left ${show(m.L)} · right ${show(m.R)}${m.G ? ` · main ${show(m.G)}` : ""} · stripes left ${show(m.lS)} right ${show(m.rS)} bottom ${show(m.bS)}` : "none");

// ---- a fresh window: every tool a window of its own, none of them showing ----
const start = await run(`${HELPERS}
  return { showing: showing(), gridTabs: gridTabs(), names: TOOL_IDS.map(iconName), grid: grid(), host: host() };
`);
const startPlaced = placed((await api("/api/prefs")).dock);
claim(
  "every tool is at an edge of its own, exactly once, and none is a tab of main",
  onceEach(startPlaced) && !start.gridTabs.some((t) => start.names.includes(t)),
  `at the edges ${startPlaced.edges.join(", ")} · in main ${startPlaced.main.join(", ")} · main's tabs ${start.gridTabs.join(", ")}`,
);
claim("a fresh window shows no tool window, and main fills the dock", start.showing.length === 0 && boxNear(start.grid, start.host), `showing ${start.showing.join(", ") || "none"} · main ${show(start.grid)} · dock ${show(start.host)}`);

// ---- the stripes stand at the frame ---------------------------------------------
/* Three stripes around the dock: the left and the right one as wide as the
   frame declares, the bottom one as high and under all of it, flush with the
   shell's edges, the dock inside them and nothing of theirs inside the dock. */
const frame = await run(`${HELPERS}
  const stripe = e => box(document.querySelector('.stripe[data-edge="' + e + '"]'));
  const px = v => Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v)) * parseFloat(getComputedStyle(document.documentElement).fontSize));
  return {
    shell: box(document.querySelector('.dockShell')), left: stripe('left'), right: stripe('right'), bottom: stripe('bottom'), bottomRight: stripe('bottomRight'), floor: box(document.querySelector('.floor')), grid: grid(), thick: px('--stripe-w'), rest: px('--stripe-rest'), dock: box(document.querySelector('.dockHost')),
    icons: stripeIcons().map(e => ({ tool: e.dataset.tool, edge: e.closest('.stripe').dataset.edge, mark: (e.querySelector('.uiIcon use')?.getAttribute('href') || '').split('#')[1] || '', inDock: Boolean(e.closest('.dockHost')) })),
    rail: document.querySelectorAll('.rail, .railHost, .railitem, .railhome').length,
  };
`);
{
  const f = frame;
  claim(
    "the left stripe stands at the shell's left edge and the right one flush with its right edge, each as wide as --stripe-w",
    f.shell && f.left && f.right && near(f.left.x, f.shell.x) && near(f.left.w, f.thick) && near(f.right.x + f.right.w, f.shell.x + f.shell.w) && near(f.right.w, f.thick),
    `shell ${show(f.shell)} · left ${show(f.left)} · right ${show(f.right)} · --stripe-w ${f.thick}px`,
  );
  claim(
    "the row under everything with no icon on it is only its line: as high as --stripe-rest, across the whole shell under the dock, and the dock has the height",
    f.floor && near(f.floor.h, f.rest) && near(f.floor.x, f.shell.x) && near(f.floor.w, f.shell.w) && near(f.floor.y + f.floor.h, f.shell.y + f.shell.h) && f.dock && near(f.dock.y + f.dock.h, f.floor.y),
    `row ${show(f.floor)} · halves ${show(f.bottom)} | ${show(f.bottomRight)} · shell ${show(f.shell)} · --stripe-rest ${f.rest}px · dock ${show(f.dock)}`,
  );
  const inside = f.grid && f.left && f.right && f.floor && f.grid.x >= f.left.x + f.left.w - 1 && f.grid.x + f.grid.w <= f.right.x + 1 && f.grid.y + f.grid.h <= f.floor.y + 1;
  claim("main sits inside the stripes, no icon is inside the dock, and no rail is left", inside && f.icons.every((i) => !i.inDock) && f.rail === 0,
    `main ${show(f.grid)} · icons inside the dock ${f.icons.filter((i) => i.inDock).length} · rail elements ${f.rail}`);
  const order = f.icons.map((i) => `${i.edge}:${i.tool}`).join(" ");
  claim("every tool is an icon exactly once, in the order this check starts from, wearing its registry mark",
    order === "left:projects left:files left:changes left:search left:review right:inbox right:usage right:accounts right:ports right:archive right:notes" && f.icons.every((i) => i.mark === (MARKS[i.tool] ?? i.tool)),
    `${order} · marks ${f.icons.map((i) => i.mark).join(",")}`);
}

// ---- open, hide, swap --------------------------------------------------------
const opened = await run(`${HELPERS}
  const g0 = grid();
  await click('files');
  const lit = toolLit('files');
  const pressed = stripeIcon('files').getAttribute('aria-pressed');
  const stripe = box(stripeIcon('files').closest('.stripe'));
  const files = edgeBox('files');
  const g1 = grid();
  const others = { changes: edgeBox('changes'), inbox: edgeBox('inbox') };
  await click('files');
  const hidden = { lit: toolLit('files'), pressed: stripeIcon('files').getAttribute('aria-pressed'), box: edgeBox('files'), icon: Boolean(stripeIcon('files')), grid: grid() };
  await click('files');
  const beforeSwap = { files: edgeBox('files'), grid: grid() };
  await click('changes');
  const swapped = { changes: edgeBox('changes'), files: edgeBox('files'), filesLit: toolLit('files'), changesLit: toolLit('changes'), grid: grid(), showing: showing() };
  return { g0, lit, pressed, stripe, files, g1, others, host: host(), hidden, beforeSwap, swapped };
`);
{
  const o = opened;
  claim(
    "clicking Files lights and presses its icon and shows its window with its left edge on the left stripe's right edge",
    o.lit && o.pressed === "true" && o.files && near(o.files.x, o.stripe.x + o.stripe.w) && near(o.files.y, o.g0.y) && near(o.files.h, o.g0.h),
    `lit ${o.lit} · aria-pressed ${o.pressed} · window ${show(o.files)} · left stripe ${show(o.stripe)}`,
  );
  claim(
    "main gives up exactly the window's width and nothing else moves",
    o.files && near(o.g1.x, o.g0.x + o.files.w, 2) && near(o.g1.x + o.g1.w, o.g0.x + o.g0.w) && near(o.g1.y, o.g0.y) && near(o.g1.h, o.g0.h) && !o.others.changes && !o.others.inbox,
    `main ${show(o.g0)} → ${show(o.g1)} · window ${o.files?.w} wide · right and bottom showing: ${Boolean(o.others.inbox)}`,
  );
  claim(
    "clicking the lit icon hides the window, the icon stays and goes dark, and main is back where it was",
    !o.hidden.lit && o.hidden.pressed === "false" && !o.hidden.box && o.hidden.icon && boxNear(o.hidden.grid, o.g0),
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
  await openSession(/plxr-stripes-check/);
  await wait(1500);
  await click('files', 900);
  const w = win('files');
  const title = w.querySelector('.toolTitle')?.textContent.trim() ?? '';
  const closes = [...document.querySelectorAll('.toolWindow')].map(t => t.closest('.dv-groupview')).filter(Boolean).reduce((n, g) => n + g.querySelectorAll('.panelTabClose').length, 0);
  const hideLabel = w.querySelector('[data-do="tool-hide"]')?.getAttribute('aria-label') ?? '';
  w.querySelector('[data-do="tool-more"]').click();
  await wait(300);
  const rows = menuRows();
  const ticked = menuChecked();
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
  return { title, icon: iconName('files'), closes, hideLabel, rows, ticked, afterMiddle, focused, afterW, afterReopen, shownAgain, afterHideButton: { lit: toolLit('files'), box: edgeBox('files') } };
`);
{
  const h = header;
  const chord = process.platform === "darwin" ? "⌘B" : "Ctrl+B";
  claim("the header names the tool the way its icon does", h.title !== "" && h.title.toLowerCase() === h.icon.toLowerCase(), `header "${h.title}" · icon "${h.icon}"`);
  claim("there is no × anywhere in a tool window", h.closes === 0, `${h.closes} closes in the edges`);
  claim(
    "⋮ reads Move to Left, Right, Bottom left, Bottom right with the tool's own edge ticked, then Hide with the edge's chord, then Reset tool positions",
    JSON.stringify(h.rows) === JSON.stringify(["# Move to", "Left", "Right", "Bottom left", "Bottom right", "---", `${h.hideLabel} [${chord}]`, "Reset tool positions"]) && JSON.stringify(h.ticked) === '["Left"]',
    `${h.rows.join(" | ")} · ticked ${h.ticked.join(",")}`,
  );
  claim("the middle button inside a tool window closes nothing", h.afterMiddle.lit && Boolean(h.afterMiddle.box), JSON.stringify(h.afterMiddle));
  claim("⌘W with the keyboard in the window hides it, and its icon stays", h.focused && !h.afterW.lit && !h.afterW.box && h.afterW.icon, JSON.stringify({ focused: h.focused, ...h.afterW }));
  claim("⇧⌘T does not bring the tool back, as a window or as a tab of main", !h.afterReopen.lit && !h.afterReopen.box && !h.afterReopen.gridTabs.includes(h.title), JSON.stringify(h.afterReopen));
  claim("the — in the header hides the window", h.shownAgain && !h.afterHideButton.lit && !h.afterHideButton.box, JSON.stringify(h.afterHideButton));
}

// ---- the keys -------------------------------------------------------------------
/* The edge chords: the stripes keep their thickness, main takes and gives the
   room, and an edge with nothing on it changes no box and says so on its
   stripe for a moment. Keys are keydown events on whatever has focus, read by
   the same window listeners a real key reaches. */
const edges = await run(`${HELPERS}
  await hideAll();
  document.activeElement?.blur?.();
  /* The bottom one by its row — where the dock ends above the shell's foot —
     because an empty bottom stripe asked to show stands over the dock for a
     moment without taking a pixel from it. */
  const thick = () => ['left', 'right', 'bottom'].map(e => { if (e === 'bottom') { const s = box(document.querySelector('.dockShell')), d = box(document.querySelector('.dockHost')); return Math.round(s.y + s.h - (d.y + d.h)); } return box(document.querySelector('.stripe[data-edge="' + e + '"]')).w; }).join('/');
  const g0 = grid(); const f0 = thick();
  const step = async (k, mods) => { await key(k, mods); const flash = document.querySelector('.stripe[data-edge="bottom"]').dataset.flash === 'yes'; await wait(300);
    return { showing: showing(), grid: grid(), thick: thick(), flash, left: edgeBox('files') || edgeBox('changes'), right: edgeBox('inbox') || edgeBox('usage') }; };
  document.activeElement?.blur?.();
  const leftOn = await step('b', { metaKey: true });
  document.activeElement?.blur?.();
  const leftOff = await step('b', { metaKey: true });
  const rightOn = await step('b', { metaKey: true, altKey: true });
  document.activeElement?.blur?.();
  const rightOff = await step('b', { metaKey: true, altKey: true });
  const bottom = await step('j', { metaKey: true });
  await wait(700);
  const afterFlash = document.querySelector('.stripe[data-edge="bottom"]').dataset.flash === 'yes';
  return { g0, f0, leftOn, leftOff, rightOn, rightOff, bottom, afterFlash };
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
    "⌘J on the empty bottom edge changes no box and flashes the bottom stripe for a moment, and the stripes keep their thickness throughout",
    e.bottom.showing.length === 0 && boxNear(e.bottom.grid, e.g0) && e.bottom.flash && !e.afterFlash && [e.leftOn, e.leftOff, e.rightOn, e.rightOff, e.bottom].every((s) => s.thick === e.f0),
    `showing ${e.bottom.showing.join(", ") || "none"} · main ${show(e.bottom.grid)} · data-flash ${e.bottom.flash}, still set after 700 ms ${e.afterFlash} · stripes ${[e.f0, e.leftOn.thick, e.rightOn.thick, e.bottom.thick].join(" | ")}`,
  );
}

// ---- the edge buttons in the top bar ------------------------------------------------
/* The same three edges from the top bar: each button shows and hides its edge
   the way its key does, is pressed while its edge shows — whichever way the
   edge came to show — and on an empty edge flashes that edge's stripe. */
const toggles = await run(`${HELPERS}
  await hideAll();
  document.activeElement?.blur?.();
  const button = e => document.querySelector('.bar [data-do="toggle-' + e + '"]');
  const pressed = () => ['left', 'bottom', 'right'].map(e => button(e)?.getAttribute('aria-pressed') ?? 'none').join(' ');
  const g0 = grid();
  const snap = async () => { await wait(700); return { showing: showing(), grid: grid(), pressed: pressed(), left: edgeBox('files') || edgeBox('changes'), right: edgeBox('inbox') || edgeBox('usage') }; };
  const start = pressed();
  button('left').click(); const leftOn = await snap();
  button('left').click(); const leftOff = await snap();
  button('right').click(); const rightOn = await snap();
  button('right').click(); const rightOff = await snap();
  // Read after the click has been drawn, and well inside the flash's 600 ms.
  button('bottom').click(); await wait(200); const flash = document.querySelector('.stripe[data-edge="bottom"]').dataset.flash === 'yes'; const bottom = await snap();
  await click('files', 900); const byIcon = pressed();
  document.activeElement?.blur?.();
  await key('b', { metaKey: true }); await wait(300); const byChord = pressed();
  return { g0, start, leftOn, leftOff, rightOn, rightOff, flash, bottom, byIcon, byChord };
`);
{
  const t = toggles;
  claim(
    "the top bar's left edge button shows the left edge, is pressed while it shows and hides it again, main giving and taking the width",
    t.start === "false false false" && t.leftOn.left && near(t.leftOn.grid.x, t.g0.x + t.leftOn.left.w, 2) && t.leftOn.pressed === "true false false" && t.leftOff.showing.length === 0 && boxNear(t.leftOff.grid, t.g0) && t.leftOff.pressed === "false false false",
    `pressed ${t.start} → ${t.leftOn.pressed} → ${t.leftOff.pressed} · main ${show(t.g0)} → ${show(t.leftOn.grid)} → ${show(t.leftOff.grid)}`,
  );
  claim(
    "the right edge button does the same for the right edge",
    t.rightOn.right && near(t.rightOn.grid.x + t.rightOn.grid.w, t.g0.x + t.g0.w - t.rightOn.right.w, 2) && t.rightOn.pressed === "false false true" && t.rightOff.showing.length === 0 && boxNear(t.rightOff.grid, t.g0) && t.rightOff.pressed === "false false false",
    `pressed ${t.rightOn.pressed} → ${t.rightOff.pressed} · main ${show(t.rightOn.grid)} → ${show(t.rightOff.grid)}`,
  );
  claim(
    "the bottom edge button on the empty bottom edge changes no box, stays unpressed and flashes the bottom stripe",
    t.flash && t.bottom.showing.length === 0 && boxNear(t.bottom.grid, t.g0) && t.bottom.pressed === "false false false",
    `data-flash ${t.flash} · main ${show(t.bottom.grid)} · pressed ${t.bottom.pressed}`,
  );
  claim("the buttons' pressed state follows a click on an icon and ⌘B", t.byIcon === "true false false" && t.byChord === "false false false", `after the Files icon ${t.byIcon} · after ⌘B ${t.byChord}`);
}

/* Hints, under a real pointer: an icon on the left stripe says its name and
   key to the right of itself, one on the right stripe to its left, and an edge
   button says what it does and its key. */
async function hint(selector) {
  const at = await run(`${HELPERS} const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2, b: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } } : null;`);
  if (!at) return null;
  await mouse("mouseMoved", at.x, at.y);
  await sleep(900);
  const tip = await run(`${HELPERS} const t = document.querySelector('.tooltip'); return t ? { text: t.textContent.trim(), b: box(t) } : null;`);
  await mouse("mouseMoved", 800, 600);
  await sleep(300);
  return { at: at.b, tip };
}
await run(`${HELPERS} await hideAll(); document.activeElement?.blur?.();`);
const tipFiles = await hint('.stripe .stripeIcon[data-tool="files"]');
const tipInbox = await hint('.stripe .stripeIcon[data-tool="inbox"]');
const tipEdge = await hint('.bar [data-do="toggle-left"]');
claim(
  "an icon's tooltip names the tool and its key beside the icon, towards the work: Files ⌘3 right of the left stripe's icon, Inbox ⌘2 left of the right stripe's",
  tipFiles?.tip?.text === "Files ⌘3" && tipFiles.tip.b.x >= tipFiles.at.x + tipFiles.at.w && tipInbox?.tip?.text === "Inbox ⌘2" && tipInbox.tip.b.x + tipInbox.tip.b.w <= tipInbox.at.x,
  `"${tipFiles?.tip?.text}" at ${show(tipFiles?.tip?.b)} for the icon at ${show(tipFiles?.at)} · "${tipInbox?.tip?.text}" at ${show(tipInbox?.tip?.b)} for ${show(tipInbox?.at)}`,
);
claim("an edge button's tooltip says what it does and its key", tipEdge?.tip?.text === "Show or hide the left tool window ⌘B", `"${tipEdge?.tip?.text}"`);

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

// ---- carrying an icon to another stripe --------------------------------------------
/* The pointer the way a hand moves it, through the debugging protocol: pressed
   on an icon, moved in steps, let go. Measured half way: the copy under the
   pointer, the stripe it would land on marked, one gap on it. */
const order = async () => run(`${HELPERS} return { left: order('left'), right: order('right'), bottom: order('bottom'), bottomRight: order('bottomRight') };`);
const centreOf = async (selector) => run(`${HELPERS} const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;`);
async function carry(tool, to, { escape = false, shot = "" } = {}) {
  const from = await centreOf(`.stripe .stripeIcon[data-tool="${tool}"]`);
  if (!from) return { error: `no icon for ${tool}` };
  await mouse("mouseMoved", from.x, from.y);
  await mouse("mousePressed", from.x, from.y, { button: "left", buttons: 1, clickCount: 1 });
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, { button: "left", buttons: 1 });
    await sleep(20);
  }
  await sleep(200);
  const mid = await run(`${HELPERS}
    return { standing: box(document.querySelector('.floor')), dock: box(document.querySelector('.dockHost')), ghost: box(document.querySelector('.stripeGhost')), dropOn: [...document.querySelectorAll('.stripe[data-drop="yes"]')].map(s => s.dataset.edge),
      gaps: document.querySelectorAll('.stripeGap').length, carried: [...document.querySelectorAll('.stripeIcon[data-dragging="yes"]')].map(e => e.dataset.tool),
      marked: document.body.dataset.draggingTool ?? '' };
  `);
  if (shot) await snap(shot);
  if (escape) {
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await sleep(200);
  }
  await mouse("mouseReleased", to.x, to.y, { button: "left", buttons: 0, clickCount: 1 });
  await sleep(900);
  return { from, mid };
}
const settledPlaces = (p) => JSON.stringify([p.left, p.right, p.bottom]);
const DEFAULT_PLACES = JSON.stringify([["projects", "files", "changes", "search", "review"], ["inbox", "usage", "accounts", "ports", "archive", "notes"], []]);

await run(`${HELPERS} await hideAll(); document.activeElement?.blur?.();`);
const bottomSpot = await run(`${HELPERS} const b = box(document.querySelector('.stripe[data-edge="bottom"]')); return { x: b.x + 90, y: b.y + b.h / 2 };`);
const carried = await carry("inbox", bottomSpot, { shot: "carrying" });
const landed = await run(`${HELPERS} return { left: order('left'), right: order('right'), bottom: order('bottom'), lit: toolLit('inbox'), showing: showing(),
  ghost: Boolean(document.querySelector('.stripeGhost')), gaps: document.querySelectorAll('.stripeGap').length, marked: document.body.dataset.draggingTool ?? '' };`);
{
  const m = carried.mid ?? {};
  claim(
    "carried half way, a copy of the icon follows the pointer, the icon is out of its stripe, and the bottom stripe is marked with a gap",
    m.ghost && near(m.ghost.x + m.ghost.w / 2, bottomSpot.x, 2) && near(m.ghost.y + m.ghost.h / 2, bottomSpot.y, 2) && JSON.stringify(m.dropOn) === '["bottom"]' && m.gaps === 1 && JSON.stringify(m.carried) === '["inbox"]' && m.marked === "yes",
    `${JSON.stringify(m)} · pointer at ${Math.round(bottomSpot.x)},${Math.round(bottomSpot.y)}`,
  );
  claim(
    "carried, the empty row under everything stands over the foot of the dock as thick as --stripe-w, and the dock under it does not move",
    m.standing && near(m.standing.h, frame.thick) && near(m.standing.y + m.standing.h, frame.shell.y + frame.shell.h) && near(m.standing.w, frame.shell.w) && m.dock && boxNear(m.dock, frame.dock),
    `bottom stripe ${show(m.standing)} · dock ${show(m.dock)} against ${show(frame.dock)} · --stripe-w ${frame.thick}px`,
  );
  claim(
    "let go on the empty bottom stripe, Inbox is its first icon and gone from the right one; it stays dark, and nothing of the carrying is left",
    landed.bottom[0] === "inbox" && !landed.right.includes("inbox") && !landed.lit && landed.showing.length === 0 && !landed.ghost && landed.gaps === 0 && landed.marked === "",
    `left ${landed.left.join(",")} · right ${landed.right.join(",")} · bottom ${landed.bottom.join(",")} · lit ${landed.lit} · showing ${landed.showing.join(",") || "none"}`,
  );
}
const between = await run(`${HELPERS}
  await click('files', 800); await click('usage', 800); await click('inbox', 1000);
  const at = e => box(document.querySelector('.stripe[data-edge="' + e + '"]'));
  const out = { B: edgeBox('inbox'), L: edgeBox('files'), R: edgeBox('usage'), lS: at('left'), rS: at('right'), bS: at('bottom'), lit: toolLit('inbox') };
  await hideAll();
  return out;
`);
claim(
  "clicked, it opens its window at the bottom across the full width, from the left stripe's inner edge to the right stripe's, on the bottom stripe, and both side windows end where it starts",
  between.lit && fullWidth(between),
  spanText(between),
);

// Let go where no stripe is, Escape half way, and a press that does not move.
await run(`${HELPERS} await hideAll(); document.activeElement?.blur?.();`);
const placesNow = settledPlaces(await order());
const mainSpot = await run(`${HELPERS} const g = grid(); return { x: g.x + g.w / 2, y: g.y + g.h / 2 };`);
await carry("notes", mainSpot);
const afterStray = { places: settledPlaces(await order()), lit: await run(`${HELPERS} return toolLit('notes');`) };
const escaped = await carry("notes", bottomSpot, { escape: true });
const afterEscape = await run(`${HELPERS} return { lit: toolLit('notes'), marked: document.body.dataset.draggingTool ?? '', ghost: Boolean(document.querySelector('.stripeGhost')) };`);
afterEscape.places = settledPlaces(await order());
async function tap(tool) {
  const at = await centreOf(`.stripe .stripeIcon[data-tool="${tool}"]`);
  await mouse("mouseMoved", at.x, at.y);
  await mouse("mousePressed", at.x, at.y, { button: "left", buttons: 1, clickCount: 1 });
  await mouse("mouseReleased", at.x, at.y, { button: "left", buttons: 0, clickCount: 1 });
  await sleep(900);
  return run(`${HELPERS} return toolLit(${JSON.stringify(tool)});`);
}
const tapOn = await tap("usage");
const tapOff = await tap("usage");
claim("let go where there is no stripe, nothing moves and nothing opens", afterStray.places === placesNow && afterStray.lit === false, `${afterStray.places} against ${placesNow} · notes lit ${afterStray.lit}`);
claim(
  "Escape half way puts the icon back: let go on a stripe afterwards, nothing moves and nothing opens",
  escaped.mid?.gaps === 1 && afterEscape.places === placesNow && !afterEscape.lit && afterEscape.marked === "" && !afterEscape.ghost,
  `gap before Escape ${escaped.mid?.gaps} · ${afterEscape.places} · notes lit ${afterEscape.lit} · still carrying ${afterEscape.marked === "yes"}`,
);
claim("pressed and let go without moving, an icon toggles its window", tapOn === true && tapOff === false, `first press lit ${tapOn} · second ${tapOff}`);

// Kept: in prefs, through a reload, and through a reset of the panel layout.
await sleep(900);
const keptPrefs = await api("/api/prefs");
await load();
const reloadedPlaces = await order();
claim(
  "after a reload Inbox is still first on the bottom stripe, prefs.toolLayout says so, and there is no dockRegions key",
  reloadedPlaces.bottom[0] === "inbox" && keptPrefs.toolLayout?.order?.bottom?.[0] === "inbox" && !("dockRegions" in keptPrefs),
  `bottom ${reloadedPlaces.bottom.join(",")} · prefs.toolLayout.order ${JSON.stringify(keptPrefs.toolLayout?.order)} · dockRegions in prefs ${"dockRegions" in keptPrefs}`,
);
const followKey = await run(`${HELPERS}
  document.activeElement?.blur?.();
  const inside = () => Boolean(document.activeElement?.closest?.('.toolWindow[data-tool="inbox"]'));
  const stripe = box(document.querySelector('.stripe[data-edge="bottom"]'));
  await key('2', { metaKey: true }); await wait(800);
  const first = { lit: toolLit('inbox'), box: edgeBox('inbox'), inside: inside() };
  document.activeElement?.blur?.();
  await key('2', { metaKey: true }); await wait(800);
  const back = { lit: toolLit('inbox'), inside: inside() };
  await key('2', { metaKey: true }); await wait(800);
  const gone = { lit: toolLit('inbox'), box: edgeBox('inbox') };
  return { first, back, gone, stripe };
`);
claim(
  "⌘2 follows the icon: it opens the Inbox at the bottom with the keyboard in it, gives the keyboard back to it from elsewhere, and hides it from inside",
  followKey.first.lit && followKey.first.box && near(followKey.first.box.y + followKey.first.box.h, followKey.stripe.y, 1) && followKey.first.inside && followKey.back.lit && followKey.back.inside && !followKey.gone.lit && !followKey.gone.box,
  JSON.stringify({ first: { ...followKey.first, box: show(followKey.first.box) }, back: followKey.back, gone: { lit: followKey.gone.lit, box: show(followKey.gone.box) } }),
);
const afterLayoutReset = await run(`${HELPERS} document.querySelector('.bar [data-do="reset-layout"]').click(); await wait(1400); return { bottom: order('bottom'), right: order('right') };`);
claim("a reset of the panel layout leaves his placement: Inbox stays on the bottom stripe", afterLayoutReset.bottom[0] === "inbox" && !afterLayoutReset.right.includes("inbox"), `bottom ${afterLayoutReset.bottom.join(",")} · right ${afterLayoutReset.right.join(",")}`);

// Two windows on one service: a tool carried in this one stands where it was put in the other within three seconds.
let other = null;
try {
  const made = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(`${base}/?token=${info.token}`)}`, { method: "PUT" }).then((r) => r.json());
  const second = await connect(made.webSocketDebuggerUrl);
  await second.send("Runtime.enable");
  await second.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  const runB = async (expression) => {
    const r = await second.send("Runtime.evaluate", { expression: `(async () => { ${expression} })()`, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  };
  let up = 0;
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(300);
    up = await runB(`${GATEKIT} return appUp();`).catch(() => 0);
  }
  other = { id: made.id, close: () => second.close(), runB, up };
} catch (e) {
  other = { error: String(e?.message ?? e) };
}
await cdp.send("Page.bringToFront").catch(() => undefined);
if (!other?.up) {
  unmeasured("an icon moved in one window stands on the other window's stripe within three seconds", other?.error ?? "the second window did not come up");
} else {
  await sleep(1500);
  const litThere = await other.runB(`${HELPERS} await click('archive', 900); return toolLit('archive');`);
  await cdp.send("Page.bringToFront").catch(() => undefined);
  await sleep(500);
  await carry("archive", bottomSpot);
  const t0 = Date.now();
  let seen = null;
  while (Date.now() - t0 < 3000) {
    seen = await other.runB(`${HELPERS} return { bottom: order('bottom'), right: order('right'), lit: toolLit('archive'), box: edgeBox('archive'), stripe: box(document.querySelector('.stripe[data-edge="bottom"]')) };`);
    if (seen.bottom.includes("archive")) break;
    await sleep(150);
  }
  const ms = Date.now() - t0;
  const here = await run(`${HELPERS} return { bottom: order('bottom'), lit: toolLit('archive') };`);
  claim(
    "an icon carried in one window stands on the other window's stripe within three seconds, and the tool that showed there keeps showing, on its new edge",
    seen?.bottom.includes("archive") && !seen.right.includes("archive") && ms <= 3000 && litThere && seen.lit && seen.box && near(seen.box.y + seen.box.h, seen.stripe.y, 1) && here.bottom.includes("archive") && !here.lit,
    `after ${ms} ms the other window's bottom stripe holds ${seen?.bottom.join(",")} · archive showing there ${seen?.lit} (${show(seen?.box)}), before ${litThere} · here ${here.bottom.join(",")}, showing ${here.lit}`,
  );
  await fetch(`http://127.0.0.1:${port}/json/close/${other.id}`).catch(() => undefined);
  other.close();
  await cdp.send("Page.bringToFront").catch(() => undefined);
  await sleep(600);
}

// ⋮ → Bottom, and the icon's own menu.
const viaMore = await run(`${HELPERS}
  await hideAll();
  await click('files', 900);
  win('files').querySelector('[data-do="tool-more"]').click();
  const row = await until(() => document.querySelector('body > .menu [data-do="move-bottom"]'), 2000);
  if (!row) return { why: 'no Bottom row under ⋮' };
  row.click(); await wait(1100);
  return { bottom: order('bottom'), left: order('left'), lit: toolLit('files'), box: edgeBox('files'), leftShows: showing().some(t => ['changes', 'search', 'review'].includes(t)),
    stripe: box(document.querySelector('.stripe[data-edge="bottom"]')) };
`);
claim(
  "⋮ → Bottom moves Files to the end of the bottom stripe, and as it was showing it shows there; the left edge is hidden",
  !viaMore.why && viaMore.bottom[viaMore.bottom.length - 1] === "files" && !viaMore.left.includes("files") && viaMore.lit && viaMore.box && near(viaMore.box.y + viaMore.box.h, viaMore.stripe.y, 1) && !viaMore.leftShows,
  viaMore.why ?? `bottom ${viaMore.bottom.join(",")} · left ${viaMore.left.join(",")} · files lit ${viaMore.lit} at ${show(viaMore.box)} · a left tool showing ${viaMore.leftShows}`,
);
const portsAt = await centreOf('.stripe .stripeIcon[data-tool="ports"]');
await mouse("mousePressed", portsAt.x, portsAt.y, { button: "right", clickCount: 1 });
await mouse("mouseReleased", portsAt.x, portsAt.y, { button: "right", clickCount: 1 });
const viaIcon = await run(`${HELPERS}
  const row = await until(() => document.querySelector('body > .menu [data-do="move-bottom"]'), 2000);
  if (!row) return { why: 'no Bottom row under the right button' };
  const rows = menuRows(); const ticked = menuChecked();
  row.click(); await wait(1100);
  return { rows, ticked, bottom: order('bottom'), right: order('right'), lit: toolLit('ports'), filesLit: toolLit('files') };
`);
claim(
  "right-click on an icon reads Open with its key, Move to Left, Right, Bottom left, Bottom right with its edge ticked, and Reset tool positions; Bottom left moves Ports there and leaves it dark",
  !viaIcon.why && JSON.stringify(viaIcon.rows) === JSON.stringify(["Open [⌘5]", "---", "# Move to", "Left", "Right", "Bottom left", "Bottom right", "---", "Reset tool positions"]) && JSON.stringify(viaIcon.ticked) === '["Right"]'
    && viaIcon.bottom[viaIcon.bottom.length - 1] === "ports" && !viaIcon.right.includes("ports") && !viaIcon.lit && viaIcon.filesLit,
  viaIcon.why ?? `${viaIcon.rows.join(" | ")} · ticked ${viaIcon.ticked.join(",")} · bottom ${viaIcon.bottom.join(",")} · ports lit ${viaIcon.lit} · files still showing ${viaIcon.filesLit}`,
);
const filesAt = await centreOf('.stripe .stripeIcon[data-tool="files"]');
await mouse("mousePressed", filesAt.x, filesAt.y, { button: "right", clickCount: 1 });
await mouse("mouseReleased", filesAt.x, filesAt.y, { button: "right", clickCount: 1 });
const resetTools = await run(`${HELPERS}
  const row = await until(() => document.querySelector('body > .menu [data-do="reset-tools"]'), 2000);
  if (!row) return { why: 'no Reset tool positions row' };
  row.click(); await wait(1400);
  return { left: order('left'), right: order('right'), bottom: order('bottom'), filesLit: toolLit('files'), files: edgeBox('files'), stripe: box(document.querySelector('.stripe[data-edge="left"]')) };
`);
await sleep(800);
const prefsAfterReset = await api("/api/prefs");
claim(
  "Reset tool positions puts every tool back where it started, Inbox on the right, forgets the placement, and Files, which was showing, shows on the left again",
  !resetTools.why && settledPlaces(resetTools) === DEFAULT_PLACES && !("toolLayout" in prefsAfterReset) && resetTools.filesLit && resetTools.files && near(resetTools.files.x, resetTools.stripe.x + resetTools.stripe.w),
  resetTools.why ?? `${settledPlaces(resetTools)} · prefs.toolLayout ${JSON.stringify(prefsAfterReset.toolLayout)} · files lit ${resetTools.filesLit} at ${show(resetTools.files)}`,
);
// The reset of the panel layout above closed the check's session; the sections after this one expect it in main.
await run(`${HELPERS} await hideAll(); await openSession(/plxr-stripes-check/); await wait(1500);`);
await sleep(600);

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
  // And onto the stripes themselves, which are no drop target of the dock's.
  const stripeSpots = await run(`${HELPERS} const l = box(document.querySelector('.stripe[data-edge="left"]')); const b = box(document.querySelector('.stripe[data-edge="bottom"]')); return { "left stripe": { x: l.x + l.w / 2, y: l.y + l.h - 40 }, "bottom stripe": { x: b.x + b.w / 2, y: b.y + b.h / 2 } };`);
  for (const [zone, at] of Object.entries(stripeSpots)) {
    const got = await tabDrag("alpha.txt", at);
    const stripes = await run(`${HELPERS} return { onStripes: document.querySelectorAll('.stripe .dv-tab, .stripe .panelTab, .stripe .editorPanel').length, icons: stripeIcons().length };`);
    drops.push({ zone, ...got, ...stripes });
  }
  // The grid's own outer edge, with the left window hidden so main reaches it.
  const outer = await run(`${HELPERS} if (toolLit('files')) await click('files', 700); const g = grid(); return { x: g.x + 4, y: g.y + g.h / 2 };`);
  drops.push({ zone: "grid's outer edge", ...(await tabDrag("alpha.txt", outer)) });
  claim(
    "the control: a tab dragged into a group of main does move there",
    moved.intercepted && moved.inMain && moved.groups?.some((g) => g.split("+").includes("beta.txt") && g.split("+").includes("Overview")),
    JSON.stringify(moved),
  );
  claim(
    "a document dragged onto a tool window's centre, its edges, the grid's outer edge or a stripe stays in main, every edge holds tools only and every stripe its eleven icons",
    drops.length === 7 && drops.every((d) => d.intercepted && d.inMain && d.inTools === 0 && (d.onStripes ?? 0) === 0 && (d.icons ?? 11) === 11),
    drops.map((d) => `${d.zone}: in main ${d.inMain}, non-tools in edges ${d.inTools}${d.icons !== undefined ? `, on the stripes ${d.onStripes}, icons ${d.icons}` : ""}`).join(" · "),
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
await api("/api/prefs", { method: "PUT", body: JSON.stringify({ toolLayout: { v: 1, order: { left: ["projects", "files", "changes", "search", "review"], right: ["usage", "accounts", "ports", "archive", "notes"], bottom: ["inbox"] } } }) });
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
  const bottomBox = await run(`${HELPERS}
    for (const t of ['files', 'usage', 'inbox']) if (!toolLit(t)) await click(t, 600);
    await wait(300);
    const out = { B: edgeBox('inbox'), L: edgeBox('files'), R: edgeBox('usage'), G: grid(), S: box(document.querySelector('.dockHost .dv-shell')) };
    await hideAll();
    return out;
  `);
  claim(
    "main's splits keep their proportions whichever order the three edges are shown and hidden in",
    worst <= 2,
    `${splitSetup.groups.map((g) => g.tabs).join(" | ")} · worst drift ${worst}px · ${seen.join(" · ")}`,
  );
  const bb = bottomBox;
  claim(
    "with both side windows showing, a tool on the bottom edge opens under main and under both of them: main ends where it starts, and it is as wide as the whole dock",
    bb.B && bb.G && bb.S && bb.L && bb.R && near(bb.G.y + bb.G.h, bb.B.y, 2) && near(bb.B.x, bb.S.x) && near(bb.B.w, bb.S.w),
    `bottom ${show(bb.B)} · main ${show(bb.G)} · left ${show(bb.L)} · right ${show(bb.R)} · dock ${show(bb.S)}`,
  );
}

// ---- the bottom under everything ---------------------------------------------------
/* His frame, in his words (translated): "left - main - right. under everything,
   the bottom" — the way PhpStorm has it. dockview keeps its bottom edge in the
   column between the side edges, where it is only as wide as main, so
   components/dock/shellNesting.ts rebuilds the shell; what is read here is the
   page. The Inbox stands on the bottom edge from the section above. */
{
  const SPAN = `${HELPERS}
    const stripeAt = e => box(document.querySelector('.stripe[data-edge="' + e + '"]'));
    const span = (l, r, b) => ({ L: edgeBox(l), R: edgeBox(r), B: edgeBox(b), G: grid(), S: box(document.querySelector('.dockHost .dv-shell')), lS: stripeAt('left'), rS: stripeAt('right'), bS: stripeAt('bottom') });
    const structure = () => {
      const shell = document.querySelector('.dockHost .dv-shell');
      const views = [...(shell?.querySelectorAll(':scope > .dv-split-view-container.dv-vertical > .dv-view-container > .dv-view') ?? [])];
      return {
        marked: shell?.dataset.bottomSpan === 'full', views: views.length,
        rowFirst: Boolean(views[0]?.querySelector(':scope > .dv-shell-row')), bottomSecond: Boolean(views[1]?.querySelector('[data-testid="dv-edge-group-bottom"]')),
        sidesInRow: Boolean(document.querySelector('.dv-shell-row [data-testid="dv-edge-group-left"]') && document.querySelector('.dv-shell-row [data-testid="dv-edge-group-right"]')),
        bottomInRow: Boolean(document.querySelector('.dv-shell-row [data-testid="dv-edge-group-bottom"]')),
        edgesInMiddle: document.querySelectorAll('.dockHost .dv-shell-middle-column .dv-edge-group').length,
      };
    };
    const showOnly = async ids => { for (const t of TOOL_IDS) if (toolLit(t) && !ids.includes(t)) await click(t, 400); for (const t of ids) if (!toolLit(t)) await click(t, 700); await wait(400); };
    const rowIn = (id, n) => [...(win(id)?.querySelectorAll('.frow') ?? [])].find(r => (r.querySelector('.fname') || {}).textContent?.trim() === n);
    const unfoldedIn = (id, n) => (rowIn(id, n)?.querySelector('.fchev')?.innerHTML || '').includes('chevron-down');
  `;
  const stripeSpot = (edge, fromEnd) => run(`${HELPERS}
    const s = box(document.querySelector('.stripe[data-edge="${edge}"]'));
    return ${edge === "bottom"} ? { x: s.x + s.w - ${fromEnd}, y: s.y + s.h / 2 } : { x: s.x + s.w / 2, y: s.y + s.h - ${fromEnd} };
  `);

  // The structure and the boxes, at three widths.
  await run(`${SPAN} await hideAll(); await openSession(/plxr-stripes-check/); await wait(1200); document.activeElement?.blur?.();`);
  const spans = [];
  for (const w of [1600, 1100, 900]) {
    await view(w);
    await sleep(900);
    spans.push(await run(`${SPAN} await showOnly(['files', 'usage', 'inbox']); document.activeElement?.blur?.(); await wait(500); return { width: innerWidth, ...span('files', 'usage', 'inbox'), structure: structure() };`));
  }
  claim(
    "the shell is rebuilt: marked, its top splitview vertical with two views — the row holding the left window, main and the right window, then the bottom edge — and no edge left in dockview's middle column",
    spans.every((m) => m.structure.marked && m.structure.views === 2 && m.structure.rowFirst && m.structure.bottomSecond && m.structure.sidesInRow && !m.structure.bottomInRow && m.structure.edgesInMiddle === 0),
    spans.map((m) => `${m.width}px: ${JSON.stringify(m.structure)}`).join(" | "),
  );
  claim(
    "with Files, Usage and Inbox shown, the bottom window runs from the left stripe's inner edge to the right stripe's on the bottom stripe, and both side windows end where it starts — at 1600, 1100 and 900 px",
    spans.every((m) => fullWidth(m)),
    spans.map((m) => `${m.width}px: ${spanText(m)}`).join(" | "),
  );

  // A short window, the bottom at the height it opens with.
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 600, deviceScaleFactor: 1, mobile: false });
  await sleep(900);
  const short = await run(`${SPAN} await showOnly(['files', 'usage', 'inbox']); document.activeElement?.blur?.(); await wait(500); return span('files', 'usage', 'inbox');`);
  await view(1600);
  await sleep(900);
  claim(
    "in a short window, 1100 by 600, the bottom window still stands on the bottom stripe under both side windows, they and main keep a hundred pixels above it, and no box overlaps another",
    fullWidth(short) && [short.L, short.R, short.G].every((b) => b.h >= 99) && [short.L, short.R, short.B, short.G].every((b) => b.w > 0 && b.h > 0 && b.x >= 0 && b.y >= 0) &&
      short.L.x + short.L.w <= short.G.x + 1 && short.G.x + short.G.w <= short.R.x + 1 && short.B.y >= short.G.y + short.G.h - 1,
    spanText(short),
  );

  // ⌘J: hidden, the side windows and main run the full height again.
  const chordJ = await run(`${SPAN}
    await showOnly(['files', 'usage', 'inbox']); document.activeElement?.blur?.();
    const shown = span('files', 'usage', 'inbox');
    await key('j', { metaKey: true }); await wait(500);
    const hidden = span('files', 'usage', 'inbox');
    document.activeElement?.blur?.();
    await key('j', { metaKey: true }); await wait(700);
    document.activeElement?.blur?.();
    return { shown, hidden, again: span('files', 'usage', 'inbox') };
  `);
  {
    const { shown, hidden: h, again } = chordJ;
    claim(
      "⌘J hides the bottom window, and both side windows and main run the full height down to the bottom stripe again, at the widths they had",
      fullWidth(shown) && !h.B && h.L && h.R && h.G && near(h.L.h, h.S.h, 2) && near(h.R.h, h.S.h, 2) && near(h.G.h, h.S.h, 2) && near(h.L.y + h.L.h, h.bS.y) && near(h.R.y + h.R.h, h.bS.y) && near(h.L.w, shown.L.w) && near(h.R.w, shown.R.w),
      `shown: ${spanText(shown)} · hidden: ${spanText(h)} · dock ${show(h.S)}`,
    );
    claim("⌘J again brings the bottom window back at the height it had, across the full width", fullWidth(again) && near(again.B.h, shown.B.h), `height before ${shown.B?.h} · again ${spanText(again)}`);
  }

  // A group of main maximised while the bottom shows.
  const maxed = await run(`${SPAN}
    await showOnly(['usage', 'inbox']); document.activeElement?.blur?.();
    const visible = () => gridGroups().filter(g => g.b.w > 0 && g.b.h > 0).length;
    const before = { ...span('files', 'usage', 'inbox'), groups: visible() };
    const tab = [...document.querySelectorAll('.plxrDock .dv-tab')].find(t => t.offsetParent !== null)?.querySelector('.panelTab');
    if (!tab) return { why: 'no tab in main to maximise' };
    const r = tab.getBoundingClientRect();
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 8, button: 2 }));
    const row = await until(() => [...document.querySelectorAll('body > .menu .menuItem')].find(b => b.querySelector('.menuLabel')?.textContent.trim() === 'Maximise'), 2000);
    if (!row) { await closeMenu(); return { why: 'no Maximise row on a tab of main' }; }
    row.click(); await wait(900);
    const during = { ...span('files', 'usage', 'inbox'), groups: visible() };
    await click('files', 1000);
    document.activeElement?.blur?.();
    return { before, during, after: { ...span('files', 'usage', 'inbox'), groups: visible() } };
  `);
  if (maxed.why || maxed.before.groups < 2) {
    unmeasured("a group of main maximised leaves the bottom window where it is", maxed.why ?? `only ${maxed.before.groups} group of main on screen`);
  } else {
    claim(
      "a group of main maximised leaves the bottom window exactly where it was, and showing Files ends the maximise with the bottom still under all three",
      maxed.during.groups === 1 && boxNear(maxed.during.B, maxed.before.B) && maxed.after.groups === maxed.before.groups && fullWidth(maxed.after),
      `groups ${maxed.before.groups} → ${maxed.during.groups} → ${maxed.after.groups} · bottom ${show(maxed.before.B)} → ${show(maxed.during.B)} · after: ${spanText(maxed.after)}`,
    );
  }

  // A height dragged by hand: through a hide, another edge and a reload.
  await run(`${SPAN} await showOnly(['files', 'usage', 'inbox']); document.activeElement?.blur?.();`);
  const dragged = await dragBottomEdge("inbox", 300);
  const heights = await run(`${SPAN}
    const at = () => edgeBox('inbox')?.h ?? null;
    const dragged = at();
    await click('inbox', 600); const hidden = edgeBox('inbox');
    await click('inbox', 900); const again = at();
    await click('files', 700); const leftOff = { bottom: at(), left: edgeBox('files') };
    await click('files', 900); const leftOn = at();
    document.activeElement?.blur?.();
    await wait(1200);
    return { dragged, hidden, again, leftOff, leftOn, before: span('files', 'usage', 'inbox') };
  `);
  await load();
  const reloaded = await run(`${SPAN} return { lit: ['files', 'usage', 'inbox'].map(toolLit), ...span('files', 'usage', 'inbox') };`);
  const reloadPrefs = await api("/api/prefs");
  claim(
    "the bottom sash dragged to 300 px leaves the bottom window 300 px high; hidden and shown it comes back at 300, and so it does with the left window hidden and shown meanwhile",
    near(dragged, 300) && near(heights.dragged, 300) && !heights.hidden && near(heights.again, 300) && !heights.leftOff.left && near(heights.leftOff.bottom, 300) && near(heights.leftOn, 300),
    JSON.stringify({ dragged, ...heights, before: undefined }),
  );
  {
    const b = heights.before;
    const eg = reloadPrefs.dock?.edgeGroups ?? {};
    claim(
      "after a reload all three windows are lit at the sizes they had — left and right widths, the bottom 300 high — the bottom still under all three, and the stored arrangement and prefs.dockSizes both say 300",
      reloaded.lit.every(Boolean) && near(reloaded.L?.w, b.L?.w) && near(reloaded.R?.w, b.R?.w) && near(reloaded.B?.h, 300) && fullWidth(reloaded) &&
        near(eg.bottom?.size, 300) && eg.bottom?.visible === true && near(reloadPrefs.dockSizes?.bottom, 300) && near(eg.left?.size, b.L?.w) && near(eg.right?.size, b.R?.w),
      `before: ${spanText(b)} · after: ${spanText(reloaded)} · lit ${reloaded.lit.join(",")} · stored ${["left", "right", "bottom"].map((e) => `${e} ${eg[e]?.size} ${eg[e]?.visible ? "shown" : "hidden"}`).join(" · ")} · dockSizes ${JSON.stringify(reloadPrefs.dockSizes)}`,
    );
  }

  // A window moved to the bottom and back is the same element, with what it had on screen.
  await run(`${SPAN} await openSession(/plxr-stripes-check/); await wait(1200);`);
  const across = await run(`${SPAN}
    await showOnly(['files', 'usage', 'inbox']);
    if (!(await until(() => rowIn('files', 'many'), 6000))) return { why: 'no folder "many" in the Files tool' };
    if (!unfoldedIn('files', 'many')) rowIn('files', 'many').click();
    if (!(await until(() => rowIn('files', 'row-001.txt'), 4000))) return { why: 'the folder "many" did not unfold' };
    const node = win('files');
    node.dataset.gateMark = 'across';
    window.__plxrGateFiles = node;
    node.querySelector('[data-do="tool-more"]').click();
    const row = await until(() => document.querySelector('body > .menu [data-do="move-bottom"]'), 2000);
    if (!row) return { why: 'no Bottom row under ⋮' };
    row.click(); await wait(1200);
    if (!toolLit('files')) await click('files', 900);
    document.activeElement?.blur?.();
    await wait(300);
    return { bottom: order('bottom'), lit: toolLit('files'), same: win('files') === node && node.dataset.gateMark === 'across', unfolded: unfoldedIn('files', 'many'), child: Boolean(rowIn('files', 'row-001.txt')), ...span('changes', 'usage', 'files') };
  `);
  if (across.why) {
    unmeasured("a tool window moved to the bottom and back is the same element", across.why);
  } else {
    await carry("files", await stripeSpot("left", 30));
    await sleep(600);
    const back = await run(`${SPAN}
      if (!toolLit('files')) await click('files', 900);
      if (!toolLit('inbox')) await click('inbox', 900);
      document.activeElement?.blur?.();
      await wait(300);
      const node = window.__plxrGateFiles;
      return { left: order('left'), same: Boolean(node) && win('files') === node && node.dataset.gateMark === 'across', unfolded: unfoldedIn('files', 'many'), ...span('files', 'usage', 'inbox') };
    `);
    await sleep(900);
    const acrossPrefs = await api("/api/prefs");
    claim(
      "⋮ → Bottom takes the showing Files window into the full-width box at the bottom as the same element, its unfolded folder still unfolded",
      across.bottom.includes("files") && across.lit && across.same && across.unfolded && across.child && acrossStripes(across) && sidesEndOnIt(across),
      `bottom stripe ${across.bottom.join(",")} · same element ${across.same} · unfolded ${across.unfolded} · ${spanText(across)}`,
    );
    claim(
      "carried back to the left stripe it shows on the left as the same element again, still unfolded, with the bottom window under all three, and every tool is at an edge exactly once",
      back.left.includes("files") && back.same && back.unfolded && fullWidth(back) && onceEach(placed(acrossPrefs.dock)),
      `left stripe ${back.left.join(",")} · same element ${back.same} · unfolded ${back.unfolded} · ${spanText(back)} · every tool once ${onceEach(placed(acrossPrefs.dock))}`,
    );
  }

  /* Usage carried to the bottom stripe and back. Files shows on the left the
     whole time: with no side window showing, main is as wide as the dock, and
     a bottom window under main alone would pass for one under everything. */
  await run(`${SPAN} await showOnly(['files', 'usage']); document.activeElement?.blur?.();`);
  await carry("usage", await stripeSpot("bottom", 60));
  const usageBottom = await run(`${SPAN} if (!toolLit('usage')) await click('usage', 900); if (!toolLit('files')) await click('files', 900); document.activeElement?.blur?.(); await wait(300); return { bottom: order('bottom'), ...span('files', 'notes', 'usage') };`);
  await carry("usage", await stripeSpot("right", 30));
  const usageBack = await run(`${SPAN} if (!toolLit('usage')) await click('usage', 900); document.activeElement?.blur?.(); await wait(300); return { right: order('right'), R: edgeBox('usage'), rS: stripeAt('right'), S: box(document.querySelector('.dockHost .dv-shell')) };`);
  claim(
    "Usage carried to the bottom stripe opens across the full width; carried back to the right stripe, the right edge shows it again",
    usageBottom.bottom.includes("usage") && acrossStripes(usageBottom) && sidesEndOnIt(usageBottom) && usageBack.right.includes("usage") && usageBack.R && near(usageBack.R.x + usageBack.R.w, usageBack.rS.x) && near(usageBack.R.h, usageBack.S.h, 2),
    `bottom stripe ${usageBottom.bottom.join(",")} · ${spanText(usageBottom)} · back: right stripe ${usageBack.right.join(",")} · usage ${show(usageBack.R)}`,
  );

  // Documents refused on the bottom window.
  const target = await run(`${SPAN}
    await showOnly(['files', 'inbox']);
    if (!tabNamed('alpha.txt')) {
      if (!(await until(() => rowIn('files', 'alpha.txt'), 6000))) return { why: 'alpha.txt is not in the Files tool' };
      rowIn('files', 'alpha.txt').click();
      if (!(await until(() => tabNamed('alpha.txt'), 5000))) return { why: 'alpha.txt did not open' };
      await wait(700);
    }
    const b = edgeBox('inbox');
    if (!b) return { why: 'the Inbox is not showing at the bottom' };
    return { centre: { x: b.x + b.w / 2, y: b.y + b.h / 2 }, 'top edge': { x: b.x + b.w / 2, y: b.y + 6 }, 'left end': { x: b.x + 12, y: b.y + b.h / 2 }, 'right end': { x: b.x + b.w - 12, y: b.y + b.h / 2 } };
  `);
  if (target.why) {
    unmeasured("a document dragged onto the bottom window stays in main", target.why);
  } else {
    const refused = [];
    for (const [zone, at] of Object.entries(target)) refused.push({ zone, ...(await tabDrag("alpha.txt", at)) });
    const bottomHolds = await run(`${SPAN} const g = win('inbox')?.closest('.dv-groupview'); return { editors: g ? g.querySelectorAll('.editorPanel, .panelTab[data-kind]:not([data-kind="view"])').length : -1, shown: Boolean(edgeBox('inbox')) };`);
    claim(
      "a document dragged onto the full-width bottom window — its centre, its top edge, either end — stays in main, and the bottom edge holds tools only",
      refused.every((d) => d.intercepted && d.inMain && d.inTools === 0) && bottomHolds.editors === 0 && bottomHolds.shown,
      `${refused.map((d) => `${d.zone}: in main ${d.inMain}, non-tools in edges ${d.inTools}`).join(" · ")} · bottom group: ${JSON.stringify(bottomHolds)}`,
    );
  }

  // ⌘W with the keyboard in the bottom window.
  const closeKey = await run(`${SPAN}
    await showOnly(['inbox']);
    const tabs = gridTabs().length;
    win('inbox').focus();
    const inside = Boolean(document.activeElement?.closest?.('.toolWindow[data-tool="inbox"]'));
    await key('w', { metaKey: true }); await wait(300);
    return { inside, lit: toolLit('inbox'), shown: Boolean(edgeBox('inbox')), tabs, after: gridTabs().length };
  `);
  claim("⌘W with the keyboard in the bottom window hides it and closes nothing in main", closeKey.inside && !closeKey.lit && !closeKey.shown && closeKey.after === closeKey.tabs, JSON.stringify(closeKey));

  // Main's floor with the bottom window showing as well.
  const floorBottom = [];
  await run(`${SPAN} await showOnly(['files', 'usage', 'inbox']); document.activeElement?.blur?.();`);
  for (const w of [1600, 1100, 900, 700]) {
    await view(w);
    await sleep(900);
    floorBottom.push(
      await run(`${SPAN}
        await wait(200);
        const g = grid(); const l = edgeBox('files'); const r = edgeBox('usage'); const shell = box(document.querySelector('.dockHost .dv-shell'));
        const gs = gridGroups().map(x => x.b).filter(b => b.w > 0 && b.h > 0);
        const left = Math.min(...gs.map(b => b.x)); const right = Math.max(...gs.map(b => b.x + b.w));
        const remPx = v => Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v)) * parseFloat(getComputedStyle(document.documentElement).fontSize));
        return { width: innerWidth, shell: shell.w, left: l?.w ?? 0, main: g.w, right: r?.w ?? 0, columns: new Set(gs.map(b => b.x)).size,
          under: Math.max(0, l ? l.x + l.w - left : 0, r ? right - r.x : 0), mainMin: remPx('--main-min'), sideMin: remPx('--side-min'), bottom: edgeBox('inbox') };
      `),
    );
  }
  await view(1600);
  await sleep(900);
  {
    const room = (f) => f.shell >= 2 * f.sideMin + f.columns * f.mainMin;
    claim(
      "with the bottom window showing too, main is never narrower than its floor nor under a side window wherever there is room, and the bottom window stays as wide as the dock",
      floorBottom.every((f) => !room(f) || (f.main >= f.mainMin - 1 && f.under <= 1)) && floorBottom.some(room) && floorBottom.every((f) => f.bottom && near(f.bottom.w, f.shell)),
      floorBottom.map((f) => `${f.width}px: left ${f.left} · main ${f.main} (${f.columns} columns, floor ${f.mainMin} each) · right ${f.right} · under a window ${f.under} · bottom ${f.bottom?.w} in a dock of ${f.shell} · room ${room(f)}`).join(" | "),
    );
  }

  // What the window stored before the bottom ran under everything.
  await api("/api/prefs", { method: "PUT", body: JSON.stringify({ dock: oldNesting.dock, dockSizes: oldNesting.dockSizes, toolLayout: oldNesting.toolLayout }) });
  await load();
  const old = await run(`${SPAN} return { lit: ['files', 'usage', 'inbox'].map(toolLit), structure: structure(), ...span('files', 'usage', 'inbox') };`);
  {
    const e = oldNesting.dock.edgeGroups;
    claim(
      "an arrangement stored while the bottom sat under main alone — Files 400 px on the left, Usage on the right, Inbox 260 px at the bottom, all shown — loads at the sizes it stored, now under all three",
      old.lit.every(Boolean) && near(old.L?.w, e.left.size) && near(old.R?.w, e.right.size) && near(old.B?.h, e.bottom.size) && fullWidth(old) && old.structure.marked,
      `stored left ${e.left.size} · right ${e.right.size} · bottom ${e.bottom.size} · loaded: ${spanText(old)} · lit ${old.lit.join(",")}`,
    );
  }

  // The sections after this one start from the Inbox on the bottom edge and nothing else changed.
  await api("/api/prefs", { method: "PUT", body: JSON.stringify({ dock: null, dockSizes: null, toolLayout: { v: 1, order: { left: ["projects", "files", "changes", "search", "review"], right: ["usage", "accounts", "ports", "archive", "notes"], bottom: ["inbox"] } } }) });
  await load();
  await run(`${HELPERS} await hideAll(); await openSession(/plxr-stripes-check/); await wait(1500);`);
}

// ---- a hidden tool asks for nothing --------------------------------------------
/* Every tool is shown once first, so every body has been mounted — the tree
   and the notes stay mounted when they are put away — then every edge is
   hidden, and ten seconds of what the window asks for are read against what
   each tool asks for. The window's own feeds — the tiles, the settings'
   revision, the limits on the status row — are nobody's tool and are left
   out. The tree used to go on asking git every four seconds from behind a
   hidden edge. */
const TOOL_ASKS = {
  files: (t) => /\/api\/git\/[^/?]+$|\/api\/files\/[^?]+\?dir=/.test(t.url),
  changes: (t) => /\/ws\/changes\/|\/api\/branches\/|\/api\/history\/|\/api\/position\/|\/api\/git\/[^/]+\/stashes/.test(t.url),
  review: (t) => /\/api\/review\//.test(t.url),
  search: (t) => /\/api\/find\//.test(t.url),
  inbox: (t) => /\/api\/replies/.test(t.url),
  usage: (t) => /\/api\/usage\?|\/api\/waiting/.test(t.url),
  ports: (t) => /\/api\/ports/.test(t.url),
  archive: (t) => /\/api\/archive|\/api\/search/.test(t.url),
  // The notes write the one key they keep; the saved arrangement names the
  // notes panel too, and is not the notes asking for anything.
  notes: (t) => t.method === "PUT" && /\/api\/prefs$/.test(t.url) && Object.prototype.hasOwnProperty.call(prefsBody(t), "notes"),
};
function prefsBody(t) {
  try {
    const parsed = JSON.parse(t.body || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
await run(`${HELPERS}
  await hideAll(); await openSession(/plxr-stripes-check/); await wait(1200);
  for (const id of TOOL_IDS) { if (!toolLit(id)) await click(id, 900); }
  await hideAll();
`);
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
await sleep(10000);
const since = (from) => traffic.filter((t) => t.at >= from && t.url);
const quiet = since(quietFrom);
const idle = {
  ...Object.fromEntries(Object.entries(TOOL_ASKS).map(([id, asks]) => [id, quiet.filter(asks).length])),
  openChanges: openChanges(),
  otherRequests: quiet.length,
  prefsWrites: quiet.filter((t) => t.method === "PUT" && /\/api\/prefs$/.test(t.url)).map((t) => Object.keys(prefsBody(t)).join("+")),
};
/* Brought back, each picks up: the tree asks git at once and then on its
   beat, the ports, what has changed and the usage ask again. */
const treeFrom = Date.now();
await run(`${HELPERS} await click('files', 400); await click('ports', 400);`);
await sleep(5000);
const treeAsks = since(treeFrom).filter(TOOL_ASKS.files);
const portsAsks = since(treeFrom).filter(TOOL_ASKS.ports);
const restFrom = Date.now();
await run(`${HELPERS} await click('changes', 400); await click('usage', 400);`);
await sleep(5000);
const busy = {
  files: treeAsks.length,
  filesFirstAfterMs: treeAsks.length ? treeAsks[0].at - treeFrom : null,
  ports: portsAsks.length,
  changes: since(restFrom).filter((t) => /\/ws\/changes\//.test(t.url)).length,
  usage: since(restFrom).filter((t) => /\/api\/usage\?/.test(t.url)).length,
  openChanges: openChanges(),
};
claim(
  "with every edge hidden for ten seconds, no tool asks the service for anything — the tree and the notes, which stay mounted, included",
  Object.keys(TOOL_ASKS).every((id) => idle[id] === 0) && idle.openChanges === 0,
  JSON.stringify(idle),
);
claim(
  "shown again, each picks up: the tree asks git at once and on its beat, the ports, the changes and the usage ask again",
  busy.files >= 2 && busy.filesFirstAfterMs !== null && busy.filesFirstAfterMs <= 1500 && busy.ports > 0 && busy.changes > 0 && busy.usage > 0,
  JSON.stringify(busy),
);
await run(`${HELPERS} await hideAll();`);
await sleep(900);

// ---- what a tool had on screen comes back ---------------------------------------
/* A tool's body is taken down more often than it looks: a hidden tool that
   polls is not rendered at all, and every arrangement loaded makes every panel
   again, the tree and the notes with them. What each had on screen is kept for
   the life of the window (lib/toolMemory). A search typed and put away came
   back empty; a tree came back at the folder it was given, folded, at the top.
   The places scrolled to are far enough down that a box put back at the top
   cannot pass for one put back where it was. */
const MEMORY = `${HELPERS}
  const rowNamed = (id, n) => [...(win(id)?.querySelectorAll('.frow') ?? [])].find(r => (r.querySelector('.fname') || {}).textContent?.trim() === n);
  const unfolded = (id, n) => (rowNamed(id, n)?.querySelector('.fchev')?.innerHTML || '').includes('chevron-down');
  const typeInto = async (el, v) => { el.focus(); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); await wait(250); };
  const scroller = { files: () => win('files')?.querySelector('.filetree'), search: () => win('search')?.querySelector('.filesearch'), archive: () => win('archive')?.querySelector('.listbody'), notes: () => win('notes')?.querySelector('.cm-scroller') };
  const topOf = id => Math.round(scroller[id]()?.scrollTop ?? -1);
  const roomOf = id => { const el = scroller[id](); return el ? el.scrollHeight - el.clientHeight : -1; };
`;
const kept24 = await run(`${MEMORY}
  await hideAll(); await openSession(/plxr-stripes-check/); await wait(1200);
  await click('files', 900);
  if (!(await until(() => rowNamed('files', 'many'), 6000))) return { why: 'no folder "many" in the Files tool' };
  if (!unfolded('files', 'many')) rowNamed('files', 'many').click();
  await until(() => rowNamed('files', 'row-001.txt'), 4000);
  const before = { unfolded: unfolded('files', 'many'), child: Boolean(rowNamed('files', 'row-001.txt')) };
  document.activeElement?.blur?.();
  await key('b', { metaKey: true }); await wait(300);
  const hidden = !edgeBox('files');
  document.activeElement?.blur?.();
  await key('b', { metaKey: true }); await wait(600);
  const after = { shown: Boolean(edgeBox('files')), unfolded: unfolded('files', 'many'), child: Boolean(rowNamed('files', 'row-001.txt')) };
  await click('search', 900);
  const field = await until(() => win('search')?.querySelector('[data-do="find-what"]'), 6000);
  if (!field) return { why: 'no search field in the Search tool' };
  await typeInto(field, 'needle-row');
  win('search').querySelector('[data-do="find-go"]').click();
  await until(() => (win('search')?.querySelectorAll('.findline').length ?? 0) >= 100, 6000);
  await wait(300);
  const hits = win('search').querySelectorAll('.findline').length;
  document.activeElement?.blur?.();
  await click('search', 600);
  const unmounted = !edgeBox('search') && !win('search')?.querySelector('[data-do="find-what"]');
  await click('search', 900);
  const again = { query: win('search')?.querySelector('[data-do="find-what"]')?.value ?? null, hits: win('search')?.querySelectorAll('.findline').length ?? 0 };
  return { before, hidden, after, hits, unmounted, again };
`);
if (kept24.why) {
  unmeasured("tool memory through a hide and a show (claim 24)", kept24.why);
} else {
  const k = kept24;
  claim(
    "a folder unfolded in the Files tool is still unfolded after ⌘B twice",
    k.before.unfolded && k.before.child && k.hidden && k.after.shown && k.after.unfolded && k.after.child,
    JSON.stringify({ before: k.before, hidden: k.hidden, after: k.after }),
  );
  claim(
    "a query run in the Search tool is there again with its hits after the tool was hidden, its body gone, and shown",
    k.unmounted && k.again.query === "needle-row" && k.hits >= 100 && k.again.hits === k.hits,
    JSON.stringify({ hits: k.hits, unmounted: k.unmounted, again: k.again }),
  );
}

const scrolled = kept24.why
  ? null
  : await run(`${MEMORY}
  const res = {};
  scroller.search().scrollTop = 500; await wait(300);
  res.search = { set: topOf('search'), room: roomOf('search') };
  await click('search', 600); await click('search', 1000);
  res.search.back = topOf('search');
  await click('files', 1000);
  scroller.files().scrollTop = 600; await wait(300);
  res.files = { set: topOf('files'), room: roomOf('files') };
  await click('files', 600); await click('files', 1000);
  res.files.back = topOf('files');
  await click('changes', 900); await click('files', 1000);
  res.files.behindChanges = topOf('files');
  await click('archive', 1800);
  res.archive = { room: roomOf('archive') };
  if (res.archive.room > 150) {
    scroller.archive().scrollTop = 150; await wait(300);
    res.archive.set = topOf('archive');
    await click('archive', 600); await click('archive', 1800);
    res.archive.back = topOf('archive');
  }
  await click('notes', 1200);
  win('notes')?.querySelector('.cm-content')?.focus();
  return res;
`);
if (scrolled) {
  // Ninety lines, typed the way a keyboard types them.
  await cdp.send("Input.insertText", { text: Array.from({ length: 90 }, (_, i) => `note line ${i + 1}`).join("\n") });
  await sleep(1200);
  const notes = await run(`${MEMORY}
    scroller.notes().scrollTop = 400; await wait(300);
    const set = topOf('notes'); const room = roomOf('notes');
    document.activeElement?.blur?.();
    await click('notes', 600); await click('notes', 1200);
    return { set, room, back: topOf('notes') };
  `);
  const s = scrolled;
  const held = (x) => Boolean(x) && x.set > 0 && near(x.back, x.set, 2);
  const archive = s.archive.room > 150 ? `archive ${s.archive.set} → ${s.archive.back}` : `the archive has ${s.archive.room}px to scroll here and is not measured`;
  claim(
    "scrolled and put away, each tool comes back where it was read to: the tree through a hide and with another tool in front of it, the search results, the archive, the notes",
    held(s.search) && held(s.files) && near(s.files.behindChanges, s.files.set, 2) && (s.archive.room <= 150 || held(s.archive)) && held(notes),
    `search ${s.search.set} → ${s.search.back} · tree ${s.files.set} → ${s.files.back}, with Changes in front meanwhile → ${s.files.behindChanges} · ${archive} · notes ${notes.set} → ${notes.back}`,
  );

  /* An arrangement loaded again: the layout reset. The tree walks into a
     folder, filters and scrolls, the archive filters, and the bodies that
     stay mounted are marked, so the claim knows they were made anew. */
  const remounted = await run(`${MEMORY}
    await click('files', 1000);
    const many = rowNamed('files', 'many');
    if (!many) return { why: 'no folder "many" to walk into' };
    const r = many.getBoundingClientRect();
    many.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 5, button: 2 }));
    await wait(300);
    const walk = [...document.querySelectorAll('body > .menu .menuItem')].find(x => (x.querySelector('.menuLabel')?.textContent || '').trim() === 'Show only this folder');
    if (!walk) { await closeMenu(); return { why: 'no "Show only this folder" in the row menu' }; }
    walk.click(); await wait(1200);
    await typeInto(win('files').querySelector('.filesbar input'), 'row-0');
    await wait(800);
    document.activeElement?.blur?.();
    scroller.files().scrollTop = 300; await wait(300);
    const before = { crumb: [...win('files').querySelectorAll('.crumb')].pop()?.textContent.trim() ?? '', filter: win('files').querySelector('.filesbar input')?.value ?? '', tree: topOf('files') };
    await click('archive', 1500);
    await typeInto(win('archive').querySelector('.listbar input'), 'kept-filter');
    document.activeElement?.blur?.();
    await wait(300);
    for (const id of ['files', 'notes']) { const b = win(id)?.querySelector('.toolBody > *'); if (b) b.dataset.gateMark = 'old'; }
    const reset = document.querySelector('[data-do="reset-layout"]');
    if (!reset) return { why: 'no reset-layout button' };
    reset.click();
    await wait(2000);
    // A body is read for the mark once its tool is on screen again: a tool not shown since the load has no body on the page at all.
    const mark = id => win(id)?.querySelector('.toolBody > *')?.dataset.gateMark ?? 'new';
    await click('files', 1500);
    const files = { mark: mark('files'), crumb: [...(win('files')?.querySelectorAll('.crumb') ?? [])].pop()?.textContent.trim() ?? '', filter: win('files')?.querySelector('.filesbar input')?.value ?? '', tree: topOf('files') };
    await click('search', 1200);
    const search = { query: win('search')?.querySelector('[data-do="find-what"]')?.value ?? null, hits: win('search')?.querySelectorAll('.findline').length ?? 0, results: topOf('search') };
    await click('archive', 1800);
    const archive = { filter: win('archive')?.querySelector('.listbar input')?.value ?? null };
    await click('notes', 1500);
    const notes = { mark: mark('notes'), text: /note line \\d+/.test(win('notes')?.querySelector('.cm-content')?.textContent || ''), editor: topOf('notes') };
    await hideAll();
    return { before, files, search, archive, notes };
  `);
  if (remounted.why) {
    unmeasured("an arrangement loaded again brings every tool back as it was", remounted.why);
  } else {
    const m = remounted;
    claim(
      "an arrangement loaded again makes the tool bodies anew, and each comes back as it was: the tree at the folder it walked to with its filter and its scroll, the search with its query, hits and scroll, the archive's filter, the notes' text and scroll",
      m.files.mark === "new" && m.notes.mark === "new" && m.before.crumb === "many" && m.files.crumb === "many" && m.files.filter === "row-0" && m.before.tree > 0 && near(m.files.tree, m.before.tree, 2) &&
        m.search.query === "needle-row" && m.search.hits >= 100 && near(m.search.results, s.search.set, 2) && m.archive.filter === "kept-filter" && m.notes.text && near(m.notes.editor, notes.set, 2),
      JSON.stringify(m),
    );
  }
}

// ---- a tool's own actions in its header, and no prompts ---------------------------
const heads = await run(`${HELPERS}
  const res = {};
  for (const id of TOOL_IDS) {
    if (!toolLit(id)) await click(id, 900);
    const w = win(id); const g = w.closest('.dv-groupview').getBoundingClientRect();
    const hide = w.querySelector('[data-do="tool-hide"]').getBoundingClientRect();
    const title = w.querySelector('.toolTitle').getBoundingClientRect();
    const acts = [...w.querySelectorAll('.toolActions [data-do]')];
    res[id] = { prompts: w.querySelectorAll('.prompt').length, actions: acts.map(a => a.dataset.do), edge: Math.round(g.width),
      inside: [hide, ...acts.map(a => a.getBoundingClientRect())].every(r => r.width > 0 && r.left >= g.left - 0.5 && r.right <= g.right + 0.5),
      clear: acts.every(a => title.right <= a.getBoundingClientRect().left + 0.5) };
  }
  return res;
`);
{
  const own = { projects: ["projects-reload"], files: ["files-refresh"], usage: ["usage-reload"], ports: ["ports-reload"] };
  const ids = Object.keys(heads);
  claim(
    "no tool window carries a prompt, and the tools with actions of their own wear them in the header: Files its refresh, Projects, Usage and Ports their reload",
    ids.length === 11 && ids.every((id) => heads[id].prompts === 0 && JSON.stringify(heads[id].actions) === JSON.stringify(own[id] ?? [])),
    ids.map((id) => `${id}: ${heads[id].prompts} prompts, ${heads[id].actions.join(",") || "no actions"}`).join(" · "),
  );
  claim(
    "the title, the actions and the — stay inside the edge and clear of each other, at the 320 pixel edge too",
    ids.every((id) => heads[id].inside && heads[id].clear) && heads.usage.edge <= 330 && heads.ports.edge <= 330,
    ids.map((id) => `${id} ${heads[id].edge}px: inside ${heads[id].inside}, clear ${heads[id].clear}`).join(" · "),
  );
}
const actionAsks = {};
for (const [id, name, re] of [["files", "files-refresh", /\/api\/files\//], ["ports", "ports-reload", /\/api\/ports/], ["usage", "usage-reload", /\/api\/usage\/accounts|\/api\/usage\?/]]) {
  // Past the ports' own four-second beat, so the request counted is the button's.
  await run(`${HELPERS} if (!toolLit('${id}')) await click('${id}', 1500); await wait(4300);`);
  const from = Date.now();
  await run(`${HELPERS} win('${id}')?.querySelector('.toolActions [data-do="${name}"]')?.click();`);
  await sleep(900);
  actionAsks[id] = traffic.filter((t) => t.at >= from && t.url && re.test(t.url)).length;
}
claim("each header action asks the service there and then: the tree reads its folders again, the ports and the usage ask again", Object.values(actionAsks).every((n) => n > 0), JSON.stringify(actionAsks));
await run(`${HELPERS} await hideAll();`);
await sleep(900);

// ---- main with nothing in it ------------------------------------------------------
/* Every document closed by its tab's close — a running session kept running
   when it asks — and main offers the board, a new session and the commands.
   Each opens what it names. */
const emptied = await run(`${HELPERS}
  await hideAll();
  for (let i = 0; i < 40; i++) {
    const close = document.querySelector('.dockHost .panelTabClose');
    if (!close) break;
    close.click();
    await wait(450);
    const keep = [...document.querySelectorAll('.ask .cardButtons .btn')].find(b => b.textContent.trim() === 'KEEP RUNNING');
    if (keep) { keep.click(); await wait(450); }
  }
  const mark = await until(() => document.querySelector('.dockHost .mainWatermark'), 3000);
  return { tabs: gridTabs(), mark: box(mark), host: host(),
    buttons: mark ? [...mark.querySelectorAll('[data-do^="watermark-"]')].map(b => b.dataset.do + ' ' + b.textContent.trim()) : [] };
`);
await snap("main-empty");
const fromMark = (which) => run(`${HELPERS}
  for (let i = 0; i < 6; i++) { const close = document.querySelector('.dockHost .panelTabClose'); if (!close) break; close.click(); await wait(450); }
  const mark = await until(() => document.querySelector('.dockHost .mainWatermark'), 3000);
  mark?.querySelector('[data-do="${which}"]')?.click();
  await wait(1000);
  const out = { tabs: gridTabs(), dialog: Boolean(document.querySelector('.backdrop .card .cardTitle')), palette: Boolean(document.querySelector('.paletteScrim .palette')), mark: Boolean(document.querySelector('.dockHost .mainWatermark')) };
  (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(500);
  return out;
`);
const boardFrom = await fromMark("watermark-board");
const sessionFrom = await fromMark("watermark-new");
const commandsFrom = await fromMark("watermark-commands");
await fromMark("watermark-board");
{
  const inside = emptied.mark && emptied.host && emptied.mark.x >= emptied.host.x - 1 && emptied.mark.x + emptied.mark.w <= emptied.host.x + emptied.host.w + 1;
  claim(
    "with every document closed main shows its empty state, with three buttons: Board ⌘1, New session ⌘N, Commands ⌘K",
    emptied.tabs.length === 0 && inside && emptied.buttons.join(" | ") === "watermark-board Board ⌘1 | watermark-new New session ⌘N | watermark-commands Commands ⌘K",
    `main's tabs ${emptied.tabs.join(", ") || "none"} · ${emptied.buttons.join(" | ") || "no buttons"} · note ${show(emptied.mark)} in the dock ${show(emptied.host)}`,
  );
  claim(
    "each opens what it names: the board in main, the new-session dialog, the command palette",
    boardFrom.tabs.includes("Overview") && !boardFrom.mark && sessionFrom.dialog && commandsFrom.palette,
    `board: tabs ${boardFrom.tabs.join(", ")}, empty state gone ${!boardFrom.mark} · new session: dialog ${sessionFrom.dialog} · commands: palette ${commandsFrom.palette}`,
  );
}

// ---- layouts and presets that know the tools --------------------------------------
/* A saved layout is main and the tool windows together: which tool shows on
   which edge, how big each edge is, where every tool stands, and main's
   documents as they were split. One is saved, everything is changed, and it is
   applied: all of it is measured back, and again after a reload. Then the four
   activities, each with the tools it is about, one per side and the bottom
   empty. Then layouts saved before a layout knew the tools: they still apply,
   keep their documents and leave his placement alone — and one that does not
   load leaves the window as it was. Driven through the LAYOUTS menu. */
const LAYOUTS = `${HELPERS}
  const layoutsButton = () => document.querySelector('.bar [data-do="layouts"]') || [...document.querySelectorAll('.bar .btn')].find(b => /^LAYOUTS$/.test(b.textContent.trim()));
  const labelOf = r => ((r.querySelector('.menuLabel') || {}).textContent || '').trim();
  const layoutRow = async (pick) => {
    if (document.querySelector('body > .menu')) await closeMenu();
    const button = layoutsButton();
    if (!button) return null;
    button.click();
    const row = await until(() => [...document.querySelectorAll('body > .menu .menuItem')].find(pick), 2000);
    if (!row) await closeMenu();
    return row;
  };
  const layoutDo = async (doName, label) => {
    const row = await layoutRow(r => r.dataset.do === doName && (!label || labelOf(r) === label));
    if (!row) return false;
    row.click();
    await wait(1500);
    return true;
  };
  const edgeOfTool = id => ['left', 'right', 'bottom', 'bottomRight'].find(e => order(e).includes(id)) || null;
  const arrangement = () => {
    const lit = showing();
    const at = e => lit.find(t => edgeOfTool(t) === e) || null;
    const size = e => { const t = at(e); const b = t ? edgeBox(t) : null; return b ? (e === 'bottom' ? b.h : b.w) : 0; };
    return {
      shows: { left: at('left'), right: at('right'), bottom: at('bottom'), bottomRight: at('bottomRight') },
      size: { left: size('left'), right: size('right'), bottom: size('bottom'), bottomRight: size('bottomRight') },
      order: { left: order('left'), right: order('right'), bottom: order('bottom'), bottomRight: order('bottomRight') },
      main: gridGroups().filter(g => g.b.w > 0 && g.b.h > 0).map(g => ({ tabs: g.tabs, b: g.b })).sort((p, q) => p.b.x - q.b.x || p.b.y - q.b.y),
      tabs: gridTabs(),
    };
  };
`;
/* A left window's sash dragged to a width, the way a hand drags it. */
async function dragLeftEdge(tool, width) {
  const s = await run(`${HELPERS}
    const w = edgeBox(${JSON.stringify(tool)});
    if (!w) return null;
    const s = [...document.querySelectorAll('.dockHost .dv-sash')].map(el => box(el)).filter(b => b.w > 0 && b.h > b.w && Math.abs(b.x + b.w / 2 - (w.x + w.w)) < 8 && b.y <= w.y + w.h / 2 && b.y + b.h >= w.y + w.h / 2);
    return s.length ? { x: s[0].x + s[0].w / 2, y: w.y + w.h / 2, width: w.w } : null;
  `);
  if (!s) return null;
  const to = s.x + (width - s.width);
  await mouse("mouseMoved", s.x, s.y);
  await mouse("mousePressed", s.x, s.y, { button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 14; i++) {
    await mouse("mouseMoved", s.x + ((to - s.x) * i) / 14, s.y, { button: "left", buttons: 1 });
    await sleep(16);
  }
  await mouse("mouseReleased", to, s.y, { button: "left", buttons: 0, clickCount: 1 });
  await sleep(700);
  return run(`${HELPERS} return edgeBox(${JSON.stringify(tool)})?.w ?? null;`);
}
/* The bottom window's sash dragged to a height: the horizontal sash along its
   top edge, found where the window starts and across its middle. */
async function dragBottomEdge(tool, height) {
  const s = await run(`${HELPERS}
    const w = edgeBox(${JSON.stringify(tool)});
    if (!w) return null;
    const s = [...document.querySelectorAll('.dockHost .dv-sash')].map(el => box(el)).filter(b => b.h > 0 && b.w > b.h && Math.abs(b.y + b.h / 2 - w.y) < 8 && b.x <= w.x + w.w / 2 && b.x + b.w >= w.x + w.w / 2);
    return s.length ? { x: w.x + w.w / 2, y: s[0].y + s[0].h / 2, height: w.h } : null;
  `);
  if (!s) return null;
  const to = s.y - (height - s.height);
  await mouse("mouseMoved", s.x, s.y);
  await mouse("mousePressed", s.x, s.y, { button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 14; i++) {
    await mouse("mouseMoved", s.x, s.y + ((to - s.y) * i) / 14, { button: "left", buttons: 1 });
    await sleep(16);
  }
  await mouse("mouseReleased", s.x, to, { button: "left", buttons: 0, clickCount: 1 });
  await sleep(700);
  return run(`${HELPERS} return edgeBox(${JSON.stringify(tool)})?.h ?? null;`);
}
const sides = (a) =>
  a ? `left ${a.shows.left ?? "none"} ${a.size.left} · right ${a.shows.right ?? "none"} ${a.size.right} · bottom ${a.shows.bottom ?? "none"} ${a.size.bottom} · stripes ${a.order.left.join(",")} | ${a.order.right.join(",")} | ${a.order.bottom.join(",") || "-"} · main ${a.main.map((g) => g.tabs.join("+")).join(" | ")}` : "none";
const sameShows = (a, b) => Boolean(a && b) && ["left", "right", "bottom", "bottomRight"].every((e) => a.shows[e] === b.shows[e] && near(a.size[e], b.size[e]));
const sameOrder = (a, b) => Boolean(a && b) && JSON.stringify(a.order) === JSON.stringify(b.order);
const sameMain = (a, b, tol = 2) => Boolean(a && b) && a.main.length === b.main.length && a.main.every((g, i) => g.tabs.join("+") === b.main[i].tabs.join("+") && boxNear(g.b, b.main[i].b, tol));
const sameTabs = (a, b) => Boolean(a && b) && JSON.stringify(a.main.map((g) => g.tabs.join("+"))) === JSON.stringify(b.main.map((g) => g.tabs.join("+")));
/* JSON compared as data: the service hands objects back with their keys sorted. */
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0))) : x));
const DEFAULT_ORDER = { left: ["projects", "files", "changes", "search", "review"], right: ["inbox", "usage", "accounts", "ports", "archive", "notes"], bottom: [], bottomRight: [] };
const bottomSpotNow = () => run(`${HELPERS} const b = box(document.querySelector('.stripe[data-edge="bottom"]')); return { x: b.x + 90, y: b.y + b.h / 2 };`);

await view(1600);
await api("/api/prefs", { method: "PUT", body: JSON.stringify({ toolLayout: null, dockPresets: null, dockActivity: null }) });
await load();
// Main: the board, and two editors opened from the Files tool and split side by side.
const presetSetup = await run(`${LAYOUTS}
  await hideAll();
  for (let i = 0; i < 12; i++) {
    const tab = [...document.querySelectorAll('.plxrDock .dv-tab')].find(t => (t.querySelector('.panelTabName') || {}).textContent?.trim() !== 'Overview');
    const close = tab?.querySelector('.panelTabClose');
    if (!close) break;
    close.click(); await wait(450);
    const keep = [...document.querySelectorAll('.ask .cardButtons .btn')].find(b => b.textContent.trim() === 'KEEP RUNNING');
    if (keep) { keep.click(); await wait(450); }
  }
  if (!tabNamed('Overview')) { await openDoc('overview'); await wait(900); }
  await click('files', 900);
  const row = n => [...(win('files')?.querySelectorAll('.frow') ?? [])].find(r => (r.querySelector('.fname') || {}).textContent?.trim() === n);
  if (!(await until(() => row('alpha.txt'), 6000))) return { why: 'alpha.txt is not in the Files tool' };
  row('alpha.txt').click();
  await until(() => tabNamed('alpha.txt'), 5000); await wait(700);
  row('beta.txt').click();
  await until(() => tabNamed('beta.txt'), 5000); await wait(700);
  const tab = tabNamed('beta.txt').querySelector('.panelTab'); const r = tab.getBoundingClientRect();
  tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 8, button: 2 }));
  const split = await until(() => [...document.querySelectorAll('body > .menu .menuItem')].find(b => labelOf(b) === 'Split to the right'), 2000);
  if (!split) { await closeMenu(); return { why: 'no Split to the right row on the beta.txt tab' }; }
  split.click(); await wait(900);
  return { main: arrangement().main };
`);
let presetSaved = null;
let presetItem = null;
if (presetSetup.why) {
  unmeasured("a saved layout brings back every edge, size, placement and document", presetSetup.why);
} else {
  const dragged = await dragLeftEdge("files", 400);
  await carry("inbox", await bottomSpotNow());
  presetSaved = await run(`${LAYOUTS}
    await click('usage', 900);
    await click('inbox', 900);
    const before = arrangement();
    if (!(await layoutDo('save-layout'))) return { why: 'no Save current as… row under LAYOUTS' };
    const ask = await until(() => document.querySelector('.card.ask input'), 2000);
    if (!ask) return { why: 'Save current as… asked for no name' };
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(ask, 'tools-on-edges');
    ask.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.card.ask button')].find(b => b.textContent.trim() === 'SAVE')?.click();
    await wait(900);
    return { before };
  `);
  presetSaved.dragged = dragged;
  await sleep(700);
  presetItem = ((await api("/api/prefs")).dockPresets?.items ?? []).find((p) => p.name === "tools-on-edges") ?? null;
  if (presetSaved.why) unmeasured("a saved layout brings back every edge, size, placement and document", presetSaved.why);
  else if (!presetItem) unmeasured("a saved layout brings back every edge, size, placement and document", "no preset tools-on-edges in prefs.dockPresets after SAVE");
}
if (presetSaved && !presetSaved.why && presetItem) {
  const before = presetSaved.before;
  const split = before.main.filter((g) => g.tabs.includes("alpha.txt") || g.tabs.includes("beta.txt"));
  claim(
    "set up to be saved: Files lit on the left dragged to 400 px, Usage on the right, Inbox carried to the bottom stripe and lit there, and two editors split side by side in main",
    near(presetSaved.dragged, 400) && before.shows.left === "files" && near(before.size.left, 400) && before.shows.right === "usage" && before.shows.bottom === "inbox" && before.order.bottom[0] === "inbox" &&
      split.length === 2 && split[0].tabs.join() !== split[1].tabs.join() && near(split[0].b.y, split[1].b.y, 1) && split[0].b.x < split[1].b.x,
    sides(before),
  );
  const eg = presetItem.layout?.edgeGroups ?? {};
  claim(
    "the saved layout carries where every tool stands (Inbox first on the bottom), the edges' sizes, and main with the tool windows showing at their edges",
    presetItem.tools?.order?.bottom?.[0] === "inbox" && canon(presetItem.tools.order) === canon(before.order) && near(presetItem.sizes?.left, 400) &&
      eg.left?.visible && near(eg.left?.size, 400) && eg.left?.group?.activeView === "files" && eg.right?.visible && eg.right?.group?.activeView === "usage" && eg.bottom?.visible && eg.bottom?.group?.views?.includes("inbox"),
    `tools ${JSON.stringify(presetItem.tools?.order)} · sizes ${JSON.stringify(presetItem.sizes)} · edges ${["left", "right", "bottom"].map((e) => `${e} ${eg[e]?.visible ? "shown" : "hidden"} ${eg[e]?.size} ${eg[e]?.group?.activeView ?? "-"}`).join(" · ")}`,
  );

  // Everything changed: every tool back where it started, Changes on the left dragged to 300 px, Notes on the right, the editors closed.
  const resetRow = await run(`${LAYOUTS} await hideAll(); const ok = await layoutDo('reset-tools'); await click('changes', 900); return ok;`);
  const narrower = await dragLeftEdge("changes", 300);
  const changed = await run(`${LAYOUTS}
    await click('notes', 900);
    for (const n of ['alpha.txt', 'beta.txt']) { tabNamed(n)?.querySelector('.panelTabClose')?.click(); await wait(500); }
    await wait(400);
    return arrangement();
  `);
  claim(
    "then everything is changed: Reset tool positions under LAYOUTS puts Inbox back on the right, Changes shows on the left at 300 px, Notes on the right, nothing on the bottom, and the editors are closed",
    resetRow && near(narrower, 300) && changed.shows.left === "changes" && changed.shows.right === "notes" && !changed.shows.bottom && changed.order.bottom.length === 0 && !changed.tabs.includes("alpha.txt") && !changed.tabs.includes("beta.txt"),
    `reset row ${resetRow} · ${sides(changed)}`,
  );

  const applied = await run(`${LAYOUTS} const ok = await layoutDo('apply-layout', 'Apply tools-on-edges'); await wait(700); return { ok, after: arrangement() };`);
  await sleep(900);
  const appliedPrefs = await api("/api/prefs");
  const a = applied.after;
  claim(
    "applied from LAYOUTS, every edge shows what it showed at the size it had: Files on the left at 400 px, Usage on the right, Inbox on the bottom",
    applied.ok && sameShows(a, before) && near(a.size.left, 400),
    `saved: ${sides(before)} · applied: ${sides(a)}`,
  );
  const appliedSpan = await run(`${HELPERS}
    const at = e => box(document.querySelector('.stripe[data-edge="' + e + '"]'));
    return { L: edgeBox('files'), R: edgeBox('usage'), B: edgeBox('inbox'), lS: at('left'), rS: at('right'), bS: at('bottom') };
  `);
  claim(
    "applied, the three sizes are the layout's — left and right widths, the bottom's height — and the bottom window runs under both side windows from stripe to stripe",
    fullWidth(appliedSpan) && ["left", "right"].every((e) => near(appliedSpan[e === "left" ? "L" : "R"]?.w, presetItem.layout?.edgeGroups?.[e]?.size)) && near(appliedSpan.B?.h, presetItem.layout?.edgeGroups?.bottom?.size),
    `saved ${["left", "right", "bottom"].map((e) => `${e} ${presetItem.layout?.edgeGroups?.[e]?.size}`).join(" · ")} · ${spanText(appliedSpan)}`,
  );
  claim(
    "applied, every tool stands where it stood — Inbox first on the bottom stripe again — and prefs.toolLayout says so",
    sameOrder(a, before) && appliedPrefs.toolLayout?.order?.bottom?.[0] === "inbox" && canon(appliedPrefs.toolLayout?.order) === canon(before.order),
    `stripes ${JSON.stringify(a.order)} · prefs.toolLayout ${JSON.stringify(appliedPrefs.toolLayout?.order)}`,
  );
  claim(
    "applied, main's documents are back as they were split: the board and the two editors side by side, each group within 2 px of its saved box",
    sameMain(a, before),
    `saved ${before.main.map((g) => `${g.tabs.join("+")} ${show(g.b)}`).join(" | ")} · applied ${a.main.map((g) => `${g.tabs.join("+")} ${show(g.b)}`).join(" | ")}`,
  );
  claim("applied, the width remembered for the left edge is the preset's: prefs.dockSizes.left is 400", near(appliedPrefs.dockSizes?.left, 400), `dockSizes ${JSON.stringify(appliedPrefs.dockSizes)}`);
  await load();
  const reloaded = await run(`${LAYOUTS} return arrangement();`);
  claim("the applied layout holds through a reload: the same windows, sizes, placement and documents", sameShows(reloaded, before) && sameOrder(reloaded, before) && sameMain(reloaded, before), sides(reloaded));

  // ---- the activities ----
  await run(`${LAYOUTS} await hideAll(); await layoutDo('reset-tools');`);
  const activities = {};
  for (const act of ["focus", "code", "review", "monitor"]) {
    activities[act] = await run(`${LAYOUTS} const ok = await layoutDo('arrange-${act}'); await wait(400); return { ok, ...arrangement() };`);
  }
  const only = (x, want) => x.ok && ["left", "right", "bottom"].every((e) => x.shows[e] === (want[e] ?? null)) && JSON.stringify(x.tabs) === '["Overview"]' && x.order.bottom.length === 0;
  const wants = { focus: {}, code: { left: "files" }, review: { left: "changes" }, monitor: { right: "inbox" } };
  claim(
    "each activity under LAYOUTS puts the board alone in main and shows the tools it is about, one per side and none on the empty bottom: Focus none, Code Files on the left, Review Changes on the left, Monitor the Inbox on the right, where Usage shares its edge",
    Object.entries(wants).every(([act, want]) => only(activities[act], want)),
    Object.entries(activities).map(([act, x]) => `${act}: ${x.ok ? "" : "no row · "}${sides(x)}`).join(" || "),
  );
  await carry("inbox", await bottomSpotNow());
  const monitorMoved = await run(`${LAYOUTS} const ok = await layoutDo('arrange-monitor'); await wait(400); return { ok, ...arrangement() };`);
  claim(
    "with the Inbox carried to the bottom stripe, Monitor shows it there and Usage on the right, an edge of its own now: his placement wins",
    monitorMoved.ok && monitorMoved.shows.bottom === "inbox" && monitorMoved.shows.right === "usage" && !monitorMoved.shows.left,
    sides(monitorMoved),
  );
  await run(`${LAYOUTS} await layoutDo('arrange-focus'); await hideAll(); await layoutDo('reset-tools');`);

  // ---- layouts saved before a layout knew the tools ----
  /* The layout just saved, as it was written before it carried a placement and
     sizes, and one whose group dockview refuses; both beside the new one. */
  const broken = { grid: { root: { type: "branch", data: [{ type: "leaf", data: { id: 7, views: [] }, size: 800 }], size: 900 }, width: 800, height: 900, orientation: "HORIZONTAL" }, panels: {} };
  await api("/api/prefs", {
    method: "PUT",
    body: JSON.stringify({
      toolLayout: null,
      dockPresets: { dvMajor: 8, items: [presetItem, { name: "edges-only", layout: presetItem.layout }, { name: "broken", layout: broken, tools: { v: 1, order: { left: [], right: [], bottom: ["files"] } } }] },
    }),
  });
  await load();
  const edgesOnly = await run(`${LAYOUTS} const ok = await layoutDo('apply-layout', 'Apply edges-only'); await wait(700); return { ok, ...arrangement() };`);
  await sleep(900);
  const edgesPrefs = await api("/api/prefs");
  const kept = (edgesPrefs.dockPresets?.items ?? []).find((p) => p.name === "edges-only");
  claim(
    "a layout saved without a placement still applies: main's documents come back split as they were, every tool is at an edge once, his placement stays (Inbox on the right, the bottom empty), Files shows at its saved 400 px, and the layout is not rewritten",
    edgesOnly.ok && sameTabs(edgesOnly, before) && onceEach(placed(edgesPrefs.dock)) && settledPlaces(edgesOnly.order) === DEFAULT_PLACES && !edgesOnly.shows.bottom &&
      edgesOnly.shows.left === "files" && near(edgesOnly.size.left, 400) && kept && !("tools" in kept) && !("sizes" in kept) && canon(edgesPrefs.toolLayout?.order ?? DEFAULT_ORDER) === canon(DEFAULT_ORDER),
    `${sides(edgesOnly)} · every tool once ${onceEach(placed(edgesPrefs.dock))} · prefs.toolLayout ${JSON.stringify(edgesPrefs.toolLayout?.order)} · kept as saved ${Boolean(kept) && !("tools" in kept)}`,
  );
  const brokenApplied = await run(`${LAYOUTS} const was = arrangement(); const ok = await layoutDo('apply-layout', 'Apply broken'); await wait(700); return { ok, was, now: arrangement() };`);
  await sleep(900);
  const brokenPrefs = await api("/api/prefs");
  claim(
    "a saved layout that does not load changes nothing: main keeps its documents, every tool keeps its edge and its window, and the placement it carried is not taken",
    brokenApplied.ok && sameTabs(brokenApplied.now, brokenApplied.was) && sameShows(brokenApplied.now, brokenApplied.was) && sameOrder(brokenApplied.now, brokenApplied.was) && canon(brokenPrefs.toolLayout?.order ?? DEFAULT_ORDER) === canon(DEFAULT_ORDER) && onceEach(placed(brokenPrefs.dock)),
    `before ${sides(brokenApplied.was)} · after ${sides(brokenApplied.now)} · every tool once ${onceEach(placed(brokenPrefs.dock))} · prefs.toolLayout ${JSON.stringify(brokenPrefs.toolLayout?.order)}`,
  );
}

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
  /* Applied as a preset: the tools it names are put on their edges, never
     copied; its documents land in main; it carries no placement, so his stays;
     and it is repaired each time it is applied, never rewritten. */
  const preset = await run(`${LAYOUTS}
    if (!layoutsButton()) return { why: 'no LAYOUTS button' };
    const row = await layoutRow(r => labelOf(r) === 'Apply old');
    if (!row) return { why: 'no Apply old row' };
    row.click(); await wait(1200);
    return { tabs: gridTabs(), editor: Boolean(document.querySelector('.plxrDock .editorPanel')), bottom: order('bottom') };
  `);
  await sleep(900);
  const presetPrefs = preset.why ? null : await api("/api/prefs");
  const afterPreset = preset.why ? null : placed(presetPrefs.dock);
  const oldKept = presetPrefs?.dockPresets?.items?.[0];
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
      `${name}: applied as a preset, no tool is copied and none lands in main, ${wantEditor ? "its editor is in main, " : ""}his placement stays (Inbox on the bottom) and the preset is not rewritten`,
      onceEach(afterPreset) && !preset.tabs.some((t) => TOOL_TITLES.includes(t)) && preset.tabs.length > 0 && (!wantEditor || preset.editor) &&
        preset.bottom[0] === "inbox" && presetPrefs.toolLayout?.order?.bottom?.[0] === "inbox" && oldKept && canon(oldKept) === canon({ name: "old", layout: dock }),
      `at the edges ${afterPreset.edges.join(",")} · in main ${afterPreset.main.join(", ")} · tabs ${preset.tabs.join(", ")} · editor ${preset.editor} · bottom stripe ${preset.bottom.join(",")} · preset as saved ${Boolean(oldKept) && canon(oldKept) === canon({ name: "old", layout: dock })}`,
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
