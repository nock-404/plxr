/* Prueft die reinen Parser-Funktionen aus app.js ohne Browser.

   Sie haengen an nichts — kein DOM, kein Zustand —, also lassen sie sich
   herausziehen und einzeln pruefen. Genau das ist der Punkt: die Knoepfe im
   Posteingang tragen jetzt den echten Optionstext, und ob der richtig
   herausgeschnitten wird, want nicht erst im Fenster auffallen. */
import { readFileSync } from 'node:fs';
const src = readFileSync('web/app.js', 'utf8');
const lines = src.split('\n');

// Eine Konstante steht auf einer Zeile, eine Funktion geht bis zur schliessenden
// Klammer in Spalte 0. Klammern zu zaehlen scheitert an Regex-Literalen wie {1,2}.
function grab(name) {
  const iConst = lines.findIndex((l) => l.startsWith(`const ${name} = `));
  if (iConst >= 0) return lines[iConst];
  const iFn = lines.findIndex((l) => l.startsWith(`function ${name}(`));
  if (iFn < 0) { console.log('  NICHT GEFUNDEN:', name); return ''; }
  let end = iFn + 1;
  while (end < lines.length && lines[end] !== '}') end++;
  return lines.slice(iFn, end + 1).join('\n');
}

const source = ['OPTION_LINE', 'shorten', 'optionsFrom', 'yesNoFrom', 'quickRepliesFor', 'isUntamed',
  'CREST_FALLBACK', 'hash32']
  .map(grab).join('\n');

const QUICK_REPLIES = [
  { text: '1', label: '1' }, { text: '2', label: '2' },
  { text: 'y', label: 'y' }, { text: 'n', label: 'n' },
  { text: '', label: 'Eingabe' }, { text: '', label: 'Esc' },
];
const mod = new Function('QUICK_REPLIES',
  source + '\nreturn { optionsFrom, quickRepliesFor, isUntamed, hash32, CREST_FALLBACK };')(QUICK_REPLIES);

const MARKER = '❯';   // die Auswahlmarke, die Claude Code setzt

const cases = [
  ['Claude-Dialog',
   'Do you want to proceed?\n' + MARKER + ' 1. Yes\n  2. No, and tell Claude what to do differently',
   ['1 · Yes', '2 · No, and tell Claude w…']],
  ['Klammerform',
   'Welche Farbe?\n  1) rot\n  2) blau\nAuswahl>',
   ['1 · rot', '2 · blau']],
  ['drei Optionen mit Marke',
   MARKER + ' 1. Nur die Testdatenbank\n  2. Auch die Entwicklungsdatenbank\n  3. Abbrechen\nAuswahl>',
   ['1 · Nur die Testdatenbank', '2 · Auch die Entwicklungs…', '3 · Abbrechen']],
  ['ja/nein', 'Datei ueberschreiben? (y/n)', ['y · ja', 'n · nein']],
  ['keine Auswahl', 'Was want ich tun?', null],
  ['nur eine Ziffer ist keine Auswahl', 'Fehler in Zeile\n  1) irgendwas', null],
];

let failures = 0;
for (const [name, question, expected] of cases) {
  const got = mod.quickRepliesFor(question).map((b) => b.label);
  const own = got.filter((l) => l !== 'Eingabe' && l !== 'Esc');
  const want = expected ?? ['1', '2', 'y', 'n'];
  const ok = JSON.stringify(own) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FEHL'} ${name}`);
  if (!ok) {
    console.log(`         bekommen: ${JSON.stringify(own)}`);
    console.log(`         expected: ${JSON.stringify(want)}`);
  }
}

console.log('  --- Warnkleid ---');
const coats = [
  [{ cmd: ['claude', '--dangerously-skip-permissions'] }, true],
  [{ cmd: ['claude', '--dangerously-skip-permissions=true'] }, true],
  [{ cmd: ['claude'] }, false],
  [{ cmd: ['/bin/zsh', '-l'] }, false],
  [{}, false],
];
for (const [t, want] of coats) {
  const got = mod.isUntamed(t);
  if (got !== want) { failures++; console.log(`  FEHL ${JSON.stringify(t.cmd ?? null)} -> ${got}`); }
  else console.log(`  ok   ${JSON.stringify(t.cmd ?? null)} -> ${got}`);
}

console.log('  --- Wappen ---');
// Ohne Fenster gibt es kein getComputedStyle — hier wird der Ersatzvorrat
// geprueft, also genau das, was ein Skin ohne own Zeichen bekommt.
const glyphs = [...mod.CREST_FALLBACK];
const crestFor = (p) => glyphs[mod.hash32(p) % glyphs.length];

// Sechs Worktrees desselben Monorepos — genau der Fall, crestFor den es das gibt.
const paths = [
  '/w/mono', '/w/mono2', '/w/mono-feature-a', '/w/mono-feature-b',
  '/w/mono/apps/web', '/w/mono/apps/api',
];
const used = paths.map(crestFor);
const dupes = used.length - new Set(used).size;
console.log('  ' + paths.map((p, i) => `${used[i]} ${p}`).join('\n  '));
if (dupes > 1) { failures++; console.log(`  FEHL ${dupes} Kollisionen unter ${paths.length} Pfaden`); }
else console.log(`  ok   ${dupes} Kollision(en) bei ${paths.length} Pfaden`);

// Derselbe Pfad muss immer dasselbe Zeichen ergeben.
if (crestFor('/w/mono') !== crestFor('/w/mono')) { failures++; console.log('  FEHL nicht deterministisch'); }
else console.log('  ok   derselbe Pfad, dasselbe Zeichen');

// Und ueber viele Pfade halbwegs gleichmaessig streuen.
const buckets = new Map();
for (let i = 0; i < 2000; i++) {
  const z = crestFor('/repo/projekt-' + i);
  buckets.set(z, (buckets.get(z) || 0) + 1);
}
const counts = [...buckets.values()];
const mean = 2000 / glyphs.length;
const skew = Math.max(...counts) / mean;
if (buckets.size < glyphs.length || skew > 1.6) {
  failures++;
  console.log(`  FEHL streut ungleich: ${buckets.size}/${glyphs.length} Zeichen, Spitze ${skew.toFixed(2)}x`);
} else {
  console.log(`  ok   streut gleichmaessig: alle ${buckets.size} Zeichen, Spitze ${skew.toFixed(2)}x`);
}

process.exit(failures ? 1 : 0);
