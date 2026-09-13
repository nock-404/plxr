/* Does the folders view say anything about the folder?
 *
 * Two complaints, both of them about what is on the screen and neither of them
 * visible from the code.
 *
 * The first: the changed-files chip in the folder bar. It is a status that is
 * also the way into the changes list, and it came out as the browser's own
 * grey pill with greyed-out text in it — in a bar of skinned controls. Nothing
 * in the stylesheets reset what a <button> is drawn as, and no check looked at
 * a computed style, so it read as a dead button in all four skins for as long
 * as it existed. It is measured here: the background, the border, and the
 * colour of the count against the colour of the words, in every skin.
 *
 * The second: the wide half of the view said "pick a file / Choose one on the
 * left", across half the window, about a folder it was looking straight at.
 * What is checked here is that the overview in its place carries facts that
 * came out of THIS repository — a commit subject, a count, a remote, a tag —
 * and not a layout that would look the same if every call had failed.
 *
 * No dependencies: the browser already on the machine, over its debugging
 * protocol, the way editor.mjs and changes.mjs do it.
 */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/* The labels below are the English ones only: with no language set the window
   speaks English, and matching both would put German into a source file, which
   german.py reads too. */
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

/* A repository built for this check, in a home of its own.
 *
 * Every fact the overview puts on screen has a counterpart here: the subject
 * of the commit HEAD sits on, the tag on the one before it, the remote, the
 * README, the languages, the stash, and exactly two changed files. A panel
 * that draws the right shape with the wrong contents passes nothing below. */
const home = mkdtempSync(join(tmpdir(), "plxr-folders-home-"));
const work = join(home, "folder");
mkdirSync(join(work, "lib"), { recursive: true });
mkdirSync(join(work, "web"), { recursive: true });
const git = (...args) => {
  try {
    execFileSync("git", ["-C", work, ...args], {
      stdio: "pipe",
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    });
    return true;
  } catch {
    return false;
  }
};
const README = "# OVERVIEWREADME\n\nwhat this folder is for, in one line.\n";
const HEAD_SUBJECT = "OVERVIEWHEAD the second commit";
const FIRST_SUBJECT = "OVERVIEWFIRST the first commit";
const REMOTE = "https://example.invalid/overview.git";
writeFileSync(join(work, "README.md"), README);
writeFileSync(join(work, "main.go"), "package main\n\nfunc main() {}\n");
writeFileSync(join(work, "lib", "one.go"), "package lib\n");
writeFileSync(join(work, "web", "app.ts"), "export const a = 1;\n");
const repo =
  git("init", "-q", "-b", "main", ".") &&
  git("add", "-A") &&
  git("commit", "-qm", `${FIRST_SUBJECT}\n\nthe body of the first one`) &&
  git("tag", "v1") &&
  git("remote", "add", "origin", REMOTE);
if (!repo) {
  console.log("  no usable git — cannot check the folder overview");
  process.exit(1);
}
// The commit HEAD ends up on: two files, one changed and one added.
writeFileSync(join(work, "main.go"), "package main\n\nfunc main() { println(1) }\n");
writeFileSync(join(work, "web", "extra.ts"), "export const b = 2;\n");
git("add", "-A");
git("commit", "-qm", `${HEAD_SUBJECT}\n\nOVERVIEWBODY, said in the body`);
// One thing put aside, so the count is not zero by accident.
writeFileSync(join(work, "main.go"), "package main\n\nfunc main() { println(2) }\n");
git("stash", "push", "-q", "-m", "aside for now");
// And exactly two files differing right now: one tracked, one git has not seen.
writeFileSync(join(work, "lib", "one.go"), "package lib\n\n// changed since the commit\n");
writeFileSync(join(work, "fresh.txt"), "never committed\n");

/* The binary build.sh leaves behind — or one named by PLXR_APP.
 *
 * The override exists because /tmp/plxr3-app is one path shared by every
 * checkout on the machine: a second worktree building while this runs replaces
 * it underneath, and the window then answers 404 for a route this source has.
 * Measured, twice, before it was understood. */
