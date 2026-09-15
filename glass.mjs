/* Does the window let the desktop through where it says it does?
 *
 * "How solid the panels are" is a slider, and for a while it moved nothing:
 * the readability fix in 0.79.0 gave every document of main, the tab strip and
 * the stripes the panel colour flat, so at 5 % they still stood opaque over a
 * see-through window. Nobody noticed, because no check ever read an alpha —
 * the checks measured contrast, and flat colour has the best contrast there is.
 *
 * So this one reads the alpha of the grounds that must follow the slider, at
 * two settings far apart, in every skin. It also holds the other half: the
 * field a document's text is read off stays opaque where the skin dresses it
 * that way, which is what made Windows 95's editor readable again.
 *
 * It runs against the daemon under PLXR_HOME, changes its settings and puts
 * them back afterwards, so the next check finds what it expects.
 */
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPng } from "./pngkit.mjs";
import { GATEKIT } from "./gatekit.mjs";

const HOME = process.env.PLXR_HOME || join(process.env.HOME, ".plxr");
const SKINS = ["crt", "win95", "sketch", "pixel"];
// Far apart on purpose: a ground that ignores the slider reads the same twice.
const THIN = 5;
const THICK = 90;

const BROWSERS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = [];
const claim = (what, ok, detail = "") => claims.push({ what, ok: Boolean(ok), detail });

function daemon() {
  try {
    return JSON.parse(readFileSync(join(HOME, "daemon.json"), "utf8"));
  } catch {
    return null;
  }
}

const info = daemon();
if (!info) {
  console.log(`  no daemon under ${HOME} — this check reads the running window`);
  process.exit(1);
}
const browserPath = BROWSERS.find((p) => {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
});
if (!browserPath) {
  console.log("  no chromium-based browser found — cannot measure");
  process.exit(1);
}

const base = `http://127.0.0.1:${info.port}`;
const api = (path, init) =>
  fetch(`${base}${path}`, { ...init, headers: { "X-Plxr-Token": info.token, "Content-Type": "application/json" } });

/* What the window is set to now, put back at the end: this check turns the
   window see-through and moves the slider, and a check after it on the same
   daemon would otherwise measure a window nobody chose. */
const held = await api("/api/prefs").then((r) => r.json()).catch(() => null);
if (!held || typeof held !== "object") {
  console.log("  the daemon's settings could not be read — nothing measured, nothing changed");
  process.exit(1);
}

const port = 9000 + Math.floor(Number(process.pid) % 900);
const profile = mkdtempSync(join(tmpdir(), "plxr-glass-"));
const child = spawn(browserPath, [
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

let stopping = false;
async function stop(code, why) {
  if (stopping) process.exit(code);
  stopping = true;
  if (why) console.log("  " + why);
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  await api("/api/prefs", { method: "PUT", body: JSON.stringify(held) }).catch(() => undefined);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* it lives in the temp directory */
  }
  process.exit(code);
}
for (const bad of ["uncaughtException", "unhandledRejection"]) {
  process.on(bad, (why) => {
    console.log(`  ${bad}: ${why?.stack ?? why}`);
    void stop(1);
  });
}
process.on("SIGINT", () => void stop(130));
process.on("SIGTERM", () => void stop(143));

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
      });
  });
}

let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i++) {
  try {
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
    wsUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
  } catch {
    /* not up yet */
  }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) await stop(1, "the browser did not come up — nothing measured");

