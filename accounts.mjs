/* Can a fourth account be added entirely from the window, and does it work?
 *
 * The question was how to add a fourth account through the interface, and
 * the honest answer was: you get a directory. SIGN IN NEW made ~/.claude4
 * with an empty projects folder and started a session somewhere behind the
 * settings. plxr's hook was not in it, so its sessions reported nothing; its
 * projects folder was its own, so none of the three other accounts' history
 * was in it and nothing of its own reached them; and nothing on the page said
 * whether it was signed in, hooked up, sharing, or had a usage reading.
 *
 * None of that shows in the code. So a machine is built here the way his is
 * — three accounts, the second and third reading the first one's projects
 * folder through a link, plxr's hook in all three, a state file per account
 * with a sign-in and a usage reading — and a fourth account is added twice:
 * once through the service, once by clicking through the page in a real
 * browser. Every claim is held against the file system.
 *
 * `claude` here is a stub of the check's own, found first on the path of the
 * home the service runs in. The real one would reach for the keychain. The
 * stub reports itself through plxr's hook the way Claude Code does, waits,
 * and then writes the sign-in into its account's state file — so the page
 * can be watched turning to "signed in" without being reloaded.
 *
 * No dependencies: the browser already on the machine, over its debugging
 * protocol, against a service of its own in a home of its own. The operator's
 * own accounts are never touched: HOME and PLXR_HOME point into a temporary
 * directory for the service, the hook installer and every session.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, symlinkSync,
  lstatSync, realpathSync, copyFileSync, chmodSync, statSync, constants,
} from "node:fs";
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
if (process.platform === "win32") {
  console.log("  needs symlinks and a POSIX shell");
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
const claim = (what, ok, detail = "") => {
  claims.push({ what, ok: Boolean(ok), detail });
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${detail ? `\n         ${detail}` : ""}`);
};

// ---- a machine of its own ----------------------------------------------------
const root = realpathSync(mkdtempSync(join(tmpdir(), "plxr-accounts-home-")));
const home = join(root, "plxr"); // PLXR_HOME
const fake = join(root, "home"); // HOME
const bin = join(root, "bin");
mkdirSync(home, { recursive: true });
mkdirSync(join(fake, "bin"), { recursive: true });
mkdirSync(bin, { recursive: true });
console.log(`  HOME=${fake}`);
console.log(`  PLXR_HOME=${home}`);

/* The binary under the name plxr. What the hook installer writes is the path
   of the running binary, and plxr recognises its own entry by that file's
   name; /tmp/plxr3-app would be written and then not recognised. A clone, so
   it costs nothing. */
const PLXR = join(bin, "plxr");
copyFileSync(APP, PLXR, constants.COPYFILE_FICLONE);
chmodSync(PLXR, 0o755);

/* Nothing of the operator's Claude Code session travels into this service or
   its sessions: no configuration directory, no session marker. */
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC|PLXR)/.test(k)),
);
Object.assign(env, {
  HOME: fake,
  PLXR_HOME: home,
  SHELL: "/bin/sh",
  PATH: `${join(fake, "bin")}:/usr/bin:/bin:/usr/sbin:/sbin`,
  PLXR_CHECK_BIN: PLXR,
  STUB_SIGNIN_AFTER: "15",
});

const NOW = Date.now();
const MIN = 60 * 1000;
const store = join(fake, ".claude", "projects");
mkdirSync(join(store, "-work-plxr"), { recursive: true });
writeFileSync(join(store, "-work-plxr", "a1b2c3d4-0000-0000-0000-000000000001.jsonl"),
  JSON.stringify({ type: "user", cwd: "/work/plxr", message: { content: "hi" } }) + "\n");
for (const n of [".claude2", ".claude3"]) {
  mkdirSync(join(fake, n), { recursive: true });
  symlinkSync(store, join(fake, n, "projects"));
}
/* A state file per account, where Claude Code keeps it: beside the directory
   for the default account, inside for the others. The sign-in entry holds
   made-up values — the service only ever looks for the key. */
const stateFile = (body) => JSON.stringify({ numStartups: 9, projects: {}, autoUpdates: true, ...body });
const reading = (ago) => ({ fetchedAtMs: NOW - ago, utilization: { five_hour: { utilization: 10, resets_at: null }, limits: [] } });
writeFileSync(join(fake, ".claude.json"), stateFile({ oauthAccount: { accountUuid: "check-1" }, cachedUsageUtilization: reading(2 * MIN) }));
writeFileSync(join(fake, ".claude2", ".claude.json"), stateFile({ oauthAccount: { accountUuid: "check-2" }, cachedUsageUtilization: reading(40 * MIN) }));
writeFileSync(join(fake, ".claude3", ".claude.json"), stateFile({ oauthAccount: { accountUuid: "check-3" }, cachedUsageUtilization: reading(180 * MIN) }));

