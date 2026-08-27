/* Prueft die Uebergaenge, die kein Compiler sieht.

   JavaScript meldet einen falschen Namen erst, wenn genau die Stelle zur
   Laufzeit erreicht wird — bei einem Fehlerpfad kann das Wochen dauern.
   `node --check` prueft nur die Syntax und sagt zu `api.gibtsNicht()` nichts.

   Vollstaendig laesst sich das ohne Geltungsbereichs-Analyse nicht pruefen, und
   ein grober Versuch produziert mehr Fehlalarme als Funde — das hier ist der
   Ausschnitt, der praezise geht und in dem die echten Brueche entstehen:

     api.*     die Sammlung der Daemon-Aufrufe in app.js
     plxrUI.*  die eigenen Bedienelemente aus ui.js

   Beide sind Sammlungen von Methoden an einem Objekt. Wer eine umbenennt und
   den Aufrufer vergisst, bekommt zur Laufzeit "is not a function" — und bei
   einem `?.()` davor passiert wortlos gar nichts.
*/
import { readFileSync } from 'node:fs';

function ohneText(src) {
  // Zeichenketten und Kommentare raus; ${…} bleibt, dort steht Code.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`([^`\\]|\\.)*`/g, (t) =>
      [...t.matchAll(/\$\{([^{}]*)\}/g)].map((m) => m[1]).join(' '))
    .replace(/'(?:[^'\\\n]|\\.)*'/g, ' ')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, ' ');
}

/* Die Schluessel eines Objektliterals. Gesucht wird ab `const name = {` bis zur
   passenden schliessenden Klammer, damit verschachtelte Objekte nicht
   dazwischenfunken. */
function schluessel(code, objekt) {
  const start = code.search(new RegExp(`\\b(?:const|let|var\\s+|window\\.)?${objekt}\\s*=\\s*\\{`));
  if (start < 0) return null;
  let i = code.indexOf('{', start), tiefe = 0, ende = i;
  for (; i < code.length; i++) {
    if (code[i] === '{') tiefe++;
    else if (code[i] === '}') { tiefe--; if (!tiefe) { ende = i; break; } }
  }
  const koerper = code.slice(start, ende);
  const namen = new Set();
  let t = 0;
  // Auch die Kurzschreibweise: { colorPicker, tippBinden } hat weder : noch (
  for (const m of koerper.matchAll(/[{}]|([A-Za-z_$][\w$]*)\s*(?:[:(]|,|$)/gm)) {
    if (m[0] === '{') { t++; continue; }
    if (m[0] === '}') { t--; continue; }
    if (t === 1 && m[1]) namen.add(m[1]);   // nur die oberste Ebene
  }
  return namen;
}

const quellen = process.argv.slice(2).map((f) => ({ f, s: ohneText(readFileSync(f, 'utf8')) }));
const alles = quellen.map((q) => q.s).join('\n');

let fehler = 0;
for (const objekt of ['api', 'plxrUI']) {
  const vorhanden = schluessel(alles, objekt);
  if (!vorhanden) { console.log(`  ${objekt} nicht gefunden — Pruefung uebersprungen`); continue; }

  const gerufen = new Set(
    [...alles.matchAll(new RegExp(`\\b${objekt}\\.([A-Za-z_$][\\w$]*)`, 'g'))].map((m) => m[1]),
  );
  const fehlt = [...gerufen].filter((n) => !vorhanden.has(n)).sort();
  if (fehlt.length) {
    fehler = 1;
    console.log(`  ${objekt}: ${fehlt.length} Aufruf(e) ohne Entsprechung:`);
    for (const n of fehlt) console.log(`      ${objekt}.${n}`);
  } else {
    console.log(`  ${objekt}: ${gerufen.size} gerufen, alle vorhanden`);
  }
}

process.exit(fehler);