const APP = process.env.PLXR_APP || "/tmp/plxr3-app";
if (!existsSync(APP)) {
  console.log(`  ${APP} is not there — run ./build.sh first`);
  process.exit(1);
}
const app = spawn(APP, ["daemon"], { env: { ...process.env, PLXR_HOME: home }, stdio: "ignore" });

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
/* The service, ended — and ended from wherever this stops.
 *
 * The service detaches itself, so the shell's background pid is not the
 * process that listens: its own is in daemon.json, and that is the one to
 * end. Registered here, the moment there is something to end, rather than
 * inside the orderly stop() further down: the first thing that can go wrong
 * is reading a route this build does not serve, which happens before the
 * browser is even started, and a throw there left a service running. It was
 * left running three times before this was written. A leaked one goes on
 * posting notifications on somebody's machine. */
const endDaemon = () => {
  try { process.kill(JSON.parse(readFileSync(join(home, "daemon.json"), "utf8")).pid); } catch { /* gone */ }
  try { app.kill(); } catch { /* gone */ }
  try { rmSync(home, { recursive: true, force: true }); } catch { /* later */ }
};
for (const bad of ["uncaughtException", "unhandledRejection"]) {
  process.on(bad, (why) => {
    console.log(`  ${bad}: ${why}`);
    endDaemon();
    process.exit(1);
  });
}
process.on("SIGINT", () => { endDaemon(); process.exit(1); });
process.on("SIGTERM", () => { endDaemon(); process.exit(1); });

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
const space = await (await api("/api/workspaces", { method: "POST", body: JSON.stringify({ path: work }) })).json();

// What the service says about the folder, to hold the screen against.
const report = await (await api(`/api/folder/${encodeURIComponent(space.id)}`)).json();

const profile = mkdtempSync(join(tmpdir(), "plxr-folders-"));
const port = 9900 + (process.pid % 90);
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
  try { chrome.kill(); } catch { /* gone */ }
  endDaemon();
  for (let i = 0; i < 20; i++) {
    try { rmSync(profile, { recursive: true, force: true }); break; }
    catch { const until = Date.now() + 100; while (Date.now() < until); }
  }
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

/* Reloaded through the protocol, not with location.reload() inside the page:
   navigating from in there tears down the evaluation that asked for it. */