// The hook, installed the way he installed it: plxr's own installer, per account.
for (const n of [".claude", ".claude2", ".claude3"]) {
  console.log(`  setup-hook ${join(fake, n)} with HOME=${env.HOME}`);
  const r = spawnSync(PLXR, ["setup-hook", join(fake, n)], { env, encoding: "utf8" });
  if (r.status !== 0) {
    console.log(`  the hook could not be installed into ${n}: ${r.stderr}`);
    process.exit(1);
  }
}

/* The stub. Renamed to "claude" in the process list, because that is how the
   hook finds the Claude Code process and the terminal it runs in. */
const RECORD = join(fake, "stub-started.txt");
writeFileSync(join(fake, "bin", "claude"), `#!/bin/bash
if [ -z "$STUB_AS_CLAUDE" ]; then STUB_AS_CLAUDE=1 exec -a claude /bin/bash "$0" "$@"; fi
printf 'pid=%s dir=%s\\n' "$$" "\${CLAUDE_CONFIG_DIR-none}" >> "$HOME/stub-started.txt"
sid=aaaaaaaa-bbbb-4ccc-8ddd-$(printf '%012d' $$)
printf '{"session_id":"%s","hook_event_name":"SessionStart","cwd":"%s"}' "$sid" "$PWD" | "$PLXR_CHECK_BIN" hook
echo "claude (the check's stub): sign in in the browser, then come back"
sleep "\${STUB_SIGNIN_AFTER:-15}"
file="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.claude.json"
[ -z "$CLAUDE_CONFIG_DIR" ] && file="$HOME/.claude.json"
printf '{"numStartups":1,"oauthAccount":{"accountUuid":"check-stub"}}' > "$file"
echo "signed in"
sleep 300
`);
chmodSync(join(fake, "bin", "claude"), 0o755);
writeFileSync(join(fake, ".profile"), `PATH="$HOME/bin:$PATH"\nexport PATH\n`);

// The login shell a session starts in must find the stub and not the real one.
const which = spawnSync("/bin/sh", ["-l", "-c", "command -v claude"], { env, encoding: "utf8" }).stdout.trim();
if (which !== join(fake, "bin", "claude")) {
  console.log(`  the login shell of the check's home finds ${which || "no claude"}, not the stub — refusing to start anything`);
  rmSync(root, { recursive: true, force: true });
  process.exit(1);
}

// Nothing is said out loud from a check.
writeFileSync(join(home, "notify.json"), JSON.stringify({ on: false, sound: "", when: { needsYou: false, waiting: false, ended: false, crashed: false, limit: false }, limit: 80 }));

