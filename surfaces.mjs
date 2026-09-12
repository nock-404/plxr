/* Is everything reachable from something you can see?
 *
 * The header MENU, the ⌘K palette and its typing guard, the right-click menus
 * on the terminal, the rail and the session title, the tooltip on the opaque
 * surface, the settings as a window that can be dragged, a terminal setting
 * reaching the running xterm, a rebound key that fires, a layout saved and
 * applied. None of that can be seen from the code — it is measured here, in a
 * real browser against a service of its own, the way changes.mjs does it, and
 * the numbers are printed rather than a green line.
 *
 * Note: this is Blink, not the WKWebView the app ships in. Reachability,
 * geometry and the clipboard's refusal path are proven here; how the opaque
 * surfaces composite in the real window is Phase 0's capture path.
 */
import { spawn } from "node:child_process";
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

const APP = "/tmp/plxr3-app";
if (!existsSync(APP)) {
  console.log("  /tmp/plxr3-app is not there — run ./build.sh first");
  process.exit(1);
}
const app = spawn(APP, ["daemon"], { env: { ...process.env, PLXR_HOME: home }, stdio: "ignore" });

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
  try { chrome.kill(); } catch { /* gone */ }
  try {
    const pid = JSON.parse(readFileSync(join(home, "daemon.json"), "utf8")).pid;
    process.kill(pid);
  } catch { /* gone */ }
  try { app.kill(); } catch { /* gone */ }
  for (let i = 0; i < 20; i++) {
    try { rmSync(profile, { recursive: true, force: true }); break; }
    catch { const until = Date.now() + 100; while (Date.now() < until); }
  }
  try { rmSync(home, { recursive: true, force: true }); } catch { /* later */ }
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
  const input = document.querySelector('.filter input');
  input.focus();
  const prevented = key(input, { key: 'k', metaKey: true });
  await wait(200);
  const opened = Boolean(document.querySelector('body .palette'));
  input.blur();
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
const gear = await rectOf('[aria-pressed]');
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

// ---- Settings as a window ----------------------------------------------------------
await mouse("mousePressed", gear.x + gear.w / 2, gear.y + gear.h / 2, { button: "left", clickCount: 1 });
await mouse("mouseReleased", gear.x + gear.w / 2, gear.y + gear.h / 2, { button: "left", clickCount: 1 });
const win = await tab.run(`${HELPERS}
  const got = await until(() => document.querySelector('body > .window'), 2000);
  const w = got.v;
  const tabs = [...document.querySelectorAll('.window .tab')].map(t => t.textContent.trim());
  const body = document.querySelector('.body').getBoundingClientRect();
  return w ? { onBody: w.parentElement === document.body, alpha: alphaOf(w), z: getComputedStyle(w).zIndex, tabs, ms: got.ms,
    rect: (r => ({ x: r.left, y: r.top, w: r.width, h: r.height }))(w.getBoundingClientRect()), bodyTop: body.top, inner: innerWidth, innerH: innerHeight, aside: document.querySelector('.settingspanel') !== null } : null;
`);
claim("Settings opens as a .window portalled to <body>, opaque, not a docked column", win && win.onBody && win.alpha === 1 && !win.aside, win ? `alpha ${win.alpha} z ${win.z} after ${win.ms} ms` : "no window");
claim("it opens snapped to the right edge, below the header, as tall as the work area", win && Math.abs((win.rect.x + win.rect.w) - win.inner) < 12 && Math.abs(win.rect.y - win.bodyTop) < 2 && Math.abs((win.rect.y + win.rect.h) - win.innerH) < 12,
  win ? `window ${Math.round(win.rect.x)},${Math.round(win.rect.y)} ${Math.round(win.rect.w)}×${Math.round(win.rect.h)} · viewport ${win.inner}×${win.innerH} · body top ${Math.round(win.bodyTop)}` : "");
claim("it has the nine tabs", win && ["skins & palette", "terminal", "editor", "keys", "accounts", "layouts", "notify", "agents", "status"].every((t) => win.tabs.includes(t)), win ? win.tabs.join(" · ") : "");

