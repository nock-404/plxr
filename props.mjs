/* Properties assigned to an object literal that never declared them.

   The reason this gate exists: while renaming, `doc.pfad = …` became
   `doc.filePath = …` on one line while the declaration and the reader stayed
   `doc.path`. Saving a file would then have sent `undefined` as the path. The
   same thing happened a second time with `state.aktiv` beside 19 uses of
   `state.active` — one rename, two names, no complaint from anywhere.

   The first version of this check asked "written but never read". That was the
   wrong question: an object passed on as a whole made every property look read,
   and `state` is passed on. The right question is whether the literal ever
   declared that property. A typo and a half-finished rename both fail it.

   No other gate covers this. fields.py checks the seam between Go and
   JavaScript; inside the JavaScript there was nothing.

   Only objects declared here as `const name = { … }` are checked: their shape
   is known. Reading an undeclared property is fine — it may come from the
   daemon; writing one is what goes wrong. */
import { readFileSync } from 'node:fs';

function withoutText(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:[^`\\]|\\.)*`/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, ' ')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, ' ');
}

let failed = 0;
for (const file of process.argv.slice(2)) {
  const src = withoutText(readFileSync(file, 'utf8'));
  const found = [];
  for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g)) {
    const name = m.group ? m.group(1) : m[1];
    // The literal's own keys, top level only.
    let i = src.indexOf('{', m.index), depth = 0, end = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) { end = i; break; } }
    }
    const body = src.slice(src.indexOf('{', m.index) + 1, end);
    const declared = new Set();
    let d = 0;
    for (const k of body.matchAll(/[{}[\]]|([A-Za-z_$][\w$]*)\s*[:,}]/g)) {
      if (k[0] === '{' || k[0] === '[') { d++; continue; }
      if (k[0] === '}' || k[0] === ']') { d--; continue; }
      if (d === 0 && k[1]) declared.add(k[1]);
    }
    if (!declared.size) continue;
    /* Optional fields, deliberately added only when they have a value, and
       handles hung on afterwards. Both are legitimate — the literal shows the
       shape, not the whole life of the object. Named here so a typo next to
       them still stands out. */
    const ALLOWED = { theme: ['fontSize', 'termSize'], entry: ['ro'] };
    for (const w of src.matchAll(new RegExp(`\\b${name}\\.([\\w$]+)\\s*=(?!=)`, 'g'))) {
      if (!declared.has(w[1]) && !(ALLOWED[name] || []).includes(w[1])) found.push(`${name}.${w[1]} — the literal declares ${[...declared].join(', ')}`);
    }
  }
  if (found.length) {
    failed = 1;
    console.log(`  ${file}: ${found.length} propert(ies) assigned but never declared:`);
    for (const f of [...new Set(found)]) console.log(`      ${f}`);
  }
}
if (!failed) console.log('  every assigned property is declared in its literal');
process.exit(failed);