console.log(`  starting the service with HOME=${env.HOME} PLXR_HOME=${env.PLXR_HOME}`);
const app = spawn(PLXR, ["daemon"], { env, stdio: "ignore" });

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
  try { app.kill(); } catch { /* gone */ }
  process.exit(1);
}
const call = async (path, opts = {}) => {
  const r = await fetch(`http://127.0.0.1:${info.port}${path}`, {
    ...opts,
    headers: { "X-Plxr-Token": info.token, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, text: text.trim(), json };
};
for (let i = 0; i < 80; i++) {
  try {
    if ((await call("/api/version")).status === 200) break;
  } catch { /* not yet */ }
  await sleep(250);
}

const profile = mkdtempSync(join(tmpdir(), "plxr-accounts-chrome-"));
const port = 9300 + (process.pid % 200);
let chrome = null;

function stubPids() {
  try {
    return [...readFileSync(RECORD, "utf8").matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
  } catch {
    return [];
  }
}

/* The browser holds a few hundred megabytes and its helpers more. It goes
   down with its whole process group — on the way out of every path, a throw
   and an interrupt included, never left for somebody to find later. */
function killChrome() {
  if (!chrome || chrome.exitCode !== null || chrome.signalCode !== null) return;
  try { process.kill(-chrome.pid, "SIGKILL"); } catch { try { chrome.kill("SIGKILL"); } catch { /* gone */ } }
}

// The service and the stub, without waiting for anything: this also runs from
// the exit handler, where nothing asynchronous is carried out any more.
function killServiceNow() {
  for (const pid of stubPids()) {
    try { process.kill(pid, "SIGKILL"); } catch { /* ended with its session */ }
  }
  try { process.kill(JSON.parse(readFileSync(join(home, "daemon.json"), "utf8")).pid); } catch { /* gone */ }
  try { app.kill(); } catch { /* gone */ }
}

let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  killChrome();
  try {
    for (const s of (await call("/api/sessions")).json ?? []) {
      await call(`/api/sessions/${encodeURIComponent(s.id)}?purge=1`, { method: "DELETE" });
    }
  } catch { /* the service is gone already */ }
  for (const pid of stubPids()) {
    try { process.kill(pid, "SIGKILL"); } catch { /* ended with its session */ }
  }
  let pid = 0;
  try {
    pid = JSON.parse(readFileSync(join(home, "daemon.json"), "utf8")).pid;
    process.kill(pid);
  } catch { /* gone */ }
  try { app.kill(); } catch { /* gone */ }
  await sleep(300);
  let alive = false;
  try { if (pid) { process.kill(pid, 0); alive = true; } } catch { /* ended */ }
  console.log(`  service pid ${pid} ${alive ? "STILL RUNNING" : "ended"}; stub pids ${stubPids().join(",") || "none"} killed`);
  for (let i = 0; i < 20; i++) {
    try { rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(100); }
  }
  if (!process.env.KEEP_CHECK_HOME) rmSync(root, { recursive: true, force: true });
  process.exit(code);
}

const bail = (why) => (e) => {
  console.log(`  stopped: ${why}${e && typeof e === "object" ? ` — ${String(e.stack ?? e).split("\n")[0]}` : ""}`);
  void stop(1);
};
process.on("uncaughtException", bail("an uncaught exception"));
process.on("unhandledRejection", bail("an unhandled rejection"));
process.on("SIGINT", bail("interrupted"));
process.on("SIGTERM", bail("terminated"));
process.on("exit", () => {
  killChrome();
  if (!stopping) killServiceNow();
});

// ---- what the file system says -------------------------------------------------
const linkOf = (p) => {
  try {
    const st = lstatSync(p);
    return { exists: true, link: st.isSymbolicLink(), dir: st.isDirectory(), real: realpathSync(p) };
  } catch {
    return { exists: false, link: false, dir: false, real: "" };
  }
};
const REAL_STORE = realpathSync(store);
const REAL_PLXR = realpathSync(PLXR);
const EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "Notification", "Stop", "SessionEnd"];
function hookIn(dir) {
  try {
    const s = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    return EVENTS.filter((ev) => (s.hooks?.[ev] ?? []).some((e) => (e.hooks ?? []).some((h) => h.command === REAL_PLXR && (h.args ?? []).includes("hook")))).length;
  } catch {
    return 0;
  }
}
const describeDir = (n) => {
  const p = linkOf(join(fake, n, "projects"));
  return `${n}: exists=${existsSync(join(fake, n))} projects ${p.link ? `→ ${p.real}` : p.dir ? "own folder" : "missing"} · hook in ${hookIn(join(fake, n))}/6 events`;
};
const savedList = () => {
  try { return readFileSync(join(home, "accounts.json"), "utf8"); } catch { return ""; }
};
const facts = (a) => a?.state ? `signedIn=${a.state.signedIn} hook=${a.state.hook} sharedWith=[${a.state.sharedWith.join(",")}] projects=${a.state.projects} usageAt=${a.state.usageAt ? `${Math.round((NOW - a.state.usageAt) / MIN)}min old` : 0}` : "no state";

// ---- through the service -----------------------------------------------------------
let got = await call("/api/accounts");
claim("the service sees his three accounts, each signed in, hooked, sharing, with a reading",
  got.json?.length === 3 && got.json.every((a) => a.state?.signedIn && a.state.hook && a.state.sharedWith.length === 2 && a.state.usageAt > 0),
  (got.json ?? []).map((a) => `${a.name}: ${facts(a)}`).join("\n         "));

got = await call("/api/accounts", { method: "POST", body: JSON.stringify({ label: "" }) });
const viaApi = got.json?.account;
claim("POST /api/accounts with nothing but a label makes claude4", got.status === 200 && viaApi?.name === "claude4",
  `${got.status} → ${viaApi?.name} at ${viaApi?.dir}`);
const d4 = linkOf(join(fake, ".claude4", "projects"));
claim("~/.claude4 exists and its projects is a link to the shared store",
  existsSync(join(fake, ".claude4")) && d4.link && d4.real === REAL_STORE,
  `${describeDir(".claude4")} · store ${REAL_STORE}`);
claim("~/.claude4/settings.json carries plxr's hook for all six events", hookIn(join(fake, ".claude4")) === 6,
  `${hookIn(join(fake, ".claude4"))}/6 with command ${REAL_PLXR}`);
claim("the service says so about claude4: not signed in, hooked, sharing with three, no reading",
  viaApi?.state && !viaApi.state.signedIn && viaApi.state.hook && viaApi.state.sharedWith.length === 3 && viaApi.state.usageAt === 0,
  facts(viaApi));

// The refusal: an existing directory whose projects folder already holds a file.
const holding = join(fake, ".claude7", "projects", "-w", "c.jsonl");
mkdirSync(dirname(holding), { recursive: true });
writeFileSync(holding, "{}\n");
const listBefore = savedList();
got = await call("/api/accounts", { method: "POST", body: JSON.stringify({ dir: "~/.claude7", label: "", share: true }) });
const d7 = linkOf(join(fake, ".claude7", "projects"));
claim("adding a directory whose projects holds a file, sharing, is refused with a code",
  got.status === 400 && got.text.startsWith("err.account.projectsNotEmpty|"), `${got.status} ${got.text}`);
claim("…and nothing changed: the list, the folder, the file",
  savedList() === listBefore && d7.dir && !d7.link && existsSync(holding) && (await call("/api/accounts")).json?.length === 4,
  `list unchanged=${savedList() === listBefore} · ${describeDir(".claude7")} · file there=${existsSync(holding)}`);

got = await call("/api/accounts", { method: "POST", body: JSON.stringify({ dir: "~/.claude7", label: "", share: false }) });
const joinRefused = await call("/api/accounts/claude7/share", { method: "POST" });
claim("added with its own history, joining later is refused the same way while it holds the file",
  got.status === 200 && joinRefused.status === 400 && joinRefused.text.startsWith("err.account.projectsNotEmpty|") &&
    !linkOf(join(fake, ".claude7", "projects")).link && existsSync(holding),
  `add ${got.status} · share ${joinRefused.status} ${joinRefused.text} · ${describeDir(".claude7")}`);

got = await call("/api/accounts", { method: "POST", body: JSON.stringify({ dir: "~/.claude8", label: "", share: false }) });
const own8 = linkOf(join(fake, ".claude8", "projects"));
const joined = await call("/api/accounts/claude8/share", { method: "POST" });
const d8 = linkOf(join(fake, ".claude8", "projects"));
claim("an account with an empty folder of its own joins the shared store later",
  got.status === 200 && own8.dir && !own8.link && joined.status === 200 && d8.link && d8.real === REAL_STORE &&
    joined.json.find((a) => a.name === "claude8")?.state.sharedWith.length === 4,
  `before: ${own8.dir ? "own folder" : "?"} · share ${joined.status} · after: ${describeDir(".claude8")} · ${facts(joined.json?.find((a) => a.name === "claude8"))}`);

// The page gets a clean start: the same three, and .claude4 free again.
for (const n of ["claude4", "claude7", "claude8"]) await call(`/api/accounts/${n}`, { method: "DELETE" });
for (const n of [".claude4", ".claude7", ".claude8"]) rmSync(join(fake, n), { recursive: true, force: true });
got = await call("/api/accounts");
if (got.json?.length !== 3) {
  console.log(`  could not return to three accounts: ${got.text}`);
  await stop(1);
}

try {
// ---- through the page ----------------------------------------------------------------
chrome = spawn(browser, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--use-mock-keychain",
  "--password-store=basic",
  "--no-default-browser-check",
  "--window-size=1600,1000",
  "about:blank",
], { stdio: "ignore", detached: true });

async function target(url) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const ws = list.find((t) => t.type === "page" && t.url === url)?.webSocketDebuggerUrl;
      if (ws) return ws;
    } catch { /* not up */ }
    await sleep(250);
  }
  return null;
}

