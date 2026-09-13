/* Is everything reachable from something you can see?
 *
 * The header MENU, the ⌘K palette and its typing guard, the right-click menus
 * on the terminal, the rail and the session title, the tooltip on the opaque
 * surface, the settings as a dock panel split beside the work, a terminal setting
 * reaching the running xterm, a rebound key that fires, a layout saved and
 * applied. None of that can be seen from the code — it is measured here, in a
 * real browser against a service of its own, the way changes.mjs does it, and
 * the numbers are printed rather than a green line.
 *
 * Note: this is Blink, not the WKWebView the app ships in. Reachability,
 * geometry and the clipboard's refusal path are proven here; how the opaque
 * surfaces composite in the real window is Phase 0's capture path.
 */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

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

const home = mkdtempSync(join(tmpdir(), "plxr-surfaces-home-"));
const folder = join(home, "scratch");
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, "a.txt"), "one\ntwo\nthree\n");

const APP = process.env.PLXR_APP || "/tmp/plxr3-app";
if (!existsSync(APP)) {
  console.log(`  ${APP} is not there — run ./build.sh first`);
  process.exit(1);
}
const app = spawn(APP, ["daemon"], { env: { ...process.env, PLXR_HOME: home }, stdio: "ignore" });

/* Everything this run starts is ended from wherever it stops.
 *
 * A crash or ^C used to leave the browser and the service running: fourteen
 * headless browsers holding 4.6 GB were found on one machine, most from gates
 * that had crashed before their cleanup. The service detaches itself, so the
 * process that listens is the one named in daemon.json. Registered the moment
 * there is something to end; the browser and its profile do not exist yet at
 * first, and reaching for them then throws, which is caught. A crash further
 * down still goes through report(), which prints what held and then stops. */
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

await api("/api/workspaces", { method: "POST", body: JSON.stringify({ path: folder }) });
const sess = await (await api("/api/sessions", { method: "POST", body: JSON.stringify({ cwd: folder, cmd: [], name: "shell", account: "" }) })).json();

const profile = mkdtempSync(join(tmpdir(), "plxr-surfaces-"));
const port = 9300 + (process.pid % 300);
const chrome = spawn(browser, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--use-mock-keychain",
  "--password-store=basic",
  "--no-default-browser-check",
  "--window-size=1600,900",
  "about:blank",
], { stdio: "ignore" });

function stop(code) {
  endEverything();
  process.exit(code);
}

async function target(url) {
  let ws = null;
  for (let i = 0; i < 80 && !ws; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      ws = list.find((t) => t.type === "page" && t.url === url)?.webSocketDebuggerUrl;
    } catch { /* not up */ }
    if (!ws) await sleep(250);
  }
  return ws;
}

