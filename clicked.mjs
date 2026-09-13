/* Does the window actually work?
 *
 * `clicked through` records that somebody looked at this build. That is worth
 * having — a hash nobody can fake into saying yes — but it proves attention,
 * not correctness. This one makes claims and checks them: the overview shows as
 * many tiles as the daemon has sessions, every view opens with either content or
 * its empty state, a session shows a terminal with something in it.
 *
 * Everything is held against what the daemon reports, not against numbers
 * written down here, so it stays true as the machine changes.
 *
 * No dependencies: the browser already on the machine, driven over its
 * debugging protocol, the same way geometry.mjs does it.
 */
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
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
  console.log(`  no daemon under ${HOME} — this check needs a live window`);
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
const api = (path) =>
  fetch(base + path, { headers: { "X-Plxr-Token": info.token } }).then((r) => r.json());

/* Which daemon is this?
 *
 * `~/.plxr/daemon.json` points at whichever plxr is running — and on this
 * machine that is usually the installed one, a different program from the build
 * in this directory. Checked against it, this gate reported a settings panel
 * with three tabs and a skin change that did nothing, and it was right: it was
 * looking at another application. Worse, it clicked around inside somebody's
 * live window.
 *
 * So the page the daemon serves is held against the page this build produced.
 * They match, or nothing happens.
 */
async function servesThisBuild() {
  let mine;
  try {
    mine = readFileSync(join(HERE, "frontend", "out", "index.html"), "utf8");
  } catch {
    return { ok: false, why: "this build has no frontend/out — run ./build.sh first" };
  }
  let theirs;
  try {
    theirs = await fetch(`${base}/?token=${info.token}`).then((r) => r.text());
  } catch {
    return { ok: false, why: "the daemon did not answer" };
  }
  if (theirs.trim() !== mine.trim()) {
    return {
      ok: false,
      why:
        `the daemon on port ${info.port} serves a different build than this one.\n` +
        "      Point PLXR_HOME at a daemon started from this directory:\n" +
        "          PLXR_HOME=/tmp/plxr-check ./plxr daemon &\n" +
        "      Checking somebody else's running window is worse than not checking.",
    };
  }
  return { ok: true };
}

const identity = await servesThisBuild();
if (!identity.ok) {
  console.log(`  ${identity.why}`);
  process.exit(1);
}

