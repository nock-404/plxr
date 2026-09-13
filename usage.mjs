/* Does the usage view say what is left, per account, and say it honestly?
 *
 * The old view led with one number — what three accounts spent over thirty
 * days, added together — and the question in front of somebody about to start
 * a long run was the other one: how much of the current window is gone, on
 * which account, and when does it come back. It went unanswered until an
 * account hit its weekly limit mid-run and took hours of work with it.
 *
 * None of that can be checked from the code. Whether the percentages reach
 * the screen, whether a reset time is shown in this machine's timezone,
 * whether an account with nothing on disk says so instead of drawing a bar at
 * zero, and whether the rail marks the account that is nearly out — all of it
 * is only true if it renders. So it is rendered here, in a real browser,
 * against a service with three accounts of its own making: two with a reading
 * Claude Code would have left, one with none, and their transcripts pooled
 * the way they are pooled on this machine.
 *
 * No dependencies: the browser already on the machine, over its debugging
 * protocol, the way changes.mjs does it.
 */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GATEKIT } from "./gatekit.mjs";

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
/* The binary build.sh leaves behind. PLXR_APP points somewhere else when
   several checkouts are building at once and would otherwise overwrite each
   other's copy between the build and the run. */
const APP = process.env.PLXR_APP || "/tmp/plxr3-app";
if (!existsSync(APP)) {
  console.log(`  ${APP} is not there — run ./build.sh first`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = [];
const claim = (what, ok, detail = "") => claims.push({ what, ok: Boolean(ok), detail });

/* A machine of its own: a home for the service, and a home for the accounts.
   The account directories are never the operator's — this must be able to run
   on a machine with no Claude account at all and still prove the view. */
const home = mkdtempSync(join(tmpdir(), "plxr-usage-home-"));
const fake = join(home, "home");

const NOW = Date.now();
const HOUR = 3600 * 1000;

/* Three accounts. The first two have a reading Claude Code would have left
   beside its configuration; the third has none at all, which is the case the
   view has to say out loud rather than draw as zero.

   claude keeps its state beside the directory (~/.claude.json), the way the
   default account does; claude2 keeps it inside (~/.claude2/.claude.json),
   the way a CLAUDE_CONFIG_DIR account does. Both paths are exercised. */
const RESET_SESSION = NOW + 2 * HOUR + 37 * 60 * 1000;
const RESET_WEEK_1 = NOW + 4 * 24 * HOUR;
const RESET_WEEK_2 = NOW + 9 * HOUR;

const utilization = (session, week, sessionReset, weekReset, model, modelPct) => ({
  fetchedAtMs: NOW - 90 * 1000,
  accountUuid: "00000000-0000-0000-0000-000000000000",
  utilization: {
    five_hour: { utilization: session, resets_at: sessionReset ? new Date(sessionReset).toISOString() : null },
    seven_day: { utilization: week, resets_at: new Date(weekReset).toISOString() },
    limits: [
      { kind: "session", group: "session", percent: session, severity: "normal", resets_at: sessionReset ? new Date(sessionReset).toISOString() : null, scope: null, is_active: true },
      { kind: "weekly_all", group: "weekly", percent: week, severity: week >= 90 ? "critical" : "normal", resets_at: new Date(weekReset).toISOString(), scope: null, is_active: true },
      { kind: "weekly_scoped", group: "weekly", percent: modelPct, severity: "normal", resets_at: new Date(weekReset).toISOString(), scope: { model: { id: null, display_name: model } }, is_active: false },
    ],
  },
});

const state = (path, body) =>
  writeFileSync(path, JSON.stringify({ numStartups: 12, projects: {}, cachedUsageUtilization: body, autoUpdates: true }));

const projects = join(fake, ".claude", "projects");
mkdirSync(join(projects, "-work-plxr"), { recursive: true });
for (const name of [".claude2", ".claude3"]) mkdirSync(join(fake, name), { recursive: true });
// The second and third account read the first one's transcripts, which is how
// this machine is set up: one pool, three readers, and a spend that cannot be
// split between them.
for (const name of [".claude2", ".claude3"]) symlinkSync(projects, join(fake, name, "projects"));

state(join(fake, ".claude.json"), utilization(28, 41, RESET_SESSION, RESET_WEEK_1, "Fable", 12));
state(join(fake, ".claude2", ".claude.json"), utilization(0, 96, null, RESET_WEEK_2, "Opus", 96));
// claude3: nothing. Claude Code has never run there.

/* One transcript with lines whose moments are known, so every figure on
   screen can be held against arithmetic done here rather than against
   whatever happened to be on the disk. Four assistant lines inside the
   five-hour window, one well outside it. */
const LINE = (when, model, inTok, outTok, cw, cr) =>
  JSON.stringify({
    type: "assistant",
    cwd: "/work/plxr",
    timestamp: new Date(when).toISOString(),
    message: { model, usage: { input_tokens: inTok, output_tokens: outTok, cache_creation_input_tokens: cw, cache_read_input_tokens: cr } },
  });
const INSIDE = [
  LINE(NOW - 30 * 60 * 1000, "claude-opus-5", 1000, 2000, 3000, 4000),
  LINE(NOW - 60 * 60 * 1000, "claude-opus-5", 1000, 2000, 3000, 4000),
  LINE(NOW - 90 * 60 * 1000, "claude-sonnet-4-5", 500, 700, 900, 1100),
  LINE(NOW - 2 * HOUR, "claude-sonnet-4-5", 500, 700, 900, 1100),
];
const OUTSIDE = [LINE(NOW - 20 * 24 * HOUR, "claude-opus-5", 9_000_000, 9_000_000, 9_000_000, 9_000_000)];
writeFileSync(join(projects, "-work-plxr", "a1b2c3d4-0000-0000-0000-000000000001.jsonl"), [...INSIDE, ...OUTSIDE].join("\n") + "\n");

// What the four lines inside the window add up to, worked out here.
const WINDOW_TOKENS = 2 * (1000 + 2000 + 3000 + 4000) + 2 * (500 + 700 + 900 + 1100);
const OPUS = { input: 2000, output: 4000, cacheWrite: 6000, cacheRead: 8000 };

/* Nothing is said out loud from here.
   This service runs with an account at 96% of its week, which is exactly the
   state the warning exists for — and a notification from a check run does not
   belong on anybody's screen. The threshold itself is proven in Go, where it
   can be crossed without a machine hearing about it. */
writeFileSync(join(home, "notify.json"), JSON.stringify({ on: false, sound: "", when: { needsYou: false, waiting: false, ended: false, crashed: false, limit: false }, limit: 80 }));

const app = spawn(APP, ["daemon"], {
  env: { ...process.env, PLXR_HOME: home, HOME: fake },
  stdio: "ignore",
});

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

const profile = mkdtempSync(join(tmpdir(), "plxr-usage-"));
const port = 9600 + (process.pid % 300);
const chrome = spawn(browser, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--use-mock-keychain",
  "--password-store=basic",
  "--no-default-browser-check",
  "--window-size=1600,1000",
  "about:blank",
], { stdio: "ignore" });

function stop(code) {
  endEverything();
  process.exit(code);
}

async function target(url) {
  let ws = null;
  for (let i = 0; i < 80 && !ws; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      ws = list.find((t) => t.type === "page" && t.url === url)?.webSocketDebuggerUrl;
    } catch { /* not up */ }
    if (!ws) await sleep(250);
  }
  return ws;
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

// ---- what the service answers ------------------------------------------------
const report = await (await api("/api/usage/accounts")).json();
claim("the service answers with one section per account", report.accounts?.length === 3,
  `${report.accounts?.length} accounts, ${report.pools} pool(s), ${report.files} transcripts read in ${report.duration}`);
claim("the three accounts share one set of transcripts and are told so",
  report.pools === 1 && report.accounts.every((a) => a.sharedWith.length === 2),
  report.accounts.map((a) => `${a.name}←${a.sharedWith.join("+") || "alone"}`).join(" · "));
claim("the percentages are per account, not one number for all three",
  report.accounts[0].week.percent === 41 && report.accounts[1].week.percent === 96,
  report.accounts.map((a) => `${a.name} session ${a.session.known ? a.session.percent + "%" : "—"} week ${a.week.known ? a.week.percent + "%" : "—"}`).join(" · "));
claim("the account Claude Code never ran in says it has no reading",
  report.accounts[2].known === false && report.accounts[2].week.known === false,
  `${report.accounts[2].name}: known=${report.accounts[2].known}, source=${report.accounts[2].source || "(none)"}`);
claim("the spend is counted from the window's real start, not over a period of its own",
  report.accounts[0].session.measured === true &&
    report.accounts[0].session.spend.input + report.accounts[0].session.spend.output +
    report.accounts[0].session.spend.cacheRead + report.accounts[0].session.spend.cacheWrite === WINDOW_TOKENS,
  `measured=${report.accounts[0].session.measured}, ${JSON.stringify(report.accounts[0].session.spend)} — worked out here: ${WINDOW_TOKENS} tokens`);
claim("a window with no reset time falls back to the last five hours and says so",
  report.accounts[1].session.measured === false,
  `claude2 session: known=${report.accounts[1].session.known} measured=${report.accounts[1].session.measured}`);
const opus = report.total.byModel.find((m) => m.key === "claude-opus-5");
claim("the spend breaks down by model with both sides of the cache",
  opus && opus.input === OPUS.input && opus.output === OPUS.output && opus.cacheWrite === OPUS.cacheWrite && opus.cacheRead === OPUS.cacheRead,
  report.total.byModel.map((m) => `${m.key} in ${m.input} out ${m.output} cw ${m.cacheWrite} cr ${m.cacheRead}`).join(" · "));
claim("a shared pool is added into the total once, not once per account",
  report.total.session.input + report.total.session.output + report.total.session.cacheRead + report.total.session.cacheWrite === WINDOW_TOKENS,
  `${JSON.stringify(report.total.session)} against ${WINDOW_TOKENS}`);

// ---- and what reaches the screen ---------------------------------------------
const PAGE = `http://127.0.0.1:${info.port}/?token=${info.token}`;
const first = await target("about:blank");
if (!first) {
  console.log("  the browser did not come up");
  stop(1);
}
const tab = await connect(first);
let up = 0;
for (let i = 0; i < 40 && !up; i++) {
  await tab.cdp.send("Page.navigate", { url: PAGE });
  await sleep(700);
  up = await tab.run(`${GATEKIT} return appUp();`).catch(() => 0);
}
if (!up) {
  console.log("  the interface did not render");
  stop(1);
}

const HELPERS = `${GATEKIT}
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const byText = (sel, re) => [...document.querySelectorAll(sel)].find(e => re.test(e.textContent.trim()));
  const until = async (fn, ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return { v, ms: Math.round(performance.now() - t0) }; await wait(60); } return { v: null, ms: Math.round(performance.now() - t0) }; };
  const cards = () => [...document.querySelectorAll('.uacct')].map(c => ({
    name: c.querySelector('.uacctName')?.textContent.trim() ?? '',
    hot: c.classList.contains('uhot'),
    badge: c.querySelector('.uacctBadge')?.textContent.trim() ?? '',
    warn: c.querySelector('.uacctHot')?.textContent.trim() ?? '',
    dir: c.querySelector('.uacctDir')?.textContent.trim() ?? '',
    windows: [...c.querySelectorAll('.uwin')].map(w => ({
      head: w.querySelector('.uwinHead')?.textContent.trim() ?? '',
      pct: w.querySelector('.uwinPct')?.textContent.trim() ?? '',
      width: w.querySelector('.uwinFill')?.style.width ?? '',
      when: w.querySelector('.uwinWhen')?.textContent.trim() ?? '',
      spend: w.querySelector('.uwinSpend')?.textContent.trim() ?? '',
      note: w.querySelector('.uwinNote')?.textContent.trim() ?? '',
      hot: w.classList.contains('uhot'),
    })),
    notes: [...c.querySelectorAll(':scope > .uwinNote')].map(n => n.textContent.trim()),
  }));
`;

const open = await tab.run(`${HELPERS}
  /* By the view it opens, not by its name or its glyph: the window may be
     running in either language, the glyph changed twice in one day, and the
     icon packs draw every entry differently again. */
  openTool('usage');
  const got = await until(() => document.querySelectorAll('.uacct').length === 3 ? cards() : null, 12000);
  return { cards: got.v, ms: got.ms,
    head: document.querySelector('.listbody .uhead')?.textContent.trim() ?? '',
    meta: document.querySelector('.uacct')?.closest('.list')?.querySelector('.listbar .meta')?.textContent.trim() ?? '' };
`);
claim("USAGE on the rail opens a section per account, named the way the settings name them",
  open.cards?.length === 3 && open.cards[0].name.length > 0,
  open.cards ? `after ${open.ms} ms · "${open.head}" · ${open.meta} · ${open.cards.map((c) => c.name).join(" | ")}` : `nothing in ${open.ms} ms`);

if (open.cards) {
  const [one, two, three] = open.cards;
  claim("the first account leads with the session window, its percentage and when it comes back",
    one.windows[0]?.head.length > 0 && /28/.test(one.windows[0]?.pct) && one.windows[0]?.when.length > 0,
    `${one.windows[0]?.head}: ${one.windows[0]?.pct} · ${one.windows[0]?.when} · bar ${one.windows[0]?.width}`);
  claim("the reset time is shown in this machine's own timezone",
    one.windows[0]?.when.includes(new Date(RESET_SESSION).toLocaleString(undefined, { weekday: "short" })) &&
      one.windows[0]?.when.includes(String(new Date(RESET_SESSION).getHours()).padStart(2, "0")),
    `"${one.windows[0]?.when}" against ${new Date(RESET_SESSION).toString()}`);
  claim("the tokens spent since that window opened are on the same line",
    /\d/.test(one.windows[0]?.spend ?? ""), one.windows[0]?.spend ?? "(none)");
  claim("the weekly window is there too, with its own percentage",
    /41/.test(one.windows[1]?.pct ?? ""), `${one.windows[1]?.head}: ${one.windows[1]?.pct} · ${one.windows[1]?.when}`);
  claim("the bar is drawn to the percentage, not to a total",
    one.windows[0]?.width === "28%" && one.windows[1]?.width === "41%",
    `${one.windows[0]?.width} and ${one.windows[1]?.width}`);
  claim("the account at 96% is marked as nearly out, and the one at 41% is not",
    two.hot && two.warn.length > 0 && !one.hot,
    `${two.name}: "${two.warn}" · ${one.name}: ${one.hot ? "marked" : "not marked"}`);
  claim("the account with nothing on disk says so in one line instead of showing zero",
    three.notes.some((n) => n.length > 20) && three.windows.every((w) => w.pct === "" || w.note.length > 0),
    three.notes[0] ?? "(no line at all)");
  claim("every section says the transcripts are shared and the tokens are the pool's",
    open.cards.every((c) => c.notes.some((n) => /claude/i.test(n) && n.length > 40)),
    open.cards.map((c) => c.notes.length).join("/") + " notes per card");
}

const rest = await tab.run(`${HELPERS}
  return {
    models: [...document.querySelectorAll('.umodels')].map(m => ({
      head: m.querySelector('.uhead')?.textContent.trim() ?? '',
      cols: [...m.querySelectorAll('.umodelHead .umodelCell')].map(c => c.textContent.trim()),
      rows: [...m.querySelectorAll('.umodelRow:not(.umodelHead)')].map(r => ({
        name: r.querySelector('.umodelName')?.textContent.trim() ?? '',
        cells: [...r.querySelectorAll('.umodelCell')].map(c => c.textContent.trim()),
      })),
    })),
    foot: document.querySelector('.ufoot')?.textContent.trim() ?? '',
    totals: [...document.querySelectorAll('.usum')][0] ? [...document.querySelectorAll('.usum')][0].textContent.trim() : '',
    railHot: stripeIcon('usage')?.dataset.nearlyOut === 'yes',
    railMark: stripeIcon('usage')?.dataset.nearlyOut === 'yes' ? stripeIcon('usage').querySelector('.rmeta')?.textContent.trim() ?? '' : '',
    railName: stripeIcon('usage')?.dataset.nearlyOut === 'yes' ? stripeIcon('usage').querySelector('.rname')?.textContent.trim() ?? '' : '',
    overflow: document.querySelector('.listbody')?.scrollWidth <= document.querySelector('.listbody')?.clientWidth,
    // What is too wide, measured, so a failure says where the sideways scroll comes from.
    widths: (() => {
      const body = document.querySelector('.listbody');
      if (!body) return null;
      const r = body.getBoundingClientRect();
      const group = body.closest('.dv-groupview')?.getBoundingClientRect();
      const wide = [...body.querySelectorAll('*')]
        .filter(e => e.getBoundingClientRect().right > r.right + 1)
        .map(e => String(e.className || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().width) + 'px')
        .slice(0, 6);
      return { client: body.clientWidth, scroll: body.scrollWidth, group: group ? Math.round(group.width) : -1, wide };
    })(),
  };
`);
const table = rest.models.find((m) => m.rows.length);
claim("the spend by model reaches the screen with input, output and both sides of the cache",
  table && table.cols.length === 4 && table.rows.length >= 2,
  table ? `"${table.head}" [${table.cols.join(" | ")}] → ${table.rows.map((r) => `${r.name}: ${r.cells.join("/")}`).join(" · ")}` : "no table rendered");
claim("the total is underneath the accounts, not instead of them",
  rest.totals.length > 0 && open.cards?.length === 3, rest.totals.replace(/\s+/g, " ").slice(0, 160));
claim("the foot says where the numbers come from and how fresh they are",
  /\.claude/.test(rest.foot) && /\d/.test(rest.foot) && rest.foot.length > 80, rest.foot.replace(/\s+/g, " "));
claim("the rail marks USAGE while an account is nearly out",
  rest.railHot && rest.railMark.length > 0, `${rest.railName} ${rest.railMark}`);
claim("the view does not scroll sideways", rest.overflow !== false,
  `${rest.overflow === false ? "the body is wider than its panel" : "fits"}: ${JSON.stringify(rest.widths)}`);

/* The account picker marks the same account before a session is started on
   it — which is the moment the choice still costs nothing. The picker in the
   session bar only appears once there is a Claude session to move; the one in
   the new-session dialog is always there, and both read the same figures. */
const picker = await tab.run(`${HELPERS}
  document.body.click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true, ctrlKey: false, bubbles: true }));
  const got = await until(() => {
    const marks = [...document.querySelectorAll('.choiceButton')].map(b => b.textContent.trim());
    return marks.some(m => /%/.test(m)) ? marks : null;
  }, 9000);
  return { marks: got.v ?? [...document.querySelectorAll('.choiceButton')].map(b => b.textContent.trim()), ms: got.ms,
    hot: document.querySelectorAll('.choiceButton[data-nearly-out="yes"]').length };
`);
claim("the account picker marks the one that is nearly out, before a session starts on it",
  picker?.hot === 1 && (picker?.marks ?? []).some((m) => /9[0-9]%|100%/.test(m)),
  `${(picker?.marks ?? []).join(" | ") || "no picker rendered"} · ${picker?.hot ?? 0} marked, after ${picker?.ms} ms`);

// ---- the report ------------------------------------------------------------
let failed = 0;
for (const c of claims) {
  console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.what}${c.detail ? `\n         ${c.detail}` : ""}`);
  if (!c.ok) failed++;
}
console.log(failed ? `  ${failed} of ${claims.length} claims failed` : `  all ${claims.length} claims hold — 1 file`);
stop(failed ? 1 : 0);
