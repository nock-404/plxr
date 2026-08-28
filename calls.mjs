/* Check the crossings no compiler sees.

   JavaScript reports a wrong name only once that exact spot is reached at
   runtime — on an error path that can take weeks. `node --check` checks the
   syntax alone and has nothing to say about `api.doesNotExist()`.

   Checking this completely is impossible without scope analysis, and a rough
   attempt produces more false alarms than findings. This is the slice that can
   be done precisely, and the one where the real breaks happen:

     api.*     the collection of daemon calls in app.js
     plxrUI.*  our own controls from ui.js

   Both are collections of methods on one object. Rename one and forget the
   caller and you get "is not a function" at runtime — and with a `?.()` in
   front of it, nothing at all.
*/
import { readFileSync } from 'node:fs';

function withoutText(src) {
  // Strings and comments out; ${…} stays, that is code.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`([^`\\]|\\.)*`/g, (t) =>
      [...t.matchAll(/\$\{([^{}]*)\}/g)].map((m) => m[1]).join(' '))
    .replace(/'(?:[^'\\\n]|\\.)*'/g, ' ')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, ' ');
}

/* The keys of an object literal. Searched from `const name = {` to the
   matching closing brace, so nested objects cannot interfere. */
function keysOf(code, object) {
  const start = code.search(new RegExp(`\\b(?:const|let|var\\s+|window\\.)?${object}\\s*=\\s*\\{`));
  if (start < 0) return null;
  let i = code.indexOf('{', start), depth = 0, end = i;
  for (; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (!depth) { end = i; break; } }
  }
  const body = code.slice(start, end);
  const names = new Set();
  let t = 0;
  // Shorthand too: { colorPicker, bindTips } has neither : nor (
  for (const m of body.matchAll(/[{}]|([A-Za-z_$][\w$]*)\s*(?:[:(]|,|$)/gm)) {
    if (m[0] === '{') { t++; continue; }
    if (m[0] === '}') { t--; continue; }
    if (t === 1 && m[1]) names.add(m[1]);   // top level only
  }
  return names;
}

const sources = process.argv.slice(2).map((f) => ({ f, s: withoutText(readFileSync(f, 'utf8')) }));
const all = sources.map((q) => q.s).join('\n');

let failed = 0;
for (const object of ['api', 'plxrUI']) {
  const present = keysOf(all, object);
  if (!present) { console.log(`  ${object} not found — check skipped`); continue; }

  const called = new Set(
    [...all.matchAll(new RegExp(`\\b${object}\\.([A-Za-z_$][\\w$]*)`, 'g'))].map((m) => m[1]),
  );
  const missing = [...called].filter((n) => !present.has(n)).sort();
  if (missing.length) {
    failed = 1;
    console.log(`  ${object}: ${missing.length} call(s) with no match:`);
    for (const n of missing) console.log(`      ${object}.${n}`);
  } else {
    console.log(`  ${object}: ${called.size} called, all present`);
  }
}

process.exit(failed);
