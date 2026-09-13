/* Two windows on one session — the kitchen and the bedroom.
 *
 * plxr can be opened from another machine on the network, and then the same
 * session is on two screens at once. Nothing is synchronised there: there is
 * one terminal, in one process, on one machine, and both windows are looking
 * at it. That is the claim this makes true or false.
 *
 * It matters because everything about it only breaks with two windows
 * attached, and until this existed nothing ever attached two. Three faults
 * were found the day it was written: a window that stopped reading froze the
 * session for everybody, attaching lost whatever was written in that same
 * moment, and the window that resized last dictated the width for both.
 *
 * Two browsers, not two tabs: a tab in the background is throttled, and the
 * point here is precisely what happens to a window that falls behind.
 *
 * No dependencies — the browser already on the machine, over its debugging
 * protocol, the way clicked.mjs and editor.mjs do it.
 */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GATEKIT } from "./gatekit.mjs";

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

const APP = process.env.PLXR_APP || "/tmp/plxr3-app";
if (!existsSync(APP)) {
  console.log(`  ${APP} is not there — run ./build.sh first`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = [];
const claim = (what, ok, detail = "") => claims.push({ what, ok: Boolean(ok), detail });

// ---- one daemon, in a home of its own -------------------------------------
const home = mkdtempSync(join(tmpdir(), "plxr-together-home-"));
const work = join(home, "folder");
mkdirSync(work, { recursive: true });
const app = spawn(APP, ["daemon"], { env: { ...process.env, PLXR_HOME: home }, stdio: "ignore" });

/* Everything this run starts is ended from wherever it stops.
 *
 * A crash, an unhandled rejection or ^C used to leave the browsers and the
 * service running: fourteen headless browsers holding 4.6 GB were found on
 * one machine, most from gates that had crashed before their cleanup. Each
 * browser is noted the moment it is started — a window only joined `opened`
 * once it had answered, so one that never did was never ended. The service
 * detaches itself, so the process that listens is the one named in
 * daemon.json; this gate used to end only the launcher. */
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
const spawned = [];
let gateEnded = false;
const endEverything = () => {
  if (gateEnded) return;
  gateEnded = true;
  for (const b of spawned) {
    try { b.proc.kill(); } catch { /* gone */ }
  }
  for (const b of spawned) browserExited(b.proc);
  try { process.kill(JSON.parse(readFileSync(join(home, "daemon.json"), "utf8")).pid); } catch { /* gone */ }
  try { app.kill(); } catch { /* gone */ }
  for (const b of spawned) {
    for (let i = 0; i < 20; i++) {
      try { rmSync(b.profile, { recursive: true, force: true }); break; }
      catch { const until = Date.now() + 100; while (Date.now() < until); }
    }
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
for (let i = 0; i < 80; i++) {
  try {
    if ((await api("/api/version")).ok) break;
  } catch { /* not yet */ }
  await sleep(250);
}

// A plain shell, so the width can be asked for and the answer read back.
const session = await api("/api/sessions", {
  method: "POST",
  body: JSON.stringify({ cwd: work, cmd: ["/bin/sh"], name: "together" }),
}).then((r) => r.json());
if (!session?.id) {
  console.log("  no session to look at");
  process.exit(1);
}

// ---- two browsers ---------------------------------------------------------
const opened = [];

async function window_(label, width, height) {
  const profile = mkdtempSync(join(tmpdir(), `plxr-${label}-`));
  const port = 9700 + opened.length * 7 + (process.pid % 200);
  const proc = spawn(browser, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--use-mock-keychain",
    "--password-store=basic",
    "--no-default-browser-check",
    `--window-size=${width},${height}`,
    "about:blank",
  ], { stdio: "ignore" });
  spawned.push({ proc, profile });

  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
    } catch { /* not up */ }
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) {
    console.log(`  the ${label} window did not come up`);
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

  /* Everything the window receives is kept, before the page has run a line.
   *
   * xterm draws to a canvas, so what is on the screen cannot be read out of
   * the document. What can be read is what arrived — and that is the thing
   * under test here: whether both windows are handed the same output. */
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      /* Only the session's own socket counts.
       *
       * The overview carries a text preview of every session over its own
       * socket, and that preview contains the very words this looks for. A
       * check that took everything the page receives was satisfied by the
       * preview and stayed green while the session stream was empty — it
       * passed with the scrollback deliberately removed. */
      window.__rx = "";
      const Real = window.WebSocket;
      window.WebSocket = function (...args) {
        const s = new Real(...args);
        const mine = String(args[0] || "").includes("/ws/session/");
        s.addEventListener("message", async (e) => {
          if (!mine) return;
          const d = e.data;
          // The terminal asks for arraybuffer, the tiles arrive as text, and a
          // socket left on its default hands out a Blob. All three, or this
          // silently records nothing and every claim below is a lie.
          if (typeof d === "string") window.__rx += d;
          else if (d instanceof ArrayBuffer) window.__rx += new TextDecoder().decode(d);
          else window.__rx += new TextDecoder().decode(await d.arrayBuffer());
        });
        return s;
      };
      window.WebSocket.prototype = Real.prototype;
      Object.assign(window.WebSocket, Real);
    `,
  });

  const w = {
    label,
    proc,
    profile,
    cdp,
    run: async (expression) => {
      const r = await cdp.send("Runtime.evaluate", {
        expression: `(async () => { ${expression} })()`,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result?.value;
    },
    type: async (text) => {
      // The keyboard, not the socket: this has to go the way a person's
      // keystroke goes, through the terminal the window draws.
      await w.run("document.querySelector('.xterm-helper-textarea')?.focus(); return 1");
      for (const ch of text) {
        await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch });
      }
      await cdp.send("Input.dispatchKeyEvent", { type: "char", text: "\r" });
    },
    seen: () => w.run("return window.__rx || ''"),
  };
  opened.push(w);
  return w;
}

function stop(code) {
  endEverything();
  process.exit(code);
}

// Open the session in a window and wait until its terminal is painting.
async function enter(w) {
  let up = 0;
  for (let i = 0; i < 40 && !up; i++) {
    await w.cdp.send("Page.navigate", { url: `http://127.0.0.1:${info.port}/?token=${info.token}` });
    await sleep(700);
    up = await w.run(`${GATEKIT} return appUp();`).catch(() => 0);
  }
  if (!up) {
    console.log(`  the ${w.label} window did not render`);
    stop(1);
  }
  const got = await w.run(`${GATEKIT}
    const wait = ms => new Promise(r => setTimeout(r, ms));
    openDoc('overview');
    await wait(600);
    const tile = [...document.querySelectorAll('.tile')].find(t => t.dataset.status !== 'orphaned' && t.dataset.status !== 'dead');
    if (!tile) return { none: true };
    tile.click();
    await wait(2000);
    const term = document.querySelector('.pterm');
    if (term) term.click();
    const box = document.querySelector('.xterm-helper-textarea');
    if (box) box.focus();
    return {
      inSession: !!document.querySelector('.session'),
      canvases: document.querySelectorAll('.pterm canvas').length,
      typeable: !!box,
    };
  `);
  return got;
}

const bedroom = await window_("bedroom", 1400, 900);
const kitchen = await window_("kitchen", 700, 620);

const first = await enter(bedroom);
claim("the session opens in the first window", first.inSession && first.canvases > 0);
claim("its terminal takes keystrokes", first.typeable);

// ---- what one types, both see ---------------------------------------------
await bedroom.type("echo ONE-FROM-BEDROOM");
await sleep(900);

const second = await enter(kitchen);
claim("the same session opens in the second window", second.inSession && second.canvases > 0);

// The scrollback: the second window has to arrive knowing what happened before it.
const kitchenStart = await kitchen.seen();
claim(
  "the second window is given what it missed",
  kitchenStart.includes("ONE-FROM-BEDROOM"),
  `${kitchenStart.length} bytes of scrollback`,
);

await kitchen.type("echo TWO-FROM-KITCHEN");
await sleep(1200);
claim("what the second window types, the first one sees", (await bedroom.seen()).includes("TWO-FROM-KITCHEN"));

await bedroom.type("echo THREE-FROM-BEDROOM");
await sleep(1200);
claim("what the first window types, the second one sees", (await kitchen.seen()).includes("THREE-FROM-BEDROOM"));

// ---- one terminal, two sizes ----------------------------------------------
/* The output has to fit into both screens, so the smaller window sets the
 * width. Asked of the shell itself, not of the setting. */
const widthNow = async (from, marker) => {
  await from.type(`echo ${marker}=$(stty size | cut -d' ' -f2)`);
  await sleep(1200);
  const text = await from.seen();
  const m = [...text.matchAll(new RegExp(marker + "=([0-9]+)", "g"))].pop();
  return m ? Number(m[1]) : 0;
};

const bothOpen = await widthNow(bedroom, "COLSBOTH");
claim("the terminal has a width at all", bothOpen > 0, `${bothOpen} columns`);

// The kitchen window goes away; the big one must get its room back.
kitchen.proc.kill();
await sleep(2500);
const aloneAgain = await widthNow(bedroom, "COLSALONE");
claim(
  "the smaller window sets the width while it is there",
  bothOpen < aloneAgain,
  `${bothOpen} columns with both, ${aloneAgain} with the big one alone`,
);

// ---- the session survives a window that stops listening -------------------
/* A machine that goes to sleep, a link that stalls: the other window must
 * carry on. The browser is killed outright, which is the harshest form of it. */
await bedroom.type("echo AFTER-THE-OTHER-LEFT");
await sleep(1000);
claim("the session carries on when a window disappears", (await bedroom.seen()).includes("AFTER-THE-OTHER-LEFT"));

const alive = await api(`/api/sessions`).then((r) => r.json());
claim("the daemon still knows the session", alive.some((s) => s.id === session.id && s.alive));

// ---- the verdict ----------------------------------------------------------
const failed = claims.filter((c) => !c.ok);
for (const c of claims) console.log(`      ${c.ok ? "ok  " : "FAIL"}  ${c.what}${c.detail ? ` — ${c.detail}` : ""}`);
console.log(`  ${claims.length - failed.length}/${claims.length} claims`);
stop(failed.length ? 1 : 0);
