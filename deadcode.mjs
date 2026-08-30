/* Code that can never run.

   The reason this exists: applyTheme() was changed to hand back a promise, and
   the four lines below it — the ones that write down which theme was chosen —
   became unreachable from that moment. Nothing failed. The theme applied at
   once and was gone at the next start, every time, and it looked like a bug in
   whatever had most recently been touched.

   No other gate sees this. node --check parses it happily, the property check
   sees an assignment that looks fine, and the browser run cannot tell a
   setting that was never saved from one that was saved and not read.

   The rule is narrow on purpose: a `return` at some indentation, followed at
   the SAME indentation by a statement, before the block closes. That is the
   shape the accident takes. Deliberate dead code does not occur here, and if
   it ever does it belongs behind a comment rather than in a gate.
*/
import { readFileSync } from 'node:fs';

let failed = 0;

for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line.startsWith('/*') && !line.includes('*/')) { inBlockComment = true; continue; }

    const ret = raw.match(/^(\s*)return\b/);
    if (!ret) continue;
    const indent = ret[1].length;

    /* Walk on until the block closes. Anything at the same indentation that is
       not a closing brace, a comment or blank can no longer be reached. */
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      const text = next.trim();
      if (!text) continue;
      if (text.startsWith('//') || text.startsWith('/*') || text.startsWith('*')) continue;

      const here = next.match(/^(\s*)/)[1].length;
      if (here < indent) break;                       // the block closed
      if (here > indent) continue;                    // still inside the return
      /* The return's own closing — `});` — sits at the same indentation, and
         breaking there was the first version of this rule. It then walked
         straight past the very case it was written for. */
      if (/^[)\]}]/.test(text)) continue;
      if (text.startsWith('.')) continue;             // a chained call, same statement

      failed = 1;
      console.log(`  ${file}:${j + 1} cannot be reached — line ${i + 1} returns first`);
      console.log(`      ${text.slice(0, 70)}`);
      break;
    }
  }
}

/* The same key twice in one object literal.

   The later one wins and the earlier one is simply gone. `unfreeze` was
   defined twice in the api object — once for a single session, once for the
   whole brake — and pausing ONE session released the brake on all of them,
   because the id was dropped along with the first definition. Nothing warns
   about this: it is legal JavaScript.

   Only object literals that read as tables of calls are looked at, which is
   the shape the accident takes here. */
for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let depth = 0, start = -1, seen = new Map();

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (text.startsWith('//') || text.startsWith('*')) continue;

    if (/^const \w+ = \{$/.test(text) && depth === 0) {
      depth = 1; start = i; seen = new Map();
      continue;
    }
    if (!depth) continue;

    for (const c of text) {
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    if (depth <= 0) { depth = 0; continue; }

    const key = text.match(/^(\w+)\s*:/);
    if (!key) continue;
    if (seen.has(key[1])) {
      failed = 1;
      console.log(`  ${file}:${i + 1} "${key[1]}" is already defined in line ${seen.get(key[1])} — the later one wins`);
    } else {
      seen.set(key[1], i + 1);
    }
  }
}

if (failed) process.exit(1);
console.log(`  ${process.argv.length - 2} file(s), nothing unreachable, no key twice`);
