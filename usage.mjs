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
 * zero, and whether the Usage icon marks the account that is nearly out — all of it
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
import { readPng } from "./pngkit.mjs";

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
claim("the Usage icon opens a section per account, named the way the settings name them",
  open.cards?.length === 3 && open.cards[0].name.length > 0,
  open.cards ? `after ${open.ms} ms · "${open.head}" · ${open.meta} · ${open.cards.map((c) => c.name).join(" | ")}` : `nothing in ${open.ms} ms`);

if (open.cards) {
  const [one, two, three] = open.cards;
  claim("the first account leads with the session window, its percentage and when it comes back",
    one.windows[0]?.head.length > 0 && /28/.test(one.windows[0]?.pct) && one.windows[0]?.when.length > 0,
    `${one.windows[0]?.head}: ${one.windows[0]?.pct} · ${one.windows[0]?.when} · bar ${one.windows[0]?.width}`);
  /* Read the day's name the way the window writes it, not the way node does.
     The two run on the same machine but not in the same locale: node was
     started in English and Chrome follows the system, which is German here, so
     a correct line ("back Mi., 09:17") was held against "Wed" and failed. What
     is being checked is the clock, so the clock is what is compared — the hour
     of the local time, and the day's name as the page itself spells it. */
  const dayName = await tab.run(`return new Date(${RESET_SESSION}).toLocaleString(undefined, { weekday: "short" });`);
  claim("the reset time is shown in this machine's own timezone",
    one.windows[0]?.when.includes(dayName) &&
      one.windows[0]?.when.includes(String(new Date(RESET_SESSION).getHours()).padStart(2, "0")),
    `"${one.windows[0]?.when}" against ${new Date(RESET_SESSION).toString()} (the page writes the day as "${dayName}")`);
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
    iconHot: stripeIcon('usage')?.dataset.nearlyOut === 'yes',
    iconBadge: stripeIcon('usage')?.querySelector('.stripeBadge')?.textContent.trim() ?? '',
    iconLabel: stripeIcon('usage')?.getAttribute('aria-label') ?? '',
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
claim("the Usage icon is marked while an account is nearly out: its badge shows and it names the account",
  rest.iconHot && rest.iconBadge.length > 0 && Boolean(open.cards?.some((c) => c.hot && rest.iconLabel.includes(c.name))),
  `badge "${rest.iconBadge}" · "${rest.iconLabel}"`);
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

// ---- what an icon stands on, in every look ------------------------------------
/* A lit icon stands on a plate, and the plate is a ground, not a light. It was
 * a quarter of the accent laid over the stripe — and the tube's accent is a
 * pale mint — so on the tube the lit Usage icon stood on a milky square,
 * #4a6d57 on a stripe of #06160d (3.2:1), and with an account nearly out its
 * red mark stood on that at 2.25:1. He saw it in the right-hand stripe: "red,
 * fine. But why is the ground behind it so light?" Nothing here looked: the
 * claims above ask whether the icon is marked, not what it stands on.
 *
 * A first version read each skin's default palette only, and what got past it
 * was the same square elsewhere: the blueprint palette's paper plate under the
 * pointer and its grey highlighter on the dark blue; a lit icon that lost its
 * plate under the pointer; and the tube as it is really set, with glass far
 * thinner than the defaults. So every palette the service serves is put on
 * with the skin it was made for, with the tube's own two and the tube with thin
 * glass, over a black desktop — the window is see-through, and a headless
 * browser puts white behind the glass. The plates are read off screenshots
 * against the stripe's own ground: Files under the pointer, Files lit, Files
 * lit under the pointer, Usage lit while nearly out, the same under the
 * pointer, and Usage nearly out under the pointer. On a dark ground a tint
 * stays dark, at most 1.8:1 against the stripe and no brighter than 0.08 in
 * luminance, and the bar on the outer edge says "open" at 3:1. On every ground
 * the mark reads on its plate at 3:1, a nearly-out mark is in the blocked
 * colour, and a lit icon under the pointer keeps the plate it has when lit.
 *
 * A dark tint alone is not enough: lit has to read as lit, not as the pointer
 * passing by. A dark tile tried on pixel's Game Boy palette came out fainter
 * than the tile under the pointer (#20480f against #244924), and there the
 * accent is the text's own green, so the mark did not change either: only the
 * bar on the edge said a window was open. So a lit icon's mark is in another
 * colour than the one under the pointer, or its plate stands 1.5:1 apart from
 * that one's. The bar does not count; it is a hair.
 *
 * pixel is the one skin whose lit icon is not a tint but its tile turned over:
 * the accent for ground, the page's colour for the mark and the count, no bar.
 * That is a light block on a dark stripe by design, written into its skin, and
 * on it a nearly-out mark is the page's colour, not red — red on that block is
 * the very thing he pointed at. On pixel the lit claims ask for that tile. */
await tab.cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 1 } });
const DEFAULT_GLASS = { panelSolid: 62, windowSolid: 46, tint: 14, glow: 0.35 };
const THIN_GLASS = { panelSolid: 13, windowSolid: 30, tint: 9, glow: 0.3 };
const servedThemes = await (await api("/api/themes")).json();
const LOOKS = [
  { skin: "crt", palette: "green", glass: DEFAULT_GLASS, name: "crt/green" },
  { skin: "crt", palette: "green", glass: THIN_GLASS, name: "crt/green with thin glass" },
  { skin: "crt", palette: "amber", glass: DEFAULT_GLASS, name: "crt/amber" },
  ...servedThemes
    .filter((t) => t.skin)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ skin: t.skin, palette: t.name, glass: DEFAULT_GLASS, name: `${t.skin}/${t.name}` })),
];
claim("every palette the service serves is among the looks the plates are read in",
  servedThemes.length >= 7 && servedThemes.every((t) => LOOKS.some((l) => l.palette === t.name && l.skin === t.skin)),
  `${servedThemes.length} served · ${LOOKS.map((l) => l.name).join(" · ")}`);