const reload = async () => {
  for (let i = 0; i < 40; i++) {
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${info.port}/?token=${info.token}` });
    await sleep(700);
    if (await run("return document.querySelectorAll('.railhome').length").catch(() => 0)) return true;
  }
  return false;
};

const up = await reload();
if (!up) {
  console.log("  the interface did not render");
  stop(1);
}

const HELPERS = `
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const byText = (sel, re) => [...document.querySelectorAll(sel)].find(e => re.test(e.textContent.trim()));
  const until = async (fn, ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return { v, ms: Math.round(performance.now() - t0) }; await wait(60); } return { v: null, ms: Math.round(performance.now() - t0) }; };
  const text = sel => document.querySelector(sel)?.textContent.trim() ?? '';
  const all = sel => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
`;

// ---- the view opens, and the wide half has something to say -----------------
const overview = await run(`${HELPERS}
  byText('.railhome', /folders/i).click();
  /* Waited for, not slept through — and for the last thing to arrive, not the
     first. The overview draws as soon as its own answer is in; the changes
     list inside it asks git separately and lands a moment later, so reading
     the page the instant the box appears finds a section that is on its way. */
  const got = await until(() => {
    const box = document.querySelector('.folderinfo');
    return box && box.querySelector('.changes .changerow') ? box : null;
  }, 12000);
  if (!got.v) return { drawn: false, ms: got.ms };
  const box = got.v;
  const facts = {};
  const grids = [...box.querySelectorAll('.infofacts')];
  for (const g of grids) {
    const kids = [...g.children];
    for (let i = 0; i + 1 < kids.length; i += 2) facts[kids[i].textContent.trim()] = kids[i + 1].textContent.trim();
  }
  return {
    drawn: true,
    ms: got.ms,
    heads: all('.folderinfo .infohead'),
    subject: text('.folderinfo .infosubject'),
    body: text('.folderinfo .infotext'),
    facts,
    languages: [...box.querySelectorAll('.urow')].map(r => r.querySelector('.ukey').textContent.trim() + ' ' + r.querySelector('.uval').textContent.trim()),
    commits: [...box.querySelectorAll('.commitrow')].map(r => ({
      hash: r.querySelector('.commithash')?.textContent.trim(),
      subject: r.querySelector('.commitsubject')?.textContent.trim(),
      refs: r.querySelector('.commitrefs')?.textContent.trim() ?? '',
    })),
    readme: [...box.querySelectorAll('.infotext')].map(p => p.textContent.trim()),
    oldEmptyState: !!byText('.foldersbody .emptyhead', /pick a file/i),
    changesGroups: all('.folderinfo .changes .uhead'),
  };
`);
claim("the wide half draws a folder overview instead of an empty box",
  overview.drawn && !overview.oldEmptyState, `after ${overview.ms} ms`);
claim("the old 'pick a file' box is gone", overview.drawn && !overview.oldEmptyState);
claim("it names the commit HEAD is on, with this repository's own subject",
  overview.subject === HEAD_SUBJECT, overview.subject);
claim("the commit's body is on screen too",
  (overview.readme ?? []).some((t) => t.includes("OVERVIEWBODY")), (overview.readme ?? [])[0]);
claim("the commit is named by hash, long and short",
  (overview.facts["commit"] ?? "").includes(report.head.hash) && (overview.facts["commit"] ?? "").includes(report.head.full),
  overview.facts["commit"]);
claim("the branch and its upstream are said",
  overview.facts["branch"] === "main", `branch=${overview.facts["branch"]} upstream=${overview.facts["upstream"]}`);
claim("the working tree is described, not merely counted",
  /1 not staged/.test(overview.facts["working tree"] ?? "") && /1 new/.test(overview.facts["working tree"] ?? ""),
  overview.facts["working tree"]);
claim("what is put aside is counted", (overview.facts["put aside"] ?? "").startsWith("1 stash"), overview.facts["put aside"]);
claim("a repository that never fetched says so, rather than showing 1970",
  (overview.facts["last fetch"] ?? "").startsWith("never"), overview.facts["last fetch"]);
claim("the remote's address is on screen",
  JSON.stringify(overview.facts).includes(REMOTE), overview.facts["origin"]);
claim("the folder is measured: size, what it holds, when it was touched",
  Boolean(overview.facts["size"] && overview.facts["holds"] && overview.facts["last touched"]),
  `${overview.facts["size"]} · ${overview.facts["holds"]} · ${overview.facts["last touched"]}`);
claim("the languages are listed by share of files, Go first",
  (overview.languages[0] ?? "").startsWith("Go"), overview.languages.join(" | "));
claim("the README is read out",
  (overview.readme ?? []).some((t) => t.includes("OVERVIEWREADME")), (overview.readme ?? []).join(" ¶ ").slice(0, 90));
claim("the history lists the commits with what points at them",
  overview.commits.length === 2 &&
    overview.commits[0].subject === HEAD_SUBJECT &&
    overview.commits[1].refs.includes("tag: v1"),
  overview.commits.map((c) => `${c.hash} ${c.subject} [${c.refs}]`).join(" | "));
claim("the changes list is the one from the changes panel, not a second copy",
  overview.changesGroups.some((h) => /not staged/.test(h)) && overview.changesGroups.some((h) => /new files/.test(h)),
  overview.changesGroups.join(" | "));

// ---- a commit in the history opens what it changed --------------------------
const opened = await run(`${HELPERS}
  const rows = [...document.querySelectorAll('.commitrow')];
  const first = rows[rows.length - 1];   // the oldest one: the tagged commit
  first.click();
  const got = await until(() => {
    const box = first.parentElement.querySelector('.commitfiles');
    return box && box.querySelector('.commitpath') ? box : null;
  }, 8000);
  if (!got.v) return { opened: false, ms: got.ms };
  return {
    opened: true,
    ms: got.ms,
    lit: first.classList.contains('on'),
    files: [...got.v.querySelectorAll('.commitfile')].map(r => ({
      path: r.querySelector('.commitpath').textContent.trim(),
      word: r.querySelector('.changeword').textContent.trim(),
      count: r.querySelector('.changecount').textContent.trim(),
    })),
  };
`);
claim("clicking a commit in the history opens what it changed", opened.opened, `after ${opened.ms} ms`);
claim("the clicked commit lights", opened.opened && opened.lit);
claim("the first commit is shown as having added this folder's four files",
  opened.opened && opened.files.length === 4 && opened.files.every((f) => f.word === "added"),
  (opened.files ?? []).map((f) => `${f.path} ${f.word} ${f.count}`).join(" | "));

// ---- the chip: what it says, and what it opens -------------------------------
const chip = await run(`${HELPERS}
  const b = document.querySelector('.folderbarLow .branchword');
  if (!b) return { there: false };
  const cs = getComputedStyle(b);
  const num = b.querySelector('.branchnum');
  return {
    there: true,
    text: b.textContent.trim(),
    count: num?.textContent.trim() ?? '',
    tag: b.tagName,
    disabled: b.disabled,
    background: cs.backgroundColor,
    borderTop: cs.borderTopWidth,
    borderStyle: cs.borderTopStyle,
    appearance: cs.appearance,
    cursor: cs.cursor,
    numColour: num ? getComputedStyle(num).color : '',
    wordColour: cs.color,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    dim: getComputedStyle(document.documentElement).getPropertyValue('--dim').trim(),
  };
`);
claim("the chip reads the real number of changed files",
  chip.there && chip.count === String(report.staged + report.unstaged + report.untracked) && /files changed/.test(chip.text),
  `"${chip.text}" against ${report.unstaged} not staged + ${report.untracked} new`);
claim("it is still a button, and still clickable while there is something to show",
  chip.tag === "BUTTON" && chip.disabled === false && chip.cursor === "pointer",
  `${chip.tag} disabled=${chip.disabled} cursor=${chip.cursor}`);
claim("it is no longer drawn as a grey pill: no background, no border",
  chip.background === "rgba(0, 0, 0, 0)" && chip.borderTop === "0px",
  `background ${chip.background}, border ${chip.borderTop} ${chip.borderStyle}`);
claim("the count wears the accent and the words do not",
  chip.numColour !== chip.wordColour && chip.numColour !== "",
  `count ${chip.numColour} (--accent ${chip.accent}), words ${chip.wordColour} (--dim ${chip.dim})`);

const toChanges = await run(`${HELPERS}
  document.querySelector('.folderbarLow .branchword').click();
  const got = await until(() => {
    const col = document.querySelector('.foldersbody > .changes');
    return col && col.querySelector('.changepath') ? col : null;
  }, 8000);
  if (!got.v) return { opened: false, ms: got.ms };
  return {
    opened: true,
    ms: got.ms,
    paths: [...got.v.querySelectorAll('.changepath')].map(p => p.textContent.trim()),
    twice: document.querySelectorAll('.changes').length,
  };
`);
claim("the chip opens the list it is counting",
  toChanges.opened && toChanges.paths.includes("lib/one.go") && toChanges.paths.includes("fresh.txt"),
  `${(toChanges.paths ?? []).join(", ")} after ${toChanges.ms} ms`);
claim("and the overview does not then show the same list a second time",
  toChanges.twice === 1, `${toChanges.twice} changes list(s) on screen`);

// A file clicked in that list opens the difference in the wide half — the
// overview gives way to it, and comes back when it is closed.
const diff = await run(`${HELPERS}
  [...document.querySelectorAll('.foldersbody > .changes .changepath')].find(p => p.textContent.trim() === 'lib/one.go').click();
  const got = await until(() => document.querySelector('.foldersbody .diffline') ? true : null, 8000);
  const lines = document.querySelectorAll('.foldersbody .diffline[data-kind="add"]').length;
  byText('.overlayBar button, .overlayBar .btn', /^CLOSE$|^BACK$|^×$/)?.click();
  const back = await until(() => document.querySelector('.folderinfo')?.textContent.trim() ? true : null, 8000);
  return { shown: Boolean(got.v), ms: got.ms, added: lines, backAgain: Boolean(back.v) };
`);
claim("a file in that list opens its difference in the wide half", diff.shown, `${diff.added} added line(s) after ${diff.ms} ms`);
claim("closing the difference brings the overview back", diff.backAgain);

// ---- the chip in every skin --------------------------------------------------
// A computed style, per skin, because that is the thing nobody had ever looked
// at: the chip was the browser's own control in all four of them at once.
const SKINS = ["crt", "win95", "sketch", "pixel"];
const perSkin = {};
for (const skin of SKINS) {
  perSkin[skin] = await run(`${HELPERS}
    document.documentElement.setAttribute('data-skin', ${JSON.stringify(skin)});
    await wait(400);
    const b = document.querySelector('.folderbarLow .branchword');
    const cs = getComputedStyle(b);
    const num = b.querySelector('.branchnum');
    const dist = document.querySelector('.foldergit .branchdist');
    return {
      background: cs.backgroundColor,
      border: cs.borderTopWidth,
      font: cs.fontFamily.split(',')[0].replace(/"/g, ''),
      words: cs.color,
      count: num ? getComputedStyle(num).color : '',
      distText: dist?.textContent.trim() ?? '(none)',
    };
  `);
}
for (const skin of SKINS) {
  const s = perSkin[skin];
  claim(`${skin}: the chip is a status, not the browser's own button`,
    s.background === "rgba(0, 0, 0, 0)" && s.border === "0px" && s.count !== s.words,
    `background ${s.background}, border ${s.border}, font ${s.font}, count ${s.count} vs words ${s.words}`);
}
await run(`document.documentElement.setAttribute('data-skin', 'crt')`);

