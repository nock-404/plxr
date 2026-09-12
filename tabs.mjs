/* Do the dock's tabs do what they say?
 *
 * Every panel's tab carries a menu, a close that asks first, and the keys
 * that walk between panels. This drives them the way somebody would and
 * holds the window to it: the menu has its six entries, "close others"
 * leaves one, "float" makes a floating group and "dock" takes it away again
 * (and the floating group is in what the layout saves), ⌘W on a running
 * session asks with three buttons and cancel keeps the panel, ⌘W on a plain
 * utility panel closes it, ⌥⌘← → walk the panels, ⌥⌘↑ ↓ the groups.
 *
 * Held against a daemon started from this build, the way clicked.mjs does it;
 * the session it needs is made for the check and terminated afterwards.
 */
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
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
  fetch(base + path, { ...init, headers: { "X-Plxr-Token": info.token, ...(init.headers ?? {}) } }).then((r) =>
    r.status === 204 ? null : r.json(),
  );

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

const port = 9500 + Math.floor(Number(process.pid) % 400);
const profile = mkdtempSync(join(tmpdir(), "plxr-tabs-"));
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
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let made = null;
async function stop(code) {
  if (made) await api(`/api/sessions/${encodeURIComponent(made.id)}`, { method: "DELETE" }).catch(() => undefined);
  try {
    child.kill();
  } catch {
    /* already gone */
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

// A session of this check's own, a plain shell, so a "running session" is
// on hand whatever else the service holds.
made = await api("/api/sessions", { method: "POST", body: JSON.stringify({ cwd: tmpdir(), cmd: [], name: "plxr-tabs-check", account: "" }) }).catch(() => null);
if (!made?.id) {
  console.log("  could not start a session for the check");
  await stop(1);
}

await cdp.send("Page.navigate", { url: `${base}/?token=${info.token}` });
await sleep(3000);

const loaded = await run(`return { app: !!document.querySelector(".app"), rail: document.querySelectorAll(".railhome").length };`).catch(() => null);
if (!loaded?.app || !loaded.rail) {
  console.log("  the interface did not render — nothing to check");
  await stop(1);
}

/* The helpers the page-side steps share. Tabs are found by their text — the
   tab's text is its title and nothing else, which is the point of the
   skin-drawn close glyph. A right-click is the contextmenu event on the tab's
   own element, and keys are keydown events on whatever has focus, read by
   the same window listener a real key reaches. */
const HELPERS = `
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const tabs = () => [...document.querySelectorAll('.dv-tab')];
  const tabNamed = (name) => tabs().find(t => t.textContent.trim() === name);
  const groupOf = (tab) => tab.closest('.dv-tabs-and-actions-container');
  const tabsIn = (tab) => [...groupOf(tab).querySelectorAll('.dv-tab')].map(t => t.textContent.trim());
  const rightClick = async (tab) => {
    const el = tab.querySelector('.panelTab') || tab;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 8, button: 2 }));
    await wait(150);
  };
  const menuLabels = () => [...document.querySelectorAll('.menu .menuItem')].map(b => b.querySelector('.menuLabel').textContent.trim());
  const pick = async (label) => {
    const b = [...document.querySelectorAll('.menu .menuItem')].find(b => b.querySelector('.menuLabel').textContent.trim() === label);
    if (!b) throw new Error('no menu entry ' + label);
    b.click();
    await wait(300);
  };
  const key = async (k, mods = {}) => {
    const target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods }));
    await wait(300);
  };
  const openView = async (name) => {
    const item = [...document.querySelectorAll('.railitem')].find(e => e.textContent.includes(name));
    if (!item) throw new Error('no rail item ' + name);
    item.click();
    await wait(500);
  };
  // Dockview activates a tab on pointerdown, not on click.
  const activate = async (tab) => {
    tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    tab.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    await wait(200);
  };
  const activeTab = () => document.querySelector('.dv-groupview.dv-active-group .dv-tab.dv-active-tab')?.textContent.trim() || '';
  const activeGroupTabs = () => {
    const g = document.querySelector('.dv-groupview.dv-active-group');
    return g ? [...g.querySelectorAll('.dv-tab')].map(t => t.textContent.trim()) : [];
  };
`;

// ---- the menu on a tab -----------------------------------------------------
const menu = await run(`${HELPERS}
  await openView('Usage'); await openView('Inbox');
  const usage = tabNamed('Usage');
  if (!usage) return { noTab: true };
  await rightClick(usage);
  const labels = menuLabels();
  const before = tabsIn(usage);
  await pick('Close others in group');
  const after = tabNamed('Usage') ? tabsIn(tabNamed('Usage')) : [];
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  return { labels, before, after };
`);
claim("a right-click on a tab opens the window's own menu with six entries", !menu.noTab && menu.labels?.length === 6, JSON.stringify(menu.labels));
claim(
  "the six entries are close, close others, close group, float, move to the other lane, copy title",
  JSON.stringify(menu.labels) === JSON.stringify(["Close", "Close others in group", "Close group", "Float", "Move to the other lane", "Copy title"]),
);
claim("close others leaves one tab in the group", menu.before?.length >= 2 && menu.after?.length === 1 && menu.after[0] === "Usage", `${JSON.stringify(menu.before)} → ${JSON.stringify(menu.after)}`);

// ---- float and dock ----------------------------------------------------------
const floated = await run(`${HELPERS}
  const usage = tabNamed('Usage');
  await rightClick(usage);
  await pick('Float');
  await wait(700);
  const floating = document.querySelectorAll('.dv-resize-container:not(.dv-hidden) .dv-groupview').length;
  const inFloat = !!tabNamed('Usage')?.closest('.dv-resize-container');
  await rightClick(tabNamed('Usage'));
  const labels = menuLabels();
  await pick('Dock');
  await wait(400);
  const after = document.querySelectorAll('.dv-resize-container:not(.dv-hidden) .dv-groupview').length;
  const backInGrid = !!tabNamed('Usage') && !tabNamed('Usage').closest('.dv-resize-container');
  return { floating, inFloat, labels, after, backInGrid };
`);
claim("float makes a floating group holding the panel", floated.floating >= 1 && floated.inFloat, `${floated.floating} floating`);
claim("a floating panel's menu says dock", floated.labels?.includes("Dock") && !floated.labels?.includes("Float"), JSON.stringify(floated.labels));
claim("dock takes the floating group away and the panel is back in the grid", floated.after === 0 && floated.backInGrid);

// The floating group has to be in what the layout saves, or it is gone at
// the next start. Floated, waited past the save debounce, read back from the
// service's prefs — then docked again so nothing is left floating.
const persisted = await run(`${HELPERS}
  await rightClick(tabNamed('Usage'));
  await pick('Float');
  await wait(900);
  return true;
`);
const prefs = await api("/api/prefs").catch(() => ({}));
const savedFloating = Array.isArray(prefs?.dock?.floatingGroups) ? prefs.dock.floatingGroups.length : 0;
claim("the saved layout carries the floating group", persisted && savedFloating === 1, `${savedFloating} in prefs.dock.floatingGroups`);
await cdp.send("Page.reload");
await sleep(3500);
const restored = await run(`${HELPERS}
  const inFloat = !!tabNamed('Usage')?.closest('.dv-resize-container');
  if (inFloat) { await rightClick(tabNamed('Usage')); await pick('Dock'); await wait(400); }
  return { inFloat, left: document.querySelectorAll('.dv-resize-container:not(.dv-hidden) .dv-groupview').length };
`);
claim("a floating group comes back floating after a reload", restored.inFloat && restored.left === 0);

// ---- ⌘W through the guard ----------------------------------------------------
const guarded = await run(`${HELPERS}
  const item = [...document.querySelectorAll('.railitem')].find(e => e.textContent.includes('plxr-tabs-check'));
  if (!item) return { noSession: true };
  item.click();
  await wait(1500);
  const tab = tabs().find(t => t.textContent.trim().includes('plxr-tabs-check'));
  if (!tab) return { noTab: true };
  await activate(tab);
  const state = { active: activeTab(), focus: document.activeElement?.tagName, covered: !!document.querySelector('.backdrop, .paletteScrim') };
  await key('w', { metaKey: true });
  const ask = document.querySelector('.ask');
  const buttons = ask ? [...ask.querySelectorAll('.cardButtons .btn')].map(b => b.textContent.trim()) : [];
  const cancel = ask ? [...ask.querySelectorAll('.cardButtons .btn')].find(b => b.textContent.trim() === 'CANCEL') : null;
  if (cancel) cancel.click();
  await wait(300);
  const stillAsking = !!document.querySelector('.ask');
  const stillThere = !!tabs().find(t => t.textContent.trim().includes('plxr-tabs-check'));
  return { buttons, stillAsking, stillThere, state };
`);
const liveNow = (await api("/api/sessions")).find((s) => s.id === made.id)?.alive;
claim("⌘W on a running session asks with three buttons", guarded.buttons?.length === 3, `${JSON.stringify(guarded.buttons)} ${JSON.stringify(guarded.state)} alive=${liveNow}`);
claim(
  "the three are cancel, terminate, keep running",
  JSON.stringify(guarded.buttons) === JSON.stringify(["CANCEL", "TERMINATE", "KEEP RUNNING"]),
);
claim("cancel keeps the panel", !guarded.stillAsking && guarded.stillThere);

const plain = await run(`${HELPERS}
  const usage = tabNamed('Usage');
  if (!usage) return { noTab: true };
  await activate(usage);
  await key('w', { metaKey: true });
  return { asked: !!document.querySelector('.ask'), gone: !tabNamed('Usage') };
`);
claim("⌘W on a clean utility panel closes it without asking", !plain.noTab && !plain.asked && plain.gone);

// ---- keep running: the panel goes, the session stays ------------------------
const kept = await run(`${HELPERS}
  const tab = tabs().find(t => t.textContent.trim().includes('plxr-tabs-check'));
  await activate(tab);
  await key('w', { metaKey: true });
  const keep = [...document.querySelectorAll('.ask .cardButtons .btn')].find(b => b.textContent.trim() === 'KEEP RUNNING');
  if (!keep) return { noKeep: true };
  keep.click();
  await wait(400);
  return { gone: !tabs().find(t => t.textContent.trim().includes('plxr-tabs-check')), asking: !!document.querySelector('.ask') };
`);
const afterKeep = await api("/api/sessions");
const stillAlive = afterKeep.find((s) => s.id === made.id)?.alive === true;
claim("keep running closes the panel and leaves the session alive", !kept.noKeep && kept.gone && !kept.asking && stillAlive);

// ---- the keys between panels and groups -------------------------------------
const walked = await run(`${HELPERS}
  await openView('plxr-tabs-check');
  await openView('Usage'); await openView('Inbox'); await openView('Ports');
  const first = activeTab();
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
claim("⌥⌘← moves to the previous panel of the group", walked.first === "Ports" && walked.left === "Inbox", `${walked.first} → ${walked.left}`);
claim("⌥⌘→ moves to the next panel of the group", walked.right === "Ports", `${walked.left} → ${walked.right}`);
claim(
  "⌥⌘↓ moves to another group and ⌥⌘↑ comes back",
  JSON.stringify(walked.groupBefore) !== JSON.stringify(walked.groupAfter) && JSON.stringify(walked.groupBack) === JSON.stringify(walked.groupBefore),
  `${JSON.stringify(walked.groupBefore)} → ${JSON.stringify(walked.groupAfter)} → ${JSON.stringify(walked.groupBack)}`,
);

// ---- the other lane, the close glyph, the middle button ----------------------
const lanes = await run(`${HELPERS}
  const sess = tabs().find(t => t.textContent.trim().includes('plxr-tabs-check'));
  if (!sess) return { noSession: true };
  const usage = tabNamed('Usage');
  const apart = groupOf(usage) !== groupOf(sess);
  await rightClick(usage);
  await pick('Move to the other lane');
  const together = groupOf(tabNamed('Usage')) === groupOf(sess);
  await rightClick(tabNamed('Usage'));
  await pick('Move to the other lane');
  const apartAgain = groupOf(tabNamed('Usage')) !== groupOf(sess) && !!tabNamed('Usage');
  return { apart, together, apartAgain };
`);
claim("move to the other lane tabs a utility beside the terminal, and back out again", !lanes.noSession && lanes.apart && lanes.together && lanes.apartAgain, JSON.stringify(lanes));

const glyph = await run(`${HELPERS}
  await openView('Archive');
  const archive = tabNamed('Archive');
  archive.querySelector('.panelTabClose').click();
  await wait(300);
  const closedByGlyph = !tabNamed('Archive');
  await openView('Archive');
  tabNamed('Archive').querySelector('.panelTab').dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
  await wait(300);
  const closedByMiddle = !tabNamed('Archive');
  return { closedByGlyph, closedByMiddle, asked: !!document.querySelector('.ask') };
`);
claim("the tab's close glyph closes a clean panel", glyph.closedByGlyph && !glyph.asked);
claim("the middle button closes a clean panel", glyph.closedByMiddle && !glyph.asked);

// ---- terminate from the guard -------------------------------------------------
const ended = await run(`${HELPERS}
  await openView('plxr-tabs-check');
  const tab = tabs().find(t => t.textContent.trim().includes('plxr-tabs-check'));
  if (!tab) return { noTab: true };
  await activate(tab);
  await key('w', { metaKey: true });
  const kill = [...document.querySelectorAll('.ask .cardButtons .btn')].find(b => b.textContent.trim() === 'TERMINATE');
  if (!kill) return { noKill: true };
  kill.click();
  await wait(800);
  return { gone: !tabs().find(t => t.textContent.trim().includes('plxr-tabs-check')), asking: !!document.querySelector('.ask') };
`);
// A shell ignores SIGTERM; the service follows up with SIGKILL after a grace
// period, so the end is waited for rather than expected at once.
let killed;
for (let i = 0; i < 40; i++) {
  killed = (await api("/api/sessions")).find((s) => s.id === made.id);
  if (!killed || killed.alive === false) break;
  await sleep(250);
}
claim("terminate closes the panel and ends the session", !ended.noTab && !ended.noKill && ended.gone && !ended.asking && (!killed || killed.alive === false), JSON.stringify({ ...ended, alive: killed?.alive }));

// ---- close group ---------------------------------------------------------------
const closedGroup = await run(`${HELPERS}
  const ports = tabNamed('Ports');
  const before = tabsIn(ports);
  await rightClick(ports);
  await pick('Close group');
  await wait(300);
  return { before, left: ['Usage', 'Inbox', 'Ports'].filter(n => tabNamed(n)) };
`);
claim("close group closes every panel of the group", closedGroup.before?.length === 3 && closedGroup.left?.length === 0, `${JSON.stringify(closedGroup.before)} → ${JSON.stringify(closedGroup.left)}`);

cdp.close();

// ---- the verdict ----------------------------------------------------------
const failed = claims.filter((c) => !c.ok);
if (claims.length === 0) {
  console.log("  checked nothing at all — the window did not load");
  await stop(1);
}
if (process.env.TABS_VERBOSE) for (const c of claims) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.what}${c.detail ? ` — ${c.detail}` : ""}`);
if (failed.length) {
  console.log(`  ${failed.length} of ${claims.length} claims failed:`);
  for (const f of failed) console.log(`      ${f.what}${f.detail ? ` — ${f.detail}` : ""}`);
  await stop(1);
}
console.log(`  the tabs do what they say — ${claims.length} claims checked`);
await stop(0);