async function connect(wsUrl) {
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
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`.trim());
    return r.result?.value;
  };
  return { cdp, run };
}

process.on("unhandledRejection", (e) => report(String(e && e.stack ? e.stack : e)));
process.on("uncaughtException", (e) => report(String(e && e.stack ? e.stack : e)));
const PAGE = `http://127.0.0.1:${info.port}/?token=${info.token}`;
const first = await target("about:blank");
if (!first) {
  console.log("  the browser did not come up");
  stop(1);
}
const tab = await connect(first);
let up = 0;
for (let i = 0; i < 40 && !up; i++) {
  await tab.cdp.send("Page.navigate", { url: PAGE });
  await sleep(700);
  up = await tab.run("return document.querySelectorAll('.railhome').length").catch(() => 0);
}
if (!up) {
  console.log("  the interface did not render");
  stop(1);
}
await sleep(1500);

const HELPERS = `
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const byText = (sel, re) => [...document.querySelectorAll(sel)].find(e => re.test(e.textContent.trim()));
  const until = async (fn, ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return { v, ms: Math.round(performance.now() - t0) }; await wait(50); } return { v: null, ms: Math.round(performance.now() - t0) }; };
  const menuRows = () => [...document.querySelectorAll('body > .menu .menuItem')].map(b => b.querySelector('.menuLabel').textContent.trim());
  const menuRow = re => byText('body > .menu .menuLabel', re)?.closest('.menuItem');
  const menuHeads = () => [...document.querySelectorAll('body > .menu .menuHeader')].map(h => h.textContent.trim());
  // A tab's text carries its icon beside the title, so names are read off .panelTabName.
  const tabNames = () => [...document.querySelectorAll('.plxrDock .panelTabName')].map(e => e.textContent.trim());
  const shellTab = () => byText('.plxrDock .panelTabName', /^shell\\b/)?.closest('.dv-tab');
  // Dockview makes a tab active on the pointer, not on a click.
  const front = async tab => {
    if (!tab) return;
    tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    tab.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    await wait(400);
  };
  const alphaOf = el => { const bg = getComputedStyle(el).backgroundColor; const m = bg.match(/rgba?\\(([^)]+)\\)/); if (!m) return -1; const parts = m[1].split(',').map(s => parseFloat(s)); return parts.length === 4 ? parts[3] : 1; };
  const key = (el, init) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }); el.dispatchEvent(e); return e.defaultPrevented; };
`;

// Native-ish mouse through the debugging protocol, so React sees a real
// pointer and the browser's own contextmenu default is what gets prevented.
async function mouse(type, x, y, extra = {}) {
  await tab.cdp.send("Input.dispatchMouseEvent", { type, x: Math.round(x), y: Math.round(y), ...extra });
}
async function rectOf(selector) {
  return tab.run(`const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;`);
}

// ---- the header MENU ----------------------------------------------------------
const menuBtn = await rectOf('[data-do="menu"]');
claim("the header has a visible MENU button", Boolean(menuBtn) && menuBtn.w > 0, menuBtn ? `${Math.round(menuBtn.w)}×${Math.round(menuBtn.h)} at ${Math.round(menuBtn.x)},${Math.round(menuBtn.y)}` : "no button");
await mouse("mousePressed", menuBtn.x + menuBtn.w / 2, menuBtn.y + menuBtn.h / 2, { button: "left", clickCount: 1 });
await mouse("mouseReleased", menuBtn.x + menuBtn.w / 2, menuBtn.y + menuBtn.h / 2, { button: "left", clickCount: 1 });
const menu = await tab.run(`${HELPERS}
  const got = await until(() => document.querySelector('body > .menu'), 2000);
  const m = got.v;
  return m ? { heads: menuHeads(), rows: menuRows(), alpha: alphaOf(m), onBody: m.parentElement === document.body,
    z: getComputedStyle(m).zIndex, checks: [...m.querySelectorAll('.menuCheck')].length,
    hints: [...m.querySelectorAll('.menuHint')].map(h => h.textContent.trim()), rect: (r => ({ x: r.left, y: r.top, w: r.width, h: r.height }))(m.getBoundingClientRect()) } : null;
`);
claim("MENU opens the one context menu on <body>, under the button", menu && menu.onBody && Math.abs(menu.rect.x - menuBtn.x) < 3 && menu.rect.y >= menuBtn.y + menuBtn.h,
  menu ? `menu at ${Math.round(menu.rect.x)},${Math.round(menu.rect.y)} · button bottom ${Math.round(menuBtn.y + menuBtn.h)} · z ${menu.z}` : "no menu");
claim("the menu is opaque (background alpha 1)", menu && menu.alpha === 1, menu ? `alpha ${menu.alpha}` : "");
claim("every group is there: Actions, Tools, Views, Help", menu && ["Actions", "Tools", "Views", "Help"].every((h) => menu.heads.includes(h)), menu ? menu.heads.join(" · ") : "");
const wantRows = ["Search commands…", "New session", "Templates", "Settings", "PAUSE ALL", "Reset the panel layout", "Workbench", "Workshop", "frame-rate readout", "Overview", "Inbox", "Folders", "Changes", "Ports", "Usage", "Archive", "Keyboard"];
claim("every action row is there (" + wantRows.length + ")", menu && wantRows.every((r) => menu.rows.includes(r)), menu ? `${menu.rows.length} rows: ${menu.rows.join(" · ")}` : "");
claim("the tools carry a check cell and the rows their keys", menu && menu.checks === 3 && menu.hints.includes("⌘K") && menu.hints.includes("⌘1"), menu ? `${menu.checks} checks · hints ${menu.hints.join(" ")}` : "");

// Workbench from the menu, by the pointer alone.
const wbRow = await tab.run(`${HELPERS} const b = menuRow(/^Workbench$/); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
await mouse("mousePressed", wbRow.x, wbRow.y, { button: "left", clickCount: 1 });
await mouse("mouseReleased", wbRow.x, wbRow.y, { button: "left", clickCount: 1 });
const bench = await tab.run(`${HELPERS}
  const got = await until(() => byText('.workbench .overlayName', /^Workbench$/), 2000);
  return { open: Boolean(got.v), ms: got.ms, menuGone: !document.querySelector('body > .menu') };
`);
claim("Workbench opens from the menu with no keyboard", bench.open && bench.menuGone, `after ${bench.ms} ms · menu closed ${bench.menuGone}`);

// And the same row again shows a tick now; Workshop from the menu too.
await mouse("mousePressed", menuBtn.x + menuBtn.w / 2, menuBtn.y + menuBtn.h / 2, { button: "left", clickCount: 1 });
await mouse("mouseReleased", menuBtn.x + menuBtn.w / 2, menuBtn.y + menuBtn.h / 2, { button: "left", clickCount: 1 });
const ticked = await tab.run(`${HELPERS}
  await until(() => document.querySelector('body > .menu'), 2000);
  const b = menuRow(/^Workbench$/);
  const s = menuRow(/^Workshop$/);
  const r = s.getBoundingClientRect();
  return { tick: b.querySelector('.menuCheck')?.textContent.trim(), checked: b.getAttribute('aria-checked'), x: r.left + r.width / 2, y: r.top + r.height / 2 };
`);
claim("an open tool shows its tick in the menu", ticked.tick === "✓" && ticked.checked === "true", `tick "${ticked.tick}" aria-checked ${ticked.checked}`);
await mouse("mousePressed", ticked.x, ticked.y, { button: "left", clickCount: 1 });
await mouse("mouseReleased", ticked.x, ticked.y, { button: "left", clickCount: 1 });
const shop = await tab.run(`${HELPERS}
  const got = await until(() => byText('.workbench .overlayName', /^Workshop$/), 2000);
  return { open: Boolean(got.v), ms: got.ms, both: document.querySelectorAll('.workbench').length };
`);
claim("Workshop opens from the menu with no keyboard", shop.open, `after ${shop.ms} ms · ${shop.both} side panels open`);
// Close both again so they do not narrow the stage for what follows.
await tab.run(`${HELPERS} document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true })); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', shiftKey: true, bubbles: true })); await wait(200);`);

// ---- ⌘K and the typing guard ----------------------------------------------------
const palette = await tab.run(`${HELPERS}
  const prevented = key(document.body, { key: 'k', metaKey: true });
  const got = await until(() => document.querySelector('body .palette'), 1500);
  const opened = Boolean(got.v);
  const focused = document.activeElement?.className ?? '';
  // Esc closes it (the palette's own field has focus now, so ⌘K must not).
  const again = key(document.activeElement, { key: 'k', metaKey: true });
  await wait(150);
  const stillOpen = Boolean(document.querySelector('body .palette'));
  key(document.activeElement, { key: 'Escape' });
  await wait(150);
  const closed = !document.querySelector('body .palette');
  return { prevented, opened, ms: got.ms, focused, stillOpen, again, closed };
`);
claim("⌘K opens the palette (keydown default prevented)", palette.opened && palette.prevented, `after ${palette.ms} ms · focus in "${palette.focused}"`);
claim("⌘K while typing in the palette's own field does not fold it", palette.stillOpen && !palette.again, `still open ${palette.stillOpen} · prevented ${palette.again}`);
claim("Esc closes the palette", palette.closed, "");
const guarded = await tab.run(`${HELPERS}
  // The folder field in the project switch's list: the field the header offers.
  document.querySelector('.switch[data-switch="project"]').click();
  const input = (await until(() => document.querySelector('body > .menu .menuField input'), 2000)).v;
  input.focus();
  const prevented = key(input, { key: 'k', metaKey: true });
  await wait(200);
  const opened = Boolean(document.querySelector('body .palette'));
  key(input, { key: 'Escape' });
  await wait(150);
  return { prevented, opened, tag: input.tagName };
`);
claim("⌘K with the keydown targeted at an <input> does NOT toggle the palette", !guarded.opened && !guarded.prevented, `target ${guarded.tag} · opened ${guarded.opened} · prevented ${guarded.prevented}`);

