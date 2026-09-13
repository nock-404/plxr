/* The icon packs, in every skin, looked at.
 *
 * An icon that is not there draws nothing, and nothing says so: a symbol
 * missing from a sprite, a colour left in a file, a pixel pack drawn at a
 * fraction of its grid — all of it is valid markup that renders quietly wrong,
 * and in one pack in one skin at a time. So this check does what a person
 * would do with a screenshot, in numbers: it picks each pack in each skin
 * through the settings the way a person does, photographs the window, and
 * reads the pixels of every icon on screen.
 *
 *   - every mark on screen is a name its pack's sprite has
 *   - every icon has ink, and is not a filled box
 *   - the ink is the icon's own colour laid over what is behind it — the skin's
 *     colour, not one the upstream file brought along
 *   - the pixel pack has hard edges: no pixel halfway between ink and ground
 *   - picking a pack changes the window at once, without a reload, and the
 *     choice is still there after one
 *   - nothing moves: every box measured is where it was in the other packs
 *   - a new browser profile, with no look stored anywhere, comes up in Pixel
 *   - every name the tool stripes draw, laid out in a row of its own because
 *     most of them wear nothing on screen yet, has ink, is not a filled box and
 *     keeps no colour of its own, in every pack, skin and density
 *   - the licences page shows each vendored licence whole, with its copyright
 *
 * Screenshots are written to $ICON_SHOTS when it is set. No dependencies: the
 * browser on the machine over its debugging protocol, and a PNG reader below.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.PLXR_HOME || join(process.env.HOME, ".plxr");
const SHOTS = process.env.ICON_SHOTS || "";
const SKINS = [
  ["crt", "CRT"],
  ["win95", "Windows 95"],
  ["sketch", "Sketch"],
  ["pixel", "Pixel"],
];
const PACKS = [
  ["tabler", "Tabler"],
  ["phosphor", "Phosphor"],
  ["lucide", "Lucide"],
  ["pixel", "Pixel"],
];
const RATIOS = [1, 2];
// The pack a window draws with until somebody picks one.
const DEFAULT_PACK = ["pixel", "Pixel"];
// The names the tool stripes draw (spec 2026-09-13 §9, his picks of
// 13.09.2026): the tools, the header's hide, more and move, the three edge
// toggles, and the project and session switchers with their opener.
const STRIPE_NAMES = [
  "files", "changes", "search", "review", "inbox", "usage", "ports", "archive", "notes",
  "hide", "more", "move", "panel-left", "panel-right", "panel-bottom", "folder", "terminal", "chevron-down",
];

// The copyright lines each shipped licence has to carry, read off the files at
// the pinned commits. A licence page that shows a text without them has
// shipped the wrong file.
const COPYRIGHTS = {
  "tabler-icons": ["Copyright (c) 2020-2026 Paweł Kuna"],
  "phosphor-core": ["Copyright (c) 2023 Phosphor Icons"],
  "seti-ui": ["Copyright (c) 2014 Jesse Weed"],
  lucide: ["Copyright (c) 2026 Lucide Icons and Contributors", "Copyright (c) 2013-present Cole Bemis"],
  "catppuccin-vscode-icons": ["Copyright (c) 2023 Catppuccin", "Copyright (c) 2023 thang-nm"],
  pixelarticons: ["Copyright (c) 2019 Gerrit Halfmann"],
};

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
  console.log("  no chromium-based browser found — cannot look at the window");
  process.exit(1);
}

const base = `http://127.0.0.1:${info.port}`;
const api = (path, opts = {}) =>
  fetch(base + path, { ...opts, headers: { "X-Plxr-Token": info.token, "Content-Type": "application/json", ...(opts.headers || {}) } });

// The same refusal the other window checks make: somebody else's plxr is not
// this build, and clicking around in it is worse than not checking.
{
  let mine = "";
  let theirs = "";
  try {
    mine = readFileSync(join(HERE, "frontend", "out", "index.html"), "utf8");
    theirs = await fetch(`${base}/?token=${info.token}`).then((r) => r.text());
  } catch {
    /* compared below */
  }
  if (!mine || mine.trim() !== theirs.trim()) {
    console.log(`  the daemon on port ${info.port} does not serve this build — start one from this directory with its own PLXR_HOME`);
    process.exit(1);
  }
}

/* A folder of its own to look at: one file of every kind the tree knows, and
   a folder inside with a folder inside that, opened as a folder and as a
   session. So the rail, the tabs and the tree all have their marks on screen
   whatever daemon this runs against, and nothing of anybody's is opened. */
