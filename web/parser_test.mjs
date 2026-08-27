/* Checks the pure parser functions from app.js without a browser.

   They hang off nothing — no DOM, no state — so they can be pulled out and
   checked one by one. That is the point: the buttons in the inbox now carry the
   real option text, and whether it is cut out correctly should not have to show
   up in the window first. */
import { readFileSync } from 'node:fs';
const src = readFileSync('web/app.js', 'utf8');
const lines = src.split('\n');

// A constant sits on one line, a function runs to the closing brace in
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
  'CREST_FALLBACK', 'hash32', 'questionKey', 'inboxGroups']
  .map(grab).join('\n');

const QUICK_REPLIES = [
  { text: '1', label: '1' }, { text: '2', label: '2' },
  { text: 'y', label: 'y' }, { text: 'n', label: 'n' },
  { text: '', label: 'Eingabe' }, { text: '', label: 'Esc' },
];
const mod = new Function('QUICK_REPLIES',
  source + '\nreturn { optionsFrom, quickRepliesFor, isUntamed, hash32, CREST_FALLBACK, inboxGroups };')(QUICK_REPLIES);

const MARKER = '❯';   // the selection marker Claude Code draws

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
// Without a window there is no getComputedStyle — what is checked here is the
// fallback set, that is exactly what a skin without its own glyphs gets.
const glyphs = [...mod.CREST_FALLBACK];
const crestFor = (p) => glyphs[mod.hash32(p) % glyphs.length];

// Six worktrees of the same monorepo — precisely the case this exists for.
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


console.log('  --- Raumzustand ---');
// Nur drei Zustaende, und "jemand wartet" schlaegt alles andere: aus dem
// Augenwinkel sind feinere Abstufungen nicht mehr unterscheidbar.
const lage = ({ laufen, blockiert, verwaist }) =>
  blockiert || verwaist ? 'waiting' : (laufen ? 'working' : 'idle');

const roomCases = [
  [{ laufen: 0, blockiert: 0, verwaist: 0 }, 'idle',    'nichts laeuft'],
  [{ laufen: 3, blockiert: 0, verwaist: 0 }, 'working', 'drei arbeiten'],
  [{ laufen: 3, blockiert: 1, verwaist: 0 }, 'waiting', 'einer fragt'],
  [{ laufen: 0, blockiert: 0, verwaist: 2 }, 'waiting', 'verwaist zaehlt wie wartend'],
  [{ laufen: 5, blockiert: 2, verwaist: 1 }, 'waiting', 'wartend schlaegt arbeitend'],
];
for (const [zustand, want, name] of roomCases) {
  const got = lage(zustand);
  if (got !== want) { failures++; console.log(`  FEHL ${name}: ${got} statt ${want}`); }
  else console.log(`  ok   ${name} -> ${got}`);
}

console.log('  --- Sammelfrage ---');
/* Zusammengefasst wird nur bei woertlich gleicher Frage. Der teuerste
   denkbare Fehler waere, zwei verschiedene Fragen in eine Karte zu ziehen:
   dann geht eine Antwort an eine Session, die etwas anderes gefragt hat.
   Deshalb pruefen die Faelle vor allem, was NICHT zusammenkommt. */
const F = 'Do you want to proceed?';
const groupCases = [
  ['gleiche Frage kommt zusammen',
   [{ id: 'a', confirm: F }, { id: 'b', confirm: F }, { id: 'c', confirm: F }],
   [3]],
  ['ein Dateiname Unterschied trennt',
   [{ id: 'a', confirm: 'Edit src/a.go?' }, { id: 'b', confirm: 'Edit src/b.go?' }],
   [1, 1]],
  ['Leerraum aussen zaehlt nicht',
   [{ id: 'a', confirm: F }, { id: 'b', confirm: '  ' + F + '\n' }],
   [2]],
  ['ohne Frage bleibt jede fuer sich',
   [{ id: 'a' }, { id: 'b' }],
   [1, 1]],
  ['activity springt ein, wenn confirm fehlt',
   [{ id: 'a', activity: F }, { id: 'b', confirm: F }],
   [2]],
  ['gemischt: zwei gleiche, eine andere',
   [{ id: 'a', confirm: F }, { id: 'b', confirm: 'Delete?' }, { id: 'c', confirm: F }],
   [2, 1]],
];
for (const [name, tiles, want] of groupCases) {
  const got = mod.inboxGroups(tiles).map((g) => g.tiles.length);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.log(`  FEHL ${name}: ${JSON.stringify(got)} statt ${JSON.stringify(want)}`); }
  else console.log(`  ok   ${name} -> ${JSON.stringify(got)}`);
}

// Keine Kachel darf verlorengehen: was rein geht, muss auch raus kommen.
const alle = [{ id: 'a', confirm: F }, { id: 'b' }, { id: 'c', confirm: F }, { id: 'd', confirm: 'X' }];
const drin = mod.inboxGroups(alle).flatMap((g) => g.tiles.map((t) => t.id)).sort().join(',');
if (drin !== 'a,b,c,d') { failures++; console.log(`  FEHL Kachel verloren: ${drin}`); }
else console.log('  ok   keine Kachel geht verloren');

process.exit(failures ? 1 : 0);
