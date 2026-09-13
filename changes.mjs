/* Does source control follow the session, and move by itself?
 *
 * The changes panel is meant to be the one beside the terminal that shows
 * what the agent in it is doing to the folder — without a button, without a
 * second `git status` for every window that looks. None of that can be seen
 * from the code: whether the panel switches folder when the operator clicks
 * into another session, how long a file takes to appear after it is written,
 * whether two windows on one folder cost one loop or two. So it is measured
 * here, in a real browser against a service of its own, and the numbers are
 * printed rather than a green line.
 *
 * No dependencies: the browser already on the machine, over its debugging
 * protocol, the way editor.mjs does it.
 */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = [];
const claim = (what, ok, detail = "") => claims.push({ what, ok: Boolean(ok), detail });

/* Two folders, two repositories, on two branches: the panel has to be seen
   moving from one to the other, and a branch name is the cheapest proof. */
const home = mkdtempSync(join(tmpdir(), "plxr-changes-home-"));
const alpha = join(home, "alpha");
const beta = join(home, "beta");
const git = (dir, ...args) =>
  execFileSync("git", ["-C", dir, ...args], {
    stdio: "pipe",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  }).toString();
for (const [dir, branch] of [[alpha, "main"], [beta, "feature/second"]]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(dir, "README.md"), `# ${dir.split("/").pop()}\n`);
  git(dir, "init", "-q", "-b", branch, ".");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "start");
}
// One change already in each, so a panel that shows the wrong folder shows it.
writeFileSync(join(alpha, "a.txt"), "one\nTWO\nthree\n");
writeFileSync(join(beta, "README.md"), "# beta\nchanged\n");

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

// Two sessions, a plain shell each, one per folder.
const sessA = await (await api("/api/sessions", { method: "POST", body: JSON.stringify({ cwd: alpha, cmd: [], name: "alpha", account: "" }) })).json();
const sessB = await (await api("/api/sessions", { method: "POST", body: JSON.stringify({ cwd: beta, cmd: [], name: "beta", account: "" }) })).json();