async function connect(wsUrl) {
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
  return { cdp, run };
}

const first = await target("about:blank");
if (!first) {
  console.log("  the browser did not come up");
  await stop(1);
}
const tab = await connect(first);
const PAGE = `http://127.0.0.1:${info.port}/?token=${info.token}`;
let up = 0;
for (let i = 0; i < 40 && !up; i++) {
  await tab.cdp.send("Page.navigate", { url: PAGE });
  await sleep(700);
  up = await tab.run("return document.querySelectorAll('.railhome').length").catch(() => 0);
}
if (!up) {
  console.log("  the interface did not render");
  await stop(1);
}
// Set once; still there at the end means the page was never loaded again.
await tab.run("window.__notReloaded = 'yes'; return true;");

const HELPERS = `
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return { v, ms: Math.round(performance.now() - t0) }; await wait(50); } return { v: null, ms: Math.round(performance.now() - t0) }; };
  const rows = () => [...document.querySelectorAll('.accountRow')].map(r => ({
    account: r.dataset.account,
    name: r.querySelector('.accountName')?.textContent.trim() ?? '',
    facts: Object.fromEntries([...r.querySelectorAll('[data-fact]')].map(f => [f.dataset.fact, { text: f.textContent.trim(), good: f.dataset.good ?? '', shared: f.dataset.shared ?? '', colour: getComputedStyle(f).color }])),
    share: !!r.querySelector('[data-do="share-account"]'),
  }));
  const row = (name) => rows().find(r => r.account === name);
  const tabs = () => [...document.querySelectorAll('.plxrDock .dv-tab')];
  const tabText = t => t.textContent.replace(/✕|×/g, '').trim();
  const activeTab = () => [...document.querySelectorAll('.plxrDock .dv-tab.dv-active-tab')].map(tabText).join('|');
`;
const line = (r) => r ? `${r.account} "${r.name}": ${["signin", "hook", "history", "usage"].map((k) => `${r.facts[k]?.text}${r.facts[k]?.good === "no" ? " (marked)" : ""}`).join(" · ")}` : "(no row)";