const port = 9500 + Math.floor(Number(process.pid) % 400);
const profile = mkdtempSync(join(tmpdir(), "plxr-clicked-"));
const child = spawn(browser, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  // Nothing of this browser's is worth keeping, and asking the system's keychain
  // for a place to keep it puts a password prompt on somebody's screen in the
  // middle of a check. A mock keychain has the same effect here and asks nobody.
  "--use-mock-keychain",
  "--password-store=basic",
  "--no-default-browser-check",
  "--window-size=1440,900",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stop(code) {
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
  stop(1);
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
};

const claims = [];
const claim = (what, ok, detail = "") => claims.push({ what, ok: Boolean(ok), detail });

await cdp.send("Page.navigate", { url: `${base}/?token=${info.token}` });
await sleep(3000);

// Nothing below can mean anything if the interface never rendered. Saying that
// plainly beats letting the first query throw a stack trace at somebody.
const loaded = await run(`
  return {
    app: !!document.querySelector(".app"),
    rail: document.querySelectorAll(".railhome").length,
  };
`).catch(() => null);
if (!loaded?.app || !loaded.rail) {
  console.log("  the interface did not render — nothing to check");
  stop(1);
}

// ---- what the daemon says, as the yardstick -------------------------------
const sessions = await api("/api/sessions");
const ports = await api("/api/ports");

// ---- the overview ---------------------------------------------------------
const overview = await run(`
  const wait = ms => new Promise(r => setTimeout(r, ms));
  document.querySelectorAll('.railhome')[0].click();
  await wait(600);
  const tiles = [...document.querySelectorAll('.tile')];
  return {
    tiles: tiles.length,
    withTitle: tiles.filter(t => (t.querySelector('.tname')?.textContent || '').trim()).length,
    withState: tiles.filter(t => (t.querySelector('.act')?.textContent || '').trim()).length,
    withDot: tiles.filter(t => t.querySelector('.dot')).length,
    railSessions: document.querySelectorAll('.railitem:has(.rsub)').length,
    strip: (document.querySelector('.statusrow span')?.textContent || '').trim(),
    emptyState: !!document.querySelector('.emptybox'),
  };
`);

if (sessions.length === 0) {
  claim("overview explains itself when there is nothing", overview.emptyState);
} else {
  claim(
    "overview shows one tile per session",
    overview.tiles === sessions.length,
    `${overview.tiles} tiles, ${sessions.length} sessions`,
  );
  claim("every tile carries a title", overview.withTitle === overview.tiles);
  claim("every tile carries a state word", overview.withState === overview.tiles);
  claim("every tile carries a dot", overview.withDot === overview.tiles);
  claim(
    "the rail lists the same sessions",
    overview.railSessions === sessions.length,
    `${overview.railSessions} in the rail`,
  );
  claim(
    "the status strip counts them",
    overview.strip.includes(String(sessions.length)),
    overview.strip,
  );
}

// ---- every view opens, and none of them is a blank area -------------------
for (const [name, expectRows] of [
  ["Inbox", null],
  ["Ports", ports.length],
  ["Usage", null],
  ["Archive", null],
]) {
  const view = await run(`
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const item = [...document.querySelectorAll('.railitem')].find(e => e.textContent.includes(${JSON.stringify(name)}));
    if (!item) return { missing: true };
    /* Waited for, not slept through — and for the new view, not the old one.
     *
     * A fixed 900ms was enough on an idle machine and not enough on a busy
     * one: this reported "Ports: 0 of 19" during a build and all 19 a minute
     * later, against the same code. Waiting for "a visible list with rows in
     * it" was no better, because the list being left is still on screen and
     * still has its rows — so it stopped at once and counted the wrong view.
     *
     * So: remember which element was there, wait for a different one, and
     * then wait for that one to have something to say. */
    const seen = () => [...document.querySelectorAll('.list')].find(el => el.offsetParent !== null);
    const before = seen();
    item.click();
    let view = null;
    for (let i = 0; i < 75; i++) {
      view = seen();
      const settled = view && (view.querySelectorAll('.row').length
        || view.querySelectorAll('.ublock').length || view.querySelector('.emptyNote'));
      if (view && view !== before && settled) break;
      await wait(200);
    }
    // Scoped to the section actually on screen. Counting rows anywhere in the
    // document and an empty note anywhere else produced a verdict that
    // contradicted itself — 25 rows and "it is empty" in the same breath.
    view = seen();
    if (!view) return { opened: false };
    const body = view.querySelector('.listbody');
    return {
      opened: true,
      rows: view.querySelectorAll('.row').length,
      blocks: view.querySelectorAll('.ublock').length,
      empty: !!view.querySelector('.emptyNote'),
      blank: !body || body.textContent.trim() === '',
    };
  `);
  claim(`${name} opens`, view.opened && !view.missing);
  claim(
    `${name} shows content or says why it is empty`,
    !view.blank && (view.rows > 0 || view.blocks > 0 || view.empty),
    `rows=${view.rows} blocks=${view.blocks} empty=${view.empty}`,
  );
  if (expectRows !== null && expectRows > 0) {
    claim(`${name} lists what the daemon reports`, view.rows === expectRows, `${view.rows} of ${expectRows}`);
  }
}

// ---- a session: the terminal is the whole point ---------------------------
const live = sessions.filter((s) => s.alive);
if (live.length > 0) {
  const session = await run(`
    const wait = ms => new Promise(r => setTimeout(r, ms));
    document.querySelectorAll('.railhome')[0].click();
    await wait(500);
    const tile = [...document.querySelectorAll('.tile')].find(t => t.dataset.status !== 'orphaned' && t.dataset.status !== 'dead');
    if (!tile) return { noLiveTile: true };
    tile.click();
    await wait(2200);
    const files = [...document.querySelectorAll('.btn')].find(b => b.textContent.trim() === 'FILES');
    if (files) { files.click(); await wait(1200); }
    return {
      inSession: !!document.querySelector('.session'),
      canvases: document.querySelectorAll('.pterm canvas').length,
      toolbar: [...document.querySelectorAll('.sessbar .btn')].length,
      fileRows: document.querySelectorAll('.frow').length,
    };
  `);
  claim("a session opens", session.inSession && !session.noLiveTile);
  claim("its terminal paints", session.canvases > 0, `${session.canvases} canvases`);
  claim("its toolbar is there", session.toolbar >= 6, `${session.toolbar} buttons`);

  /* The session bar is one line at any width, and hides nothing.
   *
   * It used to be a flex-wrap row with a spacer that took the first line for
   * itself, so it broke onto four lines even at 1440px and TERMINATE fell off
   * the bottom. Now it measures what fits and moves the rest under a single
   * "⋯". Checked at a wide width (everything on the bar) and a narrow one (the
   * row still one line, the overflow reachable through the menu), because the
   * window manager will hand this panel any width it likes. */
  const bar = await run(`
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const strip = document.querySelector('.sessbar');
    const overflows = () => strip.scrollWidth > strip.clientWidth + 2;
    const menuCount = async () => {
      const more = document.querySelector('.obarItems .obarMore');
      if (!more) return 0;
      more.click();
      await wait(120); // the menu renders on the next React tick, not on the click
      const n = document.querySelectorAll('.obarMenuItem').length;
      more.click();
      return n;
    };
    // Wide: the gate's own window (1400px). Everything on the bar, no overflow.
    await wait(200);
    const wide = { h: Math.round(strip.getBoundingClientRect().height), over: overflows() };
    // Narrow: force the strip's own box small; the ResizeObserver recomputes.
    strip.style.maxWidth = '520px';
    await wait(600);
    const narrow = { h: Math.round(strip.getBoundingClientRect().height), over: overflows(), menu: await menuCount() };
    strip.style.maxWidth = '';
    return { wide, narrow };
  `);
  claim("the session bar is one line when wide", bar.wide.h <= 56 && !bar.wide.over, JSON.stringify(bar.wide));
  claim("the session bar stays one line when narrow", bar.narrow.h <= 56 && !bar.narrow.over, JSON.stringify(bar.narrow));
  claim("what does not fit is in the overflow menu", bar.narrow.menu > 0, `${bar.narrow.menu} in the menu`);
  claim("the file tree loads", session.fileRows > 0, `${session.fileRows} entries`);

  /* The browser can change things, not only look at them, and the editor
     colours what it opens.

     Both were the whole of the complaint about these two panels: a tree that
     could open folders and nothing else, and a plain text box where an editor
     was supposed to be. A file is made, opened, and thrown away again, and what
     git thinks of it has to appear on its row while it exists. */
  const browser = await run(`
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const press = (el) => { el.click(); return wait(700); };
    const named = (re) => [...document.querySelectorAll('.frow')].find(r => re.test(r.textContent));

    const make = document.querySelector('.filesbar .btn[data-do="new-file"]');
    if (!make) return { why: 'no button for a new file' };
    await press(make);
    const box = document.querySelector('.ask .input');
    if (!box) return { why: 'the dialog asked nothing' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(box, 'plxr-gate-file.txt');
    box.dispatchEvent(new Event('input', { bubbles: true }));
    const create = document.querySelector('.ask .btn.primary');
    if (!create) return { why: 'the dialog had no way to say yes' };
    await press(create);
    await wait(1200);

    const row = named(/plxr-gate-file/);
    const madeIt = Boolean(row);
    const gitMark = row ? row.getAttribute('data-git') : null;

    let coloured = 0, gutter = false;
    if (row) {
      await press(row);
      await wait(1500);
      const cm = document.querySelector('.cm-editor');
      gutter = Boolean(cm && cm.querySelector('.cm-gutters'));
      coloured = cm ? cm.querySelectorAll('.cm-line').length : 0;
    }

    // and away again, so the gate leaves nothing behind
    let gone = false;
    const again = named(/plxr-gate-file/);
    if (again) {
      await press(again);
      const del = document.querySelector('.filesbar .btn[data-do="delete"]');
      if (del) {
        await press(del);
        const yes = [...document.querySelectorAll('.ask .btn.danger')][0];
        if (yes) { await press(yes); await wait(1200); }
      }
      gone = !named(/plxr-gate-file/);
    }
    return { madeIt, gitMark, gutter, lines: coloured, gone };
  `);
  claim("a file can be made from the browser", browser.madeIt, browser.why ?? "");
  /* Only where there is a git to ask.
   *
   * This claim first read "the mark must say untracked" and failed — not because
   * the marks were broken but because the directory under test is not a
   * repository, so there was nothing to mark. A check that cannot tell those two
   * apart is worse than none, and one that quietly skips is worse still: so it
   * asks the daemon which case this is and says which one it checked. */
  /* Whether this is a repository is a question about the directory, not about
     whether git happens to have something to say right now. Asking the status
     endpoint and taking an empty answer as "no git" was wrong the moment
     everything was committed: the answer went empty, the check took the wrong
     branch, and it failed on correct behaviour. */
  const isRepo = existsSync(join(sessions[0].cwd, ".git"));
  claim(
    isRepo ? "git says what it thinks of it" : "git is asked, and this directory has no git",
    isRepo ? browser.gitMark === "untracked" : browser.gitMark === "",
    isRepo ? `git said ${browser.gitMark || "(nothing)"}` : "not a repository — marks not exercised",
  );
  claim("the editor opens it with a gutter", browser.gutter && browser.lines > 0, `${browser.lines} lines`);
  claim("and it can be thrown away again", browser.gone);
}

// ---- the workbench, and whether a fault leaves this window ----------------
//
// The window has no developer tools. A fault inside it used to be visible to
// whoever had the panel open at that moment and to nobody else, so every one of
// them had to be found by asking what was on screen. The daemon keeps a
// window.log; this holds that faults actually reach it.
const before = (() => {
  try {
    return readFileSync(join(HOME, "window.log"), "utf8").length;
  } catch {
    return 0;
  }
})();

const bench = await run(`
  const wait = ms => new Promise(r => setTimeout(r, ms));
  console.error("plxr gate: a fault nobody was watching for");
  window.dispatchEvent(new ErrorEvent("error", { message: "plxr gate: thrown from nowhere", filename: "gate", lineno: 1 }));
  // One press, one event — dispatched on document it bubbles to window, where
  // the shell reads every shortcut off the keymap. Dispatched twice (as this
  // once was, once per listener that used to exist) F12 toggles twice.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "F12", bubbles: true }));
  await wait(1200);
  const panel = document.querySelector('.workbench');
  const shown = panel ? [...panel.querySelectorAll('.wbLine .wbText')].map(e => e.textContent) : [];
  await wait(4000);   // longer than the batch it is sent in
  return { opened: Boolean(panel), shown: shown.filter(t => t.includes('plxr gate')).length };
`);
claim("the workbench opens on F12", bench.opened);
claim("it shows what went wrong", bench.shown >= 2, `${bench.shown} of 2 lines`);

const after = (() => {
  try {
    return readFileSync(join(HOME, "window.log"), "utf8");
  } catch {
    return "";
  }
})();
claim("a fault reaches the daemon's log", after.length > before && after.includes("plxr gate"),
  `${after.length - before} bytes appended`);

// ---- settings, and a skin change that takes effect ------------------------
/* The settings are a panel in the dock, not a window on the body. They were a
   window, and a window is the one thing in this interface that cannot be
   docked anywhere — "why can I grab the settings and dock them nowhere?". As a
   panel they are tabbed, split, moved between the regions and floated like
   everything else, which is what the float-and-dock claims below prove. */
const settings = await run(`
  const wait = ms => new Promise(r => setTimeout(r, ms));
  document.querySelectorAll('.railhome')[0].click();
  await wait(400);
  const before = document.documentElement.getAttribute('data-skin');
  // The gear, by its glyph — not by index: buttons come and go in that row.
  [...document.querySelectorAll('.tools .btn')].find(b => /⚙/.test(b.textContent || b.title || '')).click();
  await wait(700);
  const opened = !!document.querySelector('.settingsPanel');
  // A panel among the others, and the work keeps a usable width beside it.
  const contentWidth = Math.round(document.querySelector('.content')?.getBoundingClientRect().width ?? -1);
  const windowStillThere = contentWidth > 100;
  const tabs = document.querySelectorAll('.settingsPanel .tab').length;
  const sel = [...document.querySelectorAll('.settingsPanel .select')][0];
  sel.querySelector('.selectButton').click();
  await wait(300);
  // The list hangs in the body while open, so that a scrolling card cannot cut
  // it off. Looking for it inside the select finds nothing.
  const rows = [...document.querySelectorAll('.selectList .selectRow')];
  const other = rows.find(r => r.textContent.trim().toLowerCase() !== (before || '').toLowerCase());
  const wanted = other ? other.textContent.trim() : null;
  if (other) other.click();
  await wait(500);
  const after = document.documentElement.getAttribute('data-skin');
  return { opened, windowStillThere, contentWidth, tabs, rows: rows.length, before, after, wanted };
`);
claim("settings open as a panel in the dock", settings.opened);
claim("settings have their tabs", settings.tabs >= 9, `${settings.tabs} tabs`);
// Beside the work, not over it: every control in there changes how the window
// looks, and the work has to stay readable under the change.
claim("the work keeps a usable width beside the settings", settings.windowStillThere,
  `${settings.contentWidth}px for the work`);

/* And the panel can be lifted out and put back.
   A panel whose place is wrong for somebody is a panel in the way, so float
   and dock are part of it working rather than a comfort. */
const sized = await run(`
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const tab = [...document.querySelectorAll('.panelTabName')].find(t => /settings/i.test(t.textContent || ''));
  if (!tab) return { why: 'the settings panel has no tab' };
  const host = tab.closest('.panelTab');
  const r = host.getBoundingClientRect();
  const menu = async (label) => {
    host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 8, clientY: r.top + 8 }));
    await wait(300);
    const row = [...document.querySelectorAll('.menuItem')].find(m => new RegExp(label, 'i').test(m.textContent || ''));
    if (!row) { document.body.click(); return false; }
    row.click();
    await wait(600);
    return true;
  };
  const floated = await menu('float');
  const isFloating = !!document.querySelector('.dv-resize-container .settingsPanel, .dv-floating-group .settingsPanel');
  const docked = await menu('dock');
  await wait(400);
  const backInGrid = !!document.querySelector('.dv-grid-view .settingsPanel');
  return { floated, isFloating, docked, backInGrid };
`);
claim("the settings panel floats out of the grid", !sized.why && sized.floated && sized.isFloating,
  sized.why ?? `floated=${sized.floated} floating=${sized.isFloating}`);
claim("and docks back into it", !sized.why && sized.docked && sized.backInGrid,
  sized.why ?? `docked=${sized.docked} inGrid=${sized.backInGrid}`);
claim("the skin list opens outside the panel", settings.rows > 1, `${settings.rows} rows`);
claim("a skin change takes effect", settings.after && settings.after !== settings.before,
  `${settings.before} → ${settings.after}`);
const closed = await run(`
  const wait = ms => new Promise(r => setTimeout(r, ms));
  [...document.querySelectorAll('.settingsPanel .btn')].find(b => b.textContent.trim() === 'DONE')?.click();
  await wait(500);
  return !document.querySelector('.settingsPanel');
`);
claim("settings close again", closed);

/* And the window asks about versions more than once.
 *
 * Both the band and the line in the settings asked when they were built and
 * never again, so a window left open — which is how this one is used — learned
 * about a release only if it happened to be restarted afterwards. The daemon had
 * the right answer the whole time. */
const asking = await run(`
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const gear = () => [...document.querySelectorAll('.tools .btn')].find(b => /⚙/.test(b.textContent || ''));
  const panel = () => document.querySelector('body > .window');
  const close = async () => {
    if (!panel()) return;
    [...panel().querySelectorAll('.btn.primary')].pop()?.click();
    await wait(600);
  };

  // Whatever the section above left behind, start from shut.
  await close();

  window.__asked = 0;
  const real = window.fetch;
  window.fetch = (...a) => { if (String(a[0]).includes('/api/version')) window.__asked++; return real(...a); };
  for (let i = 0; i < 2; i++) {
    gear()?.click();
    await wait(1000);
    await close();
  }
  window.fetch = real;
  return window.__asked;
`);
claim("the window asks about versions again, not once", asking >= 2, `${asking} times in two openings`);

/* A palette belongs to a skin, and changing the skin has to bring one with it.
 *
 * The list of palettes is filtered by the skin — but the chosen palette used to
 * stay put when the skin changed, so the tube could end up wearing Windows 95's
 * greys: a pairing the interface never offers, and one that comes out as a
 * window with no colour in it at all. It was found by looking at a screenshot,
 * which is exactly what a check is supposed to make unnecessary. */
const themes = await api("/api/themes").catch(() => []);
const pairing = await run(`
  const root = document.documentElement;
  return JSON.stringify({ skin: root.getAttribute('data-skin'), palette: root.getAttribute('data-theme') });
`);
const { skin, palette } = JSON.parse(pairing);
const ownBuiltIn = skin === "crt" && (palette === "green" || palette === "amber");
const served = (themes ?? []).some((t) => t.name === palette && t.skin === skin);
claim(
  "the palette belongs to the skin",
  palette === "custom" || ownBuiltIn || served,
  `${skin} is wearing ${palette}`,
);

// ---- the path field is the place you are ----------------------------------
/* Choosing a folder at the top used to narrow the overview and nothing else:
   + NEW asked for the same folder again, FOLDERS did not know about it. Now a
   folder taken there (Enter) is open in FOLDERS, and is where NEW starts. */
const place = await run(`
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const set = (el, v) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true })); };
  const field = document.querySelector('.filter input');
  if (!field) return { noField: true };
  field.focus();
  set(field, ${JSON.stringify(process.cwd() + "/frontend")});
  await wait(300);
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(1200);
  const folders = [...document.querySelectorAll('.railitem')].find(e => /FOLDERS/i.test(e.textContent || ''));
  folders?.click();
  await wait(1500);
  const openFolder = (document.querySelector('.folderbar .prompt')?.nextElementSibling?.textContent || '')
    + ' ' + [...document.querySelectorAll('.folderTabs .btn, .folderTabs button')].map(b => b.textContent).join(' ');
  const plus = [...document.querySelectorAll('.tools .btn')].find(b => /NEW/.test(b.textContent || ''));
  plus?.click();
  await wait(900);
  const cwd = document.querySelector('.card .pathfield input')?.value || '';
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return { openFolder, cwd };
`);
// A folder that is NOT where the gate's own session runs, so NEW cannot
// arrive at it by falling back to "where the last session was".
const taken = process.cwd() + "/frontend";
claim("a folder taken at the top is open in FOLDERS", !place.noField && place.openFolder.includes("frontend"), place.openFolder.trim().slice(0, 60));
claim("and it is where NEW starts", place.cwd.replace(/\/+$/, "") === taken, place.cwd);
const known = await api("/api/workspaces");
claim("and the daemon has it as a workspace", (known ?? []).some((w) => w.path === taken), `${(known ?? []).length} open`);

// ---- a brought-in font is declared, offered and applied -------------------
/* The one thing a check can prove about fonts without eyes: a font imported
   through the API is declared as an @font-face, appears in the settings, and
   choosing it sets --font. Nothing is downloaded; the file is served by the
   daemon from this machine. */
{
  const bytes = readFileSync(join(HERE, "frontend", "public", "fonts", "caveat.woff2"));
  const put = await fetch(`${base}/api/fonts?name=GateCaveat.woff2`, {
    method: "POST",
    headers: { "X-Plxr-Token": info.token, "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  claim("a font can be brought in", put.ok, `HTTP ${put.status}`);
  const served = await fetch(`${base}/userfonts/GateCaveat.woff2`, { headers: { "X-Plxr-Token": info.token } });
  claim("the brought-in font is served from this machine", served.ok, `HTTP ${served.status}`);

  const font = await run(`
    const w = ms => new Promise(r => setTimeout(r, ms));
    const gear = [...document.querySelectorAll('.tools .btn, .tools button')].find(b => /⚙/.test(b.textContent || ''));
    if (gear) gear.click();
    await w(1200);
    const declared = (document.getElementById('plxr-userfonts')?.textContent || '').includes('GateCaveat');
    const btn = [...document.querySelectorAll('.select .selectButton')].find(b => /skin default/i.test(b.textContent));
    let picked = false;
    if (btn) {
      btn.click(); await w(400);
      const row = [...document.querySelectorAll('.selectRow')].find(r => /GateCaveat/.test(r.textContent));
      if (row) { row.click(); picked = true; await w(700); }
    }
    let loaded = false;
    try { loaded = await document.fonts.load('16px GateCaveat').then(f => f.length > 0); } catch {}
    return { declared, picked, loaded, font: getComputedStyle(document.documentElement).getPropertyValue('--font').trim() };
  `);
  claim("the font is declared and offered in the settings", font.declared && font.picked, JSON.stringify(font));
  claim("choosing it sets the interface font and the font loads",
    /GateCaveat/.test(font.font) && font.loaded, JSON.stringify(font));
}

// ---- accounts can be managed from the settings ----------------------------
/* The ACCOUNTS tab lists the Claude accounts with the actions to name one, make
   it the default, remove it, and add one — sign in a fresh account, or take an
   existing directory. Read-only here: creating an account writes a real
   .claude directory in the user's home, which a check must not do. The
   create/default/rename/remove behaviour is proved in the accounts package. */
{
  const accts = await run(`
    const w = ms => new Promise(r => setTimeout(r, ms));
    // Open the settings only if they are not already open — the gear toggles.
    if (!document.querySelector('body > .window')) {
      const gear = [...document.querySelectorAll('.tools .btn, .tools button')].find(b => /⚙/.test(b.textContent || ''));
      if (gear) gear.click();
      await w(1000);
    }
    const accounts = [...document.querySelectorAll('.tab')].find(b => /accounts/i.test(b.textContent));
    if (accounts) accounts.click();
    await w(1200);
    const rows = [...document.querySelectorAll('.accountRow')];
    const actions = rows[0] ? [...rows[0].querySelectorAll('button')].map(b => b.textContent.trim()) : [];
    return {
      rows: rows.length,
      actions,
      signIn: !!document.querySelector('[data-do="signin-account"]'),
      addExisting: !!document.querySelector('[data-do="add-account"]'),
    };
  `);
  claim("the settings list the accounts", accts.rows > 0, `${accts.rows} rows`);
  claim("each account can be named, defaulted and removed",
    accts.actions.length >= 3, accts.actions.join(", "));
  claim("a new account can be signed in or an existing one added",
    accts.signIn && accts.addExisting, JSON.stringify({ signIn: accts.signIn, addExisting: accts.addExisting }));
}

// ---- the dock: many panels at once, saved, and resettable ------------------
/* The content is a dock now: every view and session is a panel you can split,
   tab and float, the arrangement is saved, and a reset returns it to the
   default. */
{
  const dock = await run(`
    const w = ms => new Promise(r => setTimeout(r, ms));
    const R = [...document.querySelectorAll('.railitem')];
    const c = re => { const it = R.find(e => re.test(e.textContent || '')); if (it) it.click(); };
    // Close the settings if they are covering the rail.
    if (document.querySelector('body > .window')) {
      const gear = [...document.querySelectorAll('.tools .btn, .tools button')].find(b => /⚙/.test(b.textContent || ''));
      if (gear) gear.click();
      await w(400);
    }
    c(/USAGE/i); await w(500);
    c(/PORTS/i); await w(500);
    const many = [...document.querySelectorAll('.dv-tab')].map(t => t.textContent.replace(/✕|×/g, '').trim()).filter(Boolean);
    const reset = [...document.querySelectorAll('.tools .btn, .tools button')].find(b => /⟲/.test(b.textContent || ''));
    if (reset) reset.click();
    await w(700);
    const afterReset = [...document.querySelectorAll('.dv-tab')].map(t => t.textContent.replace(/✕|×/g, '').trim()).filter(Boolean);
    return { many, afterReset };
  `);
  const prefs = await api("/api/prefs").catch(() => ({}));
  const saved = Boolean(prefs && prefs.dock);
  claim("the content is a dock with several panels at once", dock.many.length >= 3, dock.many.join(", "));
  /* The menu is the window's frame, beside the grid rather than a column in
     it — so it never appears among the dock's tabs, and it is always there. */
  const menuThere = await run(`
    const host = document.querySelector('.railHost');
    const items = document.querySelectorAll('.railHost .railhome').length;
    const inGrid = [...document.querySelectorAll('.dv-tab')].some(t => /^\\s*plxr\\s*$/.test((t.textContent || '').replace(/✕|×/g, '')));
    return { there: Boolean(host) && items > 0, width: host ? Math.round(host.getBoundingClientRect().width) : -1, inGrid };
  `);
  claim("the menu stands beside the dock, not in it", menuThere.there && !menuThere.inGrid,
    `${menuThere.width}px wide, among the tabs: ${menuThere.inGrid}`);
  claim("the arrangement is saved", saved, saved ? "prefs carry a dock layout" : "no dock in prefs");
  /* A reset rebuilds the arrangement for the activity that was chosen last —
     'focus' (rail and overview alone) unless somebody picked another from the
     LAYOUTS menu, in which case that one's panels come back and Usage/Ports,
     which belong to no activity but 'monitor', do not. */
  const activity = typeof prefs.dockActivity === "string" ? prefs.dockActivity : "focus";
  const bare = activity === "focus" ? dock.afterReset.length <= 2 : !dock.afterReset.includes("Ports");
  claim(`a reset returns the dock to the ${activity} arrangement`, dock.afterReset.includes("Overview") && bare, dock.afterReset.join(", "));

  /* A port opens as a web preview panel — a dev server beside its terminal,
     which is the point of the whole dock. */
  const preview = await run(`
    const w = ms => new Promise(r => setTimeout(r, ms));
    const ports = [...document.querySelectorAll('.railitem')].find(e => /PORTS/i.test(e.textContent || ''));
    if (ports) ports.click();
    await w(1200);
    const row = [...document.querySelectorAll('.row')].find(r => /VIEW|ANSEHEN/.test(r.textContent || ''));
    if (!row) return { noPorts: true };
    const view = [...row.querySelectorAll('button')].find(b => /VIEW|ANSEHEN/.test(b.textContent));
    if (view) view.click();
    await w(1500);
    const iframe = document.querySelector('.previewframe iframe');
    return { framed: !!iframe, src: iframe?.getAttribute('src') || '' };
  `);
  // Only assert when the machine has a listening port to view; otherwise skip.
  if (!preview.noPorts) {
    claim("a port opens as a web preview", preview.framed && /^https?:\/\/localhost:\d+/.test(preview.src), preview.src);
  }
}

// ---- right-click opens a context menu ------------------------------------
/* Anything with actions offers them at the pointer. A session tile is the one
   the gate can always reach. */
{
  const cm = await run(`
    const w = ms => new Promise(r => setTimeout(r, ms));
    const rail = [...document.querySelectorAll('.railitem')].find(e => /OVERVIEW/i.test(e.textContent || ''));
    if (rail) rail.click();
    await w(800);
    const tile = document.querySelector('.tile');
    if (!tile) return { noTile: true };
    const r = tile.getBoundingClientRect();
    tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.x + 30), clientY: Math.round(r.y + 20) }));
    await w(300);
    const menu = document.querySelector('.menu');
    const items = menu ? [...menu.querySelectorAll('.menuItem')].map(b => b.textContent.trim()) : [];
    // close it again
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return { shown: !!menu, items };
  `);
  if (!cm.noTile) {
    claim("right-click opens a context menu", cm.shown && cm.items.length >= 2, cm.items.join(", "));
  }
}

// ---- the changes panel, and a diff opening beside it ----------------------
/* Git source control as a panel: point the window at a repository, open
   CHANGES, and a changed file opens its diff as its own dock panel — the point
   of putting the changes beside the terminal instead of over it. The diff used
   to lay its hunks out side by side, so a second hunk overlapped the first;
   this holds that they stack. Skipped when the session is not in a repository
   with something changed, the way the preview claim skips with no port. */
{
  const cwd = sessions[0]?.cwd || "";
  const diff = await run(`
    const w = ms => new Promise(r => setTimeout(r, ms));
    const set = (el, v) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const field = document.querySelector('.filter input');
    if (!field) return { noField: true };
    set(field, ${JSON.stringify(cwd)});
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await w(1200);
    const changes = [...document.querySelectorAll('.railitem')].find(e => /CHANGES/i.test(e.textContent || ''));
    if (!changes) return { noRail: true };
    changes.click();
    await w(1500);
    const rows = [...document.querySelectorAll('.changesPanel .changepath')];
    if (rows.length === 0) return { nothingChanged: true };
    const before = document.querySelectorAll('.dv-tab').length;
    rows[0].click();
    await w(1500);
    const after = document.querySelectorAll('.dv-tab').length;
    const hunks = [...document.querySelectorAll('.diffPanel .hunk')].map(h => { const b = h.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; });
    // Stacked, not side by side: every hunk begins at or below the one before it.
    let stacked = true;
    for (let i = 1; i < hunks.length; i++) if (hunks[i].top < hunks[i - 1].bottom - 1) stacked = false;
    return {
      rows: rows.length,
      openedPanel: after > before,
      diffLines: document.querySelectorAll('.diffPanel .diffline').length,
      hunks: hunks.length,
      stacked,
    };
  `);
  if (!diff.noField && !diff.noRail && !diff.nothingChanged) {
    claim("a changed file opens as a diff panel", diff.openedPanel && diff.diffLines > 0, `${diff.rows} changed, ${diff.diffLines} diff lines`);
    claim("a diff stacks its hunks, one above the next", diff.stacked, `${diff.hunks} hunks`);
  }
}

// ---- the command palette reaches everything -------------------------------
/* ⌘K opens a search over every command — views, sessions, the shell's own
   actions. Typing a view name narrows to it. */
{
  const pal = await run(`
    const w = ms => new Promise(r => setTimeout(r, ms));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
    await w(400);
    const open = !!document.querySelector('.palette');
    const total = document.querySelectorAll('.paletteRow').length;
    const inp = document.querySelector('.palette input');
    let narrowed = [];
    if (inp) {
      const set = (el, v) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(inp, 'usage'); await w(300);
      narrowed = [...document.querySelectorAll('.paletteRow .paletteLabel')].map(l => l.textContent.trim());
    }
    document.querySelector('.paletteScrim')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return { open, total, narrowed };
  `);
  claim("the command palette opens on the keyboard and lists commands", pal.open && pal.total >= 5, `${pal.total} commands`);
  claim("typing narrows the palette", pal.narrowed.length > 0 && pal.narrowed.every(l => /usage/i.test(l)), pal.narrowed.join(", "));
}

cdp.close();

// ---- the verdict ----------------------------------------------------------
const failed = claims.filter((c) => !c.ok);
if (claims.length === 0) {
  console.log("  checked nothing at all — the window did not load");
  stop(1);
}
if (failed.length) {
  console.log(`  ${failed.length} of ${claims.length} claims failed:`);
  for (const f of failed) console.log(`      ${f.what}${f.detail ? ` — ${f.detail}` : ""}`);
  stop(1);
}
console.log(`  the window does what it says — ${claims.length} claims checked`);
stop(0);
