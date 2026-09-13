/* Do the four regions and the tabs in them do what they say?
 *
 * The window manager stopped being three lanes that grow and became four
 * regions that do not:
 *
 *     [ menu ][ left ][      main      ][ right ]
 *     [                bottom                   ]
 *
 * That shape is a set of promises, and every one of them is broken in a way
 * nobody notices from the code — a column too many, a region that takes its
 * neighbour's width when something closes, a menu click that stacks a tab
 * instead of swapping what the side shows, a panel that is carried to the
 * bottom and lands under one column instead of across all of them. So each is
 * driven the way somebody drives it and then measured on the screen:
 *
 *   the menu stands beside the grid and is none of its columns;
 *   the tab menu carries close, close others, close group, float or dock,
 *     the four regions with the one it is in ticked, the two splits and the
 *     title, in that order;
 *   "close others in group" leaves one tab;
 *   float lifts a panel out and dock puts it back in its OWN region;
 *   "move to" carries a panel to each of the four and it lands there — held
 *     against the boxes of the other groups, not against a class name;
 *   the choice sticks: closed and opened again, it comes back where it was put;
 *   nothing makes a fourth column;
 *   the regions keep their width when a neighbour comes and goes, and main is
 *     the one that gives and takes the space;
 *   the same menu entry twice puts a tool away but never a panel in main;
 *   a second tool replaces the first in a side region and leaves an editor
 *     with unsaved work alone;
 *   ⌘B, ⌥⌘B and ⌘J fold a tool region away and bring the same panels back;
 *   ⌘W goes through the guard, ⌥⌘← → walk the panels, ⌥⌘↑ ↓ the groups.
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
const before = await api("/api/prefs").catch(() => ({}));
const held = { dock: before?.dock ?? null, dockRegions: before?.dockRegions ?? null };
await api("/api/prefs", { method: "PUT", body: JSON.stringify({ dock: null, dockRegions: null }) }).catch(() => undefined);

const port = 9500 + Math.floor(Number(process.pid) % 400);
const profile = mkdtempSync(join(tmpdir(), "plxr-tabs-"));
/* 1600 wide because that is the window the regions were measured in: three
   columns and a bottom one all have room, and a region squeezed against its
   minimum would prove nothing about the sizes it is supposed to keep. */
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
   hand — that is the thing a menu click in a side region must not throw away. */
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
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const pending = waiting.get(msg.id);
      if (pending) {
        waiting.delete(msg.id);
        msg.error ? pending.reject(new Error(msg.error.message)) : pending.resolve(msg.result);
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
    const up = await run("return document.querySelectorAll('.railhome').length").catch(() => 0);
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
 * rendered outside .plxrDock, so tabs are looked for in the whole document
 * while the grid's groups are looked for inside the dock. A right-click is
 * the contextmenu event on the tab's own element, and keys are keydown events
 * on whatever has focus, read by the same window listener a real key reaches.
 */
const HELPERS = `
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const box = el => { const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const nameOf = t => (t.querySelector('.panelTabName') || { textContent: '' }).textContent.trim();
  const tabs = () => [...document.querySelectorAll('.dv-tab')];
  const tabNamed = n => tabs().find(t => nameOf(t) === n);
  const tabLike = re => tabs().find(t => re.test(nameOf(t)));
  const names = () => tabs().map(nameOf);
  const groups = () => [...document.querySelectorAll('.plxrDock .dv-groupview')].filter(g => !g.closest('.dv-resize-container'));
  const groupOf = n => { const t = tabNamed(n); return t ? t.closest('.dv-groupview') : null; };
  const tabsIn = n => { const g = groupOf(n); return g ? [...g.querySelectorAll('.panelTabName')].map(e => e.textContent.trim()) : []; };
  const boxOf = n => { const g = groupOf(n); return g ? box(g) : null; };
  const shot = () => groups().map(g => ({ tabs: [...g.querySelectorAll('.panelTabName')].map(e => e.textContent.trim()), b: box(g) }));
  /* A column is a left edge: two groups stacked in the same lane are one
     column, which is the thing that was never allowed to become a fourth. */
  const columns = () => [...new Set(groups().map(g => Math.round(g.getBoundingClientRect().left)))].length;
  const railBox = () => box(document.querySelector('.railHost'));
  const dockBox = () => box(document.querySelector('.plxrDock'));
  const remPx = v => Math.round(parseFloat(v) * parseFloat(getComputedStyle(document.documentElement).fontSize));
  const declaredRail = () => remPx(getComputedStyle(document.documentElement).getPropertyValue('--rail-w').trim());
  const floatingGroups = () => document.querySelectorAll('.dv-resize-container:not(.dv-hidden) .dv-groupview').length;
  const isFloating = n => { const t = tabNamed(n); return Boolean(t && t.closest('.dv-resize-container')); };
  const railRow = n => [...document.querySelectorAll('.railitem')].find(e =>
    ((e.querySelector('.rname') || { textContent: '' }).textContent.trim() === n));
  const railLike = re => [...document.querySelectorAll('.railitem')].find(e => re.test(e.textContent || ''));
  /* A click in the menu, the way he clicks it — nothing else. What it does is
     the window's business and is measured afterwards. */
  const clickMenu = async (n, ms) => { const row = railRow(n) || railLike(new RegExp(n)); if (!row) throw new Error('no menu row ' + n); row.click(); await wait(ms || 900); };
  /* The same click opens, focuses or puts away, which is the whole point of it
     — so where a step only needs a view to BE on screen for the next claim,
     this opens it when it is not there and brings it forward when it is,
     rather than clicking blind and closing what it wanted. */
  const showView = async (n, ms) => {
    const t = tabNamed(n);
    if (t) { await activate(t); return tabNamed(n); }
    await clickMenu(n, ms);
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
  const ticked = () => menuRows().filter(r => r.checked === 'true').map(r => r.label);
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
  const activeTab = () => { const t = document.querySelector('.dv-groupview.dv-active-group .dv-tab.dv-active-tab'); return t ? nameOf(t) : ''; };
  const activeGroupTabs = () => { const g = document.querySelector('.dv-groupview.dv-active-group');
    return g ? [...g.querySelectorAll('.panelTabName')].map(e => e.textContent.trim()) : []; };
  const byText = (sel, re) => [...document.querySelectorAll(sel)].find(e => re.test(e.textContent.trim()));
  /* Which region every panel on screen is in, read off the screen and not
     asked of the code: the columns in reading order, and whatever sits under
     them. Only told with all three columns up — with fewer, which of them is
     main is not a thing the screen says, and a guess is not a measurement. */
  const regionMap = () => {
    const all = groups().map(g => ({ names: [...g.querySelectorAll('.panelTabName')].map(e => e.textContent.trim()), b: box(g) }));
    if (!all.length) return { why: 'no groups' };
    const top = Math.min(...all.map(x => x.b.y));
    const row = all.filter(x => x.b.y <= top + 2).sort((a, b) => a.b.x - b.b.x);
    const under = all.filter(x => x.b.y > top + 2);
    if (row.length !== 3) return { why: row.length + ' columns, not three' };
    const out = {};
    const put = (e, r) => { for (const n of e.names) out[n] = r; };
    put(row[0], 'left'); put(row[1], 'main'); put(row[2], 'right');
    for (const u of under) put(u, 'bottom');
    return out;
  };
`;

// ---- the menu is the frame, not a column ------------------------------------
/* It was a panel in the grid: it could be tabbed into, closed, dragged away,
   and it took its share whenever a column closed — which is how it ended up
   half the window. Beside the grid it is none of the dock's columns. */
const frame = await run(`${HELPERS}
  const rail = railBox();
  const dock = dockBox();
  return {
    rail, dock,
    items: document.querySelectorAll('.railHost .railitem').length,
    inGrid: document.querySelectorAll('.plxrDock .railhome').length,
    railTab: names().filter(n => /^plxr$/i.test(n)).length,
    leftmost: Math.min(...groups().map(g => Math.round(g.getBoundingClientRect().left))),
    declared: declaredRail(),
    tabs: names(),
  };
`);
claim(
  "the menu stands beside the grid, with none of its rows in the dock",
  frame.items > 0 && frame.inGrid === 0 && frame.railTab === 0,
  `${frame.items} rows in .railHost, ${frame.inGrid} inside .plxrDock, ${frame.railTab} tabs called plxr`,
);
claim(
  "and it is none of the dock's columns — the grid starts where the menu ends",
  frame.rail.x === 0 && frame.leftmost >= frame.rail.x + frame.rail.w && frame.dock.x >= frame.rail.x + frame.rail.w,
  `menu ${frame.rail.x}…${frame.rail.x + frame.rail.w}, dock from ${frame.dock.x}, leftmost group at ${frame.leftmost}`,
);
claim(
  "the menu keeps the width the frame declares",
  Math.abs(frame.rail.w - frame.declared) <= 1,
  `${frame.rail.w}px against --rail-w = ${frame.declared}px`,
);

// ---- nothing makes a fourth column, and the sizes hold -----------------------
/* The drive that produced both complaints: the menu open with the overview,
   then the inbox, then the folders, then the usage — and then the usage away
   again. "I want only three columns", and "why doesn't the first stay as it is
   and the second take the space back?". The folders are a view of main now,
   so they make no column at all; the changes stand in for a left region, so
   that one region opening beside another is still measured. Every region is
   measured at every step, and the numbers are printed rather than summarised. */
const drive = await run(`${HELPERS}
  const step = async (what, view) => {
    if (view) await clickMenu(view, view === 'Folders' ? 2200 : view === 'Changes' ? 1400 : 1100);
    const s = shot();
    const wide = {};
    for (const g of s) wide[g.tabs.join('+')] = g.b.w;
    return { what, rail: railBox().w, columns: columns(), wide,
             main: boxOf('Overview') ? boxOf('Overview').w : -1, boxes: s.map(g => ({ t: g.tabs.join('+'), x: g.b.x, w: g.b.w })) };
  };
  const out = [];
  out.push(await step('the overview alone'));
  out.push(await step('the inbox, on the right', 'Inbox'));
  out.push(await step('the folders, a tab in main', 'Folders'));
  out.push(await step('the changes, on the left', 'Changes'));
  out.push(await step('the usage, in the inbox\\u2019s place', 'Usage'));
  out.push(await step('the usage away again', 'Usage'));
  return out;
`);
const at = (i) => drive[i];
// The width of the group a panel is in, whatever else is tabbed beside it.
const widthOf = (s, name) => (s.boxes.find((b) => b.t.split("+").includes(name)) ?? {}).w ?? -1;
// "Keeps its width" is held to two pixels: dockview rounds a sash's position.
const near = (a, b) => a > 0 && b > 0 && Math.abs(a - b) <= 2;
const printed = drive.map((s) => `${s.what}: menu ${s.rail}, ${s.boxes.map((b) => `${b.t} ${b.w}`).join(", ")} (${s.columns} columns)`).join(" · ");

claim(
  "the drive that made a fourth column never makes one",
  drive.every((s) => s.columns <= 3),
  `columns: ${drive.map((s) => s.columns).join(" → ")}`,
);
claim(
  "the menu keeps its width through all of it and is never one of the columns",
  drive.every((s) => s.rail === frame.declared),
  `menu ${drive.map((s) => s.rail).join(", ")}px against --rail-w = ${frame.declared}px`,
);
claim(
  "opening a region on the right takes the space out of main and nothing else",
  widthOf(at(1), "Inbox") > 0 && near(at(1).main, at(0).main - widthOf(at(1), "Inbox")),
  `main ${at(0).main} → ${at(1).main}, inbox ${widthOf(at(1), "Inbox")}`,
);
const mainTabs = (s) => (s.boxes.find((b) => b.t.split("+").includes("Overview")) ?? { t: "" }).t;
claim(
  "the folders open as a tab of main and move nothing",
  mainTabs(at(2)).split("+").includes("Folders") &&
    at(2).columns === at(1).columns &&
    near(at(2).main, at(1).main) &&
    near(widthOf(at(2), "Inbox"), widthOf(at(1), "Inbox")),
  `main holds ${mainTabs(at(2))}, columns ${at(1).columns} → ${at(2).columns}, main ${at(1).main} → ${at(2).main}, right ${widthOf(at(1), "Inbox")} → ${widthOf(at(2), "Inbox")}`,
);
claim(
  "opening one on the left leaves the right one where it was, and main pays for it",
  near(widthOf(at(3), "Inbox"), widthOf(at(2), "Inbox")) && widthOf(at(3), "Changes") > 0 && near(at(3).main, at(2).main - widthOf(at(3), "Changes")),
  `right ${widthOf(at(2), "Inbox")} → ${widthOf(at(3), "Inbox")}, left ${widthOf(at(3), "Changes")}, main ${at(2).main} → ${at(3).main}`,
);
claim(
  "a second tool in the same region moves nothing at all",
  near(widthOf(at(4), "Usage"), widthOf(at(3), "Inbox")) && near(at(4).main, at(3).main) && near(widthOf(at(4), "Changes"), widthOf(at(3), "Changes")),
  `left ${widthOf(at(3), "Changes")} → ${widthOf(at(4), "Changes")}, main ${at(3).main} → ${at(4).main}, right ${widthOf(at(3), "Inbox")} → ${widthOf(at(4), "Usage")}`,
);
claim(
  "closing it gives the space back to main, with the untouched region untouched",
  near(widthOf(at(5), "Changes"), widthOf(at(4), "Changes")) && widthOf(at(5), "Usage") === -1 && near(at(5).main, at(4).main + widthOf(at(4), "Usage")),
  `left ${widthOf(at(4), "Changes")} → ${widthOf(at(5), "Changes")}, main ${at(4).main} → ${at(5).main} (it gave up ${widthOf(at(4), "Usage")})`,
);
claim("every width measured, step by step", true, printed);

// ---- the same entry twice ----------------------------------------------------
/* A menu swaps what the side shows and the same click puts it away. A panel in
   main is never toggled shut that way: closing the terminal you are working in
   because you clicked its name would be its own bug. */
const twice = await run(`${HELPERS}
  await clickMenu('Inbox', 1100);
  const toolOpened = Boolean(tabNamed('Inbox'));
  await clickMenu('Inbox', 1100);
  const toolClosed = !tabNamed('Inbox');
  const overviewThere = Boolean(tabNamed('Overview'));
  await clickMenu('Overview', 900);
  const firstClick = Boolean(tabNamed('Overview'));
  await clickMenu('Overview', 900);
  const secondClick = Boolean(tabNamed('Overview'));
  const active = activeTab();
  // The folders are a view of main now, and are not put away either.
  await clickMenu('Folders', 1500);
  const foldersFront = activeTab() === 'Folders';
  await clickMenu('Folders', 1100);
  const foldersStay = Boolean(tabNamed('Folders'));
  return { toolOpened, toolClosed, overviewThere, firstClick, secondClick, active, foldersFront, foldersStay };
`);
claim(
  "the same entry twice puts a tool in a side region away again",
  twice.toolOpened && twice.toolClosed,
  `opened ${twice.toolOpened}, gone on the second click ${twice.toolClosed}`,
);
claim(
  "but never a panel in main",
  twice.overviewThere && twice.firstClick && twice.secondClick && twice.foldersFront && twice.foldersStay,
  `the overview is still there after two clicks: ${twice.secondClick} (active: ${twice.active}); the folders, in front after the first: ${twice.foldersFront}, still there after the second: ${twice.foldersStay}`,
);

// ---- the four regions, and the tab menu that names them ----------------------
/* All four up at once, each with something known in it, so that what the menu
   ticks can be held against where the panel actually is on the screen. */
const four = await run(`${HELPERS}
  /* The changes hold the left region since the drive — brought forward, not
     clicked, so a click cannot put them away. */
  await showView('Changes', 1400);
  await clickMenu('Inbox', 1100);
  const usage = tabNamed('Usage') || (await clickMenu('Usage', 1100), tabNamed('Usage'));
  if (!usage) return { why: 'the usage view did not open' };
  await rightClick(tabNamed('Usage'));
  await pick('Bottom', 1100);
  await clickMenu('Inbox', 1100);
  const where = regionMap();
  const b = { left: boxOf('Changes'), main: boxOf('Overview'), right: boxOf('Inbox'), bottom: boxOf('Usage') };
  const marks = {};
  for (const n of ['Changes', 'Folders', 'Overview', 'Inbox', 'Usage']) {
    const t = tabNamed(n);
    if (!t) { marks[n] = ['no tab']; continue; }
    await rightClick(t);
    marks[n] = ticked();
    await closeMenu();
  }
  await rightClick(tabNamed('Overview'));
  const shape = menuShape();
  const rows = menuRows();
  await closeMenu();
  return { where, b, marks, shape, rows, columns: columns(), shot: shot() };
`);

if (four.why) {
  unmeasured("the four regions are on screen at once", four.why);
} else {
  const b = four.b;
  claim(
    "all four regions are on screen at once, in their own places",
    b.left && b.main && b.right && b.bottom &&
      b.left.x + b.left.w <= b.main.x + 2 &&
      b.right.x >= b.main.x + b.main.w - 2 &&
      b.bottom.y >= b.main.y + b.main.h - 2 &&
      b.bottom.w > b.main.w,
    `left ${b.left && b.left.x}+${b.left && b.left.w} · main ${b.main && b.main.x}+${b.main && b.main.w} · right ${b.right && b.right.x}+${b.right && b.right.w} · bottom y ${b.bottom && b.bottom.y} w ${b.bottom && b.bottom.w}`,
  );
  claim(
    "the tab menu reads close, close others, close group, float, the four regions, the two splits, maximise, copy title",
    JSON.stringify(four.shape) ===
      JSON.stringify([
        "Close",
        "Close others in group",
        "Close group",
        "---",
        "Float",
        "---",
        "# Move to",
        "Main",
        "Left",
        "Right",
        "Bottom",
        "---",
        "Split to the right",
        "Split downwards",
        "---",
        "Maximise",
        "---",
        "Copy title",
      ]),
    four.shape.join(" | "),
  );
  const oneEach = ["Changes", "Folders", "Overview", "Inbox", "Usage"].every((n) => (four.marks[n] ?? []).length === 1);
  claim("exactly one region is ticked on every tab", oneEach, JSON.stringify(four.marks));
  const TITLE = { left: "Left", main: "Main", right: "Right", bottom: "Bottom" };
  const mismatched = ["Changes", "Folders", "Overview", "Inbox", "Usage"].filter(
    (n) => (four.marks[n] ?? [])[0] !== TITLE[four.where[n]],
  );
  claim(
    "and the ticked one is the region the panel is actually in, measured on the screen",
    mismatched.length === 0 && !four.where.why,
    `screen says ${JSON.stringify(four.where)}, the menu ticks ${JSON.stringify(four.marks)}`,
  );
}

// ---- move to, all four, and the choice that sticks ---------------------------
/* Where a panel lives is his choice once he has made one. A move is held
   against the boxes of the other groups: left of main, right of main, below
   both and wider than main alone — not against a class name that could be
   right while the panel is in the wrong place. */
const carried = await run(`${HELPERS}
  const out = [];
  for (const region of ['Left', 'Bottom', 'Right']) {
    const t = tabNamed('Inbox');
    if (!t) { out.push({ region, why: 'no inbox tab' }); continue; }
    await rightClick(t);
    await pick(region, 1100);
    out.push({ region, b: { it: boxOf('Inbox'), main: boxOf('Overview') }, tabs: tabsIn('Inbox'), shot: shot() });
  }
  // Into main, where it becomes a tab beside the overview.
  await rightClick(tabNamed('Inbox'));
  await pick('Main', 1100);
  out.push({ region: 'Main', b: { it: boxOf('Inbox'), main: boxOf('Overview') }, tabs: tabsIn('Inbox'), shot: shot() });
  return out;
`);
const moveTo = (r) => carried.find((c) => c.region === r) ?? {};
const L = moveTo("Left");
const B = moveTo("Bottom");
const R = moveTo("Right");
const M = moveTo("Main");
claim(
  "move to the left puts the panel left of main",
  L.b && L.b.it && L.b.main && L.b.it.x + L.b.it.w <= L.b.main.x + 2,
  L.why ?? `inbox ${L.b?.it?.x}+${L.b?.it?.w} · main from ${L.b?.main?.x}`,
);
claim(
  "move to the bottom puts it under them all, spanning wider than main alone",
  B.b && B.b.it && B.b.main && B.b.it.y >= B.b.main.y + B.b.main.h - 2 && B.b.it.w > B.b.main.w,
  B.why ?? `inbox y ${B.b?.it?.y} w ${B.b?.it?.w} · main y ${B.b?.main?.y} h ${B.b?.main?.h} w ${B.b?.main?.w}`,
);
claim(
  "move to the right puts it right of main",
  R.b && R.b.it && R.b.main && R.b.it.x >= R.b.main.x + R.b.main.w - 2,
  R.why ?? `inbox ${R.b?.it?.x}+${R.b?.it?.w} · main ${R.b?.main?.x}+${R.b?.main?.w}`,
);
claim(
  "move to main tabs it beside what is worked on",
  M.tabs && M.tabs.includes("Inbox") && M.tabs.includes("Overview"),
  M.why ?? `the main group now holds ${JSON.stringify(M.tabs)}`,
);

const sticks = await run(`${HELPERS}
  await rightClick(tabNamed('Inbox'));
  await pick('Bottom', 1100);
  const put = boxOf('Inbox');
  await clickMenu('Inbox', 1100);
  const gone = !tabNamed('Inbox');
  await clickMenu('Inbox', 1200);
  const backAt = boxOf('Inbox');
  return { put, gone, backAt, main: boxOf('Overview'), where: regionMap(), shot: shot() };
`);
claim(
  "the choice sticks: closed and opened again from the menu, it comes back to the bottom",
  sticks.gone && sticks.backAt && sticks.main && sticks.backAt.y >= sticks.main.y + sticks.main.h - 2 && sticks.backAt.w > sticks.main.w,
  `put at y ${sticks.put?.y} w ${sticks.put?.w}, closed ${sticks.gone}, back at y ${sticks.backAt?.y} w ${sticks.backAt?.w} (main y ${sticks.main?.y} h ${sticks.main?.h} w ${sticks.main?.w})`,
);

// ---- float, and dock back into its own region --------------------------------
const floated = await run(`${HELPERS}
  const bottomBefore = boxOf('Inbox');
  await rightClick(tabNamed('Inbox'));
  await pick('Float', 1200);
  const up = { count: floatingGroups(), floating: isFloating('Inbox'), inGrid: Boolean(groupOf('Inbox') && !isFloating('Inbox')) };
  await rightClick(tabNamed('Inbox'));
  const shape = menuShape();
  const regionRows = menuRows().filter(r => ['Main', 'Left', 'Right', 'Bottom'].includes(r.label));
  await pick('Dock', 1200);
  const back = boxOf('Inbox');
  return { bottomBefore, up, shape, regionRows, back, left: floatingGroups(), main: boxOf('Overview'), shot: shot() };
`);
claim(
  "float lifts the panel out of the grid into a floating group",
  floated.up.count === 1 && floated.up.floating,
  `${floated.up.count} floating group(s), the panel is in one: ${floated.up.floating}`,
);
claim(
  "a floating panel's menu offers dock instead of float, and no region to move to",
  floated.shape.includes("Dock") && !floated.shape.includes("Float") && floated.regionRows.every((r) => r.disabled),
  `${floated.shape.join(" | ")} — region rows disabled: ${floated.regionRows.map((r) => r.disabled).join(",")}`,
);
claim(
  "dock puts it back into its own region, not merely somewhere in the grid",
  floated.left === 0 &&
    floated.back &&
    floated.main &&
    floated.back.y >= floated.main.y + floated.main.h - 2 &&
    floated.back.w > floated.main.w,
  `it was at y ${floated.bottomBefore?.y} w ${floated.bottomBefore?.w}, it is back at y ${floated.back?.y} w ${floated.back?.w}, ${floated.left} floating left`,
);

// ---- fold a region away, and the same panels come back -----------------------
/* A region that could only be closed lost what was in it. The chords fold it
   away and put back what stood there — so each is pressed twice, and the
   region's tabs, its box and main's box are read before, between and after. */
const folding = await run(`${HELPERS}
  /* Something known in each of the three: the changes on the left since the
     drive, the inbox docked back at the bottom, the ports on the right. */
  await showView('Changes', 1400);
  await showView('Inbox', 1100);
  await showView('Ports', 1400);
  const out = [];
  for (const [label, k, mods, name] of [
    ['left', 'b', { metaKey: true }, 'Changes'],
    ['right', 'b', { metaKey: true, altKey: true }, 'Ports'],
    ['bottom', 'j', { metaKey: true }, 'Inbox'],
  ]) {
    // Focus in main, so the chord is read by the window and not by a field.
    const front = tabNamed('Overview');
    if (front) await activate(front);
    const was = { tabs: tabsIn(name), b: boxOf(name), main: boxOf('Overview') };
    await key(k, mods); await wait(600);
    const folded = { gone: !tabNamed(name), main: boxOf('Overview'), left: names() };
    await key(k, mods); await wait(1100);
    const back = { tabs: tabsIn(name), b: boxOf(name), main: boxOf('Overview') };
    out.push({ label, name, was, folded, back });
  }
  return out;
`);
for (const f of folding) {
  const chord = { left: "⌘B", right: "⌥⌘B", bottom: "⌘J" }[f.label];
  const along = f.label === "bottom" ? "h" : "w";
  if (!f.was.b || !f.was.main) {
    unmeasured(`${chord} folds the ${f.label} region away and brings it back`, `${f.name} or the overview was not on screen to fold`);
    continue;
  }
  const gained = f.folded.main ? f.folded.main[along] - f.was.main[along] : NaN;
  claim(
    `${chord} folds the ${f.label} region away, and main takes the room`,
    f.folded.gone && Math.abs(gained - f.was.b[along]) <= 2,
    `${f.name} gone ${f.folded.gone} · it was ${f.was.b[along]}px ${along === "w" ? "wide" : "high"}, main ${f.was.main[along]} → ${f.folded.main?.[along]} (took ${gained}) · left on screen ${JSON.stringify(f.folded.left)}`,
  );
  const same = (a, b) => b && Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2 && Math.abs(a.w - b.w) <= 2 && Math.abs(a.h - b.h) <= 2;
  claim(
    `${chord} again brings the same panels back, where they were and as big`,
    JSON.stringify(f.back.tabs) === JSON.stringify(f.was.tabs) && same(f.was.b, f.back.b),
    `${JSON.stringify(f.was.tabs)} at ${f.was.b.x},${f.was.b.y} ${f.was.b.w}×${f.was.b.h} → ${JSON.stringify(f.back.tabs)} at ${f.back.b?.x},${f.back.b?.y} ${f.back.b?.w}×${f.back.b?.h}`,
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
  await showView('Overview', 900);
  await showView('Folders', 2500);
  const work = groupFacts('Folders');
  const row = n => [...document.querySelectorAll('.foldersbody .frow')].find(r => (r.querySelector('.fname') || { textContent: '' }).textContent.trim() === n);
  if (!row('alpha.txt')) return { why: 'alpha.txt is not in the folders\\u2019 tree' };
  const columnsBefore = columns();
  const groupsBefore = groups().length;
  row('alpha.txt').click(); await wait(2200);
  const one = { folders: groupFacts('Folders'), doc: groupFacts('alpha.txt'), apart: groupOf('alpha.txt') !== groupOf('Folders'),
                tree: seen(row('beta.txt'), groupFacts('Folders') && groupFacts('Folders').b), groups: groups().length };
  if (row('beta.txt')) { row('beta.txt').click(); await wait(1800); }
  const two = { folders: groupFacts('Folders'), doc: groupFacts('beta.txt'), withAlpha: groupOf('beta.txt') === groupOf('alpha.txt'), groups: groups().length, columns: columns() };
  if (row('gamma.txt')) { row('gamma.txt').click(); await wait(1800); }
  const three = { folders: groupFacts('Folders'), doc: groupFacts('gamma.txt'), withAlpha: groupOf('gamma.txt') === groupOf('alpha.txt'), groups: groups().length };
  return { work, columnsBefore, groupsBefore, one, two, three };
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
    // A view of main from the menu while a document is in front goes to the work.
    await activate(tabNamed('alpha.txt'));
    await clickMenu('Notes', 1100);
    const notes = { withFolders: groupOf('Notes') === groupOf('Folders'), withDocs: groupOf('Notes') === groupOf('alpha.txt'), docs: groupFacts('alpha.txt') };
    return { again, notes };
  `));
}
if (fromFolders.why) {
  unmeasured("a file clicked in the folders' tree opens beside the folders", fromFolders.why);
} else {
  const { work, one, two, three, again, notes } = fromFolders;
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
    "a view of main opened while a document is in front goes to the work, not over the documents",
    notes.withFolders && !notes.withDocs && !(notes.docs?.tabs ?? []).includes("Notes"),
    `notes beside the folders ${notes.withFolders}, among the documents ${notes.withDocs}`,
  );
}

/* The same from a session: its FILES tree stands beside its terminal, and a
   file picked there must leave the terminal on screen. The documents from the
   folders are closed first, so the editor has no group to join and has to
   make its own beside the terminal. */
const fromSession = await run(`${HELPERS}${groupFacts}
  const alpha = tabNamed('alpha.txt');
  if (alpha) { await rightClick(alpha); await pick('Close group', 1100); }
  const rowLink = railLike(/plxr-tabs-check/);
  if (!rowLink) return { why: 'the check\\u2019s session is not in the menu' };
  rowLink.click(); await wait(1800);
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
/* Two tools can no longer share a region by clicking twice — that is the point
   of the menu — so the two tabs this needs are two of the things that live in
   main: the files the editor opens. */
const many = await run(`${HELPERS}
  await showView('Folders', 2500);
  const alpha = byText('.frow', /alpha\\.txt/);
  if (!alpha) return { why: 'alpha.txt is not in the tree' };
  alpha.click(); await wait(2200);
  /* The editor opens beside the folders, which stay in front of their own
     group; they are brought forward all the same, in case a step before left
     something else there. */
  await showView('Folders', 900);
  const beta = byText('.frow', /beta\\.txt/);
  if (!beta) return { why: 'beta.txt is not in the tree' };
  beta.click(); await wait(2200);
  const before = tabsIn('alpha.txt');
  // The split first, while there are three tabs to split off from.
  await rightClick(tabNamed('beta.txt'));
  await pick('Split to the right', 1100);
  const split = { apart: groupOf('beta.txt') !== groupOf('alpha.txt'),
                  beta: boxOf('beta.txt'), alpha: boxOf('alpha.txt') };
  // And back, so what follows is about one group again.
  await rightClick(tabNamed('beta.txt'));
  await pick('Main', 1100);
  const rejoined = tabsIn('alpha.txt');
  await rightClick(tabNamed('alpha.txt'));
  await pick('Close others in group', 1100);
  const after = tabsIn('alpha.txt');
  return { before, split, rejoined, after, shot: shot() };
`);
if (many.why) {
  unmeasured("close others in group leaves one tab", many.why);
} else {
  claim(
    "split to the right puts the panel beside the one it was tabbed with",
    many.split.apart && many.split.beta && many.split.alpha && many.split.beta.x >= many.split.alpha.x + many.split.alpha.w - 2,
    `alpha ${many.split.alpha?.x}+${many.split.alpha?.w}, beta ${many.split.beta?.x}+${many.split.beta?.w}`,
  );
  claim(
    "close others in group leaves one tab",
    many.before.length >= 2 && many.after.length === 1 && many.after[0] === "alpha.txt",
    `${JSON.stringify(many.before)} → ${JSON.stringify(many.after)} (rejoined as ${JSON.stringify(many.rejoined)})`,
  );
}

/* The documents have a group of their own now, so a second file is opened into
   it again for the group to hold more than one panel — and the work beside it
   is held to still being there afterwards. */
const grouped = await run(`${HELPERS}
  await showView('Folders', 900);
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

// ---- a second tool replaces the first, and leaves the work alone -------------
/* "It is just as annoying that a tab always opens, that is not how a menu
   works." So one tool at a time in a side region — and an editor with unsaved
   work in that same region is not a tool and is not swept away with them. */
const swapped = await run(`${HELPERS}
  /* Close group took main away with it, and "sits in a side region" means
     nothing without main on screen to be beside — so the overview comes back
     first. Close group also left the folders as the tool in front, and a click
     on the tool in front puts it away, so the tree is brought forward rather
     than clicked shut. */
  await showView('Overview', 900);
  // A tool in the left region to be replaced, whatever the steps before left.
  await showView('Changes', 1400);
  await showView('Folders', 2500);
  const alpha = byText('.frow', /alpha\\.txt/);
  if (!alpha) return { why: 'alpha.txt is not in the tree' };
  alpha.click(); await wait(2200);
  const t = tabNamed('alpha.txt');
  if (!t) return { why: 'the editor did not open' };
  await rightClick(t);
  await pick('Left', 1100);
  const sideBox = boxOf('alpha.txt');
  const mainBox = boxOf('Overview');
  // Unsaved work in it: typed into the editor, not asserted about.
  const cm = document.querySelector('.cm-content');
  if (!cm) return { why: 'no editor surface to type into' };
  cm.focus();
  const sel = window.getSelection(); const range = document.createRange();
  range.selectNodeContents(cm); range.collapse(false); sel.removeAllRanges(); sel.addRange(range);
  document.execCommand('insertText', false, 'UNSAVEDEDIT\\n');
  await wait(700);
  const dirty = Boolean(document.querySelector('.editorPanel .dirty'));
  const withChanges = tabsIn('alpha.txt');
  await clickMenu('Search', 1400);
  const withSearch = tabsIn('alpha.txt');
  await clickMenu('Review', 1400);
  const withReview = tabsIn('alpha.txt');
  /* The tab says so too — read after the tab has been through the front, which
     is when it is drawn again. */
  await activate(tabNamed('Review'));
  await activate(tabNamed('alpha.txt'));
  const marked = tabNamed('alpha.txt').querySelector('.panelTab').dataset.dirty;
  return { sideBox, mainBox, dirty, withChanges, withSearch, withReview, marked, shot: shot() };
`);
if (swapped.why) {
  unmeasured("a second tool in a side region replaces the first", swapped.why);
} else {
  claim(
    "an editor moved into a side region really sits there",
    swapped.sideBox && swapped.mainBox && swapped.sideBox.x + swapped.sideBox.w <= swapped.mainBox.x + 2,
    `editor ${swapped.sideBox?.x}+${swapped.sideBox?.w}, main from ${swapped.mainBox?.x}`,
  );
  claim(
    "a second tool in a side region replaces the first",
    swapped.withChanges.includes("Changes") &&
      swapped.withSearch.includes("Search") &&
      !swapped.withSearch.includes("Changes") &&
      swapped.withReview.includes("Review") &&
      !swapped.withReview.includes("Search"),
    `${JSON.stringify(swapped.withChanges)} → ${JSON.stringify(swapped.withSearch)} → ${JSON.stringify(swapped.withReview)}`,
  );
  claim(
    "and the editor with unsaved work in that region is left alone",
    swapped.dirty && swapped.withSearch.includes("alpha.txt") && swapped.withReview.includes("alpha.txt"),
    `unsaved ${swapped.dirty}, the tab's own mark says ${swapped.marked}; the region holds ${JSON.stringify(swapped.withReview)}`,
  );
}

// ---- what every tab wears ----------------------------------------------------
/* The mark of what it is, the kind beside it for the skin to colour, whether
   it holds unsaved work, and — on the one in front — a bar along the edge
   where the tab meets its panel, which is its bottom. */
const worn = await run(`${HELPERS}
  /* Only the tab in front wears the bar, which says nothing unless a tab
     behind is on screen to not wear it. What the steps before left is not
     something to lean on, so two views of main are put one behind the other. */
  await showView('Overview', 900);
  await showView('Notes', 1100);
  const all = [...document.querySelectorAll('.panelTab')];
  const front = document.querySelector('.dv-groupview.dv-active-group .dv-tab.dv-active-tab');
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
  const row = railLike(/plxr-tabs-check/);
  if (!row) return { noSession: true };
  row.click();
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
  await clickMenu('Usage', 1100);
  const usage = tabNamed('Usage');
  if (!usage) return { noTab: true };
  await activate(usage);
  await key('w', { metaKey: true });
  return { asked: Boolean(document.querySelector('.ask')), gone: !tabNamed('Usage') };
`);
claim("⌘W on a clean utility panel closes it without asking", !plain.noTab && !plain.asked && plain.gone);

const glyph = await run(`${HELPERS}
  await clickMenu('Archive', 1200);
  const archive = tabNamed('Archive');
  if (!archive) return { noTab: true };
  archive.querySelector('.panelTabClose').click();
  await wait(400);
  const closedByGlyph = !tabNamed('Archive');
  await clickMenu('Archive', 1200);
  tabNamed('Archive').querySelector('.panelTab').dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
  await wait(400);
  return { closedByGlyph, closedByMiddle: !tabNamed('Archive'), asked: Boolean(document.querySelector('.ask')) };
`);
claim("the tab's close closes a clean panel", !glyph.noTab && glyph.closedByGlyph && !glyph.asked);
claim("so does the middle button", !glyph.noTab && glyph.closedByMiddle && !glyph.asked);

// ---- the keys between panels and groups -------------------------------------
const walked = await run(`${HELPERS}
  /* Two panels in the session's group to walk between, and a second group to
     walk to. Close group took the overview away further up, so it is put back
     first — in main, where the session then tabs in beside it — and the inbox
     is brought up as the other group without a second click shutting it. */
  await showView('Overview', 900);
  await showView('Inbox', 1100);
  const row = railLike(/plxr-tabs-check/);
  if (row) { row.click(); await wait(1500); }
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
  const groupBefore = activeGroupTabs();
  await key('ArrowDown', { metaKey: true, altKey: true });
  const groupAfter = activeGroupTabs();
  await key('ArrowUp', { metaKey: true, altKey: true });
  const groupBack = activeGroupTabs();
  return { first, left, right, groupBefore, groupAfter, groupBack };
`);
if (walked.noSession || walked.tooFew) {
  unmeasured("⌥⌘← → walk the panels of a group", walked.noSession ? "the session panel did not open" : `only ${JSON.stringify(walked.tooFew)} in the group`);
} else {
  claim("⌥⌘← moves to the previous panel of the group", walked.left !== walked.first, `${walked.first} → ${walked.left}`);
  claim("⌥⌘→ moves back to the next one", walked.right === walked.first, `${walked.left} → ${walked.right}`);
  claim(
    "⌥⌘↓ moves to another group and ⌥⌘↑ comes back",
    JSON.stringify(walked.groupBefore) !== JSON.stringify(walked.groupAfter) &&
      JSON.stringify(walked.groupBack) === JSON.stringify(walked.groupBefore),
    `${JSON.stringify(walked.groupBefore)} → ${JSON.stringify(walked.groupAfter)} → ${JSON.stringify(walked.groupBack)}`,
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
  const row = railLike(/plxr-tabs-check/);
  if (!row) return { noSession: true };
  row.click();
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

// ---- a saved arrangement that still carries the menu as a panel ---------------
/* Anyone who upgrades has one: the menu was a panel with the id "rail", and a
   saved layout still names it. Left in, it would come back as an empty panel
   called "plxr" beside the real menu. The saved arrangement is taken as the
   window itself wrote it, a rail panel is put back into it, and the window is
   loaded from it. */
await sleep(900);
const savedNow = await api("/api/prefs").catch(() => ({}));
const dock = savedNow?.dock;
let injected = false;
if (dock && dock.panels && dock.grid) {
  dock.panels.rail = { contentComponent: "rail", id: "rail", tabComponent: "props.defaultTabComponent", title: "plxr" };
  let leaf = dock.grid.root;
  while (leaf && leaf.type !== "leaf") leaf = leaf.data?.[0];
  if (leaf?.data?.views) {
    leaf.data.views.unshift("rail");
    await api("/api/prefs", { method: "PUT", body: JSON.stringify({ dock }) }).catch(() => undefined);
    injected = true;
  }
}
if (!injected) {
  unmeasured("a saved arrangement carrying the old menu panel never puts it back in the grid", "the service had no saved arrangement to put one into");
} else {
  await load();
  const upgraded = await run(`${HELPERS}
    return {
      tabs: names(),
      railTab: names().filter(n => /^plxr$/i.test(n)).length,
      beside: document.querySelectorAll('.railHost .railitem').length,
      inGrid: document.querySelectorAll('.plxrDock .railhome').length,
      panels: groups().length,
    };
  `);
  claim(
    "a saved arrangement carrying the old menu panel never puts it back in the grid",
    upgraded.railTab === 0 && upgraded.inGrid === 0 && upgraded.beside > 0 && upgraded.panels > 0,
    `tabs ${JSON.stringify(upgraded.tabs)} · ${upgraded.beside} menu rows beside the grid, ${upgraded.inGrid} in it`,
  );
}

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
console.log(`\n  the regions and their tabs do what they say — all ${claims.length} claims hold`);
await stop(0);