async function type(selector, text) {
  const there = await tab.run(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); el.select?.(); return true;`);
  if (there) await tab.cdp.send("Input.insertText", { text });
  return there;
}

/* Back to Settings › accounts, and what the window looked like on the way —
   so a step that cannot find the rows says whether the tab did not come to
   the front or the settings came back on another tab. */
async function openAccounts() {
  return tab.run(`${HELPERS}
    const gear = [...document.querySelectorAll('.bar .btn')].find(b => b.textContent.trim() === '⚙');
    gear?.click();
    const clicked = !!gear;
    await until(() => /Settings/.test(activeTab()) ? true : null, 3000);
    const got = await until(() => document.querySelector('.tab[data-tab="accounts"]'), 3000);
    const seen = { clicked, active: activeTab(), settingsOn: document.querySelector('.tab.on')?.dataset.tab ?? '(none)' };
    if (!got.v) return { ...seen, rows: 0, tabs: tabs().map(tabText).join(' | ') };
    if (!got.v.classList.contains('on')) got.v.click();
    await until(() => rows().length ? true : null, 4000);
    return { ...seen, rows: rows().length };
  `);
}
const how = (o) => `[⚙ clicked ${o.clicked}, active "${o.active}", settings came back on "${o.settingsOn}"${o.tabs ? `, tabs: ${o.tabs}` : ""}]`;

// Settings › accounts
const opened = await tab.run(`${HELPERS}
  document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', metaKey: true, bubbles: true }));
  const t = await until(() => document.querySelector('.tab[data-tab="accounts"]'), 5000);
  if (!t.v) return { ok: false, active: activeTab() };
  t.v.click();
  const got = await until(() => { const r = rows(); return r.length === 3 && r.every(x => x.facts.usage) ? r : null; }, 8000);
  return { ok: !!got.v, rows: got.v, ms: got.ms, active: activeTab(),
    toggle: document.querySelector('.tabbody .styleToggle')?.dataset.on ?? '',
    toggleText: document.querySelector('.tabbody .styleToggle')?.textContent.trim() ?? '' };
`);
if (!opened?.ok) {
  claim("Settings › accounts opens with three rows", false, JSON.stringify(opened));
} else {
  const [one, two, three] = opened.rows;
  claim("the page shows his three accounts: signed in, hook, shared history, and how old each reading is",
    opened.rows.every((r) => r.facts.signin.good === "yes" && r.facts.hook.good === "yes" && r.facts.history.shared === "yes") &&
      /\b2m\b/.test(one.facts.usage.text) && /\b40m\b/.test(two.facts.usage.text) && /\b3h\b/.test(three.facts.usage.text),
    `after ${opened.ms} ms\n         ${opened.rows.map(line).join("\n         ")}`);
  claim("the share switch is on, because the three share one history",
    opened.toggle === "yes", `data-on=${opened.toggle} "${opened.toggleText}"`);
}

// + SIGN IN NEW
const clickedAt = Date.now();
const signIn = await tab.run(`${HELPERS}
  document.querySelector('[data-do="signin-account"]').click();
  const got = await until(() => { const a = activeTab(); return /sign in: claude4/.test(a) ? a : null; }, 5000);
  const active = [...document.querySelectorAll('.plxrDock .dv-tab.dv-active-tab')].find(t => /sign in: claude4/.test(tabText(t)));
  const settings = tabs().find(t => tabText(t).includes('Settings'));
  return { active: got.v ?? activeTab(), ms: got.ms,
    sameGroupAsSettings: !!(active && settings && active.closest('.dv-groupview') === settings.closest('.dv-groupview')),
    visibleTerminal: !!document.querySelector('.plxrDock .dv-active-group .session') };
`);
const sessions = (await call("/api/sessions")).json ?? [];
const loginSession = sessions.find((s) => s.account === "claude4");
claim("the sign-in session opens in front, in the main region beside the settings",
  /sign in: claude4/.test(signIn.active) && signIn.sameGroupAsSettings && signIn.visibleTerminal,
  `active tab "${signIn.active}" after ${signIn.ms} ms · same group as Settings: ${signIn.sameGroupAsSettings} · session view visible: ${signIn.visibleTerminal} · service: ${loginSession ? `${loginSession.name} on ${loginSession.account}` : "no session on claude4"}`);

const p4 = linkOf(join(fake, ".claude4", "projects"));
claim("clicked from the page: ~/.claude4 exists, projects links to the shared store, the hook is in its settings",
  existsSync(join(fake, ".claude4")) && p4.link && p4.real === REAL_STORE && hookIn(join(fake, ".claude4")) === 6,
  describeDir(".claude4"));

let record = "";
for (let i = 0; i < 40 && !/claude4/.test(record); i++) {
  try { record = readFileSync(RECORD, "utf8"); } catch { /* not yet */ }
  if (!/claude4/.test(record)) await sleep(250);
}
claim("the session really started claude under the new account", record.includes(`dir=${join(fake, ".claude4")}`), record.trim() || "(the stub never ran)");

// Back to the settings, before the stub signs in.
const back1 = await openAccounts();
const before = await tab.run(`${HELPERS}
  const got = await until(() => { const r = row('claude4'); return r && r.facts.signin ? r : null; }, 4000);
  const chip = document.querySelector('.accountRow[data-account="claude4"] [data-fact="signin"]');
  return { r: got.v, count: rows().length, ms: got.ms,
    theme: document.documentElement.dataset.theme ?? '(none)', skin: document.documentElement.dataset.skin ?? '(none)',
    blocked: chip ? getComputedStyle(chip).getPropertyValue('--blocked').trim() : '', dim: chip ? getComputedStyle(chip).getPropertyValue('--dim').trim() : '',
    body: getComputedStyle(document.body).color };
`);
claim("the page shows four accounts, the new one not signed in, hooked, sharing, with no reading",
  before.count === 4 && before.r?.facts.signin.good === "no" && before.r?.facts.hook.good === "yes" &&
    before.r?.facts.history.shared === "yes" && before.r?.facts.usage.text === "no usage reading" &&
    before.r?.facts.signin.colour !== before.r?.facts.hook.colour,
  `${how(back1)} ${before.count} rows, ${Math.round((Date.now() - clickedAt) / 1000)} s after the click · ${line(before.r)} · "not signed in" colour ${before.r?.facts.signin.colour} against "hook" ${before.r?.facts.hook.colour} · theme ${before.theme} skin ${before.skin} --blocked "${before.blocked}" --dim "${before.dim}" body ${before.body}`);

// The stub writes the sign-in; the page turns without being loaded again.
const turned = await tab.run(`${HELPERS}
  const got = await until(() => { const r = row('claude4'); return r && r.facts.signin.good === 'yes' ? r : null; }, 30000);
  return { r: got.v, ms: got.ms, notReloaded: window.__notReloaded };
`);
let signedAt = 0;
try { signedAt = statSync(join(fake, ".claude4", ".claude.json")).mtimeMs; } catch { /* never written */ }
claim("when the account becomes signed in, the page says so without a reload",
  turned.r && turned.notReloaded === "yes",
  turned.r ? `${line(turned.r)} · ${Math.round(Date.now() - signedAt)} ms after the stub wrote the sign-in · page not reloaded: ${turned.notReloaded}` : `still not signed in after ${turned.ms} ms`);

// The account switch on the sign-in session.
const picker = await tab.run(`${HELPERS}
  [...document.querySelectorAll('.railitem')].find(e => e.textContent.includes('sign in: claude4'))?.click();
  await until(() => /sign in: claude4/.test(activeTab()) ? true : null, 3000);
  const got = await until(() => document.querySelector('.plxrDock .dv-active-group .session .selectButton'), 12000);
  if (!got.v) return { options: [], ms: got.ms };
  got.v.click();
  const list = await until(() => document.querySelectorAll('.selectList .selectRow').length ? [...document.querySelectorAll('.selectList .selectRow')].map(o => o.textContent.trim()) : null, 3000);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return { options: list.v ?? [], ms: got.ms, current: got.v.textContent.trim() };
`);
claim("the account switch on a session offers the new account",
  picker.options.length === 4 && picker.options.some((o) => /account 4/.test(o)),
  picker.options.length ? `on "${picker.current}": ${picker.options.join(" | ")} (picker up after ${picker.ms} ms)` : `no picker after ${picker.ms} ms`);

// USAGE on the rail.
const usage = await tab.run(`${HELPERS}
  const glyphs = [...document.querySelectorAll('.railhome .rdot')].map(d => d.textContent.trim());
  const item = document.querySelector('.railhome[data-view="usage"]');
  item?.click();
  const got = await until(() => document.querySelectorAll('.uacct').length === 4 ? [...document.querySelectorAll('.uacct .uacctName')].map(n => n.textContent.trim()) : null, 15000);
  return { names: got.v ?? [...document.querySelectorAll('.uacct .uacctName')].map(n => n.textContent.trim()), ms: got.ms,
    glyphs: glyphs.join(' '), item: !!item, active: activeTab(), empty: document.querySelector('.emptyNote')?.textContent.trim() ?? '' };
`);
claim("the usage view lists the new account", usage.names.length === 4 && usage.names.some((n) => /account 4/.test(n)),
  `${usage.names.join(" | ") || "no cards"} after ${usage.ms} ms · rail glyphs "${usage.glyphs}" · usage item found ${usage.item} · active "${usage.active}"${usage.empty ? ` · "${usage.empty}"` : ""}`);

// The new-session dialog.
const dialog = await tab.run(`${HELPERS}
  document.body.click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true, bubbles: true }));
  const field = () => [...document.querySelectorAll('.card .field')].find(f => f.querySelector(':scope > .fieldName')?.textContent.trim() === 'account');
  const got = await until(() => { const f = field(); return f && f.querySelectorAll('.choiceButton').length === 4 ? [...f.querySelectorAll('.choiceButton')].map(b => b.textContent.trim()) : null; }, 6000);
  const names = got.v ?? (field() ? [...field().querySelectorAll('.choiceButton')].map(b => b.textContent.trim()) : []);
  [...document.querySelectorAll('.card .cardButtons .btn')].find(b => /cancel/i.test(b.textContent))?.click();
  return { names, ms: got.ms };
