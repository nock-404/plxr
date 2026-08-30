/* Does the workbench actually record?
 *
 * What is checked here is the half that matters and that no eye can see: does
 * a console error, a failed request and a stylesheet that never arrives all
 * end up in the log. The drawing is not covered — that needs a real window.
 *
 * The trick with readyState: as long as the document claims to be loading, the
 * panel defers building itself. So the recording can be exercised without
 * having to fake a whole DOM.
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'devpanel.js'), 'utf8');

let failed = 0;
const check = (condition, what) => {
  if (!condition) { console.error(`  FAILED: ${what}`); failed = 1; }
};

/* ---- the smallest window the panel is happy with ---- */

const listeners = { window: {}, document: {} };
const realFetchCalls = [];

const sandbox = {
  performance: { now: () => 0 },
  navigator: { userAgent: 'test' },
  location: { href: 'wails://wails/' },
  console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
  setTimeout, clearTimeout,
  JSON, Date, Math, String, Number, Object, Array, Error, Promise,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.document = {
  readyState: 'loading',            // keeps the panel from building itself
  documentElement: { dataset: {}, lang: 'de' },
  styleSheets: [],
  getElementById: () => null,
  addEventListener: (name, fn) => { (listeners.document[name] ||= []).push(fn); },
};
sandbox.addEventListener = (name, fn) => { (listeners.window[name] ||= []).push(fn); };
sandbox.fetch = async (url) => {
  realFetchCalls.push(url);
  if (String(url).includes('missing')) return { ok: false, status: 404 };
  if (String(url).includes('boom')) throw new Error('network down');
  return { ok: true, status: 200 };
};

const ctx = createContext(sandbox);
runInContext(source, ctx);

const dbg = sandbox.plxrDebug;
check(dbg && typeof dbg.dump === 'function', 'plxrDebug.dump is missing');

const texts = () => dbg.entries.map((e) => `${e.where}/${e.kind} ${e.text}`);

/* 1. A console error has to be recorded — and passed through. */
sandbox.console.error('something broke');
check(texts().some((t) => t.startsWith('console/error') && t.includes('something broke')),
  'console.error does not reach the log');

/* 2. A 404 does not throw. Precisely the case that stayed invisible today. */
await sandbox.fetch('/i18n/de.json?missing');
check(texts().some((t) => t.startsWith('fetch/bad') && t.includes('404')),
  '404 is not recorded as an error');

/* 3. A request that dies has to be visible as well. */
await sandbox.fetch('/api/boom').catch(() => {});
check(texts().some((t) => t.includes('network down')), 'aborted call is missing');

/* 4. A stylesheet that never arrives. This one has no other trace anywhere. */
for (const fn of listeners.window.error || []) {
  fn({ target: { tagName: 'LINK', href: '/skins/crt/skin.css' } });
}
check(texts().some((t) => t.startsWith('load/bad') && t.includes('skin.css')),
  'a stylesheet that failed to load is not recorded');

/* 5. An ordinary success stays visible too, otherwise the network tab lies. */
await sandbox.fetch('/api/themes');
check(texts().some((t) => t.startsWith('fetch/net') && t.includes('200')),
  'successful call is missing');

/* 6. The original fetch keeps being called — the hook must not swallow. */
check(realFetchCalls.length === 3, `fetch was ${realFetchCalls.length}× passed through, expected 3`);

/* 7. dump() has to carry both halves, that is what gets pasted into a report. */
const text = dbg.dump();
check(text.includes('── state ──') && text.includes('skin.css'), 'dump() is incomplete');

/* 8. Counter-test: without a fault nothing may be reported as one. */
const before = dbg.entries.filter((e) => e.kind === 'bad' || e.kind === 'error').length;
sandbox.console.log('alles gut');
const after = dbg.entries.filter((e) => e.kind === 'bad' || e.kind === 'error').length;
check(before === after, 'a harmless message was counted as an error');

/* 9. Under no circumstances may it take itself apart. Without a DOM there is
   nothing to draw — it still has to record, and opening then has to do nothing
   rather than throw. It failed at exactly that once already, when the
   self-announcement what added. */
let threw = null;
try { dbg.open(); dbg.close(); dbg.toggle(); } catch (e) { threw = e; }
check(!threw, `opening without a DOM threw: ${threw && threw.message}`);

/* And afterwards it keeps recording — a half-dead recorder would be the worst
   of both. */
sandbox.console.error('still here afterwards');
check(texts().some((t) => t.includes('still here afterwards')), 'recording stops after opening');

/* The count has to point at the tab the entry is actually on. A failed request
   used to raise the number on the console tab, and the console was empty. */
const netErrors = dbg.entries.filter((e) => e.where === 'fetch' && (e.kind === 'bad' || e.kind === 'error')).length;
const otherErrors = dbg.entries.filter((e) => e.where !== 'fetch' && (e.kind === 'bad' || e.kind === 'error')).length;
check(netErrors > 0 && otherErrors > 0,
  `the test itself produced no errors of both kinds (${netErrors} network, ${otherErrors} other)`);
check(netErrors + otherErrors ===
  dbg.entries.filter((e) => e.kind === 'bad' || e.kind === 'error').length,
  'the two counts do not add up to the whole');

if (failed) { console.error('  workbench: FAILED'); process.exit(1); }
console.log(`  workbench records (${dbg.entries.length} entries, 10 checks)`);
