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
    item.click();
    await wait(900);
    // Scoped to the section actually on screen. Counting rows anywhere in the
    // document and an empty note anywhere else produced a verdict that
    // contradicted itself — 25 rows and "it is empty" in the same breath.
    const view = [...document.querySelectorAll('.list')].find(el => el.offsetParent !== null);
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
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "F12", bubbles: true }));
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
const settings = await run(`
  const wait = ms => new Promise(r => setTimeout(r, ms));
  document.querySelectorAll('.railhome')[0].click();
  await wait(400);
  const before = document.documentElement.getAttribute('data-skin');
  document.querySelectorAll('.btn.icon')[1].click();
  await wait(500);
  const opened = !!document.querySelector('.settingspanel');
  // The point of docking it: the window it changes stays on screen beside it.
  const contentWidth = Math.round(document.querySelector('.content')?.getBoundingClientRect().width ?? -1);
  const windowStillThere = contentWidth > 100;
  const tabs = document.querySelectorAll('.tab').length;
  const sel = [...document.querySelectorAll('.select')][0];
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
  [...document.querySelectorAll('.btn')].find(b => b.textContent.trim() === 'DONE')?.click();
  await wait(400);
  return { opened, windowStillThere, contentWidth, tabs, rows: rows.length, before, after, wanted, closed: !document.querySelector('.settingspanel') };
`);
claim("settings open", settings.opened);
claim("settings have their tabs", settings.tabs >= 4, `${settings.tabs} tabs`);
// Docked beside the window, not laid over it: every control in there changes
// how the window looks, and a panel that covers it hides its own effect.
claim("the window stays visible beside the settings", settings.windowStillThere,
  `${settings.contentWidth}px left for the work`);

/* And its width can be changed.
   A panel docked beside the work is a panel whose width is wrong for somebody,
   so the handle is part of it working rather than a comfort. */
const sized = await run(`
  // The block above closes the panel when it is done with it, so this opens it
  // again rather than measuring a panel that is not on screen.
  if (!document.querySelector('.settingspanel')) {
    const gear = [...document.querySelectorAll('button')]
      .find(b => /settings/i.test(b.getAttribute('title') || b.getAttribute('aria-label') || ''))
      || [...document.querySelectorAll('.bar button')].at(-3);
    gear?.click();
    await new Promise(r => setTimeout(r, 900));
  }
  const bar = document.querySelector('.splitter');
  if (!bar) return { why: 'no handle beside the panel' };
  const wide = () => Math.round(document.querySelector('.settingspanel').getBoundingClientRect().width);
  const before = wide();
  const b = bar.getBoundingClientRect();
  const at = x => ({ bubbles: true, clientX: x, clientY: b.top + b.height / 2, buttons: 1, pointerId: 1 });
  // Narrower first, so the test does not depend on there being room to grow —
  // it failed once because the panel was already at its widest.
  bar.dispatchEvent(new PointerEvent('pointerdown', at(b.left + 3)));
  bar.dispatchEvent(new PointerEvent('pointermove', at(b.left + 160)));
  await new Promise(r => setTimeout(r, 400));
  const narrower = wide();
  const b2 = bar.getBoundingClientRect();
  bar.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: b2.left - 120, clientY: b2.top + b2.height / 2, buttons: 1, pointerId: 1 }));
  await new Promise(r => setTimeout(r, 400));
  const after = wide();
  bar.dispatchEvent(new PointerEvent('pointermove', at(b.left - 6000)));
  await new Promise(r => setTimeout(r, 400));
  const shoved = wide();
  bar.dispatchEvent(new PointerEvent('pointerup', at(b.left)));
  return { before, narrower, after, shoved, window: Math.round(window.innerWidth) };
`);
claim("the settings can be made narrower and wider", sized.narrower < sized.before && sized.after > sized.narrower,
  sized.why ?? `${sized.before} → ${sized.narrower} → ${sized.after}px`);
claim("and it stops before it eats the window", sized.shoved < sized.window * 0.9, `${sized.shoved} of ${sized.window}px`);
claim("the skin list opens outside the panel", settings.rows > 1, `${settings.rows} rows`);
claim("a skin change takes effect", settings.after && settings.after !== settings.before,
  `${settings.before} → ${settings.after}`);
claim("settings close again", settings.closed);

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