`);
claim("the new-session dialog offers the new account", dialog.names.length === 4 && dialog.names.some((n) => /account 4/.test(n)),
  `${dialog.names.join(" | ") || "no account field"} after ${dialog.ms} ms`);

// + EXISTING with the switch off, then SHARE HISTORY on the row.
const back2 = await openAccounts();
const ownAdd = await tab.run(`${HELPERS}
  const found = await until(() => document.querySelector('.tabbody .styleToggle'), 3000);
  const t = found.v;
  if (!t) return { pageToggle: '(no switch)', dialogToggle: '(none)', ask: false, active: activeTab(), tabs: tabs().map(tabText).join(' | ') };
  if (t.dataset.on === 'yes') t.click();
  await wait(50);
  document.querySelector('[data-do="add-account"]').click();
  const ask = await until(() => document.querySelector('.ask input'), 3000);
  return { pageToggle: t.dataset.on, dialogToggle: document.querySelector('.ask .styleToggle')?.dataset.on ?? '(none)', ask: !!ask.v };
`);
await type(".ask input", "~/.claude5");
const own = await tab.run(`${HELPERS}
  await wait(150);
  [...document.querySelectorAll('.ask .cardButtons .btn')].find(b => b.classList.contains('primary'))?.click();
  const got = await until(() => { const r = row('claude5'); return r && r.facts.history ? r : null; }, 5000);
  return { r: got.v, count: rows().length, ms: got.ms };