// A short name: the rail heads its sessions with the folder's name, and a long
// one wraps out of its row in the wider skins and lies across the entry above.
const FIXTURE = mkdtempSync(join(tmpdir(), "icons-"));
const KINDS = [
  "a.ts", "b.tsx", "c.js", "d.jsx", "e.go", "f.py", "g.rs", "h.php", "i.sh", "j.css", "k.html",
  "l.json", "m.yaml", "n.toml", ".env", "o.sql", "p.csv", "q.md", "r.txt", "s.png", "t.jpg",
  "u.svg", "v.gif", "w.zip", "x.tar", "yarn.lock", "package.json", "go.mod", "go.sum",
  "Dockerfile", "Makefile", "README.md", ".gitignore", "main.c", "unknown.xyz",
  "sub/inner.go", "sub/deeper/note.md",
];
mkdirSync(join(FIXTURE, "sub", "deeper"), { recursive: true });
for (const name of KINDS) writeFileSync(join(FIXTURE, name), "x\n");
const workspace = await api("/api/workspaces", { method: "POST", body: JSON.stringify({ path: FIXTURE }) })
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
const session = await api("/api/sessions", { method: "POST", body: JSON.stringify({ cwd: FIXTURE, cmd: [], name: "", account: "" }) })
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
if (!workspace) {
  rmSync(FIXTURE, { recursive: true, force: true });
  console.log("  the service would not open a folder to look at");
  process.exit(1);
}

/* ---- a PNG, read ---------------------------------------------------------
   Chrome writes 8-bit RGB or RGBA, non-interlaced. That is all this reads. */
function readPng(buffer) {
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  const data = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const kind = buffer.toString("ascii", at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (kind === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      if (body[12] !== 0) throw new Error("an interlaced PNG");
    } else if (kind === "IDAT") data.push(body);
    else if (kind === "IEND") break;
    at += 12 + length;
  }
  if (depth !== 8 || (type !== 2 && type !== 6)) throw new Error(`a PNG of depth ${depth}, type ${type}`);
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * bpp;
  const rgb = new Uint8Array(width * height * 3);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? line[x - bpp] : 0;
      const up = previous[x];
      const corner = x >= bpp ? previous[x - bpp] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      line[x] = (line[x] + add) & 255;
    }
    for (let x = 0; x < width; x++) {
      rgb[(y * width + x) * 3] = line[x * bpp];
      rgb[(y * width + x) * 3 + 1] = line[x * bpp + 1];
      rgb[(y * width + x) * 3 + 2] = line[x * bpp + 2];
    }
    previous = line;
  }
  return { width, height, rgb };
}

/* ---- one icon, read off the screenshot -----------------------------------
   The ground is the median of a ring just outside the icon's box. Every pixel
   inside is then placed on the line from the ground to the icon's colour:
   how far along it is (a), and how far off the line (off). An icon drawn in
   its own colour stays on that line; a colour the file brought with it does
   not. A filled box is ink nearly everywhere; a missing icon, nowhere. */
function readIcon(img, box, colour) {
  const at = (x, y) => {
    const i = (Math.min(img.height - 1, Math.max(0, y)) * img.width + Math.min(img.width - 1, Math.max(0, x))) * 3;
    return [img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]];
  };
  const ring = [];
  const pad = 2;
  for (let x = box.x - pad; x <= box.x + box.w + pad; x++) {
    ring.push(at(x, box.y - pad), at(x, box.y + box.h + pad));
  }
  for (let y = box.y - pad; y <= box.y + box.h + pad; y++) {
    ring.push(at(box.x - pad, y), at(box.x + box.w + pad, y));
  }
  const middle = (list, k) => list.map((p) => p[k]).sort((p, q) => p - q)[list.length >> 1];
  const ground = [middle(ring, 0), middle(ring, 1), middle(ring, 2)];
  const span = colour.map((c, k) => c - ground[k]);
  const reach = Math.hypot(...span);
  const samples = [];
  for (let y = box.y; y < box.y + box.h; y++) {
    // The ground of this one pixel row, from the gaps just left and right of
    // the icon. A skin that rules its panels — Sketch draws lines across the
    // tree like paper — runs those lines straight through an icon's box, and
    // against the box's overall ground every pixel of such a line reads as
    // half-toned ink. Against its own row it reads as what it is: ground.
    const beside = [at(box.x - 2, y), at(box.x - 3, y), at(box.x + box.w + 1, y), at(box.x + box.w + 2, y)];
    const row = [middle(beside, 0), middle(beside, 1), middle(beside, 2)];
    // Trusted only where both sides agree: a ruled line runs across the
    // icon, while a letter or a neighbouring mark sits on one side of it.
    const spread = Math.max(...beside.map((p) => Math.hypot(p[0] - row[0], p[1] - row[1], p[2] - row[2])));
    const lined = spread < reach * 0.2 ? row : ground;
    for (let x = box.x; x < box.x + box.w; x++) {
      const d = at(x, y).map((v, k) => v - lined[k]);
      if (reach < 1) {
        samples.push([0, 0]);
        continue;
      }
      const a = (d[0] * span[0] + d[1] * span[1] + d[2] * span[2]) / (reach * reach);
      const off = Math.hypot(d[0] - a * span[0], d[1] - a * span[1], d[2] - a * span[2]) / reach;
      samples.push([a, off]);
    }
  }
  // The icon's own full strength. A mark in a row drawn at part opacity never
  // reaches its colour anywhere: that makes it lighter, not softer and not
  // another colour, so every threshold below is taken relative to what it
  // does reach. A glow's fringe is weak ink and is left out of the colour test.
  const strong = samples.map((s) => s[0]).filter((v) => v > 0.15).sort((p, q) => p - q);
  const peak = strong.length ? Math.max(0.3, strong[Math.floor(strong.length * 0.9)]) : 1;
  let ink = 0;
  let solid = 0;
  let foreign = 0;
  let between = 0;
  for (const [v, off] of samples) {
    if (v > 0.25 * peak || off > 0.5) ink++;
    if (v > 0.5 * peak) {
      solid++;
      if (off > 0.45 * peak) foreign++;
    }
    if (v > 0.2 * peak && v < 0.8 * peak && off < 0.3 * peak) between++;
  }
  return { ground, reach, peak, coverage: ink / samples.length, foreign: solid ? foreign / solid : 0, between: ink ? between / ink : 0 };
}