// Drag it by the title bar: press, move, release through the protocol.
const head = await rectOf(".windowHead");
const before = await rectOf(".window");
await mouse("mousePressed", head.x + head.w / 2, head.y + head.h / 2, { button: "left", clickCount: 1 });
await mouse("mouseMoved", head.x + head.w / 2 - 150, head.y + head.h / 2 - 20, { button: "left" });
await mouse("mouseMoved", head.x + head.w / 2 - 300, head.y + head.h / 2 - 40, { button: "left" });
await mouse("mouseReleased", head.x + head.w / 2 - 300, head.y + head.h / 2 - 40, { button: "left", clickCount: 1 });
await sleep(100);
const after = await rectOf(".window");
claim("dragging the title bar moves the window by the pointer's travel (−300, −40)", Math.round(after.x - before.x) === -300 && Math.round(after.y - before.y) === -40,
  `from ${Math.round(before.x)},${Math.round(before.y)} to ${Math.round(after.x)},${Math.round(after.y)} (Δ ${Math.round(after.x - before.x)}, ${Math.round(after.y - before.y)})`);
// Resize by the corner grip.
const grip = await rectOf(".windowGrip");
await mouse("mousePressed", grip.x + grip.w / 2, grip.y + grip.h / 2, { button: "left", clickCount: 1 });
await mouse("mouseMoved", grip.x + grip.w / 2 + 80, grip.y + grip.h / 2 - 100, { button: "left" });
await mouse("mouseReleased", grip.x + grip.w / 2 + 80, grip.y + grip.h / 2 - 100, { button: "left", clickCount: 1 });
await sleep(100);
const sized = await rectOf(".window");
claim("dragging the corner grip resizes it (+80, −100)", Math.round(sized.w - after.w) === 80 && Math.round(sized.h - after.h) === -100,
  `${Math.round(after.w)}×${Math.round(after.h)} → ${Math.round(sized.w)}×${Math.round(sized.h)}`);

// ---- a terminal setting reaches the running xterm --------------------------------
const cursor = await tab.run(`${HELPERS}
  byText('.window .tab', /^terminal$/).click();
  await wait(200);
  const term = document.querySelector('.ptermbox').xterm;
  const was = { style: term.options.cursorStyle, blink: term.options.cursorBlink, scrollback: term.options.scrollback };
  // The cursor picker is the Select in the cursor field; open it and pick BAR.
  const field = byText('.window .fieldName', /^cursor$/).closest('.field');
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
  byText('.window .tab', /^keys$/).click();
  await wait(200);
  const row = [...document.querySelectorAll('.window .keyRow')].find(r => /command palette/.test(r.textContent));
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
  const before = [...document.querySelectorAll('.plxrDock .dv-tab')].map(t => t.textContent.trim());
  key(document.body, { key: '6', metaKey: true });
  const got = await until(() => [...document.querySelectorAll('.plxrDock .dv-tab')].some(t => /^Usage$/.test(t.textContent.trim())) ? true : null, 3000);
  return { before, opened: Boolean(got.v), ms: got.ms };
`);
claim("⌘6 opens the Usage view (the ⌘1…7 row is true, not phantom)", viewKey.opened, `Usage tab after ${viewKey.ms} ms · before: ${viewKey.before.join(", ")}`);