// ---- ahead and behind get the same treatment --------------------------------
// A second copy of the folder, fetched from the first and then committed on,
// so the branch is genuinely ahead of an upstream it really has.
const clone = join(home, "clone");
execFileSync("git", ["clone", "-q", work, clone], { stdio: "pipe" });
execFileSync("git", ["-C", clone, "commit", "-q", "--allow-empty", "-m", "one ahead"], {
  stdio: "pipe",
  env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
});
await api("/api/workspaces", { method: "POST", body: JSON.stringify({ path: clone }) });
// The list of folders is read when the view opens, so the page is opened again
// rather than being expected to notice a folder added behind its back.
await reload();
const distance = await run(`${HELPERS}
  byText('.railhome', /folders/i).click();
  const found = await until(() => byText('.folderTab', /^clone$/), 10000);
  if (!found.v) return { there: false };
  found.v.click();
  const got = await until(() => {
    const d = document.querySelector('.foldergit .branchdist .branchnum');
    return d ? d : null;
  }, 10000);
  if (!got.v) return { there: true, shown: false, ms: got.ms };
  const dist = got.v.closest('.branchdist');
  return {
    there: true, shown: true, ms: got.ms,
    text: dist.textContent.trim(),
    numColour: getComputedStyle(got.v).color,
    wordColour: getComputedStyle(dist).color,
  };
`);
claim("ahead is written as a number and a word, not as bare arithmetic",
  distance.shown && /^1\s+ahead$/.test(distance.text ?? ""), distance.text);
claim("its number wears the accent, like the chip's",
  distance.shown && distance.numColour !== distance.wordColour,
  `number ${distance.numColour}, word ${distance.wordColour}`);

// ---- the answer -------------------------------------------------------------
console.log();
console.log("  the folder overview, measured in a real browser");
console.log();
for (const c of claims) {
  console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.what}${c.detail ? `\n         ${c.detail}` : ""}`);
}
const failed = claims.filter((c) => !c.ok).length;
console.log();
console.log(`  ${claims.length - failed} of ${claims.length} hold`);
stop(failed ? 1 : 0);