// ---- right-click the terminal ---------------------------------------------------
const opened = await tab.run(`${HELPERS}
  byText('.railitem .rname', /^shell$/).closest('.railitem').click();
  const got = await until(() => document.querySelector('.ptermbox .xterm'), 6000);
  await wait(800);
  return { ok: Boolean(got.v), ms: got.ms };
`);
claim("the session opens with a live terminal", opened.ok, `after ${opened.ms} ms`);
const host = await rectOf(".ptermbox");
// Caught on the way down: the menu handler stops propagation, so a bubbling
// listener on window never sees it. defaultPrevented is read off the held
// event afterwards, once the handler has had its say.
await tab.run(`window.__ctxEvent = null; window.addEventListener('contextmenu', e => { window.__ctxEvent = e; }, true);`);
await mouse("mousePressed", host.x + host.w / 2, host.y + host.h / 2, { button: "right", clickCount: 1 });
await mouse("mouseReleased", host.x + host.w / 2, host.y + host.h / 2, { button: "right", clickCount: 1 });
const termMenu = await tab.run(`${HELPERS}
  const got = await until(() => document.querySelector('body > .menu'), 2000);
  const m = got.v;
  const copy = m && menuRow(/^Copy$/);
  const ev = window.__ctxEvent;
  const ctx = ev ? { prevented: ev.defaultPrevented, target: ev.target.className } : null;
  return m ? { rows: menuRows(), alpha: alphaOf(m), onBody: m.parentElement === document.body, ctx, copyDisabled: copy ? copy.disabled : null, ms: got.ms } : { ctx };
`);
claim("right-click on the terminal host opens a .menu on <body>, opaque", termMenu.rows && termMenu.onBody && termMenu.alpha === 1, termMenu.rows ? `alpha ${termMenu.alpha} after ${termMenu.ms} ms` : "no menu");
claim("it offers Copy / Paste / Select all / Clear / Find…", termMenu.rows && ["Copy", "Paste", "Select all", "Clear", "Find…"].every((r) => termMenu.rows.includes(r)), termMenu.rows ? termMenu.rows.join(" · ") : "");
claim("the browser's own contextmenu default was prevented", termMenu.ctx && termMenu.ctx.prevented, termMenu.ctx ? `prevented ${termMenu.ctx.prevented} on "${termMenu.ctx.target}"` : "no event seen");
claim("Copy is disabled while nothing is selected", termMenu.copyDisabled === true, `disabled ${termMenu.copyDisabled}`);

// Select all, then Copy is offered; Clear runs; Find opens the find box.
const selectAll = await tab.run(`${HELPERS}
  menuRow(/^Select all$/).click();
  await wait(100);
  const term = document.querySelector('.ptermbox').xterm;
  return { has: term.hasSelection(), len: term.getSelection().length };
`);
claim("Select all selects the terminal's text through xterm", selectAll.has, `selection ${selectAll.len} chars`);
await mouse("mousePressed", host.x + host.w / 2, host.y + host.h / 2, { button: "right", clickCount: 1 });
await mouse("mouseReleased", host.x + host.w / 2, host.y + host.h / 2, { button: "right", clickCount: 1 });
const copyOn = await tab.run(`${HELPERS}
  await until(() => document.querySelector('body > .menu'), 2000);
  const copy = menuRow(/^Copy$/);
  const on = copy && !copy.disabled;
  menuRow(/^Find…$/).click();
  const got = await until(() => document.querySelector('.find'), 2000);
  return { on, find: Boolean(got.v) };
`);
claim("with a selection Copy is enabled; Find… opens the find box", copyOn.on && copyOn.find, `copy enabled ${copyOn.on} · find box ${copyOn.find}`);
await tab.run(`${HELPERS} document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(100);`);

// Paste: headless Blink refuses the async clipboard read without a
// permission grant — which is exactly the refusal path the pane must report.
await mouse("mousePressed", host.x + host.w / 2, host.y + host.h / 2, { button: "right", clickCount: 1 });
await mouse("mouseReleased", host.x + host.w / 2, host.y + host.h / 2, { button: "right", clickCount: 1 });
const paste = await tab.run(`${HELPERS}
  await until(() => document.querySelector('body > .menu'), 2000);
  menuRow(/^Paste$/).click();
  const got = await until(() => document.querySelector('.ptermNote'), 3000);
  return { note: got.v ? got.v.textContent.trim() : '', ms: got.ms, alpha: got.v ? alphaOf(got.v) : -1 };
`);
claim("a refused Paste is said in the pane (not silent)", paste.note.length > 0, paste.note ? `"${paste.note}" after ${paste.ms} ms · alpha ${paste.alpha}` : "no notice — clipboard read was allowed here");

// ---- right-click a rail session -------------------------------------------------
const railItem = await rectOf(".railitem[data-status]");
await mouse("mousePressed", railItem.x + railItem.w / 2, railItem.y + railItem.h / 2, { button: "right", clickCount: 1 });
await mouse("mouseReleased", railItem.x + railItem.w / 2, railItem.y + railItem.h / 2, { button: "right", clickCount: 1 });
const railMenu = await tab.run(`${HELPERS}
  const got = await until(() => document.querySelector('body > .menu'), 2000);
  const rows = menuRows();
  const danger = [...document.querySelectorAll('body > .menu .menuItem.danger')].map(b => b.textContent.trim());
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(100);
  return { rows, danger, ms: got.ms };
`);
claim("right-click on a rail session offers Open / Pause / Terminate / COPY PATH", ["Open", "Pause", "Terminate", "COPY PATH"].every((r) => railMenu.rows.includes(r)) && railMenu.danger.includes("Terminate"),
  `${railMenu.rows.join(" · ")} · danger: ${railMenu.danger.join(",")}`);

// ---- the session switch: every session, its menu, and the keyboard ------------------
/* The list the rail's session rows are becoming, at the top of the window. A
   click opens it with each session under its project and its state; the right
   button on a row offers the session's actions; ⌘E opens it with the keyboard
   on the first row, the arrows walk it, Enter brings the session forward, and
   ⌘E again closes it and hands the keyboard back. Real key events, through the
   debugging protocol: a dispatched keydown does not press a button. */
