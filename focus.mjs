/* Does a click on a notification open the session?
 *
 * The plxr window posts the notifications and takes the click, but the page
 * is where the session opens, and there is no wire from the one into the
 * other: the page loads the service's address, the Wails runtime is not in
 * it, and a script pushed at it waits for a ready that never comes. That is
 * how the first version shipped — the event was dispatched into a page that
 * never ran it, and the click brought the window forward on whatever
 * session it was already showing.
 *
 * So the click goes through the service: the window writes {focusSession:
 * {id, seq}} into the settings, and the page opens the session on its
 * revision watch. This does what the window does — the same PUT, with the
 * token — and holds the page to it: the session's panel is the active one
 * within two seconds, a second click on another session moves it, a seq
 * already seen does not move it again, and a reload does not open the last
 * clicked session anew.
 *
 * No dependencies: the browser already on the machine, over its debugging
 * protocol, against a service of its own in a home of its own.
 */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
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
// The binary build.sh leaves behind, or the one named in PLXR_APP.
const APP = process.env.PLXR_APP || "/tmp/plxr3-app";
if (!existsSync(APP)) {
  console.log(`  ${APP} is not there — run ./build.sh first`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = [];
const claim = (what, ok, detail = "") => claims.push({ what, ok: Boolean(ok), detail });

const home = mkdtempSync(join(tmpdir(), "plxr-focus-home-"));
const app = spawn(APP, ["daemon"], { env: { ...process.env, PLXR_HOME: home }, stdio: "ignore" });

/* Everything this run starts is ended from wherever it stops.
 *
 * A crash, an unhandled rejection or ^C used to leave the browser and the
 * service running: fourteen headless browsers holding 4.6 GB were found on
 * one machine, most from gates that had crashed before their cleanup. The
 * service detaches itself, so the process that listens is the one named in
 * daemon.json. Registered the moment there is something to end; the browser
 * and its profile do not exist yet at first, and reaching for them then
 * throws, which is caught. */
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

// Two sessions, so that "the right one" is a claim with a wrong answer.
const start = async (name) => {
  const r = await api("/api/sessions", { method: "POST", body: JSON.stringify({ cwd: home, cmd: [], name, account: "" }) });
  return (await r.json()).id;
};
const alpha = await start("alpha");
const beta = await start("beta");

const profile = mkdtempSync(join(tmpdir(), "plxr-focus-"));
const port = 9900 + (process.pid % 300);
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
  if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`.trim());
  return r.result?.value;
};

const open = async () => {
  let up = 0;
  for (let i = 0; i < 40 && !up; i++) {
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${info.port}/?token=${info.token}` });
    await sleep(700);
    up = await run("return document.querySelectorAll('.railhome').length").catch(() => 0);
  }
  if (!up) {
    console.log("  the interface did not render");
    stop(1);
  }
  // The revision watch starts with the page; give it its first look, so the
  // click below is a change it sees and not the state it started in.
  await sleep(2000);
};
await open();

// The active tab, as dockview marks it — what a person sees as "the session
// in front".
// A tab's text carries its icon before the title, so the title is read off .panelTabName.
const ACTIVE = "return [...document.querySelectorAll('.plxrDock .dv-tab.dv-active-tab')].map(t => (t.querySelector('.panelTabName')?.textContent ?? '').trim()).join('|')";
const names = (id, name) => new RegExp(`(^|\\|)(${name}|${id.slice(0, 8)})( · |$|\\|)`) // a tab reads "name · state" now, so the name is matched as a word before the state, the end, or the next tab
const active = () => run(ACTIVE).catch(() => "");

// What the window does on a click: the same PUT, with the token.
const click = (id, seq) => api("/api/prefs", { method: "PUT", body: JSON.stringify({ focusSession: { id, seq } }) });
const until = async (want, ms) => {
  const t0 = Date.now();
  let seen = "";
  while (Date.now() - t0 < ms) {
    seen = await active();
    if (want.test(seen)) return { ok: true, took: Date.now() - t0, seen };
    await sleep(50);
  }
  return { ok: false, took: Date.now() - t0, seen };
};

// ---- a click opens the session --------------------------------------------
const before = await active();
claim("before any click, beta is not in front", !names(beta, "beta").test(before), before);
let r = await (click(beta, 1), until(names(beta, "beta"), 2000));
claim("a click on beta's notification puts beta in front within 2 s", r.ok, `${r.took} ms, active: ${r.seen || "(none)"}`);

// ---- a second click moves it ----------------------------------------------
r = await (click(alpha, 2), until(names(alpha, "alpha"), 2000));
claim("a click on alpha's notification then puts alpha in front within 2 s", r.ok, `${r.took} ms, active: ${r.seen || "(none)"}`);

// ---- a seq already seen does not move it again ----------------------------
// The person clicks beta's tab; the layout is saved, the settings' revision
// moves, the page reads them again — and the old click must stay old.
await run(`
  const tab = [...document.querySelectorAll('.plxrDock .dv-tab')].find(t => /beta|${beta.slice(0, 8)}/.test(t.textContent));
  tab?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  tab?.click();
`);
await sleep(3500);
const held = await active();
claim("the tab chosen by hand stays in front past two more looks at the settings", names(beta, "beta").test(held), held);

// ---- a reload does not open the last click again --------------------------
await open();
await sleep(2000);
const after = await active();
claim("after a reload the last clicked session is not put in front again", !names(alpha, "alpha").test(after), after || "(none)");

// ---- the verdict -----------------------------------------------------------
const failed = claims.filter((c) => !c.ok);
for (const c of claims) console.log(`  ${c.ok ? "ok " : "NO "} ${c.what}${c.detail ? ` — ${c.detail}` : ""}`);
if (failed.length) {
  console.log(`  ${failed.length} of ${claims.length} claims failed`);
  stop(1);
}
console.log(`  ${claims.length} claims hold`);
stop(0);
