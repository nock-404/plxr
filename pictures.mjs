/* What a path printed in a terminal is worth.
 *
 * A program says where it put something — a screenshot, a log, a file it just
 * wrote — and the answer to ⌘-click on that path was, for three different
 * reasons, nothing at all: a name with a space in it was never recognised as a
 * path, a path outside the folder the session was started in was refused by
 * the file service, and a picture that did open was answered with "this file
 * is binary, so there is nothing sensible to show". All three are the everyday
 * case, so all three are checked here, in a home of its own, against the built
 * window: the path is printed by a real shell and clicked with a real
 * ⌘-click, and what has to appear is the picture.
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
process.on("exit", () => { endEverything(); try { rmSync(`/tmp/plxr-far-${process.pid}`, { recursive: true, force: true }); } catch {} });
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
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
writeFileSync(join(work, "shot.png"), PNG);
writeFileSync(join(work, "Bildschirmfoto 2026-09-23 um 10.12.png"), PNG);
mkdirSync(join(work, "pics"), { recursive: true });
writeFileSync(join(work, "pics", "inside.txt"), "nothing much\n");
mkdirSync(join(work, "a folder"), { recursive: true });
const outside = `/tmp/plxr-far-${process.pid}`;
mkdirSync(outside, { recursive: true });
writeFileSync(join(outside, "far.png"), PNG);
await api("/api/workspaces", { method: "POST", body: JSON.stringify({ path: work }) });
await (await api("/api/sessions", { method: "POST", body: JSON.stringify({ cwd: work, cmd: [], name: "probe", account: "" }) })).json();
globalThis.WORK = work;
globalThis.OUT = outside;

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
  const term = () => (document.querySelector('.plxrDock .session .ptermbox') || {}).xterm;
  const type = (t) => term()._core.coreService.triggerDataEvent(t, true);
  const rowsOf = () => { const x = term(), b = x.buffer.active, out = [];
    for (let y = b.viewportY; y < b.viewportY + x.rows; y++) out.push({ y: y - b.viewportY, t: b.getLine(y)?.translateToString(true) ?? '' });
    return out; };
  const clickPath = async (re) => {
    // The session's own tab back in front: the last click opened a file over it.
    const tabOf = (n) => [...document.querySelectorAll('.plxrDock .dv-tab')].find(t => (t.querySelector('.panelTabName')?.textContent ?? '').trim() === n);
    tabOf('probe · running')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await wait(800);
    const before = [...document.querySelectorAll('.plxrDock .dv-tab .panelTabName')].map(t => t.textContent.trim());
    const x = term();
    const rows = rowsOf().filter(r => re.test(r.t));
    const row = rows[rows.length - 1];
    if (!row) return { why: 'no row matching ' + re };
    const col = row.t.search(re) + 2;
    const screen = document.querySelector('.plxrDock .session .xterm-screen');
    const r = screen.getBoundingClientRect();
    const cell = { w: r.width / x.cols, h: r.height / x.rows };
    const px = { x: r.left + cell.w * (col + 0.5), y: r.top + cell.h * (row.y + 0.5) };
    const opts = { bubbles: true, clientX: px.x, clientY: px.y, metaKey: true, button: 0 };
    const at = document.elementFromPoint(px.x, px.y);
    for (const t of ['mousemove', 'mouseover']) at.dispatchEvent(new MouseEvent(t, opts));
    await wait(600);
    const underline = document.querySelectorAll('.xterm-rows span[style*="underline"], .xterm-link-layer a').length;
    for (const t of ['mousedown', 'mouseup', 'click']) at.dispatchEvent(new MouseEvent(t, opts));
    await wait(1800);
    const img = document.querySelector('.picshot');
    const after = [...document.querySelectorAll('.plxrDock .dv-tab .panelTabName')].map(t => t.textContent.trim());
    const opened = after.filter(t => !before.includes(t));
    return { clicked: row.t.trim().slice(0, 60), at: col, row: row.y, underline, opened, tabs: [...document.querySelectorAll('.plxrDock .dv-tab .panelTabName')].map(t => t.textContent.trim()),
             picture: Boolean(img), wide: img ? img.naturalWidth : 0, note: document.querySelector('.emptyNote b')?.textContent.trim() ?? '' };
  };
`;

const boot = await run(`${HELPERS}
  await openSession('probe');
  await wait(2500);
  type("printf '%s\\\\n' shot.png '${globalThis.OUT}/far.png' 'Bildschirmfoto 2026-09-23 um 10.12.png done' '${globalThis.OUT}' 'a folder here'\\r");
  await wait(2500);
  return rowsOf().filter(r => r.t.trim()).map(r => r.t.trim());
`);
claim("a shell in the session prints the three paths", boot.some((l) => /far\.png$/.test(l)) && boot.some((l) => /^shot\.png$/.test(l)),
  boot.slice(-4).join(" | "));

const cases = [
  ["a picture in the session's folder opens as a picture", "/^shot\\.png/", "shot.png"],
  ["a picture outside it, named by its absolute path, opens too", "/far\\.png$/", "far.png"],
  ["a name with spaces in it is one path, not the first word of it", "/^Bildschirmfoto/", "Bildschirmfoto 2026-09-23 um 10.12.png"],
];
for (const [what, re, file] of cases) {
  const got = await run(`${HELPERS} return await clickPath(${re});`);
  claim(what, got.opened?.includes(file) && got.picture && got.wide > 0,
    `clicked row ${got.row} column ${got.at} of "${got.clicked}" · opened ${JSON.stringify(got.opened ?? [])} · picture ${got.picture} · ${got.wide}px wide${got.note ? ' · "' + got.note + '"' : ""}${got.why ? " · " + got.why : ""}`);
}

/* ---- and a folder is opened as a folder ------------------------------------
 *
 * It went to the editor like everything else, and the editor's honest answer to
 * a directory is "that is a directory" — which is what a click on a path a
 * program had just printed was worth. */
const folder = await run(`${HELPERS}
  const tabOf = (n) => [...document.querySelectorAll('.plxrDock .dv-tab')].find(t => (t.querySelector('.panelTabName')?.textContent ?? '').trim() === n);
  tabOf('probe · running')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  await wait(800);
  const before = [...document.querySelectorAll('.plxrDock .dv-tab .panelTabName')].map(t => t.textContent.trim());
  const got = await clickPath(/plxr-far-[0-9]+$/);
  const after = [...document.querySelectorAll('.plxrDock .dv-tab .panelTabName')].map(t => t.textContent.trim());
  return { clicked: got.clicked, opened: after.filter(t => !before.includes(t)),
           tree: Boolean(document.querySelector('.foldersbody, .folderbar')),
           note: document.querySelector('.emptyNote b')?.textContent.trim() ?? '' };
`);
claim("a folder in the output opens as a folder, not as a file nobody can read",
  folder.tree && !/directory/i.test(folder.note),
  `clicked "${folder.clicked}" · opened ${JSON.stringify(folder.opened ?? [])} · tree ${folder.tree} · note "${folder.note}"`);

// ---- report ---------------------------------------------------------------
const failed = claims.filter((c) => !c.ok);
for (const c of failed) console.log(`      ${c.what}${c.detail ? " — " + c.detail : ""}`);
if (failed.length) {
  console.log(`  ${failed.length} of ${claims.length} claims failed`);
  stop(1);
}
console.log(`  ${claims.length} claims about paths in the terminal hold`);
stop(0);
