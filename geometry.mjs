/* One layout, four skins.
 *
 * The reference is three screenshots of the old app in three skins: identical
 * positions, identical sizes, only the dressing changes. That held until a skin
 * set its own padding — the header grew from 59 pixels to 78 and nobody noticed,
 * because nobody had two skins open at the same time.
 *
 * So it is measured rather than looked at: the real page is loaded once per
 * skin, the frame is measured, and any box that differs between two skins fails
 * this check.
 *
 * No dependencies. Chrome is already on the machine and speaks its debugging
 * protocol over a websocket, which node brings along — installing a browser
 * automation stack for one measurement would be a heavier footprint than the
 * thing being measured.
 */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GATEKIT } from "./gatekit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const HOME = process.env.PLXR_HOME || join(process.env.HOME, ".plxr");
const SKINS = ["crt", "win95", "sketch", "pixel"];

// The frame, not the words in it: a typeface decides how wide a label is, and
// that is the skin's business. These boxes are the layout's.
const BOXES = {
  bar: ".bar",
  statusrow: ".statusrow",
  rail: ".rail",
  content: ".content",
  railHome: ".railhome",
  railGroup: ".railgroup",
  railSession: ".railitem:has(.rsub)",
  tile: ".tile",
  tileHead: ".thead",
  tileFoot: ".tfoot",
};

const BROWSERS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function daemon() {
  try {
    return JSON.parse(readFileSync(join(HOME, "daemon.json"), "utf8"));
  } catch {
    return null;
  }
}

const info = daemon();
if (!info) {
  console.log(`  no daemon under ${HOME} — this check measures the real window`);
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
  console.log("  no chromium-based browser found — cannot measure");
  process.exit(1);
}

const base = `http://127.0.0.1:${info.port}`;

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

const port = 9000 + Math.floor(Number(process.pid) % 900);
const profile = mkdtempSync(join(tmpdir(), "plxr-measure-"));
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

function stop(code) {
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* the browser is still letting go of its profile; it lives in the temp
       directory and the system clears it. Not worth failing a check over. */
  }
  process.exit(code);
}

const wsUrl = await endpoint();
if (!wsUrl) {
  console.log("  the browser did not come up — nothing measured");
  stop(1);
}

const cdp = await connect(wsUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Page.navigate", { url: `http://127.0.0.1:${info.port}/?token=${info.token}` });
await sleep(2500);

const evaluate = async (expression) => {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};

/* The boxes are the frame's and the overview's, so the overview is brought to
   the front first. Measured on whatever arrangement was saved last, a window
   left with another tab in front of the overview has no tiles to measure, and
   a missing box fails below. */
for (let i = 0; i < 80; i++) {
  if (await evaluate(`(() => { ${GATEKIT} return appUp(); })()`).catch(() => 0)) break;
  await sleep(250);
}
await evaluate(`(() => { ${GATEKIT} return openDoc("overview"); })()`).catch(() => false);

/* Waited for until every box is on the page, for twenty seconds at most, so a
   page still arriving does not read as a page without one. */
for (let i = 0; i < 80; i++) {
  const all = await evaluate(`Object.values(${JSON.stringify(BOXES)}).every((sel) => document.querySelector(sel))`).catch(() => false);
  if (all) break;
  await sleep(250);
}

/* A skin's border thickness is its own business: a hairline in one, a four
   pixel block frame in another. That shifts the content inside a box without
   moving the box, so the comparison allows the widest frame any skin draws —
   four pixels on each side. Anything beyond that is the frame itself moving,
   which is the layout's job and no skin's. */
const SLACK = 8;

const measured = {};
// The first skin is measured twice and the first reading thrown away: right
// after navigation the page has not settled, and a stale reading here looks
// exactly like a layout bug.
for (const skin of [SKINS[0], ...SKINS]) {
  await evaluate(`document.documentElement.setAttribute("data-skin", ${JSON.stringify(skin)})`);
  await sleep(350);
  measured[skin] = await evaluate(`(() => {
    const boxes = ${JSON.stringify(BOXES)};
    const out = {};
    for (const [name, sel] of Object.entries(boxes)) {
      const el = document.querySelector(sel);
      if (!el) { out[name] = null; continue; }
      // Layout position, not the painted one: sketch tilts its tiles by half a
      // degree, and a rotated rectangle is not a moved one.
      let x = 0, y = 0;
      for (let n = el; n; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
      out[name] = [x, y, el.clientWidth, el.clientHeight];
    }
    return out;
  })()`);
}
cdp.close();

const names = Object.keys(BOXES);
const seen = names.filter((n) => SKINS.some((s) => measured[s]?.[n]));
if (seen.length === 0) {
  console.log("  nothing on screen to measure — the window did not load");
  stop(1);
}
/* An expected box that is not on the page is a failure. It used to be left
   out of the comparison: a box missing in one skin was compared across the
   other three, and one missing in all four was not compared at all — so a
   selector that matched nothing still reported one layout. */
const missing = names.flatMap((n) => SKINS.filter((s) => !measured[s]?.[n]).map((s) => `${n} (${BOXES[n]}) in ${s}`));
if (missing.length) {
  console.log(`  ${missing.length} expected boxes are not on the page:`);
  for (const m of missing) console.log(`      ${m}`);
  stop(1);
}
const differing = names.filter((n) => {
  const rows = SKINS.map((s) => measured[s][n]);
  return [0, 1, 2, 3].some((i) => {
    const values = rows.map((r) => r[i]);
    return Math.max(...values) - Math.min(...values) > SLACK;
  });
});
if (differing.length) {
  console.log(`  ${differing.length} boxes differ between skins by more than ${SLACK}px:`);
  for (const n of differing) {
    console.log(`      ${n}`);
    for (const s of SKINS) console.log(`          ${s.padEnd(7)} ${(measured[s][n] || []).join(",")}`);
  }
  stop(1);
}
console.log(`  one layout in all skins — ${names.length} boxes, ${SKINS.length} skins`);
stop(0);
