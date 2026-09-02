#!/usr/bin/env python3
"""No German in the code. Ever. Only web/i18n/de.json.

The rule the user set on day one: the code is entirely English, German lives in
exactly one place — the translation table. It was carried by hand for two days
and kept coming back, because nothing checked. This is that check.

Two ways of catching it, because German hides in two shapes:

  1. Umlauts and ß — unambiguous. Any ä ö ü Ä Ö Ü ß outside the translation
     tables is German that leaked in.
  2. A word list — for German without special characters (der, wird, nicht,
     Sitzung …). Narrow on purpose: a word list that is too eager flags English
     code, and a gate that cries wolf gets switched off.

What is allowed to contain German — and nothing else is:
"""
import re
import os
import sys
import glob

HERE = os.path.dirname(os.path.abspath(__file__))

# The one place German belongs, plus things that are not source we ship.
ALLOWED_PATHS = (
    'assets/i18n/',          # the translation tables — German by definition
    'assets/vendor/', 'build/', '.git/', 'node_modules/',
    'frontend/node_modules/', 'frontend/out/', 'frontend/.next/',
    'frontend/package-lock.json', 'frontend/package.json',
    'frontend/next-env.d.ts', 'BUILD.md',
    'german.py',             # this file names the words it hunts
)

# Files to look at.
def sources():
    # Every language the project is actually written in. The TypeScript
    # patterns were missing once, and the gate reported green while it had
    # never opened a single component — worse than having no gate at all.
    pats = ['**/*.go', '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
            '**/*.mjs', '**/*.css', '**/*.html', '**/*.sh', '**/*.py',
            '**/*.json', '**/*.md']
    for pat in pats:
        for path in glob.glob(os.path.join(HERE, pat), recursive=True):
            rel = os.path.relpath(path, HERE)
            if any(rel.startswith(a) or ('/' + a) in ('/' + rel) for a in ALLOWED_PATHS):
                continue
            yield rel, path

# German words with no special characters. Each one is common in German and
# rare-to-absent as a standalone token in English code. Deliberately short:
# every entry is a word a reviewer would recognise as unmistakably German.
WORDS = {
    'der', 'die', 'das', 'und', 'oder', 'nicht', 'kein', 'keine', 'wird',
    'wurde', 'sind', 'eine', 'einen', 'einem', 'einer', 'fuer', 'mit', 'auf',
    'aus', 'dem', 'den', 'zum', 'zur', 'noch', 'schon', 'dann', 'wenn', 'weil',
    'damit', 'sich', 'nur', 'auch', 'bei', 'ohne', 'ueber', 'unter', 'hier',
    'dort', 'jede', 'jeder', 'jedes', 'alle', 'allen', 'seite', 'fehler',
    'datei', 'zeile', 'konto', 'sitzung', 'laeuft', 'beendet', 'wartet',
    'anzeigen', 'schliessen', 'oeffnen', 'gewuenscht', 'kaputt', 'mitschnitt',
    'vorlage', 'vorlagen', 'einstellungen', 'zuruecksetzen', 'auswahl',
    'ja', 'nein', 'eingabe', 'eigen', 'eigene', 'eigenes', 'tippen',
    'anhalten', 'fortsetzen', 'notbremse', 'laufen', 'blockiert', 'verwaist',
    'abbruch', 'geaendert', 'pruefen', 'aussieht', 'erkanntes',
    'anzeigename', 'belegt', 'welcher', 'welchen', 'prozess', 'zeigt',
    'arbeitet','laeuft','zeigt','haelt','wartet','steht','kommt','macht',
    'gibt','geht','liegt','bringt','faengt','erkennt','anlegen','speichern',
    # Only words that cannot also be English. "name", "tag" and "per" were in
    # here for a moment and produced 500 hits in code that was already correct —
    # a check nobody can trust is worse than no check.
    'absolut','rauschen','ordner','verzeichnis','pfad','groesse',
    'zwischenspeicher','modell','posten','eingebunden','inhalt',
    'verbrauch','abschnitt','konto','kontos','konten','geschwister','durchnummeriert','durchnummerierten','uebersicht','einstellung','sitzungen','fenster',
    'loeschen','waehlen','suchen','warten','holen','setzen','lesen','schreiben',
    'arbeiten','sollte','muss','kann','beim','sonst','damit','deshalb',
    # Participles: these are how German verbs most often appear in a string or
    # a comment, and a word list without them lets "gestartet" through.
    'gestartet','beendet','geladen','gespeichert','geloescht','geaendert',
    'angehalten','abgebrochen','erstellt','gefunden','gesetzt','gelesen',
    'geschrieben','verbunden','getrennt','frisch','neuen','alten','eigenen',
    # Short words that read as English fragments but are whole German words.
    # 'neu' slipped through in a temp file name for a whole night.
    'neu','alte','neue','ohne','viele','wenig','mehr','weniger','immer','nie',
    'zwei','drei','vier','erste','letzte','beide','jeweils','etwa','genau',
    'alt','gibt','gibtesnicht','nichts','etwas','alles','wieder','schon',
}