async function pressKey(name, code, keyCode, modifiers = 0) {
  const text = name === "Enter" ? "\r" : undefined;
  await tab.cdp.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: name, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers, text });
  await tab.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
}
const sessionSwitch = await rectOf('.switch[data-switch="session"]');
await mouse("mousePressed", sessionSwitch.x + sessionSwitch.w / 2, sessionSwitch.y + sessionSwitch.h / 2, { button: "left", clickCount: 1 });
await mouse("mouseReleased", sessionSwitch.x + sessionSwitch.w / 2, sessionSwitch.y + sessionSwitch.h / 2, { button: "left", clickCount: 1 });
const sessionList = await tab.run(`${HELPERS}
  const got = await until(() => document.querySelector('body > .menu'), 2000);
  const rows = [...document.querySelectorAll('body > .menu .menuItem')].filter(b => b.querySelector('.menuSub'));
  const first = rows[0]?.getBoundingClientRect();
  return {
    heads: menuHeads(),
    sessions: rows.map(b => b.querySelector('.menuLabel').firstChild.textContent.trim() + ' — ' + b.querySelector('.menuSub').textContent.trim()),
    marks: rows.filter(b => b.querySelector('.menuIcon.dot')).length,
    rows: menuRows(),
    pressed: document.querySelector('.switch[data-switch="session"]').dataset.open,
    ms: got.ms,
    first: first ? { x: first.left + first.width / 2, y: first.top + first.height / 2 } : null,
  };
`);
const listed = await (await api("/api/sessions")).json();
claim("a click on the session switch lists every session under its project, with its state", sessionList.sessions.length === listed.length && sessionList.marks === listed.length && sessionList.heads.includes("scratch") && sessionList.pressed === "yes" && ["All sessions (board)", "New session…", "New shell here"].every((r) => sessionList.rows.includes(r)),
  `${sessionList.sessions.join(" · ")} under ${sessionList.heads.join(", ")} · ${listed.length} in the service · after ${sessionList.ms} ms`);
if (sessionList.first) {
  await mouse("mousePressed", sessionList.first.x, sessionList.first.y, { button: "right", clickCount: 1 });
  await mouse("mouseReleased", sessionList.first.x, sessionList.first.y, { button: "right", clickCount: 1 });
}
const switchRowMenu = await tab.run(`${HELPERS}
  await wait(300);
  const rows = menuRows();
  const danger = [...document.querySelectorAll('body > .menu .menuItem.danger')].map(b => b.textContent.trim());
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(150);
  return { rows, danger, gone: !document.querySelector('body > .menu') };
`);
claim("right-click on a session switch row offers Open / Pause / Terminate / COPY PATH", ["Open", "Pause", "Terminate", "COPY PATH"].every((r) => switchRowMenu.rows.includes(r)) && switchRowMenu.danger.includes("Terminate") && switchRowMenu.gone,
  `${switchRowMenu.rows.join(" · ")} · danger: ${switchRowMenu.danger.join(",")}`);

// From the keyboard: the board in front, the keyboard on the rail.
await tab.run(`${HELPERS} byText('.railitem .rname', /^Overview$/).closest('.railitem').click(); await wait(600);`);
await pressKey("e", "KeyE", 69, 4);
const keyOpen = await tab.run(`${HELPERS}
  const got = await until(() => document.querySelector('body > .menu'), 1500);
  await wait(100);
  const a = document.activeElement;
  return { open: Boolean(got.v), inMenu: Boolean(a && a.closest('body > .menu')), on: a?.querySelector?.('.menuLabel')?.firstChild?.textContent.trim() ?? a?.tagName };
`);
await pressKey("ArrowDown", "ArrowDown", 40);
const keyWalk = await tab.run(`const a = document.activeElement; return a?.querySelector?.('.menuLabel')?.firstChild?.textContent.trim() ?? a?.tagName;`);
await pressKey("ArrowUp", "ArrowUp", 38);
await pressKey("Enter", "Enter", 13);
const keyPick = await tab.run(`${HELPERS}
  const got = await until(() => (document.querySelector('.dv-active-group .dv-active-tab .panelTabName')?.textContent.trim() ?? '').startsWith('shell') ? true : null, 3000);
  return { front: document.querySelector('.dv-active-group .dv-active-tab .panelTabName')?.textContent.trim() ?? '', closed: !document.querySelector('body > .menu'), ms: got.ms };
`);
claim("⌘E opens the session switch with the keyboard on its first row", keyOpen.open && keyOpen.inMenu && keyOpen.on === "shell", JSON.stringify(keyOpen));
claim("the arrows walk the rows and Enter brings the session's panel to the front", keyWalk !== keyOpen.on && keyPick.closed && keyPick.front.startsWith("shell"), `ArrowDown → ${keyWalk} · front "${keyPick.front}" after ${keyPick.ms} ms`);
await tab.run(`document.querySelector('.ptermbox .xterm-helper-textarea')?.focus();`);
await pressKey("e", "KeyE", 69, 4);
const keyAgain = await tab.run(`${HELPERS} await until(() => document.querySelector('body > .menu'), 1500); await wait(100); return Boolean(document.activeElement?.closest('body > .menu'));`);
await pressKey("e", "KeyE", 69, 4);
const keyBack = await tab.run(`${HELPERS} await wait(200); return { open: Boolean(document.querySelector('body > .menu')), back: String(document.activeElement?.className ?? '') };`);
claim("from the terminal, ⌘E opens it and ⌘E again closes it and gives the keyboard back to the terminal", keyAgain && !keyBack.open && /xterm-helper-textarea/.test(keyBack.back), `in the list ${keyAgain} · open ${keyBack.open} · keyboard on "${keyBack.back}"`);

// ---- right-click the session title ---------------------------------------------
const title = await rectOf(".sesstitle");
await mouse("mousePressed", title.x + title.w / 2, title.y + title.h / 2, { button: "right", clickCount: 1 });
await mouse("mouseReleased", title.x + title.w / 2, title.y + title.h / 2, { button: "right", clickCount: 1 });
const titleMenu = await tab.run(`${HELPERS}
  const got = await until(() => document.querySelector('body > .menu'), 2000);
  const rows = menuRows();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(100);
  return { rows };
`);
claim("right-click on the session title offers the session's actions", ["FILES", "QUEUE", "PAUSE", "TERMINATE", "COPY PATH"].every((r) => titleMenu.rows.includes(r)), titleMenu.rows.join(" · "));

