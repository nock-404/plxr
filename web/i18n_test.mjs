/* Checks the translation tables against the keys the code actually uses.

   A missing key does not crash — t() falls back to English and then to the key
   itself. That is deliberate, but it means a forgotten translation shows up as
   "inbox.empty" on screen and nowhere else. So it gets checked here instead.

   Both directions matter: a key used but not translated leaves the user with a
   raw identifier, and a key translated but never used is dead weight that the
   next person still has to keep in sync. */
import { readFileSync, readdirSync } from 'node:fs';

const tabellen = {};
for (const f of readdirSync('web/i18n')) {
  if (f.endsWith('.json')) tabellen[f.replace('.json', '')] = JSON.parse(readFileSync(`web/i18n/${f}`, 'utf8'));
}

const quellen = ['web/app.js', 'web/ui.js', 'web/index.html'].map((f) => readFileSync(f, 'utf8')).join('\n');
const benutzt = new Set([
  ...[...quellen.matchAll(/\bt\(\s*'([\w.]+)'/g)].map((m) => m[1]),
  ...[...quellen.matchAll(/\bt\(\s*"([\w.]+)"/g)].map((m) => m[1]),
  ...[...quellen.matchAll(/data-i18n(?:-tip|-ph)?="([\w.]+)"/g)].map((m) => m[1]),
]);

let fehler = 0;
const en = tabellen.en || {};

for (const k of [...benutzt].sort()) {
  if (!(k in en)) { fehler = 1; console.log(`  fehlt in en.json: ${k}`); }
}

for (const [name, tab] of Object.entries(tabellen)) {
  if (name === 'en') continue;
  const fehlend = Object.keys(en).filter((k) => !(k in tab)).sort();
  if (fehlend.length) {
    fehler = 1;
    console.log(`  ${name}.json: ${fehlend.length} Schluessel fehlen`);
    for (const k of fehlend.slice(0, 8)) console.log(`      ${k}`);
  }
  const zuviel = Object.keys(tab).filter((k) => !(k in en)).sort();
  if (zuviel.length) {
    fehler = 1;
    console.log(`  ${name}.json: ${zuviel.length} Schluessel gibt es in en.json nicht`);
    for (const k of zuviel.slice(0, 8)) console.log(`      ${k}`);
  }
}

// Platzhalter muessen in jeder Sprache dieselben sein, sonst faellt einer weg.
for (const [name, tab] of Object.entries(tabellen)) {
  for (const [k, v] of Object.entries(tab)) {
    if (!(k in en)) continue;
    const a = [...String(en[k]).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    const b = [...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    if (a !== b) { fehler = 1; console.log(`  ${name}.json ${k}: Platzhalter {${b}} statt {${a}}`); }
  }
}

const ungenutzt = Object.keys(en).filter((k) => !k.startsWith('_') && !benutzt.has(k));
if (ungenutzt.length) {
  fehler = 1;
  console.log(`  ${ungenutzt.length} Schluessel in en.json werden nirgends benutzt:`);
  for (const k of ungenutzt.slice(0, 8)) console.log(`      ${k}`);
}

if (!fehler) {
  console.log(`  ${benutzt.size} Schluessel, ${Object.keys(tabellen).length} Sprachen, vollstaendig`);
}
process.exit(fehler);