`);
const own5 = linkOf(join(fake, ".claude5", "projects"));
claim("+ EXISTING with the switch off takes ~/.claude5 in with its own history, and offers SHARE HISTORY",
  ownAdd.pageToggle === "no" && ownAdd.dialogToggle === "no" && own.r?.facts.history.shared === "no" && own.r?.share && own5.dir && !own5.link,
  `switch on the page ${ownAdd.pageToggle}, in the dialog ${ownAdd.dialogToggle}${ownAdd.tabs ? ` (active: ${ownAdd.active}; tabs: ${ownAdd.tabs})` : ""} ${how(back2)} · ${own.count} rows · ${line(own.r)} · share button ${own.r?.share} · ${describeDir(".claude5")}`);

const later = await tab.run(`${HELPERS}
  document.querySelector('.accountRow[data-account="claude5"] [data-do="share-account"]')?.click();
  const got = await until(() => { const r = row('claude5'); return r && r.facts.history.shared === 'yes' ? r : null; }, 5000);
  return { r: got.v, ms: got.ms, problem: document.querySelector('.tabbody .notice.warn')?.textContent.trim() ?? '' };
`);
const joined5 = linkOf(join(fake, ".claude5", "projects"));
claim("SHARE HISTORY joins it later: the row turns, and projects is a link to the store",
  later.r && joined5.link && joined5.real === REAL_STORE && !later.r.share,
  later.r ? `after ${later.ms} ms · ${line(later.r)} · ${describeDir(".claude5")}` : `nothing after ${later.ms} ms · ${later.problem}`);

// The refusal, on the page: a directory whose projects already holds a file.
const held = join(fake, ".claude6", "projects", "-w", "keep.jsonl");
mkdirSync(dirname(held), { recursive: true });
writeFileSync(held, "{}\n");
const listBeforePage = savedList();
const refuseOpen = await tab.run(`${HELPERS}
  const t = document.querySelector('.tabbody .styleToggle');
  if (!t) return { dialogToggle: '(no switch on the page)' };
  if (t.dataset.on !== 'yes') t.click();
  await wait(50);
  document.querySelector('[data-do="add-account"]').click();
  await until(() => document.querySelector('.ask input'), 3000);
  return { dialogToggle: document.querySelector('.ask .styleToggle')?.dataset.on ?? '(none)' };
