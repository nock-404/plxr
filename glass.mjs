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

/* The grounds that have to follow the slider: the strip the tabs sit in, a
   document of main filling its panel, and the stripes at the edges. */
const READ = `(() => {
  const alphaOf = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const c = getComputedStyle(el).backgroundColor;
    const m = c.match(/([0-9.]+)\\s*\\)$/);
    if (/^rgba?\\(/.test(c)) return c.startsWith("rgba(") ? Number(m?.[1] ?? 1) : 1;
    if (/^color\\(/.test(c)) return c.includes("/") ? Number(m?.[1] ?? 1) : 1;
    return c === "transparent" ? 0 : 1;
  };
  return {
    tabs: alphaOf('.plxrDock .dv-tabs-container'),
    doc: alphaOf('.overviewPanel'),
    stripe: alphaOf('.stripe[data-edge="left"]'),
    field: alphaOf('.viewerwrap'),
    skin: document.documentElement.dataset.skin ?? "",
    solid: getComputedStyle(document.documentElement).getPropertyValue('--panelSolid').trim(),
  };
})()`;

async function look(skin, panelSolid) {
  const prefs = await api("/api/prefs").then((r) => r.json()).catch(() => ({}));
  const theme = { ...(prefs.theme ?? {}), skin, seethrough: true, panelSolid };
  await api("/api/prefs", { method: "PUT", body: JSON.stringify({ ...prefs, theme }) });
  for (let i = 0; i < 20; i++) {
    const seen = await run(READ);
    if (seen && seen.skin === skin && seen.solid === `${panelSolid}%`) return seen;
    await sleep(250);
  }
  return await run(READ);
}

const near = (value, want) => value !== null && Math.abs(value - want) <= 0.02;

for (const skin of SKINS) {
  const thin = await look(skin, THIN);
  const thick = await look(skin, THICK);
  const grounds = [["the tab strip", "tabs"], ["a document of main", "doc"], ["the stripe at the edge", "stripe"]];
  for (const [name, key] of grounds) {
    // A stripe with nothing behind it may be drawn fully transparent by a skin;
    // what must never happen is a ground that ignores the slider.
    const thinOk = near(thin[key], THIN / 100) || thin[key] === 0;
    const thickOk = near(thick[key], THICK / 100) || thick[key] === 0;
    claim(
      `${skin}: ${name} carries the solidity the slider is set to`,
      thinOk && thickOk,
      `at ${THIN}% alpha ${thin[key]} · at ${THICK}% alpha ${thick[key]}`,
    );
  }
  claim(
    `${skin}: the slider moves the ground, it is not painted flat`,
    thin.doc !== null && thick.doc !== null && (thin.doc === 0 ? thick.doc === 0 : Math.abs(thick.doc - thin.doc) > 0.5),
    `document ground ${thin.doc} → ${thick.doc}`,
  );
}

/* The other half, the one the readability fix bought: Windows 95 reads its
   documents off a white field, and that field is opaque whatever the slider
   says. Without it the fix of 0.79.0 would be undone here. */
await look("win95", THIN);
// The field only exists where a document with text is open: the notes are one.
await run(`(() => { ${GATEKIT} return openTool('notes'); })()`).catch(() => false);
await sleep(900);
const win95 = await run(READ);
claim(
  "win95: the field a document's text is read off stays opaque at 5%",
  win95.field === 1,
  `.viewerwrap alpha ${win95.field}`,
);

// Put the window back the way it was found: a tool left open is not what the
// next check expects.
await run(`(() => { ${GATEKIT} return openTool('notes'); })()`).catch(() => false);

let bad = 0;
for (const c of claims) {
  if (!c.ok) bad++;
  console.log(`  ${c.ok ? "ok " : "NOT"}  ${c.what}${c.detail ? `\n         ${c.detail}` : ""}`);
}
console.log(bad ? `\n  ${bad} of ${claims.length} claims failed` : `\n  all ${claims.length} claims hold`);
await stop(bad ? 1 : 0);