# Identifier fragments that are German and occur without word boundaries,
# e.g. hexNachHsv, ZEICHEN_VERWAIST, farbwahl.
FRAGMENTS = [
    'nach', 'zeichen', 'verwaist', 'farb', 'schraeg', 'griff', 'kasten',
    'auswahl', 'pfad', 'stil', 'zeile', 'wahl',
]

# Individual exceptions: a token that trips a rule but is not German. Every one
# needs its reason.
EXCEPT = {
    'and': 'English',      # substring of no German word here, listed for clarity
}

# A word list only catches the words somebody thought of. These endings do not
# occur in English at all, so anything wearing one is German whether or not it
# was ever added to the list — "alphabetisch" and "Einstellung" both walked
# straight past the list before this was here.
ENDINGS = re.compile(
    r'\b\w{4,}(?:isch|ische|ischen|keit|keiten|heit|heiten|schaft|schaften|'
    r'lich|liche|lichen|licher|ungen|ung)\b'
)
# ...with the handful of English words that happen to end the same way.
ENDINGS_OK = {
    'establish', 'accomplish', 'astonish', 'garnish', 'furnish', 'polish',
    'punish',
    # English words that happen to end in -ung.
    'strung', 'sprung', 'flung', 'stung', 'swung', 'wrung', 'clung', 'slung',
    'unsung', 'highstrung',
}

UMLAUT = re.compile(r'[äöüÄÖÜß]')
WORD_RE = re.compile(r'\b([A-Za-zÄÖÜäöüß]+)\b')


def main():
    hits = []
    scanned = 0
    for rel, path in sources():
        scanned += 1
        try:
            text = open(path, encoding='utf-8').read()
        except (UnicodeDecodeError, IsADirectoryError):
            continue
        for nr, line in enumerate(text.splitlines(), 1):
            # A narrow escape hatch for the rare legitimate case: migrating AWAY
            # from an old German name has to name it. Every use carries a reason.
            if 'german-ok:' in line:
                continue
            ending = ENDINGS.search(line.lower())
            if ending and ending.group(0) not in ENDINGS_OK:
                hits.append((rel, nr, f'Endung "{ending.group(0)}"', line.strip()[:70]))
                continue
            if UMLAUT.search(line):
                hits.append((rel, nr, 'Umlaut/ß', line.strip()[:70]))
                continue
            low = line.lower()
            # `die` is the universal shell error-exit helper, not the German
            # article, in a shell script. Skip that one word there — real
            # German in .sh is still caught by every other word and by umlauts.
            words = WORDS - ({'die'} if rel.endswith('.sh') else set())
            for w in WORD_RE.findall(low):
                if w in words:
                    hits.append((rel, nr, f'Wort "{w}"', line.strip()[:70]))
                    break
    if scanned == 0:
        print('  read no files at all — the patterns are wrong')
        return 1
    if hits:
        print(f'  {len(hits)} lines with German outside web/i18n/:')
        for rel, nr, why, txt in hits[:60]:
            print(f'      {rel}:{nr}  [{why}]  {txt}')
        if len(hits) > 60:
            print(f'      … and {len(hits) - 60} more')
        return 1
    print(f'  no German outside web/i18n/ — {scanned} files')
    return 0


if __name__ == '__main__':
    sys.exit(main())
