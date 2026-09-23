/* The terminal view: the window with everything but the terminal taken away.
 *
 * "plxr feels like a stuffed lump on a laptop screen" — so one button hides
 * the stripes, the bottom row and the session's own bar, and what is left is
 * the work. Three things were asked for in a row and each was something still
 * in the way: the loud frame around the terminal, the seven buttons over it,
 * and then the whole strip they stood in. None of that is measured anywhere
 * else, and all of it is one careless rule away from coming back.
 *
 * Measured in a home of its own, against the built window.
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
await (await api("/api/sessions", { method: "POST", body: JSON.stringify({ cwd: work, cmd: [], name: "bare", account: "" }) })).json();

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
  /* A colour's alpha, whatever notation it comes back in: rgba(), the newer
     color(srgb ... / a) and the word transparent are all in use. Read by hand
     rather than by pattern — this text is carried into the page as a string,
     where a pattern's backslashes do not survive the journey. */
  const alpha = (c) => {
    const s = String(c).trim();
    if (s === 'transparent') return 0;
    const slash = s.lastIndexOf('/');
    if (slash > 0 && s.endsWith(')')) return parseFloat(s.slice(slash + 1, -1));
    if (s.startsWith('rgba')) {
      const parts = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')).split(',');
      return parts.length > 3 ? parseFloat(parts[3]) : 1;
    }
    return 1;
  };
  const seen = (el) => Boolean(el && el.getClientRects().length);
  const facts = () => {
    const shell = document.querySelector('.dockShell');
    const pane = document.querySelector('.plxrDock .session .pterm');
    const cs = pane && getComputedStyle(pane);
    return {
      bare: shell?.dataset.bare ?? 'no',
      stripes: [...document.querySelectorAll('.stripe')].filter(seen).length,
      strip: seen(document.querySelector('.plxrDock .session .viewstrip')),
      label: seen(document.querySelector('.plxrDock .session .panelabel')),
      frame: cs ? { alpha: alpha(cs.borderTopColor), colour: cs.borderTopColor, shadow: cs.boxShadow } : null,
      box: pane ? Math.round(pane.getBoundingClientRect().height) : 0,
      dock: Math.round(document.querySelector('.dockHost')?.getBoundingClientRect().width ?? 0),
      shellWide: Math.round(shell?.getBoundingClientRect().width ?? 0),
    };
  };
`;

const before = await run(`${HELPERS} await openSession('bare'); await wait(2500); return facts();`);
claim("in the ordinary view the session has its stripes, its bar and a frame around the terminal",
  before.bare === "no" && before.stripes >= 2 && before.strip && before.frame?.alpha === 1,
  JSON.stringify(before));

const after = await run(`${HELPERS}
  const b = document.querySelector('.bar [data-do="bare"]');
  if (!b) return { why: 'no terminal-view button in the bar' };
  b.click();
  await wait(1200);
  return facts();
`);
claim("the button leaves the terminal alone on the screen — no stripes, no bar, no name over it",
  after.bare === "yes" && after.stripes === 0 && !after.strip && !after.label,
  JSON.stringify(after));
claim("and no frame around it: nothing is drawn where the border was",
  after.frame?.alpha === 0 && (after.frame?.shadow === "none" || !after.frame?.shadow),
  `border ${after.frame?.colour} · shadow ${after.frame?.shadow}`);
claim("the terminal is taller for it, and the dock has the whole window",
  after.box > before.box && after.dock >= after.shellWide - 1,
  `${before.box}px -> ${after.box}px · dock ${after.dock} of ${after.shellWide}`);

/* ---- what the bar held is still reachable ---------------------------------
   The bar is not drawn there, so its actions live under the right button on
   the terminal: the views, pausing, terminating. */
const menu = await run(`${HELPERS}
  const box = document.querySelector('.plxrDock .session .ptermbox');
  const r = box.getBoundingClientRect();
  box.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
  await wait(500);
  const rows = [...document.querySelectorAll('body > .menu .menuItem')].map(e => e.textContent.trim());
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(200);
  return rows;
`);
claim("in that view the terminal's own menu carries what the bar held",
  ["FILES", "QUEUE", "PAUSE", "TERMINATE"].every((r) => menu.some((row) => row.startsWith(r))),
  menu.join(" · "));

const back = await run(`${HELPERS}
  document.querySelector('.bar [data-do="bare"]').click();
  await wait(1200);
  return facts();
`);
claim("pressing the button again brings everything back",
  back.bare === "no" && back.stripes >= 2 && back.strip && back.frame?.alpha === 1, JSON.stringify(back));

// ---- report ---------------------------------------------------------------
const failed = claims.filter((c) => !c.ok);
for (const c of failed) console.log(`      ${c.what}${c.detail ? " — " + c.detail : ""}`);
if (failed.length) {
  console.log(`  ${failed.length} of ${claims.length} claims failed`);
  stop(1);
}
console.log(`  ${claims.length} claims about the terminal view hold`);
stop(0);