// ---- save and apply a named layout ------------------------------------------------
const saved = await tab.run(`${HELPERS}
  byText('.window .tab', /^layouts$/).click();
  await wait(200);
  byText('.window [data-do="save-layout"]', /Save current as/).click();
  const ask = await until(() => document.querySelector('.card.ask input'), 2000);
  const askZ = getComputedStyle(document.querySelector('.card.ask').closest('.backdrop')).zIndex;
  const winZ = getComputedStyle(document.querySelector('.window')).zIndex;
  ask.v.value = 'bench';
  ask.v.dispatchEvent(new Event('input', { bubbles: true }));
  byText('.card.ask button', /^SAVE$/).click();
  const row = await until(() => byText('.window .presetRow .presetName', /^bench$/), 3000);
  const inUse = row.v && row.v.closest('.presetRow').dataset.current;
  const prefs = await (await fetch('/api/prefs', { headers: { 'X-Plxr-Token': ${JSON.stringify(info.token)} } })).json();
  const names = (prefs.dockPresets?.items ?? []).map(p => p.name);
  const panels = [...document.querySelectorAll('.plxrDock .dv-tab')].map(t => t.textContent.trim());
  return { askZ, winZ, listed: Boolean(row.v), inUse, names, panels, ms: row.ms };
`);
claim("Save current as… asks in the shell's dialog, which stands over the window", Number(saved.askZ) > Number(saved.winZ), `dialog z ${saved.askZ} · window z ${saved.winZ}`);
claim("the named layout is listed as in use and stored under prefs.dockPresets", saved.listed && saved.inUse === "yes" && saved.names.includes("bench"), `presets ${saved.names.join(",")} after ${saved.ms} ms · panels ${saved.panels.join(", ")}`);
const applied = await tab.run(`${HELPERS}
  // Reset the arrangement, then bring the saved one back.
  byText('.window [data-do="reset-layout"]', /Reset/).click();
  await until(() => [...document.querySelectorAll('.plxrDock .dv-tab')].length <= 2 ? true : null, 3000);
  const afterReset = [...document.querySelectorAll('.plxrDock .dv-tab')].map(t => t.textContent.trim());
  byText('.window .presetRow [data-do="apply-layout"]', /APPLY/).click();
  const got = await until(() => [...document.querySelectorAll('.plxrDock .dv-tab')].some(t => /^Usage$/.test(t.textContent.trim())) ? true : null, 3000);
  const afterApply = [...document.querySelectorAll('.plxrDock .dv-tab')].map(t => t.textContent.trim());
  return { afterReset, afterApply, ms: got.ms };
`);
claim("Reset clears the arrangement and APPLY brings the saved one back", !applied.afterReset.includes("Usage") && applied.afterApply.includes("Usage") && applied.afterApply.includes("shell"),
  `reset → ${applied.afterReset.join(", ")} · apply → ${applied.afterApply.join(", ")} after ${applied.ms} ms`);

// ---- Esc closes the topmost thing only ----------------------------------------------
const escLadder = await tab.run(`${HELPERS}
  byText('.window [data-do="save-layout"]', /Save current as/).click();
  await until(() => document.querySelector('.card.ask'), 2000);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(200);
  return { askGone: !document.querySelector('.card.ask'), windowStays: Boolean(document.querySelector('body > .window')) };
`);
claim("Esc in a dialog asked from the settings closes the dialog and leaves the window", escLadder.askGone && escLadder.windowStays, `dialog gone ${escLadder.askGone} · window stays ${escLadder.windowStays}`);

// ---- the editor takes its settings live ------------------------------------------
const editor = await tab.run(`${HELPERS}
  // Open a file in an editor panel beside the terminal, then change the tab width.
  byText('.railitem .rname', /^Folders$/).closest('.railitem').click();
  await until(() => document.querySelector('.frow'), 4000);
  byText('.frow .fname', /^a\\.txt$/)?.closest('.frow').click();
  const cm = await until(() => document.querySelector('.editorPanel .cm-content'), 4000);
  if (!cm.v) return { opened: false };
  const view = cm.v.cmTile?.root?.view ?? cm.v.cmView?.view;
  const before = view.state.tabSize;
  byText('.window .tab', /^editor$/).click();
  await wait(200);
  const field = byText('.window .fieldName', /^tab width$/).closest('.field');
  field.querySelector('.selectButton').click();
  await wait(100);
  byText('body > .selectList .selectRow', /^8$/).click();
  const got = await until(() => view.state.tabSize === 8 ? true : null, 2000);
  // And wrapping off: CodeMirror marks a wrapping editor with a class.
  const wrapped = cm.v.classList.contains('cm-lineWrapping');
  byText('.window .fieldName', /^long lines$/).closest('.field').querySelector('.styleToggle').click();
  const unwrapped = await until(() => cm.v.classList.contains('cm-lineWrapping') ? null : true, 2000);
  return { opened: true, before, after: view.state.tabSize, ms: got.ms, wrapped, unwrapped: Boolean(unwrapped.v), wrapMs: unwrapped.ms };
`);
claim("changing the tab width reaches the open CodeMirror editor (state.tabSize)", editor.opened && editor.before === 2 && editor.after === 8, editor.opened ? `${editor.before} → ${editor.after} after ${editor.ms} ms` : "no editor opened");
claim("switching long lines to SCROLL takes the wrapping off the open editor", editor.opened && editor.wrapped && editor.unwrapped, editor.opened ? `cm-lineWrapping ${editor.wrapped} → ${!editor.unwrapped} after ${editor.wrapMs} ms` : "");

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