/* ---- the browser ---------------------------------------------------------- */
const port = 9100 + Math.floor(Number(process.pid) % 400);
const profile = mkdtempSync(join(tmpdir(), "plxr-icons-"));
const child = spawn(browser, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--use-mock-keychain",
  "--password-store=basic",
  "--no-default-browser-check",
  "--window-size=1440,900",
  "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stop(code) {
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  try {
    rmSync(FIXTURE, { recursive: true, force: true });
  } catch {
    /* in the temp directory either way */
  }
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* the browser is still letting go; it lives in the temp directory */
  }
  process.exit(code);
}

/* One browser, and it goes with this process whatever ends it.
 *
 * A check that throws halfway — a selector that found nothing, a page that
 * never answered — used to leave its headless browser running, and a morning
 * of runs left more than a dozen of them holding gigabytes. Every way out now
 * passes through here: a thrown error, a rejected promise, an interrupt, and
 * the ordinary exit, which a kill that already happened makes harmless. */
process.on("exit", () => {
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => stop(130));
process.on("uncaughtException", (err) => {
  console.log(`  the check broke off: ${err?.message ?? err}`);
  stop(1);
});
process.on("unhandledRejection", (err) => {
  console.log(`  the check broke off: ${err?.message ?? err}`);
  stop(1);
});

let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i++) {
  try {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
    wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
  } catch {
    /* not up yet */
  }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) {
  console.log("  the browser did not come up — nothing looked at");
  stop(1);
}
const cdp = await new Promise((resolve, reject) => {
  const ws = new WebSocket(wsUrl);
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
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");

const run = async (body) => {
  const r = await cdp.send("Runtime.evaluate", {
    expression: `(async () => { ${HELPERS} ${body} })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`.trim());
  return r.result?.value;
};

// Everything the page side needs, in one place. Nothing is found by a word
// that changes with the language: packs and skins have names that are names.
const HELPERS = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const settingsOpen = () => !!document.querySelector('.settingsbody');
  const gear = () => document.querySelector('.tools [data-do="settings"]');
  const openSettings = async () => { if (!settingsOpen()) { gear().click(); await wait(900); } };
  // Closed through its own DONE, and checked: a settings panel left standing
  // in front of the tree hides every mark the check is here to read.
  const closeSettings = async () => {
    for (let i = 0; i < 3 && settingsOpen(); i++) {
      document.querySelector('.settingsbody .dialogFoot .btn.primary')?.click();
      await wait(700);
    }
    return !settingsOpen();
  };
  // A tab brought to the front by the mark it wears, the way dockview wants it:
  // a pointer going down, then the click.
  const front = async (icon) => {
    const tab = document.querySelector('.panelTab .uiIcon[data-icon="' + icon + '"]')?.closest('.dv-tab');
    if (!tab) return false;
    tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    tab.click();
    await wait(900);
    return true;
  };
  const pick = async (button, label) => {
    button.click();
    await wait(300);
    const row = [...document.querySelectorAll('.selectList .selectRow')].find((r) => r.textContent.trim() === label);
    if (!row) { document.body.click(); return false; }
    row.click();
    await wait(500);
    return true;
  };
`;

const claims = [];
const claim = (what, ok, detail = "") => claims.push({ what, ok: Boolean(ok), detail });
const record = {};

async function load() {
  for (let i = 0; i < 40; i++) {
    await cdp.send("Page.navigate", { url: `${base}/?token=${info.token}` });
    await sleep(900);
    const up = await run("return document.querySelectorAll('.railhome').length").catch(() => 0);
    if (up) return true;
  }
  return false;
}

/* What is on screen: the window arranged so every kind of mark is showing —
   the rail with its views and a session, the folder's tree with a folder
   unfolded, a file open in a tab of its own, and the toolbar. */
async function arrange() {
  return run(`
    const row = (name) => [...document.querySelectorAll('.frow')].find((r) => r.querySelector('.fname')?.textContent === name);
    // A file opens in a tab of its own in front of the tree, so the tree's tab
    // is brought back to the front after each one — the way a person would.
    document.querySelector('.railitem:has(.rsub)')?.click();
    await wait(1500);
    document.querySelector('.railhome[data-view="folders"]')?.click();
    await wait(2000);
    // This check's own folder, by its name — other folders may be open.
    [...document.querySelectorAll('.folderTab')].find((b) => b.textContent.trim() === ${JSON.stringify(basename(FIXTURE))})?.click();
    await wait(1500);
    for (const name of ['a.ts', 'm.yaml']) {
      row(name)?.click();
      await wait(1500);
      await front('folder');
    }
    row('sub')?.click();
    await wait(1200);
    return {
      icons: document.querySelectorAll('.uiIcon').length,
      rows: document.querySelectorAll('.frow').length,
      tabs: [...document.querySelectorAll('.panelTab .uiIcon')].map((i) => i.dataset.icon),
    };
  `);
}

// Boxes that must not move when the pack changes. The frame, plus the rows the
// icons sit in and the text beside them.
const MEASURE = `
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; };
  const q = (s) => document.querySelector(s);
  // A tab strip with more tabs than room scrolls to keep the tab in front in
  // view, and the pixel pack's wider tabs scroll it further. Measured in the
  // pixel skin at 1x: 98px under Tabler, 114px under Pixel, each tab exactly
  // where it was along the strip. So a tab is measured along its strip, and a
  // scroll is not read as a move.
  const strip = q('.panelTab')?.closest('.dv-tabs-container');
  const along = (b) => b && strip ? [Math.round((b[0] + strip.scrollLeft) * 10) / 10, b[1], b[2], b[3]] : b;
  return {
    bar: box(q('.bar')), statusrow: box(q('.statusrow')), rail: box(q('.rail')),
    railHome: box(q('.railhome')), railHomeName: box(q('.railhome .rname')),
    railSession: box(q('.railitem:has(.rsub)')),
    frow: box(q('.frow')), frowName: box(q('.frow .fname')), frowCount: document.querySelectorAll('.frow').length,
    tab: along(box(q('.panelTab'))), tabName: along(box(q('.panelTab .panelTabName'))),
    toolIcon: box(q('.tools [data-do="settings"]')), toolReset: box(q('.tools [data-do="reset-layout"]')),
  };
`;

async function iconsOnScreen() {
  return run(`
    return [...document.querySelectorAll('.uiIcon')].map((svg) => {
      const r = svg.getBoundingClientRect();
      const c = getComputedStyle(svg).color.match(/[0-9.]+/g).map(Number);
      const hidden = r.width === 0 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth
        || !!svg.closest('[hidden], .selectList') || getComputedStyle(svg).visibility === 'hidden';
      // What is drawn on top of the icon's middle, to leave out marks covered
      // by a menu or a panel.
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const covered = !top || !(svg === top || svg.contains(top) || top.contains(svg));
      return { name: svg.dataset.icon, specimen: svg.dataset.specimen === 'yes', href: svg.querySelector('use')?.getAttribute('href') || '', x: r.x, y: r.y, w: r.width, h: r.height,
        colour: c.slice(0, 3), alpha: c.length > 3 ? c[3] : 1, hidden, covered,
        where: svg.closest('.railitem') ? 'rail' : svg.closest('.panelTab') ? 'tab' : svg.closest('.fchev') ? 'chevron' : svg.closest('.frow') ? 'tree' : svg.closest('.tools') ? 'toolbar' : 'other' };
    });
  `);
}

// Everything the service keeps for the window, as it was, put back at the end:
// the look, and the arrangement of panels this check opened. A check that runs
// after this one starts from the window as the service had it.
const prefsBefore = await api("/api/prefs").then((r) => r.json()).catch(() => ({}));

const sprites = {};
for (const [pack] of PACKS) {
  const text = await fetch(`${base}/icons/${pack}.svg`).then((r) => (r.ok ? r.text() : ""));
  sprites[pack] = new Set([...text.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
  claim(`the ${pack} sprite is served from the build`, sprites[pack].size > 0, `${sprites[pack].size} symbols`);
}

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const geometry = {};

/* The pack nobody picked. This browser profile is new, and the service's
   stored look is set aside until the end, when the prefs are put back whole —
   so the first window below starts from nothing stored anywhere. */
if (prefsBefore?.theme !== undefined) {
  await api("/api/prefs", { method: "PUT", body: JSON.stringify({ theme: null }) }).catch(() => undefined);
}

// One row of every tool-stripe name, drawn the way Icon.tsx draws a mark — an
// svg.uiIcon using the chosen pack's symbol — in a panel's text colour on a
// panel's ground, clear of every other mark so the ring around each reads
// ground.
const LAY_OUT_STRIPE_NAMES = `
  document.getElementById('stripeSpecimen')?.remove();
  const sprite = (document.querySelector('.railhome .uiIcon use')?.getAttribute('href') ?? '').split('#')[0];
  const row = document.createElement('div');
  row.id = 'stripeSpecimen';
  row.style.cssText = 'position:fixed;left:22rem;top:10rem;z-index:2147483647;display:flex;gap:1rem;padding:1rem;background:var(--panel);color:var(--fg)';
  for (const name of ${JSON.stringify(STRIPE_NAMES)}) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'uiIcon');
    svg.setAttribute('data-icon', name);
    svg.setAttribute('data-specimen', 'yes');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', sprite + '#' + name);
    svg.appendChild(use);
    row.appendChild(svg);
  }
  document.body.appendChild(row);
  await wait(500);
  const r = row.getBoundingClientRect();
  return { sprite, box: { x: r.x, y: r.y, width: r.width, height: r.height } };
