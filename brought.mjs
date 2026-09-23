/* Can somebody bring their own look, with nothing but a file?
 *
 * That was the ground rule for the whole product, and measured against it the
 * answer was no. The service had every piece: a skin of one's own at
 * ~/.plxr/skins/<name>/skin.css, a route that serves it, a route that writes
 * it, a validator that accepts a theme pointing at it — and a test proving an
 * own skin wins over a built-in one. The window asked for none of it. The four
 * skins were compiled into the bundle, the skin name was a closed union of
 * four, and the picker was four literals: a look brought from outside could
 * recolour one of the four and nothing more.
 *
 * So this walks the whole way, against the built window: a file with a
 * stylesheet in it is imported, the skin it brings appears in the list, the
 * window wears it, the stylesheet really reaches the page, the other things
 * the file asks for are taken, and what comes back out of the EXPORT button is
 * the same look again.
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
  const openSettings = async () => {
    // The button is a switch: clicking it with the panel already up closes it.
    if (!document.querySelector('.tab[data-tab="skins"]')) document.querySelector('.bar [data-do="settings"]')?.click();
    await kitUntil(() => document.querySelector('.tab[data-tab="skins"]'), 4000);
    document.querySelector('.tab[data-tab="skins"]')?.click();
    await wait(400);
  };
  /* The pickers are plxr's own, not the browser's: a button that opens a list
     in a portal at the end of the document. So a choice is made the way a
     person makes it — open it, read the rows, click one. */
  const pickers = () => [...document.querySelectorAll('.tabbody .select .selectButton')];
  // The list that is open now, not every one the document has seen.
  const openList = () => [...document.querySelectorAll('body > .selectList')].pop() ?? null;
  const rowsOfList = () => [...(openList()?.querySelectorAll('.selectRow') ?? [])].map(r => r.textContent.trim());
  const choose = async (which, label) => {
    // Anything still open is closed first: two lists in the document at once
    // read as one list with both sets of rows in it.
    document.body.click();
    await wait(200);
    const button = pickers()[which];
    if (!button) return { why: 'no picker ' + which };
    button.click();
    await kitUntil(() => document.querySelector('body > .selectList'), 3000);
    const rows = rowsOfList();
    const row = [...(openList()?.querySelectorAll('.selectRow') ?? [])].find(r => r.textContent.trim() === label);
    if (!row) { document.body.click(); return { why: 'no row "' + label + '"', rows }; }
    row.click();
    await wait(1200);
    return { rows };
  };
`;

/* A whole look in one file: its own stylesheet, its own colours, and the
   things a theme was always allowed to ask for and never got. */
const BROUGHT = {
  name: "brought",
  label: "Brought Look",
  author: "the check",
  css: `[data-skin="brought"] .bar { background: rgb(7, 9, 11); }
[data-skin="brought"] .tile { border-radius: 2rem 0 0 2rem; }
[data-skin="brought"] body { --hair: 0.125rem; }`,
  palette: { bg: "#050607", fg: "#ffcc66", accent: "#ff9900", panel: "#111417", dim: "#cc99cc" },
  fontSize: 15,
  termSize: 13,
  glow: false,
  scanlines: false,
  gradient: 0,
  seethrough: 0,
};

const posted = await api("/api/themes", { method: "POST", body: JSON.stringify(BROUGHT) });
const stored = posted.ok ? await posted.json() : { error: await posted.text() };
claim("the service takes a theme that brings its own stylesheet", posted.ok && stored.skin === "brought",
  posted.ok ? `stored as skin "${stored.skin}"` : `refused: ${stored.error}`);
claim("and writes it out as a skin of its own", existsSync(join(home, "skins", "brought", "skin.css")),
  join(home, "skins", "brought", "skin.css"));

const listed = await (await api("/api/skins")).json();
claim("the skin list names it beside the four that ship",
  listed.some((s) => s.name === "brought" && s.own) && ["crt", "win95", "sketch", "pixel"].every((n) => listed.some((s) => s.name === n)),
  listed.map((s) => `${s.name}${s.own ? " (own)" : ""}`).join(" · "));

const served = await api("/skins/brought/skin.css");
const servedText = served.ok ? await served.text() : "";
claim("the stylesheet is served where the window looks for it",
  served.ok && servedText.includes('[data-skin="brought"]'), `${served.status} · ${servedText.length} bytes`);

// ---- and now the window itself ---------------------------------------------
const worn = await run(`${HELPERS}
  await openSettings();
  const got = await choose(0, 'Brought Look');
  const names = got.rows ?? [];
  if (got.why) return { why: got.why, names };
  const root = document.documentElement;
  const link = document.getElementById('plxr-skin');
  const bar = document.querySelector('.bar');
  return {
    names,
    skin: root.dataset.skin,
    href: link ? link.getAttribute('href') : '',
    sheetSeen: [...document.styleSheets].some(s => (s.href || '').includes('/skins/brought/skin.css')),
    barGround: bar ? getComputedStyle(bar).backgroundColor : '',
    glow: root.dataset.glow,
    scan: root.dataset.scan,
  };