`);
await type(".ask input", "~/.claude6");
const refused = await tab.run(`${HELPERS}
  await wait(150);
  [...document.querySelectorAll('.ask .cardButtons .btn')].find(b => b.classList.contains('primary'))?.click();
  const got = await until(() => document.querySelector('.tabbody .notice.warn')?.textContent.trim() || null, 5000);
  return { text: got.v ?? '', count: rows().length, ms: got.ms };
`);
const d6 = linkOf(join(fake, ".claude6", "projects"));
claim("the page refuses a projects folder that holds a file, says why, and changes nothing",
  refuseOpen.dialogToggle === "yes" && /already holds files/.test(refused.text) && refused.text.includes(join(fake, ".claude6", "projects")) &&
    refused.count === 5 && d6.dir && !d6.link && existsSync(held) && savedList() === listBeforePage,
  `switch in the dialog ${refuseOpen.dialogToggle} · "${refused.text}" · ${refused.count} rows · ${describeDir(".claude6")} · file there=${existsSync(held)} · saved list unchanged=${savedList() === listBeforePage}`);

const finalRows = await tab.run(`${HELPERS} return { rows: rows(), notReloaded: window.__notReloaded };`);
claim("in the end the page shows every account with the right states, and was never reloaded",
  finalRows.notReloaded === "yes" && finalRows.rows.length === 5 &&
    finalRows.rows.every((r) => r.facts.hook.good === "yes" && r.facts.history.shared === "yes"),
  finalRows.rows.map(line).join("\n         "));

} catch (e) {
  claim("the page could be driven to the end", false, String(e?.stack ?? e).split("\n").slice(0, 3).join(" · "));
}

// ---- the report ------------------------------------------------------------------------
const failed = claims.filter((c) => !c.ok).length;
console.log(failed ? `  ${failed} of ${claims.length} claims failed` : `  all ${claims.length} claims hold — 1 file`);
await stop(failed ? 1 : 0);