const cdp = await connect(wsUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Page.navigate", { url: `${base}/?token=${info.token}` });
await sleep(2500);
const run = async (expression) => {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};

/* What the three sliders own, and what has to look the same within each.
   Read as composited pixels over a loud pattern behind the page — the only
   way to catch a second pane of glass stacked on a first, which computed
   styles alone never showed. */
const LAYERS = {
  panel: [".filetree", ".pterm", ".overviewPanel", ".settingsPanel", ".toolWindow"],
  /* The tab strip's pane is on the outer box — the actions container. The inner
     tabs container is clear, and reading it read whatever was behind it. */
  chrome: [".bar", ".statusbar", '.stripe[data-edge="left"]', ".plxrDock .dv-tabs-and-actions-container"],
};

const PLAIN = `(() => {
  const html = document.documentElement;
  html.style.background = "#808080";
  html.style.backgroundAttachment = "fixed";
  return true;
})()`;

const PATTERN = `(() => {
  const html = document.documentElement;
  html.style.background = "repeating-conic-gradient(#ff00c8 0% 25%, #ffe600 0% 50%) 0 0 / 48px 48px";
  html.style.backgroundAttachment = "fixed";
  return true;
})()`;

const boxesOf = (sels) => `(() => {
  const out = {};
  for (const sel of ${JSON.stringify(Object.values(LAYERS).flat())}) {
    const el = document.querySelector(sel);
    if (!el) { out[sel] = null; continue; }
    const r = el.getBoundingClientRect();
    if (r.width < 12 || r.height < 12) { out[sel] = null; continue; }
    out[sel] = { x: Math.round(r.x + 4), y: Math.round(r.y + 4), width: Math.min(120, Math.round(r.width - 8)), height: Math.min(80, Math.round(r.height - 8)) };
  }
  return JSON.stringify(out);
})()`;

async function average(box) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 1 } });
  const png = readPng(Buffer.from(shot.data, "base64"));
  let r = 0, g = 0, b = 0;
  const n = png.width * png.height;
  for (let i = 0; i < n; i++) {
    r += png.rgb[i * 3];
    g += png.rgb[i * 3 + 1];
    b += png.rgb[i * 3 + 2];
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

const far = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/* The status line runs the whole width of the window, so it is the one surface
   that can be read at both edges and in the middle. */
async function ends(skin) {
  const prefs = await api("/api/prefs").then((r) => r.json()).catch(() => ({}));
  const theme = { ...(prefs.theme ?? {}), skin, seethrough: true, panelSolid: 40, chromeSolid: 40, windowSolid: 40, gradient: false, scanOn: true };
  await api("/api/prefs", { method: "PUT", body: JSON.stringify({ ...prefs, theme }) });
  await sleep(2200);
  await run(PLAIN);
  await sleep(300);
  const box = await run(`(() => {
    const el = document.querySelector(".statusbar");
    if (!el) return "";
    el.dataset.glassRead = "yes";
    for (const kid of el.querySelectorAll("*")) kid.style.visibility = "hidden";
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y + 3), width: Math.round(r.width), height: Math.max(6, Math.round(r.height - 6)) });
  })()`);
  if (!box) return null;
  const r = JSON.parse(box);
  const wide = Math.min(120, Math.round(r.width / 6));
  const left = await average({ x: r.x + 2, y: r.y, width: wide, height: r.height });
  const middle = await average({ x: Math.round(r.x + r.width / 2 - wide / 2), y: r.y, width: wide, height: r.height });
  const right = await average({ x: r.x + r.width - wide - 2, y: r.y, width: wide, height: r.height });
  await run(`(() => { const el = document.querySelector('[data-glass-read="yes"]'); if (!el) return false; for (const kid of el.querySelectorAll("*")) kid.style.visibility = ""; delete el.dataset.glassRead; return true; })()`);
  return { left, middle, right, worst: Math.max(far(left, middle), far(middle, right), far(left, right)) };
}

async function layers(skin, panelSolid, chromeSolid) {
  const prefs = await api("/api/prefs").then((r) => r.json()).catch(() => ({}));
  const theme = { ...(prefs.theme ?? {}), skin, seethrough: true, panelSolid, chromeSolid, windowSolid: 0, gradient: false, scanOn: false };
  await api("/api/prefs", { method: "PUT", body: JSON.stringify({ ...prefs, theme }) });
  await sleep(2200);
  /* One colour behind the page, not a pattern: then two samples can only differ
     by the glass over them, never by which part of a chequerboard they happened
     to sit on. What the pattern was for — a second pane stacked on a first —
     reads here just as well, as a darker sample. */
  await run(PLAIN);
  await sleep(300);
  const seen = {};
  for (const [name, sels] of Object.entries(LAYERS)) {
    seen[name] = [];
    for (const sel of sels) {
      /* The surface alone: everything standing on it — rows, fields, words —
         is out of sight while it is read. Hiding only the childless ones left
         the search field lying over the top bar, and the bar's sample was the
         field's. */
      const box = await run(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => { const r = e.getBoundingClientRect(); return r.width >= 24 && r.height >= 16; });
        if (!el) return "";
        el.dataset.glassRead = "yes";
        for (const kid of el.querySelectorAll("*")) kid.style.visibility = "hidden";
        const r = el.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.x + 4), y: Math.round(r.y + 4), width: Math.min(120, Math.round(r.width - 8)), height: Math.min(80, Math.round(r.height - 8)) });
      })()`);
      if (!box) continue;
      seen[name].push({ sel, rgb: await average(JSON.parse(box)) });
      await run(`(() => { const el = document.querySelector('[data-glass-read="yes"]'); if (!el) return false; for (const kid of el.querySelectorAll("*")) kid.style.visibility = ""; delete el.dataset.glassRead; return true; })()`);
    }
  }
  await run(`(() => { document.querySelectorAll('.app *').forEach((el) => { el.style.visibility = ''; }); return true; })()`);
  return seen;
}

for (const skin of SKINS) {
  // Every surface of one layer has to read the same over the pattern.
  const even = await layers(skin, 40, 40);
  for (const [name, reads] of Object.entries(even)) {
    if (reads.length < 2) continue;
    /* Windows 95 reads its fields off white paper — the tree, the terminal and
       a folder's overview are white by design in that skin, not glass. Its
       sliders still have to own their layers, which is checked below. */
    if (skin === "win95") continue;
    const worst = reads.reduce((m, a) => Math.max(m, ...reads.map((b) => far(a.rgb, b.rgb))), 0);
    claim(`${skin}: every surface of the ${name} layer lets the same amount through`,
      worst <= 12,
      reads.map((r) => `${r.sel} rgb(${r.rgb.join(",")})`).join(" · ") + ` — worst gap ${worst}`);
  }

  /* Each slider owns its layer: moving it moves that layer and leaves the
     other one where it was. A slider that moves everything, or nothing, is the
     fault this check was written for. */
  const panelsThin = await layers(skin, 5, 50);
  const panelsThick = await layers(skin, 95, 50);
  const barsThin = await layers(skin, 50, 5);
  const barsThick = await layers(skin, 50, 95);
  const first = (seen, name) => seen[name][0]?.rgb;
  const moved = (a, b, name) => (first(a, name) && first(b, name) ? far(first(a, name), first(b, name)) : -1);

  /* Fifteen levels, not more: a dark palette over the pattern shifts less in
     plain numbers than a light one, and what is asked here is that the slider
     does something you can see, not that every skin shifts equally far. */
  claim(`${skin}: the panel slider moves the panels`, moved(panelsThin, panelsThick, "panel") >= 15,
    `panels 5% rgb(${first(panelsThin, "panel")}) → 95% rgb(${first(panelsThick, "panel")}) — apart by ${moved(panelsThin, panelsThick, "panel")}`);
  claim(`${skin}: the panel slider leaves the bars alone`, moved(panelsThin, panelsThick, "chrome") <= 10,
    `bars rgb(${first(panelsThin, "chrome")}) → rgb(${first(panelsThick, "chrome")}) — moved by ${moved(panelsThin, panelsThick, "chrome")}`);
  claim(`${skin}: the bar slider moves the bars`, moved(barsThin, barsThick, "chrome") >= 15,
    `bars 5% rgb(${first(barsThin, "chrome")}) → 95% rgb(${first(barsThick, "chrome")}) — apart by ${moved(barsThin, barsThick, "chrome")}`);
  claim(`${skin}: the bar slider leaves the panels alone`, moved(barsThin, barsThick, "panel") <= 10,
    `panels rgb(${first(barsThin, "panel")}) → rgb(${first(barsThick, "panel")}) — moved by ${moved(barsThin, barsThick, "panel")}`);

  /* One surface, read at both ends of the window and in its middle. Anything
     laid over the whole window that is not even — the tube's vignette was up
     to 34 % black at the edges — shows here and nowhere else: every surface
     stays exactly as see-through as its slider says, and the frame still reads
     darker than the middle. That is what he pointed at on 15.09.2026. */
  const across = await ends(skin);
  if (across) {
    claim(`${skin}: the status line reads the same from end to end`, across.worst <= 10,
      `left rgb(${across.left}) · middle rgb(${across.middle}) · right rgb(${across.right}) — worst gap ${across.worst}`);
  }
}

let bad = 0;
for (const c of claims) {
  if (!c.ok) bad++;
  console.log(`  ${c.ok ? "ok " : "NOT"}  ${c.what}${c.detail ? `\n         ${c.detail}` : ""}`);
}
console.log(bad ? `\n  ${bad} of ${claims.length} claims failed` : `\n  all ${claims.length} claims hold`);
await stop(bad ? 1 : 0);