`;

for (const ratio of RATIOS) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: ratio, mobile: false });
  if (!(await load())) {
    console.log("  the interface did not render");
    stop(1);
  }
  if (ratio === RATIOS[0]) {
    const fresh = await run(`
      await wait(1500);
      await openSettings();
      const shown = document.querySelector('[data-field="icons"] .selectButton span')?.textContent.trim();
      const closed = await closeSettings();
      return { icons: document.documentElement.dataset.icons, shown, closed,
        hrefs: [...document.querySelectorAll('.uiIcon use')].map((u) => u.getAttribute('href') || '') };
    `);
    const kept = await api("/api/prefs").then((r) => r.json()).catch(() => ({}));
    const elsewhere = fresh.hrefs.filter((h) => !h.startsWith(`/icons/${DEFAULT_PACK[0]}.svg`));
    claim(`a new profile with no stored look comes up in the ${DEFAULT_PACK[1]} pack`,
      kept?.theme === undefined && fresh.icons === DEFAULT_PACK[0] && fresh.shown === DEFAULT_PACK[1] && fresh.closed
        && fresh.hrefs.length > 0 && elsewhere.length === 0,
      `service keeps ${kept?.theme === undefined ? "no look" : `a look with ${kept.theme.icons}`} · data-icons=${fresh.icons} · picker says ${fresh.shown}`
        + ` · ${fresh.hrefs.length} marks, ${elsewhere.length} drawn from another pack${elsewhere.length ? `: ${elsewhere[0]}` : ""}`);
  }
  await arrange();
  for (const [skin, skinLabel] of SKINS) {
    for (const [pack, packLabel] of PACKS) {
      const chosen = await run(`
        window.__notReloaded = true;
        await openSettings();
        const skinButton = document.querySelector('.settingsbody .tabbody .field .selectButton');
        const packButton = document.querySelector('[data-field="icons"] .selectButton');
        if (!skinButton || !packButton) return { error: 'the pickers are not in the settings' };
        const hrefBefore = document.querySelector('.railhome .uiIcon use')?.getAttribute('href');
        const skinPicked = await pick(skinButton, ${JSON.stringify(skinLabel)});
        const packPicked = await pick(packButton, ${JSON.stringify(packLabel)});
        const shown = document.querySelector('[data-field="icons"] .selectButton span')?.textContent.trim();
        const closed = await closeSettings();
        await front('folder');
        await wait(600);
        return { skinPicked, packPicked, shown, hrefBefore, closed, rows: document.querySelectorAll('.frow').length,
          hrefAfter: document.querySelector('.railhome .uiIcon use')?.getAttribute('href'),
          skin: document.documentElement.dataset.skin, icons: document.documentElement.dataset.icons,
          live: window.__notReloaded === true };
      `);
      const tag = `${skin} + ${pack} at ${ratio}x`;
      if (chosen.error) {
        claim(`${tag}: ${chosen.error}`, false);
        continue;
      }
      claim(`${tag}: picked through the settings, applied without a reload`,
        chosen.skinPicked && chosen.packPicked && chosen.closed && chosen.rows > 20 && chosen.skin === skin && chosen.icons === pack && chosen.live
          && (chosen.hrefAfter || "").startsWith(`/icons/${pack}.svg`),
        `data-skin=${chosen.skin} data-icons=${chosen.icons} picker says ${chosen.shown} · settings ${chosen.closed ? "closed" : "STILL OPEN"} · ${chosen.rows} tree rows · ${chosen.hrefAfter}`);

      geometry[`${ratio}|${skin}|${pack}`] = await run(MEASURE);
      const icons = (await iconsOnScreen()).filter((i) => !i.hidden && !i.covered);
      const unknown = [...new Set(icons.filter((i) => !sprites[pack].has(i.name)).map((i) => i.name))];
      const wrongHref = icons.filter((i) => !i.href.startsWith(`/icons/${pack}.svg`) || !i.href.endsWith(`#${i.name}`));
      claim(`${tag}: every mark on screen is in the ${pack} sprite`, icons.length > 20 && unknown.length === 0 && wrongHref.length === 0,
        `${icons.length} icons${unknown.length ? ` · not in the sprite: ${unknown.join(", ")}` : ""}${wrongHref.length ? ` · ${wrongHref.length} drawn from elsewhere` : ""}`);

      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      const png = Buffer.from(shot.data, "base64");
      if (SHOTS) writeFileSync(join(SHOTS, `${ratio}x-${skin}-${pack}.png`), png);
      if (SHOTS && ratio === 2) {
        const close = await cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 560, height: 520, scale: 1 } });
        writeFileSync(join(SHOTS, `${ratio}x-${skin}-${pack}-close.png`), Buffer.from(close.data, "base64"));
      }
      const img = readPng(png);
      const readings = icons.map((i) => {
        const box = {
          x: Math.round(i.x * ratio),
          y: Math.round(i.y * ratio),
          w: Math.max(1, Math.round(i.w * ratio)),
          h: Math.max(1, Math.round(i.h * ratio)),
        };
        return { ...i, ...readIcon(img, box, i.colour) };
      });
      // A mark in a colour close to its ground cannot be judged by colour —
      // there is no line to stay on. Counted, never silently passed.
      const judged = readings.filter((r) => r.reach >= 60);
      const empty = judged.filter((r) => r.coverage < 0.015);
      const boxes = judged.filter((r) => r.coverage > 0.8);
      const foreign = judged.filter((r) => r.foreign > 0.25);
      claim(`${tag}: every icon has ink and none is a filled box`, judged.length > 10 && empty.length === 0 && boxes.length === 0,
        `${judged.length} of ${readings.length} judged · coverage ${Math.min(...judged.map((r) => r.coverage)).toFixed(2)}–${Math.max(...judged.map((r) => r.coverage)).toFixed(2)}`
          + (empty.length ? ` · empty: ${empty.map((r) => `${r.where}/${r.name}`).join(", ")}` : "")
          + (boxes.length ? ` · filled: ${boxes.map((r) => `${r.where}/${r.name}`).join(", ")}` : ""));
      claim(`${tag}: no icon keeps a colour of its own`, foreign.length === 0,
        `worst ${Math.max(0, ...judged.map((r) => r.foreign)).toFixed(2)} of its ink off the skin's colour`
          + (foreign.length ? ` · ${foreign.map((r) => `${r.where}/${r.name} ${r.foreign.toFixed(2)}`).join(", ")}` : ""));
      if (pack === "pixel" && skin !== "crt" && skin !== "sketch") {
        // Read in the two skins that lay nothing over or behind a mark. The
        // tube puts a glow around every one on purpose, a soft edge by design;
        // Sketch rules its panels like paper and dots its buttons, and those
        // lines cross the icons' boxes, so their pixels read as half-tones of
        // ink that is not there. Looked at in the close-ups instead: crisp.
        const soft = judged.filter((r) => r.between > 0.12);
        const worst = Math.max(0, ...judged.map((r) => r.between));
        const size = icons.find((i) => i.where === "rail")?.w;
        claim(`${tag}: the pixel pack is crisp — one grid unit on whole device pixels`,
          soft.length === 0 && size && Number.isInteger((size * ratio) / 24),
          `icon ${size} CSS px = ${size * ratio} device px = ${(size * ratio) / 24} per unit · worst ${worst.toFixed(2)} of ink half-toned`
            + (soft.length ? ` · soft: ${soft.map((r) => `${r.where}/${r.name} ${r.between.toFixed(2)}`).join(", ")}` : ""));
        record[`between ${tag}`] = worst;
      }
      if (pack !== "pixel" && skin !== "crt" && skin !== "sketch") record[`between ${tag}`] = Math.max(0, ...judged.map((r) => r.between));

      // The tool-stripe names, read the same way as the marks above.
      const laid = await run(LAY_OUT_STRIPE_NAMES);
      const specimens = (await iconsOnScreen()).filter((i) => i.specimen);
      const stripeShot = readPng(Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
      if (SHOTS) {
        const clip = { ...laid.box, scale: 1 };
        const close = await cdp.send("Page.captureScreenshot", { format: "png", clip });
        writeFileSync(join(SHOTS, `${ratio}x-${skin}-${pack}-stripes.png`), Buffer.from(close.data, "base64"));
      }
      await run("document.getElementById('stripeSpecimen')?.remove();");
      const drawn = specimens.map((i) => ({
        ...i,
        ...readIcon(stripeShot, {
          x: Math.round(i.x * ratio),
          y: Math.round(i.y * ratio),
          w: Math.max(1, Math.round(i.w * ratio)),
          h: Math.max(1, Math.round(i.h * ratio)),
        }, i.colour),
      }));
      const absent = STRIPE_NAMES.filter((n) => !sprites[pack].has(n));
      const unseen = STRIPE_NAMES.filter((n) => !drawn.some((d) => d.name === n && !d.hidden && !d.covered));
      const unjudged = drawn.filter((d) => d.reach < 60);
      const bare = drawn.filter((d) => d.coverage < 0.015);
      const filled = drawn.filter((d) => d.coverage > 0.8);
      const own = drawn.filter((d) => d.foreign > 0.25);
      const wrongSprite = drawn.filter((d) => !d.href.startsWith(`/icons/${pack}.svg`));
      claim(`${tag}: every tool-stripe name has ink from the ${pack} sprite and none is a filled box`,
        absent.length === 0 && unseen.length === 0 && unjudged.length === 0 && bare.length === 0 && filled.length === 0 && wrongSprite.length === 0,
        `${drawn.length} of ${STRIPE_NAMES.length} laid out · coverage ${Math.min(...drawn.map((d) => d.coverage)).toFixed(2)}–${Math.max(...drawn.map((d) => d.coverage)).toFixed(2)}`
          + (absent.length ? ` · not in the sprite: ${absent.join(", ")}` : "")
          + (unseen.length ? ` · not on screen: ${unseen.join(", ")}` : "")
          + (unjudged.length ? ` · too close to its ground to judge: ${unjudged.map((d) => d.name).join(", ")}` : "")
          + (bare.length ? ` · empty: ${bare.map((d) => `${d.name} ${d.coverage.toFixed(3)}`).join(", ")}` : "")
          + (filled.length ? ` · filled: ${filled.map((d) => d.name).join(", ")}` : "")
          + (wrongSprite.length ? ` · drawn from ${wrongSprite[0].href}` : ""));
      claim(`${tag}: no tool-stripe name keeps a colour of its own`, drawn.length === STRIPE_NAMES.length && own.length === 0,
        `worst ${Math.max(0, ...drawn.map((d) => d.foreign)).toFixed(2)} of its ink off the skin's colour`
          + (own.length ? ` · ${own.map((d) => `${d.name} ${d.foreign.toFixed(2)}`).join(", ")}` : ""));
      if (pack === "pixel" && skin !== "crt" && skin !== "sketch") {
        const soft = drawn.filter((d) => d.between > 0.12);
        claim(`${tag}: the tool-stripe names in the pixel pack are crisp`, drawn.length === STRIPE_NAMES.length && soft.length === 0,
          `worst ${Math.max(0, ...drawn.map((d) => d.between)).toFixed(2)} of ink half-toned`
            + (soft.length ? ` · soft: ${soft.map((d) => `${d.name} ${d.between.toFixed(2)}`).join(", ")}` : ""));
      }
    }
  }
}

