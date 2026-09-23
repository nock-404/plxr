/* Putting the sessions in order, without dragging them there.
 *
 * "what would be really bonkers is an auto-arrange": four sessions and a board
 * to watch them in meant four drags, every time, and the arrangement was gone
 * the next time something opened. Two entries do it now — a row of columns,
 * and a rectangle for when a row would leave them too narrow to read.
 *
 * Checked here because the measure of it is arithmetic on boxes: every session
 * alone in its place, and the places the same size. Along with it the field in
 * a dialog, which had the same shape of fault — something happening on every
 * keystroke that should happen once.
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
process.on("exit", endEverything);
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
await api("/api/workspaces", { method: "POST", body: JSON.stringify({ path: work }) });
for (const name of ["one", "two", "three"]) {
  await (await api("/api/sessions", { method: "POST", body: JSON.stringify({ cwd: work, cmd: [], name, account: "" }) })).json();
}

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
  const groupsOf = () => {
    const seen = new Map();
    for (const tab of [...document.querySelectorAll('.plxrDock .dv-groupview')].filter(g => !g.closest('.dv-resize-container') && !g.closest('.dv-groupview-edge'))) {
      const names = [...tab.querySelectorAll('.panelTabName')].map(t => t.textContent.trim());
      const r = tab.getBoundingClientRect();
      seen.set(names.join('|'), { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top), names });
    }
    return [...seen.values()];
  };
  // Named without a pattern: this text is carried into the page as a string,
  // where a pattern's backslashes do not survive the journey.
  const named = (n) => ['one', 'two', 'three'].some(x => n === x || n.startsWith(x + ' '));
  const sessionBoxes = () => groupsOf().filter(g => g.names.some(named));
  const layouts = async (verb) => {
    const b = document.querySelector('.bar [data-do="layouts"]');
    if (!b) return false;
    b.click();
    const row = await kitUntil(() => document.querySelector('body > .menu [data-do="' + verb + '"]'), 3000);
    if (!row) return false;
    row.click();
    await wait(900);
    return true;
  };
`;

const opened = await run(`${HELPERS}
  for (const name of ['one', 'two', 'three']) { await openSession(name); await wait(900); }
  return { tabs: [...document.querySelectorAll('.plxrDock .panelTabName')].map(t => t.textContent.trim()),
           groups: document.querySelectorAll('.plxrDock .dv-groupview').length };
`);
claim("the three sessions open as panels", (opened.tabs ?? []).filter(t => /^(one|two|three)\b/.test(t)).length === 3,
  `tabs ${(opened.tabs ?? []).join(" · ")} in ${opened.groups} groups`);

const columns = await run(`${HELPERS}
  if (!await layouts('spread-columns')) return { why: 'no spread-columns in the LAYOUTS menu' };
  const boxes = sessionBoxes();
  return { boxes, apart: boxes.length > 1 ? Math.max(...boxes.map(b => b.w)) - Math.min(...boxes.map(b => b.w)) : 0,
           rows: new Set(boxes.map(b => b.y)).size, alone: boxes.every(b => b.names.length === 1) };
`);
claim("in columns every session stands alone, side by side, the same width",
  columns.boxes?.length === 3 && columns.alone && columns.rows === 1 && columns.apart <= 8,
  columns.why ?? `${(columns.boxes ?? []).map(b => `${b.names.join('|')} ${b.w}px`).join(" · ")} — widest and narrowest ${columns.apart}px apart, ${columns.rows} row(s)`);

const grid = await run(`${HELPERS}
  if (!await layouts('spread-grid')) return { why: 'no spread-grid in the LAYOUTS menu' };
  const boxes = sessionBoxes();
  return { boxes, rows: new Set(boxes.map(b => b.y)).size, cols: new Set(boxes.map(b => b.x)).size, alone: boxes.every(b => b.names.length === 1) };
`);
claim("as a grid they stand in two rows and two columns, still one to a place",
  grid.boxes?.length === 3 && grid.alone && grid.rows === 2 && grid.cols === 2,
  grid.why ?? `${grid.rows} row(s), ${grid.cols} column(s) — ${(grid.boxes ?? []).map(b => `${b.names.join('|')} ${b.x},${b.y}`).join(" · ")}`);

/* ---- and the field in a dialog keeps what is typed -------------------------
   It took the keyboard and selected itself on every render of whoever opened
   it, so every letter selected the text again and the next letter wrote over
   it: two letters typed came out as one. */
const typed = await run(`${HELPERS}
  if (!await layouts('save-layout')) return { why: 'no save entry in the LAYOUTS menu' };
  const box = await kitUntil(() => document.querySelector('.ask input, .askField input, .modal input'), 3000);
  if (!box) return { why: 'the dialog has no field' };
  box.focus();
  const set = (v) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value').set.call(box, v); box.dispatchEvent(new Event('input', { bubbles: true })); };
  for (const letter of ['a', 'ab', 'abc']) { set(letter); await wait(250); }
  const value = box.value;
  const selected = box.selectionEnd - box.selectionStart;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return { value, selected };
`);
claim("a dialog's field keeps every letter typed into it, and stops selecting itself",
  typed.value === "abc" && typed.selected === 0, typed.why ?? `field reads "${typed.value}" with ${typed.selected} characters selected`);

// ---- report ---------------------------------------------------------------
const failed = claims.filter((c) => !c.ok);
for (const c of failed) console.log(`      ${c.what}${c.detail ? " — " + c.detail : ""}`);
if (failed.length) {
  console.log(`  ${failed.length} of ${claims.length} claims failed`);
  stop(1);
}
console.log(`  ${claims.length} claims about arranging the sessions hold`);
stop(0);