const profile = mkdtempSync(join(tmpdir(), "plxr-changes-"));
const port = 9300 + (process.pid % 300);
const chrome = spawn(browser, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--use-mock-keychain",
  "--password-store=basic",
  "--no-default-browser-check",
  "--window-size=1600,900",
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

const PAGE = `http://127.0.0.1:${info.port}/?token=${info.token}`;
const first = await target("about:blank");
if (!first) {
  console.log("  the browser did not come up");
  stop(1);
}
const tab1 = await connect(first);
let up = 0;
for (let i = 0; i < 40 && !up; i++) {
  await tab1.cdp.send("Page.navigate", { url: PAGE });
  await sleep(700);
  up = await tab1.run("return document.querySelectorAll('.railhome').length").catch(() => 0);
}
if (!up) {
  console.log("  the interface did not render");
  stop(1);
}

const HELPERS = `
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const byText = (sel, re) => [...document.querySelectorAll(sel)].find(e => re.test(e.textContent.trim()));
  const until = async (fn, ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return { v, ms: Math.round(performance.now() - t0) }; await wait(50); } return { v: null, ms: Math.round(performance.now() - t0) }; };
  const branch = () => document.querySelector('.changesPanel .branchline')?.textContent.trim() ?? '';
  const rows = () => [...document.querySelectorAll('.changesPanel .changegroup')].map(g => ({
    head: g.querySelector('.uhead')?.textContent.trim().replace(/ALL (IN|OUT)$/, '').trim(),
    files: [...g.querySelectorAll('.changerow')].map(r => ({
      path: r.querySelector('.changepath').textContent.trim(),
      on: r.querySelector('.changepath').classList.contains('on'),
      count: r.querySelector('.changecount')?.textContent.trim() ?? '',
    })),
  }));
`;

// ---- the panel follows the session ------------------------------------------
const followA = await tab1.run(`${HELPERS}
  byText('.railitem .rname', /^alpha$/).closest('.railitem').click();
  await wait(1500);
  byText('.sessbar button, .obarMenuItem button', /^CHANGES$/)?.click();
  const got = await until(() => branch() === 'main' ? branch() : null, 6000);
  return { branch: got.v, ms: got.ms, following: document.querySelector('.changesPanel .notice')?.textContent.trim() ?? '', rows: rows() };
`);
claim("CHANGES in the session bar opens the panel on alpha's folder (main)", followA.branch === "main",
  `branch "${followA.branch}" after ${followA.ms} ms · ${followA.following}`);
claim("alpha's own change is listed", JSON.stringify(followA.rows).includes('"a.txt"'), JSON.stringify(followA.rows));

const followB = await tab1.run(`${HELPERS}
  byText('.railitem .rname', /^beta$/).closest('.railitem').click();
  const got = await until(() => branch() === 'feature/second' ? branch() : null, 6000);
  return { branch: got.v, ms: got.ms, following: document.querySelector('.changesPanel .notice')?.textContent.trim() ?? '', rows: rows(),
    panels: document.querySelectorAll('.changesPanel').length };
`);
claim("clicking into beta moves the ONE panel to beta's folder (feature/second)", followB.branch === "feature/second" && followB.panels === 1,
  `branch "${followB.branch}" after ${followB.ms} ms · ${followB.following} · ${followB.panels} panel(s)`);
claim("beta's own change is listed, alpha's is not",
  JSON.stringify(followB.rows).includes('"README.md"') && !JSON.stringify(followB.rows).includes('"a.txt"'), JSON.stringify(followB.rows));

// Back to alpha, and it follows back — the editor does not steal the follow.
const backA = await tab1.run(`${HELPERS}
  byText('.railitem .rname', /^alpha$/).closest('.railitem').click();
  const got = await until(() => branch() === 'main' ? branch() : null, 6000);
  return { branch: got.v, ms: got.ms };
`);
claim("clicking back into alpha follows back (main)", backA.branch === "main", `after ${backA.ms} ms`);

// ---- files move by themselves ------------------------------------------------
// Everything below is done to alpha's folder through the API — the way an
// agent's write lands on disk — and watched in the panel. AGAIN is never
// pressed.
const B = (path) => `/api/file/${encodeURIComponent(sessA.id)}` + path;

const created = await (async () => {
  const t0 = Date.now();
  await api(B(""), { method: "POST", body: JSON.stringify({ path: "made.txt", dir: false }) });
  const seen = await tab1.run(`${HELPERS}
    const got = await until(() => { const r = rows(); const g = r.find(x => /new files/i.test(x.head)); const f = g?.files.find(f => f.path === 'made.txt'); return f ? { f, g: g.head } : null; }, 6000);
    return got;
  `);
  return { ...seen, total: Date.now() - t0 };
})();
claim("a file created on disk appears under 'new files' without AGAIN", created.v?.f?.path === "made.txt",
  created.v ? `after ${created.ms} ms (${created.total} ms end to end) · ${created.v.f.count}` : `not seen in ${created.ms} ms`);

const written = await (async () => {
  const t0 = Date.now();
  // Two lines added, one changed: git says +3 -1 against "one\ntwo\nthree\n".
  await api(B(""), { method: "PUT", body: JSON.stringify({ path: "a.txt", text: "one\nTWO\nthree\nfour\nfive\n", mod: 0 }) });
  const seen = await tab1.run(`${HELPERS}
    const got = await until(() => { const r = rows(); const g = r.find(x => /not staged/i.test(x.head)); const f = g?.files.find(f => f.path === 'a.txt' && /\\+3/.test(f.count) && /1$/.test(f.count)); return f ? f : null; }, 6000);
    return got;
  `);
  return { ...seen, total: Date.now() - t0 };
})();
claim("a tracked file written on disk updates its +/- counts (+3 −1) without AGAIN", Boolean(written.v),
  written.v ? `after ${written.ms} ms (${written.total} ms end to end) · ${written.v.count}` : `not seen in ${written.ms} ms`);

const removed = await (async () => {
  const t0 = Date.now();
  await api(B(`?path=${encodeURIComponent("made.txt")}`), { method: "DELETE" });
  const seen = await tab1.run(`${HELPERS}
    const got = await until(() => { const r = rows(); return r.some(g => g.files.some(f => f.path === 'made.txt')) ? null : rows(); }, 6000);
    return got;
  `);
  return { ...seen, total: Date.now() - t0 };
})();
claim("a file deleted on disk leaves the list without AGAIN", Boolean(removed.v),
  removed.v ? `after ${removed.ms} ms (${removed.total} ms end to end)` : `still listed after ${removed.ms} ms`);

const againPressed = await tab1.run(`return [...document.querySelectorAll('.changesPanel button')].filter(b => /^AGAIN$/.test(b.textContent.trim())).length`);
claim("AGAIN is still there, as a manual fallback — and was never needed", againPressed === 1, `${againPressed} AGAIN button(s)`);

// ---- click-to-diff lights the row, and the diff stays live -------------------
const lit = await tab1.run(`${HELPERS}
  const row = [...document.querySelectorAll('.changesPanel .changepath')].find(b => b.textContent.trim() === 'a.txt');
  row.click();
  const got = await until(() => document.querySelector('.diffPanel .diffline') ? true : null, 6000);
  return {
    ms: got.ms,
    diffPanels: document.querySelectorAll('.diffPanel').length,
    litRows: [...document.querySelectorAll('.changesPanel .changepath.on')].map(b => b.textContent.trim()),
    added: document.querySelectorAll('.diffPanel .diffline[data-kind="add"]').length,
    removed: document.querySelectorAll('.diffPanel .diffline[data-kind="del"]').length,
    clickable: document.querySelectorAll('.diffPanel button.diffline').length,
  };
`);
claim("clicking a changed file opens its diff panel beside", lit.diffPanels === 1, `${lit.diffPanels} diff panel(s) after ${lit.ms} ms`);
claim("the clicked row lights (.changepath.on)", lit.litRows.length === 1 && lit.litRows[0] === "a.txt", lit.litRows.join(", "));
claim("the diff shows +3 -1", lit.added === 3 && lit.removed === 1, `${lit.added} added, ${lit.removed} removed lines`);
claim("diff lines that exist in the file are clickable controls", lit.clickable >= 3, `${lit.clickable} clickable lines`);

const liveDiff = await (async () => {
  await api(B(""), { method: "PUT", body: JSON.stringify({ path: "a.txt", text: "one\nTWO\nthree\nfour\nfive\nsix\nseven\n", mod: 0 }) });
  return tab1.run(`${HELPERS}
    const got = await until(() => document.querySelectorAll('.diffPanel .diffline[data-kind="add"]').length === 5 ? 5 : null, 6000);
    return { added: document.querySelectorAll('.diffPanel .diffline[data-kind="add"]').length, ms: got.ms };
  `);
})();
claim("the open diff refreshes live when the file changes again (+5)", liveDiff.added === 5, `${liveDiff.added} added lines after ${liveDiff.ms} ms`);

// Closing the diff puts the row out.
const unlit = await tab1.run(`${HELPERS}
  byText('.diffPanel .overlayBar button', /^BACK$/).click();
  await wait(400);
  return { diffPanels: document.querySelectorAll('.diffPanel').length, lit: document.querySelectorAll('.changesPanel .changepath.on').length };
`);
claim("closing the diff clears the highlight", unlit.diffPanels === 0 && unlit.lit === 0, `${unlit.diffPanels} diff panel(s), ${unlit.lit} lit row(s)`);

// ---- the editor gutter ---------------------------------------------------------
const gutter = await tab1.run(`${HELPERS}
  const row = [...document.querySelectorAll('.changesPanel .changerow')].find(r => r.querySelector('.changepath').textContent.trim() === 'a.txt');
  byText('.changesPanel .changerow button', /^EDIT$/) && [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'EDIT').click();
  const got = await until(() => document.querySelector('.editorPanel .cm-gutter-changes .cm-changeLine-mod') ? true : null, 8000);
  const count = k => document.querySelectorAll('.editorPanel .cm-gutter-changes .cm-changeLine-' + k).length;
  const marked = [...document.querySelectorAll('.editorPanel .cm-gutter-changes .cm-gutterElement')].map((el, i) => el.className.includes('cm-changeLine-mod') ? 'mod' : el.className.includes('cm-changeLine-add') ? 'add' : el.className.includes('cm-changeLine-del') ? 'del' : '.');
  return { ms: got.ms, editors: document.querySelectorAll('.editorPanel').length, mod: count('mod'), add: count('add'), del: count('del'), marked: marked.join('') };
`);
claim("EDIT on a changed row opens the editor beside", gutter.editors === 1, `${gutter.editors} editor panel(s) after ${gutter.ms} ms`);
claim("the gutter marks the changed line (mod) and the added lines (add)", gutter.mod === 1 && gutter.add === 4,
  `${gutter.mod} mod, ${gutter.add} add, ${gutter.del} del — by line: ${gutter.marked}`);

// Typing moves the marks at once: a new line at the end is one more add.
await tab1.run(`${HELPERS}
  const cm = document.querySelector('.editorPanel .cm-content'); cm.focus();
  const view = cm.cmTile.root.view; const end = view.state.doc.length;
  view.dispatch({ selection: { anchor: end } });
`);
await tab1.cdp.send("Input.insertText", { text: "typed here\n" });
const typed = await tab1.run(`${HELPERS}
  const got = await until(() => document.querySelectorAll('.editorPanel .cm-gutter-changes .cm-changeLine-add').length === 5 ? 5 : null, 3000);
  return { add: document.querySelectorAll('.editorPanel .cm-gutter-changes .cm-changeLine-add').length, ms: got.ms,
    dirty: document.querySelector('.editorPanel .dirty')?.textContent.trim() ?? '' };
`);
claim("the gutter follows the operator's typing (one more add, live)", typed.add === 5, `${typed.add} add marks after ${typed.ms} ms · ${typed.dirty}`);

// A write on disk while the buffer is dirty is offered, never painted over.
await api(B(""), { method: "PUT", body: JSON.stringify({ path: "a.txt", text: "one\nTWO\nthree\nfour\nfive\nsix\nseven\nagent wrote this\n", mod: 0 }) });
const offered = await tab1.run(`${HELPERS}
  const got = await until(() => byText('.editorPanel .overlayBar .notice', /changed on disk/i) ? true : null, 6000);
  const text = document.querySelector('.editorPanel .cm-content').cmTile.root.view.state.doc.toString();
  return { ms: got.ms, offered: Boolean(got.v), keepsTyping: text.includes('typed here'), tookAgent: text.includes('agent wrote this'),
    buttons: [...document.querySelectorAll('.editorPanel .overlayBar button')].map(b => b.textContent.trim()) };
`);
claim("an on-disk write under a dirty buffer shows 'changed on disk' and does not touch the buffer",
  offered.offered && offered.keepsTyping && !offered.tookAgent, `after ${offered.ms} ms · buttons: ${offered.buttons.join(", ")}`);

const reloaded = await tab1.run(`${HELPERS}
  byText('.editorPanel .overlayBar button', /^RELOAD$/).click();
  await wait(300);
  const text = document.querySelector('.editorPanel .cm-content').cmTile.root.view.state.doc.toString();
  const got = await until(() => document.querySelectorAll('.editorPanel .cm-gutter-changes .cm-changeLine-add').length === 5 ? 5 : null, 3000);
  return { tookAgent: text.includes('agent wrote this'), keepsTyping: text.includes('typed here'), add: got.v, dirty: Boolean(document.querySelector('.editorPanel .dirty')) };
`);
claim("RELOAD takes the disk's text and the gutter re-measures it", reloaded.tookAgent && !reloaded.keepsTyping && reloaded.add === 5 && !reloaded.dirty,
  `disk text ${reloaded.tookAgent ? "in" : "missing"}, typed text ${reloaded.keepsTyping ? "still there" : "gone"}, ${reloaded.add} add marks, ${reloaded.dirty ? "dirty" : "clean"}`);

// ---- two windows, one loop ------------------------------------------------------
// A second tab on the same service, following the same session. The proof
// is process-level: sampled fast, at most one `git status` exists at any
// moment, however many windows look at the folder.
const { targetId } = await tab1.cdp.send("Target.createTarget", { url: PAGE });
const second = await target(PAGE);
const tab2 = await connect(second);
for (let i = 0; i < 40; i++) {
  await sleep(400);
  if (await tab2.run("return document.querySelectorAll('.railhome').length").catch(() => 0)) break;
}
const tab2Follow = await tab2.run(`${HELPERS}
  byText('.railitem .rname', /^alpha$/).closest('.railitem').click();
  await wait(800);
  if (!document.querySelector('.changesPanel')) byText('.sessbar button, .obarMenuItem button', /^CHANGES$/)?.click();
  const got = await until(() => branch() === 'main' ? branch() : null, 8000);
  return { branch: got.v, ms: got.ms };
`);
claim("a second window follows the same folder", tab2Follow.branch === "main", `branch "${tab2Follow.branch}" after ${tab2Follow.ms} ms`);

const sample = (ms, every) => {
  const t0 = Date.now();
  let max = 0;
  let seen = 0;
  let samples = 0;
  const lines = new Set();
  const when = [];
  while (Date.now() - t0 < ms) {
    let out = "";
    try {
      // Children of this service only: another plxr on the machine, or a
      // shell whose command line quotes these words, is not this loop.
      out = execFileSync("pgrep", ["-P", String(info.pid), "-fl", "git status"], { stdio: "pipe" }).toString();
    } catch { /* none running: pgrep exits 1 */ }
    const hits = out.split("\n").filter((l) => /^\d+\s+(\S*\/)?git status\b/.test(l));
    const n = hits.length;
    for (const l of hits) lines.add(l.replace(/^\d+\s+/, ""));
    if (n > max) max = n;
    if (n > 0) {
      seen++;
      when.push(Date.now() - t0);
    }
    samples++;
    const until = Date.now() + every;
    while (Date.now() < until);
  }
  return { max, seen, samples, lines: [...lines], when };
};
// Keep the folder moving so the loop is at its fastest pace, then sample.
await api(B(""), { method: "PUT", body: JSON.stringify({ path: "a.txt", text: "moving\n", mod: 0 }) });
const busy = sample(4000, 20);
claim("two windows on one folder: never more than one `git status` at a time", busy.max <= 1,
  `max ${busy.max} concurrent over ${busy.samples} samples in 4 s (${busy.seen} samples saw one) · ${busy.lines.join(" | ") || "none caught"}`);

// The other folder has no subscriber now: nothing may be polling it.
const other = busy.lines.filter((l) => l.includes(beta));
claim("the folder nobody follows is not polled", other.length === 0, other.join(" | ") || "no git status in beta");

// Both tabs closed: the loop stops, and the folder goes quiet.
await tab1.cdp.send("Target.closeTarget", { targetId });
await tab1.cdp.send("Page.navigate", { url: "about:blank" });
// The last poll that was already under way when the windows went is not a
// loop that survived; the sampling starts once that has had time to finish.
await sleep(3000);
const idle = sample(6000, 20);
claim("with no window looking, git is quiet", idle.max === 0,
  `${idle.seen} of ${idle.samples} samples saw git over 6 s${idle.when.length ? ` (at ${idle.when.join(", ")} ms)` : ""}`);

// ---- the report ------------------------------------------------------------
let failed = 0;
for (const c of claims) {
  console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.what}${c.detail ? `\n         ${c.detail}` : ""}`);
  if (!c.ok) failed++;
}
console.log(failed ? `  ${failed} of ${claims.length} claims failed` : `  all ${claims.length} claims hold — 1 file`);
stop(failed ? 1 : 0);