// ---- right-click a folder tab ------------------------------------------------------
const folderTab = await tab.run(`${HELPERS}
  byText('.railitem .rname', /^Folders$/).closest('.railitem').click();
  const got = await until(() => document.querySelector('.folderTab'), 4000);
  const r = got.v?.getBoundingClientRect();
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, ms: got.ms } : null;
`);
if (folderTab) {
  await mouse("mousePressed", folderTab.x, folderTab.y, { button: "right", clickCount: 1 });
  await mouse("mouseReleased", folderTab.x, folderTab.y, { button: "right", clickCount: 1 });
}
const folderMenu = await tab.run(`${HELPERS}
  const got = await until(() => document.querySelector('body > .menu'), 2000);
  const rows = menuRows();
  const danger = [...document.querySelectorAll('body > .menu .menuItem.danger')].map(b => b.textContent.trim());
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(100);
  return { rows, danger };
`);
claim("right-click on a folder tab offers Open / COPY PATH / SHOW / Remove folder", ["Open", "COPY PATH", "SHOW", "Remove folder"].every((r) => folderMenu.rows.includes(r)) && folderMenu.danger.includes("Remove folder"),
  `${folderMenu.rows.join(" · ")} · danger: ${folderMenu.danger.join(",")}`);

// ---- the tooltip ------------------------------------------------------------------
/* The gear, by what it does. It was found by aria-pressed while it toggled a
   window, and by its glyph after that; it brings a panel forward now,
   presses nothing, and its mark is an icon from whichever pack is chosen. */
const gear = await tab.run(`const b = document.querySelector('.tools [data-do="settings"]'); const r = b?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;`);
await mouse("mouseMoved", gear.x + gear.w / 2, gear.y + gear.h / 2);
const tip = await tab.run(`${HELPERS}
  const got = await until(() => { const t = document.querySelector('body > .tooltip'); return t && t.dataset.placed === 'yes' ? t : null; }, 2000);
  const t = got.v;
  const nativeTitles = [...document.querySelectorAll('.app [title]')].map(e => e.tagName + '.' + e.className).slice(0, 5);
  return t ? { text: t.textContent.trim(), alpha: alphaOf(t), z: getComputedStyle(t).zIndex, rect: (r => ({ x: r.left, y: r.top, w: r.width, h: r.height }))(t.getBoundingClientRect()), ms: got.ms, nativeTitles } : { nativeTitles };
`);
await mouse("mouseMoved", 5, 5);
claim("hovering ⚙ shows the plxr tooltip on <body>, opaque, at the top rung", tip.text === "Settings" && tip.alpha === 1 && tip.z === "410", tip.text ? `"${tip.text}" alpha ${tip.alpha} z ${tip.z} after ${tip.ms} ms` : "no tooltip");
claim("the tooltip sits under the button, centred", tip.rect && tip.rect.y >= gear.y + gear.h && Math.abs((tip.rect.x + tip.rect.w / 2) - (gear.x + gear.w / 2)) < 2,
  tip.rect ? `tip ${Math.round(tip.rect.x)},${Math.round(tip.rect.y)} ${Math.round(tip.rect.w)}×${Math.round(tip.rect.h)} · button bottom ${Math.round(gear.y + gear.h)}` : "");
claim("no native title= attribute is left inside the app", tip.nativeTitles.length === 0, tip.nativeTitles.length ? tip.nativeTitles.join(", ") : "none");

// ---- Settings as a panel in the dock ---------------------------------------------------
/* The settings were a window on <body>, dragged and sized by hand and docked
   nowhere. They are a panel now: they open as a tab of main beside the work,
   and are moved the way every panel is moved — here split off to the right
   through the tab's own menu, so the terminal they change stays on screen
   beside them for the claims that follow. */
await mouse("mousePressed", gear.x + gear.w / 2, gear.y + gear.h / 2, { button: "left", clickCount: 1 });
await mouse("mouseReleased", gear.x + gear.w / 2, gear.y + gear.h / 2, { button: "left", clickCount: 1 });
const win = await tab.run(`${HELPERS}
  const got = await until(() => document.querySelector('.settingsPanel'), 2000);
  const p = got.v;
  if (!p) return null;
  const group = p.closest('.dv-groupview');
  const g = group ? group.getBoundingClientRect() : null;
  return { inGrid: Boolean(p.closest('.plxrDock')) && !p.closest('.dv-resize-container'), onBody: Boolean(document.querySelector('body > .window')),
    mates: group ? [...group.querySelectorAll('.panelTabName')].map(e => e.textContent.trim()) : [],
    tabs: [...p.querySelectorAll('.tab')].map(t => t.textContent.trim()), ms: got.ms,
    groupX: g ? Math.round(g.left) : -1, railRight: Math.round(document.querySelector('.railHost').getBoundingClientRect().right) };
`);
claim("Settings open as a panel in the dock's grid, not a window on <body>", win && win.inGrid && !win.onBody,
  win ? `after ${win.ms} ms · in the grid ${win.inGrid} · a window on <body> ${win.onBody}` : "no settings panel");
claim("they open in main, as a tab beside the session, right of the menu",
  win && win.mates.includes("Settings") && win.mates.some((m) => /^shell\b/.test(m)) && win.groupX >= win.railRight - 1,
  win ? `the group holds ${win.mates.join(", ")}, from x ${win.groupX} · the menu ends at ${win.railRight}` : "");
claim("it has the nine tabs", win && ["skins & palette", "terminal", "editor", "keys", "accounts", "layouts", "notify", "agents", "status"].every((t) => win.tabs.includes(t)), win ? win.tabs.join(" · ") : "");

const split = await tab.run(`${HELPERS}
  const name = byText('.plxrDock .panelTabName', /^Settings$/);
  if (!name) return { why: 'the settings have no tab' };
  const host = name.closest('.panelTab');
  const r = host.getBoundingClientRect();
  host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 8, button: 2 }));
  await until(() => document.querySelector('body > .menu'), 1500);
  const row = menuRow(/^Split to the right$/);
  if (!row || row.disabled) {
    const rows = menuRows();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { why: (row ? 'Split to the right is disabled: ' : 'no Split to the right in: ') + rows.join(' · ') };
  }
  row.click();
  await wait(700);
  // The session comes to the front of the group it stayed in.
  await front(shellTab());
  const box = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), w: Math.round(b.width) }; };
  const p = document.querySelector('.settingsPanel');
  const term = document.querySelector('.ptermbox');
  return { settings: box(p), terminal: box(term), apart: Boolean(p && term) && p.closest('.dv-groupview') !== term.closest('.dv-groupview') };
`);
claim("split to the right from the tab's own menu, the settings stand beside the running terminal",
  !split.why && split.apart && split.settings && split.terminal && split.settings.x >= split.terminal.x + split.terminal.w - 2,
  split.why ?? `terminal ${split.terminal?.x}+${split.terminal?.w} · settings ${split.settings?.x}+${split.settings?.w}`);

