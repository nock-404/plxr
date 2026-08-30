/* Checks the pure parser functions from app.js without a browser.

   They hang off nothing — no DOM, no state — so they can be pulled out and
   checked one by one. That is the point: the buttons in the inbox now carry the
   real option text, and whether it is cut out correctly should not have to show
   up in the window first. */
import { readFileSync } from 'node:fs';
const src = readFileSync('web/app.js', 'utf8');
const lines = src.split('\n');

// A constant sits on one line; a function runs to the closing brace in
// column 0. Counting braces would trip over regex literals like {1,2}.
function grab(name) {
  const iConst = lines.findIndex((l) => l.startsWith(`const ${name} = `));
  if (iConst >= 0) return lines[iConst];
  const iFn = lines.findIndex((l) => l.startsWith(`function ${name}(`));
  if (iFn < 0) { console.log('  NOT FOUND:', name); return ''; }
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
  { text: '', label: 'Enter' }, { text: '', label: 'Esc' },
];
const mod = new Function('QUICK_REPLIES',
  source + '\nreturn { optionsFrom, quickRepliesFor, isUntamed, hash32, CREST_FALLBACK, inboxGroups };')(QUICK_REPLIES);

const MARKER = '❯';   // the selection marker Claude Code draws

const cases = [
  ['Claude dialog',
   'Do you want to proceed?\n' + MARKER + ' 1. Yes\n  2. No, and tell Claude what to do differently',
   ['1 · Yes', '2 · No, and tell Claude w…']],
  ['bracket form',
   'What colour?\n  1) red\n  2) blue\nChoice>',
   ['1 · red', '2 · blue']],
  ['three options with a marker',
   MARKER + ' 1. Only the test database\n  2. The development database too\n  3. Cancel\nChoice>',
   ['1 · Only the test database', '2 · The development datab…', '3 · Cancel']],
  ['yes/no', 'Overwrite file? (y/n)', ['y · yes', 'n · no']],
  ['no choice', 'What now?', null],
  ['a lone digit is not a choice', 'Error on line\n  1) something', null],
];

let failures = 0;
for (const [name, question, expected] of cases) {
  const got = mod.quickRepliesFor(question).map((b) => b.label);
  const own = got.filter((l) => l !== 'Enter' && l !== 'Esc');
  const want = expected ?? ['1', '2', 'y', 'n'];
  const ok = JSON.stringify(own) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) {
    console.log(`         got:      ${JSON.stringify(own)}`);
    console.log(`         expected: ${JSON.stringify(want)}`);
  }
}

console.log('  --- warning coat ---');
const coats = [
  [{ cmd: ['claude', '--dangerously-skip-permissions'] }, true],
  [{ cmd: ['claude', '--dangerously-skip-permissions=true'] }, true],
  [{ cmd: ['claude'] }, false],
  [{ cmd: ['/bin/zsh', '-l'] }, false],
  [{}, false],
];
for (const [t, want] of coats) {
  const got = mod.isUntamed(t);
  if (got !== want) { failures++; console.log(`  FAIL ${JSON.stringify(t.cmd ?? null)} -> ${got}`); }
  else console.log(`  ok   ${JSON.stringify(t.cmd ?? null)} -> ${got}`);
}

console.log('  --- crest ---');
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
if (dupes > 1) { failures++; console.log(`  FAIL ${dupes} collisions among ${paths.length} paths`); }
else console.log(`  ok   ${dupes} collision(s) among ${paths.length} paths`);

// The same path must always give the same glyph.
if (crestFor('/w/mono') !== crestFor('/w/mono')) { failures++; console.log('  FAIL not deterministic'); }
else console.log('  ok   same path, same glyph');

// And spread reasonably evenly across many paths.
const buckets = new Map();
for (let i = 0; i < 2000; i++) {
  const z = crestFor('/repo/project-' + i);
  buckets.set(z, (buckets.get(z) || 0) + 1);
}
const counts = [...buckets.values()];
const mean = 2000 / glyphs.length;
const skew = Math.max(...counts) / mean;
if (buckets.size < glyphs.length || skew > 1.6) {
  failures++;
  console.log(`  FAIL spreads unevenly: ${buckets.size}/${glyphs.length} glyphs, peak ${skew.toFixed(2)}x`);
} else {
  console.log(`  ok   spreads evenly: all ${buckets.size} glyphs, peak ${skew.toFixed(2)}x`);
}


console.log('  --- room state ---');
// Only three states, and "somebody is waiting" beats everything else: out of
// the corner of your eye finer gradations are no longer distinguishable.
const roomState = ({ running, blocked, orphaned }) =>
  blocked || orphaned ? 'waiting' : (running ? 'working' : 'idle');

const roomCases = [
  [{ running: 0, blocked: 0, orphaned: 0 }, 'idle',    'nothing running'],
  [{ running: 3, blocked: 0, orphaned: 0 }, 'working', 'three working'],
  [{ running: 3, blocked: 1, orphaned: 0 }, 'waiting', 'one asks'],
  [{ running: 0, blocked: 0, orphaned: 2 }, 'waiting', 'orphaned counts as waiting'],
  [{ running: 5, blocked: 2, orphaned: 1 }, 'waiting', 'waiting beats working'],
];
for (const [state, want, name] of roomCases) {
  const got = roomState(state);
  if (got !== want) { failures++; console.log(`  FAIL ${name}: ${got} instead of ${want}`); }
  else console.log(`  ok   ${name} -> ${got}`);
}

console.log('  --- grouped question ---');
/* Grouping happens only for word-for-word identical questions. The most
   expensive mistake imaginable would be pulling two different questions into
   one card: one answer would then go to a session that asked something else.
   So the cases check above all what does NOT come together. */
const F = 'Do you want to proceed?';
const groupCases = [
  ['the same question groups together',
   [{ id: 'a', question: F }, { id: 'b', question: F }, { id: 'c', question: F }],
   [3]],
  ['one filename apart splits them',
   [{ id: 'a', question: 'Edit src/a.go?' }, { id: 'b', question: 'Edit src/b.go?' }],
   [1, 1]],
  ['outer whitespace does not count',
   [{ id: 'a', question: F }, { id: 'b', question: '  ' + F + '\n' }],
   [2]],
  ['without a question each stays on its own',
   [{ id: 'a' }, { id: 'b' }],
   [1, 1]],
  ['activity fills in when question is missing',
   [{ id: 'a', activity: F }, { id: 'b', question: F }],
   [2]],
  ['mixed: two the same, one different',
   [{ id: 'a', question: F }, { id: 'b', question: 'Delete?' }, { id: 'c', question: F }],
   [2, 1]],
];
for (const [name, tiles, want] of groupCases) {
  const got = mod.inboxGroups(tiles).map((g) => g.tiles.length);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.log(`  FAIL ${name}: ${JSON.stringify(got)} instead of ${JSON.stringify(want)}`); }
  else console.log(`  ok   ${name} -> ${JSON.stringify(got)}`);
}

// No tile may be lost: what goes in has to come out.
const every = [{ id: 'a', question: F }, { id: 'b' }, { id: 'c', question: F }, { id: 'd', question: 'X' }];
const inside = mod.inboxGroups(every).flatMap((g) => g.tiles.map((t) => t.id)).sort().join(',');
if (inside !== 'a,b,c,d') { failures++; console.log(`  FAIL tile lost: ${inside}`); }
else console.log('  ok   no tile is lost');

process.exit(failures ? 1 : 0);
