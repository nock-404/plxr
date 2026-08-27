/* Does the Werkbank actually record?
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

let fehler = 0;
const pruefe = (bedingung, was) => {
  if (!bedingung) { console.error(`  FEHLER: ${was}`); fehler = 1; }
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
pruefe(dbg && typeof dbg.dump === 'function', 'plxrDebug.dump fehlt');

const texte = () => dbg.entries.map((e) => `${e.where}/${e.kind} ${e.text}`);

/* 1. A console error has to be recorded — and passed through. */
sandbox.console.error('kaputt hier');
pruefe(texte().some((t) => t.startsWith('console/error') && t.includes('kaputt hier')),
  'console.error landet nicht im Protokoll');

/* 2. A 404 does not throw. Precisely the case that stayed invisible today. */
await sandbox.fetch('/i18n/de.json?missing');
pruefe(texte().some((t) => t.startsWith('fetch/bad') && t.includes('404')),
  '404 wird nicht als Fehler vermerkt');

/* 3. A request that dies has to be visible as well. */
await sandbox.fetch('/api/boom').catch(() => {});
pruefe(texte().some((t) => t.includes('network down')), 'abgebrochener Aufruf fehlt');

/* 4. A stylesheet that never arrives. This one has no other trace anywhere. */
for (const fn of listeners.window.error || []) {
  fn({ target: { tagName: 'LINK', href: '/skins/crt/skin.css' } });
}
pruefe(texte().some((t) => t.startsWith('load/bad') && t.includes('skin.css')),
  'nicht geladenes Stylesheet wird nicht vermerkt');

/* 5. An ordinary success stays visible too, otherwise the network tab lies. */
await sandbox.fetch('/api/themes');
pruefe(texte().some((t) => t.startsWith('fetch/net') && t.includes('200')),
  'erfolgreicher Aufruf fehlt');

/* 6. The original fetch keeps being called — the hook must not swallow. */
pruefe(realFetchCalls.length === 3, `fetch wurde ${realFetchCalls.length}× durchgereicht, erwartet 3`);

/* 7. dump() has to carry both halves, that is what gets pasted into a report. */
const text = dbg.dump();
pruefe(text.includes('── state ──') && text.includes('skin.css'), 'dump() ist unvollständig');

/* 8. Counter-test: without a fault nothing may be reported as one. */
const vorher = dbg.entries.filter((e) => e.kind === 'bad' || e.kind === 'error').length;
sandbox.console.log('alles gut');
const nachher = dbg.entries.filter((e) => e.kind === 'bad' || e.kind === 'error').length;
pruefe(vorher === nachher, 'eine harmlose Meldung wurde als Fehler gezählt');

/* 9. Sie darf sich unter keinen Umständen selbst zerlegen. Ohne DOM gibt es
   nichts zu zeichnen — aufzeichnen muss sie trotzdem, und öffnen darf dann
   eben nichts tun statt zu werfen. Genau daran ist sie schon einmal
   gescheitert, als die Selbstmeldung dazukam. */
let warf = null;
try { dbg.open(); dbg.close(); dbg.toggle(); } catch (e) { warf = e; }
pruefe(!warf, `öffnen ohne DOM hat geworfen: ${warf && warf.message}`);

/* Und danach zeichnet sie weiter auf — ein halb gestorbener Rekorder wäre das
   Schlimmste von beidem. */
sandbox.console.error('danach noch da');
pruefe(texte().some((t) => t.includes('danach noch da')), 'nach dem Öffnen wird nicht weiter aufgezeichnet');

if (fehler) { console.error('  Werkbank: FEHLGESCHLAGEN'); process.exit(1); }
console.log(`  Werkbank zeichnet auf (${dbg.entries.length} Einträge, 10 Prüfungen)`);