const channel = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (c) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
const ratio = (a, b) => { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hexOf = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
const medianOf = (cols) => [0, 1, 2].map((k) => cols.map((c) => c[k]).sort((a, b) => a - b)[Math.floor(cols.length / 2)]);
const pixelAt = (img, x, y) => { const i = (y * img.width + x) * 3; return [img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]]; };
const areaOf = (img, x0, y0, x1, y1) => {
  const out = [];
  for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) out.push(pixelAt(img, x, y));
  return out;
};
const apart = (a, b) => Math.max(...a.map((v, k) => Math.abs(v - b[k])));
/* One icon read off a screenshot: the stripe's ground below its last icon,
   clear of every plate and glow; the plate from a band just inside the icon's
   box along three edges, clear of its corners, of the count in the top corner
   and of the mark in the middle; the bar on the stripe's outer edge. */
const plateOf = (img, g) => {
  const { icon: b, stripe: s } = g;
  const gy = Math.min(g.lastBottom + 40, s.y + s.h - 20);
  return {
    ground: medianOf(areaOf(img, s.x + 12, gy, s.x + s.w - 12, gy + 10)),
    plate: medianOf([
      ...areaOf(img, b.x + 2, b.y + 10, b.x + 5, b.y + b.h - 10),
      ...areaOf(img, b.x + b.w - 5, b.y + 12, b.x + b.w - 2, b.y + b.h - 10),
      ...areaOf(img, b.x + 10, b.y + b.h - 5, b.x + b.w - 10, b.y + b.h - 2),
    ]),
    bar: pixelAt(img, Math.round(g.edge === "right" ? s.x + s.w - 2 : s.x + 1), Math.round(b.y + b.h / 2)),
    mark: g.colour,
  };
};
const ICON_GEOMETRY = `
  const rgbOf = (colour) => {
    const scale = colour.startsWith('color(') ? 255 : 1;
    return (colour.match(/[0-9.]+/g) || []).slice(0, 3).map((v) => Math.round(Number(v) * scale));
  };
  const iconGeometry = (id) => {
    const icon = stripeIcon(id);
    const stripe = icon.closest('.stripe');
    const r = icon.getBoundingClientRect();
    const s = stripe.getBoundingClientRect();
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    probe.style.color = 'var(--blocked)';
    const blocked = getComputedStyle(probe).color;
    probe.style.color = 'var(--accent)';
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return { icon: { x: r.left, y: r.top, w: r.width, h: r.height }, stripe: { x: s.left, y: s.top, w: s.width, h: s.height },
      lastBottom: [...stripe.querySelectorAll('.stripeIcon')].pop().getBoundingClientRect().bottom, edge: stripe.dataset.edge,
      lit: icon.dataset.lit === 'yes', hot: icon.dataset.nearlyOut === 'yes', under: icon.matches(':hover'),
      colour: rgbOf(getComputedStyle(icon).color), blocked: rgbOf(blocked), accent: rgbOf(accent) };
  };
  const badgeGeometry = (id) => {
    const badge = stripeIcon(id).querySelector('.stripeBadge');
    if (!badge) return null;
    const b = badge.getBoundingClientRect();
    const cs = getComputedStyle(badge);
    return { x: b.left, y: b.top, w: b.width, h: b.height, text: badge.textContent.trim(), bg: rgbOf(cs.backgroundColor), fg: rgbOf(cs.color) };
  };
`;
const shotNow = async () => readPng(Buffer.from((await tab.cdp.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
const pointerAt = (x, y) => tab.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
const centreOf = (g) => [Math.round(g.icon.x + g.icon.w / 2), Math.round(g.icon.y + g.icon.h / 2)];
// The pointer on an icon, then the screen and the icon as they are with it there.
const underPointer = async (g, id) => {
  await pointerAt(...centreOf(g));
  await sleep(400);
  const shot = await shotNow();
  return { shot, g: await tab.run(`${HELPERS} ${ICON_GEOMETRY} return iconGeometry(${JSON.stringify(id)});`) };
};
for (const look of LOOKS) {
  const theme = { skin: look.skin, palette: look.palette, ...look.glass };
  await tab.run(`
    const theme = { ...JSON.parse(localStorage.getItem('plxr.theme') || '{}'), ...${JSON.stringify(theme)} };
    localStorage.setItem('plxr.theme', JSON.stringify(theme));
    await fetch('/api/prefs', { method: 'PUT', headers: { 'X-Plxr-Token': ${JSON.stringify(info.token)}, 'Content-Type': 'application/json' }, body: JSON.stringify({ theme }) });
    return true;
  `);
  const want = `${look.skin}/${look.palette}/${look.glass.panelSolid}%`;
  let dressed = "";
  for (let i = 0; i < 20 && dressed !== want; i++) {
    await tab.cdp.send("Page.navigate", { url: PAGE });
    await sleep(900);
    dressed = await tab.run(`${GATEKIT} if (!appUp() || stripeIcon('usage').dataset.nearlyOut !== 'yes') return ''; await document.fonts.ready;
      const root = document.documentElement; return root.dataset.skin + '/' + root.dataset.theme + '/' + root.style.getPropertyValue('--panelSolid');`).catch(() => "");
  }
  if (dressed !== want) {
    claim(`${look.name}: the window comes up in this look with the Usage icon nearly out`, false, `came up as "${dressed}", wanted "${want}"`);
    continue;
  }
  await pointerAt(800, 60);
  const lit = await tab.run(`${HELPERS} ${ICON_GEOMETRY}
    openTool('files');
    openTool('usage');
    await until(() => toolLit('files') && toolLit('usage'), 3000);
    return { files: iconGeometry('files'), usage: iconGeometry('usage'), badge: badgeGeometry('usage') };
  `);
  await sleep(400);
  const litShot = await shotNow();
  const filesLitUnder = await underPointer(lit.files, "files");
  const usageLitUnder = await underPointer(lit.usage, "usage");
  await pointerAt(800, 60);
  const shut = await tab.run(`${HELPERS} ${ICON_GEOMETRY}
    stripeIcon('usage').click();
    await until(() => !toolLit('usage'), 3000);
    stripeIcon('files').click();
    await until(() => !toolLit('files'), 3000);
    return { files: iconGeometry('files'), usage: iconGeometry('usage'), badge: badgeGeometry('usage') };
  `);
  const usageUnder = await underPointer(shut.usage, "usage");
  const filesUnder = await underPointer(shut.files, "files");
  await pointerAt(800, 60);

  const m = {
    filesUnder: plateOf(filesUnder.shot, filesUnder.g),
    filesLit: plateOf(litShot, lit.files),
    filesLitUnder: plateOf(filesLitUnder.shot, filesLitUnder.g),
    usageLit: plateOf(litShot, lit.usage),
    usageLitUnder: plateOf(usageLitUnder.shot, usageLitUnder.g),
    usageUnder: plateOf(usageUnder.shot, usageUnder.g),
  };
  const dark = (p) => luminance(p.ground) < 0.2;
  const quiet = (p) => ratio(p.plate, p.ground) <= 1.8 && luminance(p.plate) <= 0.08;
  const reads = (p) => ratio(p.mark, p.plate) >= 3;
  const barReads = (p) => ratio(p.bar, p.ground) >= 3;
  const inBlocked = (g) => apart(g.colour, g.blocked) <= 2;
  const say = (p) => `ground ${hexOf(p.ground)} · plate ${hexOf(p.plate)}, ${ratio(p.plate, p.ground).toFixed(2)}:1 against it, luminance ${luminance(p.plate).toFixed(3)} · mark ${hexOf(p.mark)} on it ${ratio(p.mark, p.plate).toFixed(2)}:1 · bar ${hexOf(p.bar)} ${ratio(p.bar, p.ground).toFixed(2)}:1`;
  const on = (p, what) => (dark(p) ? `a dark plate${what}` : "a plate its mark reads on");
  // pixel's lit icon: the tile turned over, the accent itself for ground, its mark reading on it.
  const turnedOver = look.skin === "pixel";
  const isTile = (p, g) => apart(p.plate, g.accent) <= 6 && reads(p);

  claim(`${look.name}: an icon under the pointer stands on ${on(m.filesUnder, "")}`,
    filesUnder.g.under && !filesUnder.g.lit && reads(m.filesUnder) && (!dark(m.filesUnder) || quiet(m.filesUnder)),
    say(m.filesUnder));
  if (turnedOver) {
    claim(`${look.name}: a lit icon is its tile turned over, the accent for ground and its mark reading on it`,
      lit.files.lit && isTile(m.filesLit, lit.files),
      `accent ${hexOf(lit.files.accent)} · ${say(m.filesLit)}`);
  } else {
    claim(`${look.name}: a lit icon stands on ${on(m.filesLit, ", a quiet tint of the stripe, with the bar saying it is open")}`,
      lit.files.lit && apart(m.filesLit.plate, m.filesLit.ground) >= 6 && reads(m.filesLit) &&
        (!dark(m.filesLit) || (quiet(m.filesLit) && barReads(m.filesLit))),
      say(m.filesLit));
  }
  claim(`${look.name}: a lit icon under the pointer keeps the plate it has when lit`,
    filesLitUnder.g.under && filesLitUnder.g.lit && apart(m.filesLitUnder.plate, m.filesLit.plate) <= 6 && reads(m.filesLitUnder),
    `lit ${hexOf(m.filesLit.plate)} · under the pointer ${hexOf(m.filesLitUnder.plate)} · ${say(m.filesLitUnder)}`);
  claim(`${look.name}: a lit icon is told from one under the pointer by its mark or its plate, not by the bar alone`,
    lit.files.lit && filesUnder.g.under && !filesUnder.g.lit &&
      (apart(lit.files.colour, filesUnder.g.colour) >= 40 || ratio(m.filesLit.plate, m.filesUnder.plate) >= 1.5),
    `mark under the pointer ${hexOf(filesUnder.g.colour)}, lit ${hexOf(lit.files.colour)} · plate under the pointer ${hexOf(m.filesUnder.plate)}, lit ${hexOf(m.filesLit.plate)}, ${ratio(m.filesLit.plate, m.filesUnder.plate).toFixed(2)}:1 apart`);
  if (turnedOver) {
    claim(`${look.name}: lit with an account nearly out, the Usage icon keeps the turned-over tile, its mark reads on it and its count still shows`,
      lit.usage.lit && lit.usage.hot && isTile(m.usageLit, lit.usage) && (lit.badge?.text ?? "").length > 0,
      `accent ${hexOf(lit.usage.accent)} · count "${lit.badge?.text ?? ""}" · ${say(m.usageLit)}`);
  } else {
    claim(`${look.name}: the Usage icon lit with an account nearly out is in the blocked colour on ${on(m.usageLit, " beside the bar")}`,
      lit.usage.lit && lit.usage.hot && inBlocked(lit.usage) && reads(m.usageLit) &&
        (!dark(m.usageLit) || (quiet(m.usageLit) && barReads(m.usageLit))),
      `blocked ${hexOf(lit.usage.blocked)} · ${say(m.usageLit)}`);
  }
  claim(`${look.name}: lit and nearly out under the pointer, the Usage icon keeps that plate`,
    usageLitUnder.g.under && usageLitUnder.g.lit && usageLitUnder.g.hot && (turnedOver || inBlocked(usageLitUnder.g)) &&
      apart(m.usageLitUnder.plate, m.usageLit.plate) <= 6 && reads(m.usageLitUnder),
    `lit ${hexOf(m.usageLit.plate)} · under the pointer ${hexOf(m.usageLitUnder.plate)} · ${say(m.usageLitUnder)}`);
  claim(`${look.name}: under the pointer the nearly-out Usage icon keeps ${on(m.usageUnder, "")}`,
    usageUnder.g.under && usageUnder.g.hot && !usageUnder.g.lit && inBlocked(usageUnder.g) && reads(m.usageUnder) &&
      (!dark(m.usageUnder) || quiet(m.usageUnder)),
    say(m.usageUnder));
}

/* ---- and over the terminal, whose account it is spending -------------------
 *
 * "if it said above the terminal which AI account it is and how much percent it
 * has in the current five-hour session and in the week". The figures are the
 * ones this check made up, so the line can be held against them exactly. */
const renamed = await api(`/api/accounts/${encodeURIComponent(report.accounts[0].name)}`, {
  method: "PATCH",
  body: JSON.stringify({ label: "Work" }),
});
const afterRename = await (await api("/api/usage/accounts")).json();
claim("an account can be given a name, and the service hands it back",
  renamed.ok && afterRename.accounts[0].label === "Work",
  `PATCH ${renamed.status} · label now "${afterRename.accounts[0].label ?? ""}"`);
await api("/api/sessions", { method: "POST", body: JSON.stringify({ cwd: fake, cmd: [], name: "spender", account: report.accounts[0].name }) });
// The window hears about a new session through the tiles, once a second; it
// cannot be opened from a list it is not on yet.
await sleep(2500);
const overTerminal = await tab.run(`${HELPERS}
  for (let i = 0; i < 10 && !document.querySelector('.plxrDock .session'); i++) {
    await openSession('spender');
    await wait(600);
  }
  const line = await until(() => document.querySelector('.plxrDock .session .paneacct'), 6000);
  if (!line.v) return { why: 'no account line over the terminal' };
  await wait(600);
  /* The window reads the figures every twenty seconds, and the name rides with
     them: renamed from outside — as this check does it — the line answers to
     the old name until the next reading. Waited for rather than slept through. */
  await until(() => document.querySelector('.plxrDock .session .paneacct .limitName')?.textContent.trim() === 'Work', 25000);
  const row = document.querySelector('.plxrDock .session .paneacct');
  return {
    name: row.querySelector('.limitName')?.textContent.trim() ?? '',
    figures: [...row.querySelectorAll('.limitPct')].map(e => e.textContent.trim()),
    bars: [...row.querySelectorAll('.ufill')].map(e => e.style.width),
    account: row.dataset.account ?? '',
  };
`);
claim("over the terminal stands the account it spends, with the window and the week",
  overTerminal.name === "Work" && (overTerminal.figures ?? []).length === 2 &&
    overTerminal.figures[0].startsWith("28%") && overTerminal.figures[1].startsWith("41%"),
  overTerminal.why ?? `"${overTerminal.name}" · ${(overTerminal.figures ?? []).join(" · ")} · bars ${(overTerminal.bars ?? []).join(" · ")}`);
claim("the bars are drawn to those percentages, not to a total",
  JSON.stringify(overTerminal.bars) === JSON.stringify(["28%", "41%"]),
  (overTerminal.bars ?? []).join(" · "));

/* ---- and it is the only thing standing there ------------------------------
 *
 * The tab names the session and the bar above it names the session, so a third
 * copy in capitals over the terminal was the same words three times on one
 * screen, which he called doubled rubbish (24.09.2026). What stands there is
 * the one thing neither of the other two says. */
const naming = await tab.run(`${HELPERS}
  const pane = document.querySelector('.plxrDock .session');
  if (!pane) return { why: 'no session pane' };
  const name = document.querySelector('.plxrDock .session .panelabel');
  return {
    repeated: name ? name.textContent.trim() : '',
    onTab: [...document.querySelectorAll('.dv-tab')].map(e => e.textContent).join(' ').includes('spender'),
    usage: Boolean(pane.querySelector('.paneacct')),
  };
`);
claim("the session's name is not repeated over its own terminal",
  naming.repeated === "" && naming.onTab === true && naming.usage === true,
  naming.why ?? `over the terminal "${naming.repeated}" · on the tab ${naming.onTab} · usage there ${naming.usage}`);

/* ---- and it follows the file, not a timer ---------------------------------
 *
 * He asked how often this is refreshed, and wanted it live. The figures
 * come off a file Claude Code rewrites when it runs, so they move at no pace
 * of their own: nothing for an hour, then a whole window resets between two
 * blinks. Polled every twenty seconds a window that had just come back stayed
 * on screen as full. So the service watches the file and pushes, and the proof
 * is that a rewrite lands well inside one poll. */
state(join(fake, ".claude.json"), utilization(7, 9, RESET_SESSION, RESET_WEEK_1, "Fable", 12));
const wroteAt = Date.now();
const live = await tab.run(`${HELPERS}
  const figures = () => [...document.querySelectorAll('.plxrDock .session .paneacct .limitPct')].map(e => e.textContent.trim());
  // Well under the twenty-second poll: anything this fast can only be a push.
  const got = await until(() => figures()[0]?.startsWith('7%') ? figures() : null, 8000);
  return { figures: got.v ?? figures() };
`);
claim("a window that resets is on screen within seconds, not at the next poll",
  (live.figures ?? [])[0]?.startsWith("7%") && (live.figures ?? [])[1]?.startsWith("9%"),
  `${(live.figures ?? []).join(" · ")} · ${Math.round((Date.now() - wroteAt) / 100) / 10}s after the file changed`);

/* ---- and an empty file beside a full one hides nothing --------------------
 *
 * The default account has a state file beside its directory and may have a
 * second one inside it. His had both: 167 KB of figures beside, and a stub
 * inside with no reading in it at all. The stub was found first and the
 * account was shown as having no reading while it was being worked on all day
 * (24.09.2026). */
mkdirSync(join(fake, ".claude"), { recursive: true });
writeFileSync(join(fake, ".claude", ".claude.json"), JSON.stringify({ numStartups: 1, projects: {} }));
const shadowed = await (await api("/api/usage/accounts")).json();
const behind = shadowed.accounts[0];
claim("a state file with no reading in it does not hide the one that has it",
  behind.known === true && behind.session.known === true && behind.session.percent === 7,
  `known ${behind.known} · session ${behind.session.known ? behind.session.percent + "%" : "none"} · from ${behind.source}`);

// ---- the report ------------------------------------------------------------
let failed = 0;
for (const c of claims) {
  console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.what}${c.detail ? `\n         ${c.detail}` : ""}`);
  if (!c.ok) failed++;
}
console.log(failed ? `  ${failed} of ${claims.length} claims failed` : `  all ${claims.length} claims hold — 1 file`);
stop(failed ? 1 : 0);
