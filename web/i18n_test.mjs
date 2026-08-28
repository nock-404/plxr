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
/* Ein Schluessel gilt als benutzt, wenn sein Name irgendwo in Anfuehrungszeichen
   im Quelltext steht. Praeziser waere, nur t('…') zu zaehlen — aber dann faellt
   tr(bedingung ? 'a' : 'b') durch, und ein Test, der bei richtigem Code Alarm
   schlaegt, wird abgeschaltet statt gelesen. */
/* Gezaehlt wird, was in einem tr(…)-Aufruf in Anfuehrungszeichen steht — samt
   der Faelle mit Verzweigung, tr(bedingung ? 'a' : 'b'). Nur tr('…') zu matchen
   liesse die durchfallen; alle punktierten Zeichenketten zu nehmen faengt die
   Schluessel von localStorage mit. */
const benutzt = new Set([
  ...[...quellen.matchAll(/\btr\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g)]
    .flatMap((m) => [...m[1].matchAll(/['"]([\w.]+)['"]/g)].map((k) => k[1])),
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

/* Und: steht noch deutscher Text fest verdrahtet im Quelltext?

   Die erste Runde suchte nach Umlauten und Artikeln — "Session wartet auf
   dich" hat weder das eine noch das andere und blieb monatelang stehen.
   Deshalb hier eine Wortliste, die auf die Sprache zielt, nicht auf ihre
   Sonderzeichen.

   Die zweite Runde liess "Escape senden" durch: kein Umlaut, kein Artikel,
   kein Wort aus der Liste. Und Vorlagen-Zeichenketten sah sie ueberhaupt
   nicht an, obwohl der halbe Kurzhinweis dort steht. Also: Verben und
   Hauptwoerter dazu, die in Bedienoberflaechen wirklich vorkommen, und
   Backticks mitlesen — ohne die ${…}, dort steht Code. */
const DEUTSCH = /\b(auf|dich|wartet|warten|laeuft|laufen|kein|keine|nichts|noch|schon|mehr|gibt|steht|wird|werden|beendet|Fassung|Konto|von|bis|aktiv|angehalten|fortgesetzt|Datei|Dateien|Verzeichnis|der|die|das|und|ist|nicht|damit|eine|senden|gesendet|oeffnen|geoeffnet|schliessen|speichern|gespeichert|loeschen|geloescht|abbrechen|Abbruch|Antwort|Antworten|Frage|Fragen|Eingabe|Eingabetaste|Taste|Sitzung|Fenster|Zeile|Zeilen|Ordner|Einstellungen|waehlen|Auswahl|neu|alle|mit|fuer|zum|zur|bei|dem|den|kann|muss|soll|hier|dort|jetzt|wieder|wurde|haben|hat)\b|[äöüßÄÖÜ]/;
/* Keine HTML-Entities in den Werten.

   Die Texte werden mit textContent gesetzt, und textContent decodiert nichts:
   aus "path&gt;" wird auf dem Bildschirm woertlich path&gt;. Genau so ist es
   passiert — beim Umzug der Texte aus dem HTML in die Tabellen sind die
   Entities mitgewandert, zwoelf Stueck, und niemand hat es gesehen. */
const entities = [];
for (const [sprache, tabelle] of Object.entries(tabellen)) {
  for (const [k, v] of Object.entries(tabelle)) {
    if (typeof v === 'string' && /&(?:[a-zA-Z]+|#\d+);/.test(v)) entities.push(`${sprache}: ${k} = ${v}`);
  }
}
if (entities.length) {
  fehler = 1;
  console.log(`  ${entities.length} Uebersetzungen enthalten HTML-Entities (textContent decodiert die nicht):`);
  for (const e of entities) console.log(`      ${e}`);
}

const jsQuellen = ['web/app.js', 'web/ui.js'].map((f) => [f, readFileSync(f, 'utf8')]);
const deutscheReste = [];
for (const [datei, src] of jsQuellen) {
  const ohneKommentar = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  // Vorlagen-Zeichenketten ohne ihre Einsetzungen: `„${x}" senden` ist Text.
  const mitVorlagen = ohneKommentar.replace(/`([^`\\]|\\.)*`/g,
    (t) => "'" + t.slice(1, -1).replace(/\$\{[^{}]*\}/g, ' ').replace(/['\\\n]/g, ' ') + "'");
  for (const m of mitVorlagen.matchAll(/'([^'\\\n]{6,})'|"([^"\\\n]{6,})"/g)) {
    const txt = m[1] || m[2];
    // Selektoren, Schluessel, Kopfzeilen und Klassennamen sind kein Text.
    if (/^[\w.#\[\]=-]+$/.test(txt) || txt.startsWith('X-') || txt.includes('/')) continue;
    // Naives Paaren von Anfuehrungszeichen erwischt auch Code zwischen zwei
    // Zeichenketten. Was wie Code aussieht, ist keiner.
    if (/=>|&&|\|\||\$\{|\bdata-\w+=|===|\?|\btr\(/.test(txt)) continue;
    if (DEUTSCH.test(txt)) deutscheReste.push(`${datei}: ${txt.slice(0, 60)}`);
  }
}
/* Was auf den Schirm geht, muss durch tr().

   Die Wortliste oben ist ein festes Vokabular und faengt nur, was jemand
   hineingeschrieben hat: "liest …", "Ein lauschender Port" und "Transkripte"
   sind ihr durchgerutscht, jahrelang sichtbar. Diese Pruefung fragt nicht
   nach der Sprache, sondern nach der Herkunft — eine Zeichenkette, die als
   Text gesetzt wird, ohne durch tr() gegangen zu sein, ist unuebersetzbar,
   ganz gleich wie sie klingt. */
/* Bausteine ohne Uebersetzung: Einheiten, Kennungen, Praefixe. Sie stehen im
   Code, weil sie in jeder Sprache gleich heissen, nicht weil jemand sie
   vergessen hat.

   Im Zweifel gehoert eine Zeichenkette NICHT hierher — genau so verschwindet
   der naechste deutsche Rest aus dem Blick. Jeder Eintrag hat seinen Grund. */
const KEIN_TEXT = new Set([
  'claude-',   // Praefix, das beim Kuerzen eines Modellnamens abgeschnitten wird
  'kB',        // Einheit
  'pid',       // Kennung, heisst ueberall so
  ', pid',     // dieselbe Kennung mit Trenner
  'shell',     // Kennung einer eingebauten Vorlage, kein Text
]);

const ZIELE = /(?:\.textContent\s*=|\.placeholder\s*=|plxrUI\.notice\(|plxrUI\.confirm\(|showEmpty\()/g;
const ungefiltert = [];
for (const [datei, src] of jsQuellen) {
  const ohneKommentar = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  for (const m of ohneKommentar.matchAll(ZIELE)) {
    // Der Ausdruck bis zum Zeilen- oder Anweisungsende.
    const rest = ohneKommentar.slice(m.index + m[0].length, m.index + m[0].length + 400);
    const ausdruck = rest.split(/;\n|\n\s*\n/)[0].split('\n').slice(0, 4).join('\n');
    if (/\btr\(/.test(ausdruck)) continue;
    for (const lit of ausdruck.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`]*)`/g)) {
      const txt = (lit[1] ?? lit[2] ?? lit[3] ?? '').replace(/\$\{[^{}]*\}/g, '');
      if (!/[A-Za-zÄÖÜäöü]{2,}/.test(txt)) continue;      // '', '·', '%' sind kein Text
      if (KEIN_TEXT.has(txt.trim())) continue;
      ungefiltert.push(`${datei}: ${txt.trim().slice(0, 50)}`);
      break;
    }
  }
}
if (ungefiltert.length) {
  fehler = 1;
  console.log(`  ${ungefiltert.length} Texte gehen ohne tr() auf den Schirm:`);
  for (const t of ungefiltert) console.log(`      ${t}`);
}

if (deutscheReste.length) {
  fehler = 1;
  console.log(`  ${deutscheReste.length} deutsche Texte stehen noch fest im Quelltext:`);
  for (const r of deutscheReste.slice(0, 10)) console.log(`      ${r}`);
}

/* Wird die Uebersetzungsfunktion verdeckt?

   Sie hiess erst t(). In dieser Datei heisst aber fast jede Kachel in fast
   jeder Schleife ebenfalls t — und `for (const t of list)` verdeckt die
   Funktion lautlos. `t('inbox.open')` ruft dann ein Objekt als Funktion auf und
   wirft, aber erst wenn genau diese Schleife laeuft. Deshalb heisst sie jetzt
   tr(), und jeder verbliebene t('…')-Aufruf ist entweder ein Rest oder genau
   dieser Fehler. */
const verdeckt = [...jsQuellen]
  .flatMap(([datei, src]) => [...src.matchAll(/(?<![.\w$])t\(\s*['"]/g)].map(() => datei));
if (verdeckt.length) {
  fehler = 1;
  console.log(`  ${verdeckt.length} Aufruf(e) von t('…') — die Funktion heisst tr()`);
  for (const d of [...new Set(verdeckt)]) console.log(`      ${d}`);
}

if (!fehler) {
  console.log(`  ${benutzt.size} Schluessel, ${Object.keys(tabellen).length} Sprachen, vollstaendig`);
}
process.exit(fehler);