/* Nothing moves. Within one screen density and one skin, every box measured
   is where it was with Tabler, to a tenth of a pixel. The one allowed
   difference is the pixel pack on a plain screen: its icon is 24 CSS pixels
   there, wider than the glyph slot it sits in, so the slot grows and the words
   beside it start further right — in the same row, at the same height. Those
   shifts are reported, never silently allowed anywhere else. */
for (const ratio of RATIOS) {
  for (const [skin] of SKINS) {
    const ref = geometry[`${ratio}|${skin}|tabler`];
    for (const [pack] of PACKS.slice(1)) {
      const got = geometry[`${ratio}|${skin}|${pack}`];
      if (!ref || !got) continue;
      const moved = [];
      const shifted = [];
      for (const key of Object.keys(ref)) {
        const a = ref[key];
        const b = got[key];
        if (typeof a === "number" || a === null || b === null) {
          if (a !== b) moved.push(`${key} ${a} → ${b}`);
          continue;
        }
        // The pixel pack on a plain screen draws at 24 CSS pixels: wider than a
        // glyph slot and taller than a tree row. Its slots widen, the words
        // beside them start further right, and a tree row grows to hold its
        // icon rather than stack icons into each other. Which of x, y, width
        // and height still have to hold, per box, in that one case:
        const loose = pack === "pixel" && ratio === 1
          ? { railHomeName: [1, 3], tabName: [1, 3], tab: [0, 1, 3], frow: [0, 1], frowName: [3] }[key]
          : undefined;
        const checked = loose ?? [0, 1, 2, 3];
        if (checked.some((i) => Math.abs(a[i] - b[i]) > 0.15)) {
          moved.push(`${key} ${a.join(",")} → ${b.join(",")}`);
          continue;
        }
        if (!loose) continue;
        const dx = b[0] - a[0];
        const dh = b[3] - a[3];
        if (key.endsWith("Name") && Math.abs(dx) > 0.15) {
          if (dx > 2 * 24) moved.push(`${key} starts ${dx.toFixed(1)}px further right`);
          else shifted.push(`${key} +${dx.toFixed(1)}px`);
        }
        if (key === "frow" && Math.abs(dh) > 0.15) {
          if (dh > 16) moved.push(`a tree row grew ${dh.toFixed(1)}px`);
          else shifted.push(`tree row ${a[3]}→${b[3]}px tall`);
        }
        // Taller rows can make the tree scroll where it did not, and its
        // scrollbar takes its width from the rows — never more than that.
        if (key === "frow" && Math.abs(b[2] - a[2]) > 0.15) {
          if (a[2] - b[2] > 16 || b[2] > a[2]) moved.push(`tree rows ${a[2]}→${b[2]}px wide`);
          else shifted.push(`tree ${(a[2] - b[2]).toFixed(1)}px narrower for a scrollbar`);
        }
        if (key === "tab") {
          const push = got.tabName && ref.tabName ? got.tabName[0] - ref.tabName[0] : 0;
          if (Math.abs(b[2] - a[2] - push) > 0.3) moved.push(`tab widened ${(b[2] - a[2]).toFixed(1)}px for a title pushed ${push.toFixed(1)}px`);
        }
      }
      claim(`${skin} at ${ratio}x: ${pack} leaves every box where Tabler had it`, moved.length === 0,
        (moved.join(" · ") || `${Object.keys(ref).length} boxes`) + (shifted.length ? ` · grown for the 24px pixel icon: ${shifted.join(", ")}` : ""));
    }
  }
}