// ---- a terminal setting reaches the running xterm --------------------------------
const cursor = await tab.run(`${HELPERS}
  byText('.settingsPanel .tab', /^terminal$/).click();
  await wait(200);
  const term = document.querySelector('.ptermbox').xterm;
  const was = { style: term.options.cursorStyle, blink: term.options.cursorBlink, scrollback: term.options.scrollback };
  // The cursor picker is the Select in the cursor field; open it and pick BAR.
  const field = byText('.settingsPanel .fieldName', /^cursor$/).closest('.field');
  field.querySelector('.selectButton').click();
  await wait(100);
  byText('body > .selectList .selectRow', /^BAR$/).click();
  const got = await until(() => term.options.cursorStyle === 'bar' ? true : null, 2000);
  // And blinking off through the toggle beside it.
  field.querySelector('.styleToggle').click();
  const blink = await until(() => term.options.cursorBlink === false ? true : null, 2000);
  const prefs = await (await fetch('/api/prefs', { headers: { 'X-Plxr-Token': ${JSON.stringify(info.token)} } })).json();
  return { was, now: { style: term.options.cursorStyle, blink: term.options.cursorBlink }, ms: got.ms, blinkMs: blink.ms, saved: prefs.terminal };
`);
claim("picking cursor BAR updates the live xterm option (term.options.cursorStyle)", cursor.now.style === "bar" && cursor.was.style === "block", `${cursor.was.style} → ${cursor.now.style} after ${cursor.ms} ms`);
claim("the blink toggle updates term.options.cursorBlink and both land in prefs.terminal", cursor.now.blink === false && cursor.saved && cursor.saved.cursorStyle === "bar" && cursor.saved.cursorBlink === false,
  `blink ${cursor.was.blink} → ${cursor.now.blink} after ${cursor.blinkMs} ms · prefs.terminal ${JSON.stringify(cursor.saved)}`);

// ---- a rebound key fires, and the list reflects it ---------------------------------
const rebound = await tab.run(`${HELPERS}
  byText('.settingsPanel .tab', /^keys$/).click();
  await wait(200);
  const row = [...document.querySelectorAll('.settingsPanel .keyRow')].find(r => /command palette/.test(r.textContent));
  const before = row.querySelector('.keyCap').textContent.trim();
  row.querySelector('[data-do="rebind"]').click();
  await wait(100);
  const waiting = row.dataset.waiting;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true, bubbles: true, cancelable: true }));
  await wait(300);
  const after = row.querySelector('.keyCap').textContent.trim();
  const prefs = await (await fetch('/api/prefs', { headers: { 'X-Plxr-Token': ${JSON.stringify(info.token)} } })).json();
  // Now ⌘P opens the palette and ⌘K no longer does.
  key(document.body, { key: 'k', metaKey: true });
  await wait(200);
  const kOpens = Boolean(document.querySelector('body .palette'));
  key(document.body, { key: 'p', metaKey: true });
  const got = await until(() => document.querySelector('body .palette'), 1500);
  const pOpens = Boolean(got.v);
  if (pOpens) key(document.activeElement, { key: 'Escape' });
  await wait(150);
  // The keyboard list under "?" prints the new key.
  key(document.body, { key: '?', shiftKey: true });
  const list = await until(() => document.querySelector('.card .ruleslist'), 1500);
  const rows = [...document.querySelectorAll('.card .rrow')].map(r => r.querySelector('.keyCap').textContent.trim() + ' ' + r.querySelector('.rtitle').textContent.trim());
  const phantom = rows.some(r => /⌘1…5/.test(r));
  key(document.body, { key: 'Escape' });
  await wait(150);
  // Back to the shipped key.
  const reset = row.querySelector('[data-do="reset-key"]');
  reset?.click();
  await wait(200);
  const restored = row.querySelector('.keyCap').textContent.trim();
  return { before, waiting, after, saved: prefs.keymap, kOpens, pOpens, listMs: list.ms, rows, phantom, restored, menuHint: null };
`);
claim("REBIND takes the next key: the palette row goes ⌘K → ⌘P and prefs.keymap holds it", rebound.before === "⌘K" && rebound.waiting === "yes" && rebound.after === "⌘P" && rebound.saved && rebound.saved.palette === "Mod+P",
  `${rebound.before} → ${rebound.after} · prefs.keymap ${JSON.stringify(rebound.saved)}`);
claim("the rebound key fires (⌘P opens the palette) and the old one no longer does", rebound.pOpens && !rebound.kOpens, `⌘K opens ${rebound.kOpens} · ⌘P opens ${rebound.pOpens}`);
claim("the keyboard list reflects the rebinding and has no phantom ⌘1…5 row", rebound.rows.some((r) => r.startsWith("⌘P ")) && !rebound.phantom && rebound.rows.some((r) => r.startsWith("⌘7 Archive")),
  `${rebound.rows.length} rows after ${rebound.listMs} ms: ${rebound.rows.slice(0, 6).join(" | ")} …`);
claim("RESET puts the shipped key back", rebound.restored === "⌘K", `now ${rebound.restored}`);

// ⌘1…7 really open views now.
const viewKey = await tab.run(`${HELPERS}
  const before = tabNames();
  key(document.body, { key: '6', metaKey: true });
  const got = await until(() => tabNames().includes('Usage') ? true : null, 3000);
  return { before, opened: Boolean(got.v), ms: got.ms };
`);
claim("⌘6 opens the Usage view (the ⌘1…7 row is true, not phantom)", viewKey.opened, `Usage tab after ${viewKey.ms} ms · before: ${viewKey.before.join(", ")}`);

