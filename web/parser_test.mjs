/* Prueft die reinen Parser-Funktionen aus app.js ohne Browser.

   Sie haengen an nichts — kein DOM, kein Zustand —, also lassen sie sich
   herausziehen und einzeln pruefen. Genau das ist der Punkt: die Knoepfe im
   Posteingang tragen jetzt den echten Optionstext, und ob der richtig
   herausgeschnitten wird, soll nicht erst im Fenster auffallen. */
import { readFileSync } from 'node:fs';
const src = readFileSync('web/app.js', 'utf8');
const zeilen = src.split('\n');

// Eine Konstante steht auf einer Zeile, eine Funktion geht bis zur schliessenden
// Klammer in Spalte 0. Klammern zu zaehlen scheitert an Regex-Literalen wie {1,2}.
function hol(name) {
  const iKonst = zeilen.findIndex((l) => l.startsWith(`const ${name} = `));
  if (iKonst >= 0) return zeilen[iKonst];
  const iFn = zeilen.findIndex((l) => l.startsWith(`function ${name}(`));
  if (iFn < 0) { console.log('  NICHT GEFUNDEN:', name); return ''; }
  let ende = iFn + 1;
  while (ende < zeilen.length && zeilen[ende] !== '}') ende++;
  return zeilen.slice(iFn, ende + 1).join('\n');
}

const quelle = ['OPTIONSZEILE', 'kurzText', 'optionenAus', 'jaNeinAus', 'schnellFuer', 'ungezaehmt']
  .map(hol).join('\n');

const SCHNELLANTWORT = [
  { text: '1', label: '1' }, { text: '2', label: '2' },
  { text: 'y', label: 'y' }, { text: 'n', label: 'n' },
  { text: '', label: 'Eingabe' }, { text: '', label: 'Esc' },
];
const mod = new Function('SCHNELLANTWORT',
  quelle + '\nreturn { optionenAus, schnellFuer, ungezaehmt };')(SCHNELLANTWORT);

const MARKE = '❯';   // die Auswahlmarke, die Claude Code setzt

const faelle = [
  ['Claude-Dialog',
   'Do you want to proceed?\n' + MARKE + ' 1. Yes\n  2. No, and tell Claude what to do differently',
   ['1 · Yes', '2 · No, and tell Claude w…']],
  ['Klammerform',
   'Welche Farbe?\n  1) rot\n  2) blau\nAuswahl>',
   ['1 · rot', '2 · blau']],
  ['drei Optionen mit Marke',
   MARKE + ' 1. Nur die Testdatenbank\n  2. Auch die Entwicklungsdatenbank\n  3. Abbrechen\nAuswahl>',
   ['1 · Nur die Testdatenbank', '2 · Auch die Entwicklungs…', '3 · Abbrechen']],
  ['ja/nein', 'Datei ueberschreiben? (y/n)', ['y · ja', 'n · nein']],
  ['keine Auswahl', 'Was soll ich tun?', null],
  ['nur eine Ziffer ist keine Auswahl', 'Fehler in Zeile\n  1) irgendwas', null],
];

let fehler = 0;
for (const [name, frage, erwartet] of faelle) {
  const got = mod.schnellFuer(frage).map((b) => b.label);
  const eigene = got.filter((l) => l !== 'Eingabe' && l !== 'Esc');
  const soll = erwartet ?? ['1', '2', 'y', 'n'];
  const ok = JSON.stringify(eigene) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(`  ${ok ? 'ok  ' : 'FEHL'} ${name}`);
  if (!ok) {
    console.log(`         bekommen: ${JSON.stringify(eigene)}`);
    console.log(`         erwartet: ${JSON.stringify(soll)}`);
  }
}

console.log('  --- Warnkleid ---');
const kleid = [
  [{ cmd: ['claude', '--dangerously-skip-permissions'] }, true],
  [{ cmd: ['claude', '--dangerously-skip-permissions=true'] }, true],
  [{ cmd: ['claude'] }, false],
  [{ cmd: ['/bin/zsh', '-l'] }, false],
  [{}, false],
];
for (const [t, soll] of kleid) {
  const got = mod.ungezaehmt(t);
  if (got !== soll) { fehler++; console.log(`  FEHL ${JSON.stringify(t.cmd ?? null)} -> ${got}`); }
  else console.log(`  ok   ${JSON.stringify(t.cmd ?? null)} -> ${got}`);
}
process.exit(fehler ? 1 : 0);