/* Remembered: the last pick survives a reload and sits in the daemon's copy
   of the look, which is what a second window and the next start read. */
{
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await run(`
    await openSettings();
    await pick(document.querySelector('[data-field="icons"] .selectButton'), 'Pixel');
    await closeSettings();
  `);
  await sleep(1200);
  await load();
  const after = await run(`
    await wait(1500);
    await openSettings();
    const shown = document.querySelector('[data-field="icons"] .selectButton span')?.textContent.trim();
    return { icons: document.documentElement.dataset.icons, shown };
  `);
  const prefs = await api("/api/prefs").then((r) => r.json()).catch(() => ({}));
  claim("the chosen pack is still chosen after a reload, and kept by the service",
    after.icons === "pixel" && after.shown === "Pixel" && prefs?.theme?.icons === "pixel",
    `data-icons=${after.icons} · picker says ${after.shown} · service keeps ${prefs?.theme?.icons}`);
}

/* The licences page. */
{
  const page = await run(`
    await openSettings();
    document.querySelector('.settingsbody [data-tab="licences"]')?.click();
    await wait(1500);
    const blocks = [...document.querySelectorAll('.licence')];
    const out = [];
    for (const b of blocks) {
      const id = b.dataset.set;
      const file = await fetch('/licenses/' + id + '.txt').then((r) => r.ok ? r.text() : null);
      out.push({ id, shown: b.querySelector('.licenceText')?.textContent ?? '', file, title: b.querySelector('.licenceTitle')?.textContent });
    }
    const text = document.querySelector('.licenceText');
    if (text) text.scrollIntoView({ block: 'start' });
    return out;
  `);
  const ids = page.map((p) => p.id).sort();
  claim("the licences page lists every vendored set", JSON.stringify(ids) === JSON.stringify(Object.keys(COPYRIGHTS).sort()), ids.join(", "));
  for (const p of page) {
    const lines = COPYRIGHTS[p.id] ?? [];
    claim(`licences: ${p.id} is shown whole, as the file ships, with its copyright`,
      p.file && p.shown === p.file && lines.every((l) => p.shown.includes(l)),
      `${p.shown.length} characters shown, ${p.file?.length ?? 0} in /licenses/${p.id}.txt · ${lines.map((l) => (p.shown.includes(l) ? "has" : "LACKS") + ` "${l}"`).join(" · ")}`);
  }
  if (SHOTS) {
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(SHOTS, "licences.png"), Buffer.from(shot.data, "base64"));
  }
}

