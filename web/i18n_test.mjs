/* Checks the translation tables against the keys the code actually uses.

   A missing key does not crash — t() falls back to English and then to the key
   itself. That is deliberate, but it means a forgotten translation shows up as
   "inbox.empty" on screen and nowhere else. So it gets checked here instead.

   Both directions matter: a key used but not translated leaves the user with a
   raw identifier, and a key translated but never used is dead weight that the
   next person still has to keep in sync. */
import { readFileSync, readdirSync } from 'node:fs';

const tables = {};
for (const f of readdirSync('web/i18n')) {
  if (f.endsWith('.json')) tables[f.replace('.json', '')] = JSON.parse(readFileSync(`web/i18n/${f}`, 'utf8'));
}

const sources = ['web/app.js', 'web/ui.js', 'web/index.html'].map((f) => readFileSync(f, 'utf8')).join('\n');
/* Counted is whatever sits in quotes inside a tr(…) call — including the cases
   with a branch, tr(condition ? 'a' : 'b'). Matching only tr('…') would let
   those fall through; taking every dotted string would catch the localStorage
   keys as well. A test that cries wolf on correct code gets switched off
   instead of read. */
const used = new Set([
  ...[...sources.matchAll(/\btr\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g)]
    /* A key starts with a word character and holds a dot: tr('a.b', { x: '.' + y })
       also carries a bare '.' — and that then counts as a missing translation. */
    .flatMap((m) => [...m[1].matchAll(/['"](\w[\w.]*\.[\w.]+)['"]/g)].map((k) => k[1])),
  ...[...sources.matchAll(/data-i18n(?:-tip|-ph)?="([\w.]+)"/g)].map((m) => m[1]),
]);

/* Keys that go through a variable — the shortcut table holds the key, not the
   text, because tr() at that point would run before the language file is
   loaded, and the labels would freeze in the English fallback.

   These only EXCUSE a key from the unused report, they never demand one. That
   distinction is the whole point: taking every dotted literal as a used key
   turns plxr.theme and every other localStorage name into a missing
   translation. That is exactly what happened when this was first written. */
const mentioned = new Set(
  [...sources.matchAll(/['"]([a-z][\w]*\.[\w.]+)['"]/gi)].map((m) => m[1]),
);

let failed = 0;
const en = tables.en || {};

for (const k of [...used].sort()) {
  if (!(k in en)) { failed = 1; console.log(`  missing from en.json: ${k}`); }
}

for (const [name, tab] of Object.entries(tables)) {
  if (name === 'en') continue;
  const missing = Object.keys(en).filter((k) => !(k in tab)).sort();
  if (missing.length) {
    failed = 1;
    console.log(`  ${name}.json: ${missing.length} keys missing`);
    for (const k of missing.slice(0, 8)) console.log(`      ${k}`);
  }
  const extra = Object.keys(tab).filter((k) => !(k in en)).sort();
  if (extra.length) {
    failed = 1;
    console.log(`  ${name}.json: ${extra.length} keys do not exist in en.json`);
    for (const k of extra.slice(0, 8)) console.log(`      ${k}`);
  }
}

// Placeholders have to be the same in every language, otherwise one drops out.
for (const [name, tab] of Object.entries(tables)) {
  for (const [k, v] of Object.entries(tab)) {
    if (!(k in en)) continue;
    const a = [...String(en[k]).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    const b = [...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    if (a !== b) { failed = 1; console.log(`  ${name}.json ${k}: placeholders {${b}} instead of {${a}}`); }
  }
}

/* Keys under err. are not used from here: Go sends the code, errText() turns
   it into a sentence. errors.py checks those against the Go side, in both
   directions. */
const unused = Object.keys(en).filter((k) => !k.startsWith('_') && !k.startsWith('err.') && !used.has(k) && !mentioned.has(k));
if (unused.length) {
  failed = 1;
  console.log(`  ${unused.length} keys in en.json are used nowhere:`);
  for (const k of unused.slice(0, 8)) console.log(`      ${k}`);
}

/* And: is there still German text hard-wired into the source?

   The first round looked for umlauts and articles — "Session wartet auf dich"
   has neither and stood there for months. Hence a word list that aims at the
   language, not at its special characters.

   The second round let "Escape senden" through: no umlaut, no article, no word
   from the list. And it never looked at template strings at all, although half
   the tooltips live there. So: verbs and nouns added that really do occur in
   user interfaces, and backticks read along — without the ${…}, that is code.

   The list below stays German on purpose. It is not prose, it is the
   vocabulary being searched for — translating it would make the check useless.
   Same reasoning as for the language files themselves. */
const GERMAN = /\b(auf|dich|wartet|warten|laeuft|laufen|kein|keine|nichts|noch|schon|mehr|gibt|steht|wird|werden|beendet|Fassung|Konto|von|bis|aktiv|angehalten|fortgesetzt|Datei|Dateien|Verzeichnis|der|die|das|und|ist|nicht|damit|eine|senden|gesendet|oeffnen|geoeffnet|schliessen|speichern|gespeichert|loeschen|geloescht|abbrechen|Abbruch|Antwort|Antworten|Frage|Fragen|Eingabe|Eingabetaste|Taste|Sitzung|Fenster|Zeile|Zeilen|Ordner|Einstellungen|waehlen|Auswahl|neu|alle|mit|fuer|zum|zur|bei|dem|den|kann|muss|soll|hier|dort|jetzt|wieder|wurde|haben|hat)\b|[äöüßÄÖÜ]/;
/* No HTML entities in the values.

   The texts are set with textContent, and textContent decodes nothing: on
   screen "path&gt;" comes out literally as path&gt;. That is exactly what
   happened — while the texts moved from the HTML into the tables the entities
   travelled with them, twelve of them, and nobody saw it. */
const entities = [];
for (const [language, table] of Object.entries(tables)) {
  for (const [k, v] of Object.entries(table)) {
    if (typeof v === 'string' && /&(?:[a-zA-Z]+|#\d+);/.test(v)) entities.push(`${language}: ${k} = ${v}`);
  }
}
if (entities.length) {
  failed = 1;
  console.log(`  ${entities.length} translations contain HTML entities (textContent does not decode those):`);
  for (const e of entities) console.log(`      ${e}`);
}

const jsSources = ['web/app.js', 'web/ui.js'].map((f) => [f, readFileSync(f, 'utf8')]);
const germanLeft = [];
for (const [file, src] of jsSources) {
  const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  // Template strings without their substitutions: `„${x}" senden` is text.
  const withTemplates = withoutComments.replace(/`([^`\\]|\\.)*`/g,
    (t) => "'" + t.slice(1, -1).replace(/\$\{[^{}]*\}/g, ' ').replace(/['\\\n]/g, ' ') + "'");
  for (const m of withTemplates.matchAll(/'([^'\\\n]{6,})'|"([^"\\\n]{6,})"/g)) {
    const txt = m[1] || m[2];
    // Selectors, keys, headers and class names are not text.
    if (/^[\w.#\[\]=-]+$/.test(txt) || txt.startsWith('X-') || txt.includes('/')) continue;
    // Naive quote pairing also catches code between two strings. Whatever
    // looks like code is not text.
    if (/=>|&&|\|\||\$\{|\bdata-\w+=|===|\?|\btr\(/.test(txt)) continue;
    if (GERMAN.test(txt)) germanLeft.push(`${file}: ${txt.slice(0, 60)}`);
  }
}
/* Whatever goes on screen has to pass through tr().

   The word list above is a fixed vocabulary and catches only what someone put
   into it: "liest …", "Ein lauschender Port" and "Transkripte" slipped past it
   and were visible for years. This check does not ask about the language but
   about the origin — a string that gets set as text without having gone
   through tr() cannot be translated, no matter how it sounds. It catches
   English texts a later hand writes in, too. */
/* Building blocks without a translation: units, identifiers, prefixes. They
   sit in the code because they are called the same in every language, not
   because somebody forgot them.

   When in doubt a string does NOT belong here — that is exactly how the next
   German leftover disappears from view. Every entry has its reason. */
const NOT_TEXT = new Set([
  'claude-',   // prefix cut off when a model name is shortened
  'kB',        // unit
  'pid',       // identifier, called that everywhere
  ', pid',     // the same identifier with a separator
  'shell',     // id of a built-in template, not text
  'Claude Code', // product name, not translated
  'plxr',      // our own name
  ' MB',       // unit
  '·  MB',     // the same unit inside a template
]);

const TARGETS = /(?:\.textContent\s*=|\.placeholder\s*=|plxrUI\.notice\(|plxrUI\.confirm\(|showEmpty\()/g;
const unfiltered = [];
for (const [file, src] of jsSources) {
  const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  for (const m of withoutComments.matchAll(TARGETS)) {
    // The expression up to the end of the statement.
    const rest = withoutComments.slice(m.index + m[0].length, m.index + m[0].length + 400);
    /* Cut at the first semicolon, not after four lines: the window reached
       past the end of the statement and reported the 'click' of the next
       addEventListener as untranslated text. */
    const expression = rest.split(';')[0].split('\n').slice(0, 4).join('\n');
    /* Cut the tr(…) calls out instead of skipping the whole expression.
       Before, ONE tr() anywhere in the call was enough and the second text was
       invisible: plxrUI.notice(tr('brake.nothingRunning'), 'Nichts anzuhalten')
       slipped through that way for years. */
    const withoutTr = expression.replace(/\btr\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, ' ');
    for (const lit of withoutTr.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`]*)`/g)) {
      const txt = (lit[1] ?? lit[2] ?? lit[3] ?? '').replace(/\$\{[^{}]*\}/g, '');
      if (!/[A-Za-zÄÖÜäöü]{2,}/.test(txt)) continue;      // '', '·', '%' are not text
      if (/^#[A-Za-z][\w-]*$/.test(txt.trim())) continue; // '#brake' is a selector, not text
      if (NOT_TEXT.has(txt.trim())) continue;
      unfiltered.push(`${file}: ${txt.trim().slice(0, 50)}`);
      break;
    }
  }
}
if (unfiltered.length) {
  failed = 1;
  console.log(`  ${unfiltered.length} texts go on screen without tr():`);
  for (const t of unfiltered) console.log(`      ${t}`);
}

if (germanLeft.length) {
  failed = 1;
  console.log(`  ${germanLeft.length} German texts are still hard-wired in the source:`);
  for (const r of germanLeft.slice(0, 10)) console.log(`      ${r}`);
}

/* Is the translation function being shadowed?

   It used to be called t(). But in app.js nearly every tile in nearly every
   loop is called t as well — and `for (const t of list)` shadows the function
   silently. `t('inbox.open')` then calls an object as a function and throws,
   but only once that exact loop runs. Hence it is now called tr(), and every
   remaining t('…') call is either a leftover or precisely that bug. */
const shadowed = [...jsSources]
  .flatMap(([file, src]) => [...src.matchAll(/(?<![.\w$])t\(\s*['"]/g)].map(() => file));
if (shadowed.length) {
  failed = 1;
  console.log(`  ${shadowed.length} call(s) of t('…') — the function is called tr()`);
  for (const d of [...new Set(shadowed)]) console.log(`      ${d}`);
}

if (!failed) {
  console.log(`  ${used.size} keys, ${Object.keys(tables).length} languages, complete`);
}
process.exit(failed);