`);
claim("the picker offers the brought skin by the name it gave itself", (worn.names ?? []).includes("Brought Look"), (worn.names ?? []).join(" · "));
claim("choosing it points the window at that stylesheet and the page really loads it",
  worn.skin === "brought" && worn.href === "/skins/brought/skin.css" && worn.sheetSeen,
  worn.why ?? `data-skin ${worn.skin} · link ${worn.href} · loaded ${worn.sheetSeen}`);
claim("and the rules in it are drawn: the bar takes the ground the file asked for",
  worn.barGround === "rgb(7, 9, 11)", `bar ${worn.barGround}`);

const asked = await run(`${HELPERS}
  await openSettings();
  const got = await choose(1, 'Brought Look');
  if (got.why) return { why: got.why, rows: got.rows };
  const root = document.documentElement;
  const read = (k) => getComputedStyle(root).getPropertyValue(k).trim();
  return { bg: read('--bg'), accent: read('--accent'), size: read('--size'), termSize: read('--term-size'),
           glow: root.dataset.glow, scan: root.dataset.scan,
           theme: root.dataset.theme, skin: root.dataset.skin,
           inline: root.style.getPropertyValue('--bg'),
           rows: got.rows ?? [] };
`);
claim("its colours are worn", asked.bg === "#050607" && asked.accent === "#ff9900",
  asked.why ? `${asked.why} · rows ${(asked.rows ?? []).join(", ")}` : `data-skin ${asked.skin} · data-theme ${asked.theme} · inline --bg "${asked.inline}" · computed --bg "${asked.bg}" · accent "${asked.accent}" · rows ${(asked.rows ?? []).join(", ")}`);

// ---- what comes back out ----------------------------------------------------
const out = await run(`${HELPERS}
  await openSettings();
  const clicked = document.querySelector('[data-do="export-theme"]');
  if (!clicked) return { why: 'no export button' };
  // The click would open a save dialog the browser has no place for, so the
  // file is caught on its way out instead.
  let caught = null;
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { caught = this.download; };
  const realCreate = URL.createObjectURL;
  let blob = null;
  URL.createObjectURL = function (b) { blob = b; return realCreate.call(URL, b); };
  clicked.click();
  await wait(600);
  HTMLAnchorElement.prototype.click = realClick;
  const text = blob ? await blob.text() : '';
  URL.createObjectURL = realCreate;
  return { name: caught, text };
`);
let back = null;
try {
  back = JSON.parse(out.text || "{}");
} catch {
  back = null;
}
claim("EXPORT writes the look back out as one file, stylesheet and all",
  Boolean(out.name) && back && back.skin === "brought" && typeof back.css === "string" && back.css.includes('[data-skin="brought"]') && back.palette?.bg === "#050607",
  out.why ?? `${out.name} · ${(out.text || "").length} bytes · skin ${back?.skin} · css ${back?.css ? back.css.length + " bytes" : "none"}`);

/* ---- and the look that ships as an example ---------------------------------
   docs/themes/lcars.json is written the way anybody would write one, and is
   the proof that the way through is wide enough for a whole visual language
   rather than a recolouring. */
const example = readFileSync(join(HERE, "docs", "themes", "lcars.json"), "utf8");
const sent = await api("/api/themes", { method: "POST", body: example });
const asStored = sent.ok ? await sent.json() : { error: await sent.text() };
claim("the look that ships as an example goes in as it is", sent.ok && asStored.skin === "lcars",
  sent.ok ? `stored as "${asStored.label}" on skin "${asStored.skin}"` : `refused: ${asStored.error}`);

const wearing = await run(`${HELPERS}
  /* Shut and opened again: the panel reads the lists when it opens, and this
     look arrived while it was already up — which is what a person does when
     they drop a file in from somewhere else. */
  /* The looks tab clicked again, which is how somebody goes looking: the panel
     lives on behind its tab, so it asks the service afresh at that moment. */
  await openSettings();
  document.querySelector('.tab[data-tab="skins"]')?.click();
  await wait(900);
  const got = await choose(0, 'LCARS');
  if (got.why) return { why: got.why, rows: got.rows, served: await (await fetch('/api/skins', { headers: { 'X-Plxr-Token': new URLSearchParams(location.search).get('token') || '' } })).json().then(l => l.map(s => s.name + ':' + s.label)).catch(e => String(e)) };
  await wait(1200);
  const bar = getComputedStyle(document.querySelector('.bar'));
  const icon = document.querySelector('.stripe[data-edge="left"] .stripeIcon');
  return {
    skin: document.documentElement.dataset.skin,
    bar: bar.backgroundColor,
    block: icon ? getComputedStyle(icon).backgroundColor : '',
    caps: getComputedStyle(document.body).textTransform,
    font: getComputedStyle(document.body).fontFamily,
  };
`);
/* The frame, not a recolouring: the ground is black and carries the blocks,
   the column is a stack of them in the warm family, everything in capitals in
   an ultra-compressed face. */
claim("worn, it is the frame and not a recolouring: black ground, blocks down the column, capitals",
  wearing.skin === "lcars" && wearing.bar === "rgb(0, 0, 0)" && wearing.block === "rgb(255, 204, 102)" &&
    wearing.caps === "uppercase" && /Antonio/.test(wearing.font ?? ""),
  wearing.why ? `${wearing.why} · rows ${(wearing.rows ?? []).join(", ")} · service says ${JSON.stringify(wearing.served ?? [])}` : `bar ${wearing.bar} · block ${wearing.block} · ${wearing.caps} · ${wearing.font}`);

// ---- report ---------------------------------------------------------------
const failed = claims.filter((c) => !c.ok);
for (const c of failed) console.log(`      ${c.what}${c.detail ? " — " + c.detail : ""}`);
if (failed.length) {
  console.log(`  ${failed.length} of ${claims.length} claims failed`);
  stop(1);
}
console.log(`  ${claims.length} claims about bringing your own look hold`);
stop(0);