cdp.close();
// The page goes before the service is put back, or it stores its panels again
// on its way out and undoes the restore.
try {
  child.kill();
} catch {
  /* already gone */
}
await sleep(800);
const failed = claims.filter((c) => !c.ok);
for (const c of claims) {
  if (!c.ok || process.env.ICON_VERBOSE) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.what}${c.detail ? `\n         ${c.detail}` : ""}`);
}
if (process.env.ICON_VERBOSE) console.log(JSON.stringify(record, null, 1));
console.log(failed.length ? `  ${failed.length} of ${claims.length} claims failed` : `  icon packs hold — ${claims.length} claims, ${RATIOS.length} densities, ${SKINS.length} skins, ${PACKS.length} packs`);
// What this check opened, it closes: the session, the folder, the files — and
// the service's prefs go back to what they were, with anything added removed.
{
  const now = await api("/api/prefs").then((r) => r.json()).catch(() => ({}));
  const back = { ...prefsBefore };
  for (const key of Object.keys(now ?? {})) if (!(key in (prefsBefore ?? {}))) back[key] = null;
  await api("/api/prefs", { method: "PUT", body: JSON.stringify(back) }).catch(() => undefined);
}
// Ended, then taken off the board: a stopped session stays in the service's
// register on purpose, and one left there points at a folder that is gone.
if (session?.id) {
  await api(`/api/sessions/${session.id}`, { method: "DELETE" }).catch(() => undefined);
  await sleep(500);
  await api(`/api/sessions/${session.id}?purge=1`, { method: "DELETE" }).catch(() => undefined);
}
if (workspace?.id) await api(`/api/workspaces/${workspace.id}`, { method: "DELETE" }).catch(() => undefined);
stop(failed.length ? 1 : 0);