// ---- save and apply a named layout ------------------------------------------------
const saved = await tab.run(`${HELPERS}
  byText('.settingsPanel .tab', /^layouts$/).click();
  await wait(200);
  byText('.settingsPanel [data-do="save-layout"]', /Save current as/).click();
  const ask = await until(() => document.querySelector('.card.ask input'), 2000);
  /* Over the settings, measured by what is under the middle of the settings
     panel while the dialog asks: the dialog's backdrop, not the panel. */
  const sp = document.querySelector('.settingsPanel').getBoundingClientRect();
  const under = document.elementFromPoint(sp.left + sp.width / 2, sp.top + sp.height / 2);
  const over = Boolean(under && under.closest('.backdrop'));
  const askZ = getComputedStyle(document.querySelector('.card.ask').closest('.backdrop')).zIndex;
  ask.v.value = 'bench';
  ask.v.dispatchEvent(new Event('input', { bubbles: true }));
  byText('.card.ask button', /^SAVE$/).click();
  const row = await until(() => byText('.settingsPanel .presetRow .presetName', /^bench$/), 3000);
  const inUse = row.v && row.v.closest('.presetRow').dataset.current;
  const prefs = await (await fetch('/api/prefs', { headers: { 'X-Plxr-Token': ${JSON.stringify(info.token)} } })).json();
  const names = (prefs.dockPresets?.items ?? []).map(p => p.name);
  const panels = tabNames();
  return { over, under: under ? String(under.className) : '', askZ, listed: Boolean(row.v), inUse, names, panels, ms: row.ms };
`);
claim("Save current as… asks in the shell's dialog, which stands over the settings", saved.over, `under the middle of the settings: "${saved.under}" · dialog z ${saved.askZ}`);
claim("the named layout is listed as in use and stored under prefs.dockPresets", saved.listed && saved.inUse === "yes" && saved.names.includes("bench"), `presets ${saved.names.join(",")} after ${saved.ms} ms · panels ${saved.panels.join(", ")}`);
const applied = await tab.run(`${HELPERS}
  /* Reset the arrangement, then bring the saved one back. The settings are a
     panel of the arrangement, so the reset takes them with it; they are opened
     again to reach APPLY. */
  byText('.settingsPanel [data-do="reset-layout"]', /Reset/).click();
  await until(() => document.querySelectorAll('.plxrDock .dv-tab').length <= 2 ? true : null, 3000);
  const afterReset = tabNames();
  const settingsGone = !document.querySelector('.settingsPanel');
  document.querySelector('.tools [data-do="settings"]')?.click();
  await until(() => document.querySelector('.settingsPanel'), 2000);
  byText('.settingsPanel .tab', /^layouts$/)?.click();
  const apply = await until(() => byText('.settingsPanel .presetRow [data-do="apply-layout"]', /APPLY/), 2000);
  apply.v?.click();
  const got = await until(() => tabNames().includes('Usage') ? true : null, 3000);
  const afterApply = tabNames();
  return { afterReset, settingsGone, found: Boolean(apply.v), afterApply, ms: got.ms };
`);
claim("Reset clears the arrangement and APPLY brings the saved one back", !applied.afterReset.includes("Usage") && applied.afterApply.includes("Usage") && applied.afterApply.some((t) => /^shell\b/.test(t)),
  `reset → ${applied.afterReset.join(", ")} (the settings went with it: ${applied.settingsGone}, APPLY found again: ${applied.found}) · apply → ${applied.afterApply.join(", ")} after ${applied.ms} ms`);

// ---- Esc closes the topmost thing only ----------------------------------------------
const escLadder = await tab.run(`${HELPERS}
  // The applied arrangement brought the settings back on their first tab.
  byText('.settingsPanel .tab', /^layouts$/)?.click();
  await wait(200);
  byText('.settingsPanel [data-do="save-layout"]', /Save current as/).click();
  await until(() => document.querySelector('.card.ask'), 2000);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(200);
  return { askGone: !document.querySelector('.card.ask'), settingsStay: Boolean(document.querySelector('.settingsPanel')) };
`);
claim("Esc in a dialog asked from the settings closes the dialog and leaves the settings", escLadder.askGone && escLadder.settingsStay, `dialog gone ${escLadder.askGone} · settings stay ${escLadder.settingsStay}`);

// ---- the editor takes its settings live ------------------------------------------
const editor = await tab.run(`${HELPERS}
  /* Open a file in an editor panel, then change the tab width. An editor is a
     panel of main and lands in the group in front, so the session's group is
     brought forward first: the folders and the editor open there, and the
     settings keep the group they were split into, on screen beside them. */
  await front(shellTab());
  byText('.railitem .rname', /^Folders$/).closest('.railitem').click();
  await until(() => document.querySelector('.frow'), 4000);
  byText('.frow .fname', /^a\\.txt$/)?.closest('.frow').click();
  const cm = await until(() => document.querySelector('.editorPanel .cm-content'), 4000);
  if (!cm.v) return { opened: false };
  const view = cm.v.cmTile?.root?.view ?? cm.v.cmView?.view;
  const before = view.state.tabSize;
  byText('.settingsPanel .tab', /^editor$/).click();
  await wait(200);
  const field = byText('.settingsPanel .fieldName', /^tab width$/).closest('.field');
  field.querySelector('.selectButton').click();
  await wait(100);
  byText('body > .selectList .selectRow', /^8$/).click();
  const got = await until(() => view.state.tabSize === 8 ? true : null, 2000);
  // And wrapping off: CodeMirror marks a wrapping editor with a class.
  const wrapped = cm.v.classList.contains('cm-lineWrapping');
  byText('.settingsPanel .fieldName', /^long lines$/).closest('.field').querySelector('.styleToggle').click();
  const unwrapped = await until(() => cm.v.classList.contains('cm-lineWrapping') ? null : true, 2000);
  return { opened: true, before, after: view.state.tabSize, ms: got.ms, wrapped, unwrapped: Boolean(unwrapped.v), wrapMs: unwrapped.ms };
`);
claim("changing the tab width reaches the open CodeMirror editor (state.tabSize)", editor.opened && editor.before === 2 && editor.after === 8, editor.opened ? `${editor.before} → ${editor.after} after ${editor.ms} ms` : "no editor opened");
claim("switching long lines to SCROLL takes the wrapping off the open editor", editor.opened && editor.wrapped && editor.unwrapped, editor.opened ? `cm-lineWrapping ${editor.wrapped} → ${!editor.unwrapped} after ${editor.wrapMs} ms` : "");

// ---- the project switch: which project the tools follow ------------------------------
/* Two sessions in two folders and a third folder on its own. The switch names
   the project of the session in front and lists the folders with the current
   one ticked; a folder picked there is what the tools follow — Search says so
   — and it holds until another session comes to the front, whether it is
   picked in the session switch or brought forward by its tab. */
