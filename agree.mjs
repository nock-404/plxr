/* Two windows on one control room have to agree about how they look.
 *
 * Each of them used to read the settings once, at startup, and never again. A
 * skin changed in one left the other on whatever it happened to have; both then
 * wrote their whole set back, and whichever wrote last won — silently, with no
 * way to tell which that had been. The question "which window wins?" had no
 * answer anybody could give.
 *
 * Now the daemon stamps the settings with a version and every window watches
 * it. This holds that to be true: two pages on one daemon, one changes the
 * skin, the other must arrive at the same one on its own.
 *
 * It drives the real select, not the stored state, so a change that the
 * interface cannot actually make still fails here.
 */
import { spawn, execFileSync } from "node:child_process";
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
  console.log("  no chromium-based browser found — nothing checked");
  process.exit(1);
}

const base = `http://127.0.0.1:${info.port}`;

// The same guard the other window gate has: never check somebody else's plxr.
let mine;
try {
  mine = readFileSync(join(HERE, "frontend", "out", "index.html"), "utf8");
} catch {
  console.log("  this build has no frontend/out — run ./build.sh first");
  process.exit(1);
}
const served = await fetch(`${base}/?token=${info.token}`).then((r) => r.text()).catch(() => null);
if (served === null || served.trim() !== mine.trim()) {
  console.log(`  the daemon on port ${info.port} serves a different build than this one`);
  process.exit(1);
}

const port = 9600 + Math.floor(Number(process.pid) % 300);
const profile = mkdtempSync(join(tmpdir(), "plxr-agree-"));
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
  "--window-size=1200,800",
  "about:blank",
], { stdio: "ignore" });

/* The browser is ended from wherever this stops — a crash, an unhandled
 * rejection, ^C — not only from stop(). Fourteen headless browsers holding
 * 4.6 GB were found on one machine, most from gates that had crashed before
 * their cleanup. */
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
const endBrowser = () => {
  try { child.kill(); browserExited(child); } catch { /* already gone */ }
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* it lives in the temp directory */ }
};
process.on("exit", endBrowser);
for (const bad of ["uncaughtException", "unhandledRejection"]) {
  process.on(bad, (why) => { console.log(`  ${bad}: ${why?.stack ?? why}`); process.exit(1); });
}
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function stop(code, why) {
  if (why) console.log("  " + why);
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

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try {
    up = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).some((t) => t.type === "page");
  } catch {
    /* not up yet */
  }
  if (!up) await sleep(250);
}
if (!up) stop(1, "the browser did not come up — nothing checked");

async function openPage(url) {
  const tab = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })
    .then((r) => r.json());
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
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
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const next = ++id;
      waiting.set(next, { resolve: res, reject: rej });
      ws.send(JSON.stringify({ id: next, method, params }));
    });
  await send("Runtime.enable");
  return async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };
}

const url = `${base}/?token=${info.token}`;
const first = await openPage(url);
const second = await openPage(url);
await sleep(4500);

const skinOf = (run) => run(`return document.documentElement.getAttribute("data-skin");`);
const started = await skinOf(second);

const changed = await first(`
  // The gear, by what it does — not by index or by a title: buttons come and
  // go in that row, the hint on it is plxr's own tooltip, and the mark on it
  // is an icon from whichever pack is chosen.
  const gear = document.querySelector('.tools [data-do="settings"]');
  if (!gear) return null;
  gear.click();
  await new Promise(r => setTimeout(r, 900));
  const select = document.querySelector(".selectButton");
  if (!select) return null;
  select.click();
  await new Promise(r => setTimeout(r, 400));
  const rows = [...document.querySelectorAll(".selectList .selectRow, .selectList [role=option]")];
  const other = rows.find(o => o.textContent.trim().toLowerCase() !== (document.documentElement.getAttribute("data-skin") || "").toLowerCase());
  if (!other) return null;
  other.click();
  await new Promise(r => setTimeout(r, 900));
  return document.documentElement.getAttribute("data-skin");
`);

if (!changed || changed === started) {
  stop(1, `the first window could not change its skin (still ${started})`);
}

// Give it longer than the poll it depends on, so a slow machine is not a failure.
let followed = null;
for (let i = 0; i < 12; i++) {
  await sleep(500);
  followed = await skinOf(second);
  if (followed === changed) break;
}

if (followed !== changed) {
  stop(1, `the second window stayed on ${followed} while the first went to ${changed}`);
}
stop(0, `both windows on ${changed} — the second followed the first`);