const otherFolder = join(home, "other");
const thirdFolder = join(home, "third");
mkdirSync(otherFolder, { recursive: true });
mkdirSync(thirdFolder, { recursive: true });
await api("/api/workspaces", { method: "POST", body: JSON.stringify({ path: thirdFolder }) });
await api("/api/sessions", { method: "POST", body: JSON.stringify({ cwd: otherFolder, cmd: [], name: "other", account: "" }) });
const projectRule = await tab.run(`${HELPERS}
  const label = () => document.querySelector('.switch[data-switch="project"] .switchLabel')?.textContent.trim() ?? '';
  const name = b => b.querySelector('.menuLabel')?.firstChild?.textContent.trim() ?? '';
  const notice = () => document.querySelector('.searchPanel .notice')?.textContent.trim() ?? '';
  const pickSession = async who => {
    document.querySelector('.switch[data-switch="session"]').click();
    const got = await until(() => [...document.querySelectorAll('body > .menu .menuItem')].find(b => name(b) === who), 6000);
    got.v?.click();
    await wait(1200);
    return Boolean(got.v);
  };
  const openList = async () => {
    document.querySelector('.switch[data-switch="project"]').click();
    await until(() => document.querySelector('body > .menu .menuField'), 3000);
    await wait(100);
    return [...document.querySelectorAll('body > .menu .menuItem')];
  };
  const search = async want => {
    byText('.railitem .rname', /^Search$/).closest('.railitem').click();
    return (await until(() => want.test(notice()) ? notice() : null, 4000)).v ?? notice();
  };
  const out = {};
  out.pickedShell = await pickSession('shell');
  out.shell = label();
  const rows = await openList();
  out.rows = rows.map(b => name(b) + (b.getAttribute('aria-checked') === 'true' ? ' ✓' : ''));
  rows.find(b => name(b) === 'third')?.click();
  await wait(1200);
  out.third = label();
  out.searchThird = await search(/third/);
  document.querySelector('.searchPanel').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await wait(400);
  out.afterSearchClick = label();
  out.pickedOther = await pickSession('other');
  out.other = label();
  out.searchOther = await search(/other/);
  (await openList()).find(b => name(b) === 'third')?.click();
  await wait(1200);
  out.thirdAgain = label();
  await front(shellTab());
  await wait(1000);
  out.byTab = label();
  return out;
`);
claim("the project switch names the project of the session in front", projectRule.pickedShell && projectRule.shell === "scratch", `shell in front → "${projectRule.shell}"`);
claim("it lists all projects, the folders and the project overview, with the current folder ticked", ["All projects", "scratch ✓", "other", "third", "Project overview"].every((r) => projectRule.rows.includes(r)), projectRule.rows.join(" · "));
claim("a folder picked there is the project, and Search follows it", projectRule.third === "third" && /third/.test(projectRule.searchThird), `"${projectRule.third}" · Search: "${projectRule.searchThird}"`);
claim("the pick holds while the work goes on in a panel that is not a session", projectRule.afterSearchClick === "third", `after a click into Search: "${projectRule.afterSearchClick}"`);
claim("until another session comes to the front — picked in the session switch", projectRule.pickedOther && projectRule.other === "other" && /other/.test(projectRule.searchOther), `"${projectRule.other}" · Search: "${projectRule.searchOther}"`);
claim("or brought forward by its tab", projectRule.thirdAgain === "third" && projectRule.byTab === "scratch", `picked "${projectRule.thirdAgain}", then the shell's tab → "${projectRule.byTab}"`);

const projectSwitch = await rectOf('.switch[data-switch="project"]');
await mouse("mousePressed", projectSwitch.x + projectSwitch.w / 2, projectSwitch.y + projectSwitch.h / 2, { button: "left", clickCount: 1 });
await mouse("mouseReleased", projectSwitch.x + projectSwitch.w / 2, projectSwitch.y + projectSwitch.h / 2, { button: "left", clickCount: 1 });
const thirdRow = await tab.run(`${HELPERS}
  const got = await until(() => [...document.querySelectorAll('body > .menu .menuItem')].find(b => b.querySelector('.menuLabel')?.firstChild?.textContent.trim() === 'third'), 3000);
  const r = got.v?.getBoundingClientRect();
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
`);
if (thirdRow) {
  await mouse("mousePressed", thirdRow.x, thirdRow.y, { button: "right", clickCount: 1 });
  await mouse("mouseReleased", thirdRow.x, thirdRow.y, { button: "right", clickCount: 1 });
}
const projectRowMenu = await tab.run(`${HELPERS}
  await wait(300);
  const rows = menuRows();
  const danger = [...document.querySelectorAll('body > .menu .menuItem.danger')].map(b => b.textContent.trim());
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(150);
  return { rows, danger };
`);
claim("right-click on a project switch row offers COPY PATH / Remove folder", ["COPY PATH", "Remove folder"].every((r) => projectRowMenu.rows.includes(r)) && projectRowMenu.danger.includes("Remove folder"), `${projectRowMenu.rows.join(" · ")} · danger: ${projectRowMenu.danger.join(",")}`);

// From the keyboard: Enter on the switch, the keyboard on the ticked row, the arrows and Enter pick.
await tab.run(`document.querySelector('.switch[data-switch="project"]').focus();`);
await pressKey("Enter", "Enter", 13);
const projectKeys = await tab.run(`${HELPERS}
  await until(() => document.querySelector('body > .menu .menuField'), 2000);
  await wait(150);
  const a = document.activeElement;
  const on = a?.querySelector?.('.menuLabel')?.firstChild?.textContent.trim() ?? a?.tagName;
  return { on, ticked: a?.getAttribute?.('aria-checked') };
`);
await pressKey("ArrowDown", "ArrowDown", 40);
const projectNext = await tab.run(`const a = document.activeElement; return a?.querySelector?.('.menuLabel')?.firstChild?.textContent.trim() ?? a?.tagName;`);
await pressKey("Enter", "Enter", 13);
const projectPicked = await tab.run(`${HELPERS} await wait(1000); return { label: document.querySelector('.switch[data-switch="project"] .switchLabel')?.textContent.trim() ?? '', closed: !document.querySelector('body > .menu') };`);
claim("the project switch works from the keyboard: Enter opens it on the ticked row, the arrows and Enter pick", projectKeys.on === "scratch" && projectKeys.ticked === "true" && projectNext && projectNext !== "scratch" && projectPicked.closed && projectPicked.label === projectNext,
  `on "${projectKeys.on}" (ticked ${projectKeys.ticked}) → ArrowDown "${projectNext}" → Enter → "${projectPicked.label}"`);

// ---- report --------------------------------------------------------------------------
report();

function report(crash) {
let bad = 0;
for (const c of claims) {
  if (!c.ok) bad++;
  console.log(`  ${c.ok ? "ok " : "NOT"}  ${c.what}${c.detail ? `\n         ${c.detail}` : ""}`);
}
if (crash) console.log(`\n  the run crashed: ${crash}`);
console.log(bad ? `\n  ${bad} of ${claims.length} claims failed` : `\n  all ${claims.length} claims hold`);
stop(bad || crash ? 1 : 0);
}
