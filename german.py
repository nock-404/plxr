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
    'web/i18n/',              # the translation tables — German by definition
    'web/vendor/', 'web/wailsjs/', 'build/', '.git/', 'node_modules/',
    'german.py',             # this file names the words it hunts
)

# Files to look at.
def sources():
    pats = ['**/*.go', '**/*.js', '**/*.mjs', '**/*.css', '**/*.html',
            '**/*.sh', '**/*.py', '**/*.json']
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
    'abbruch', 'geaendert', 'pruefen',
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

UMLAUT = re.compile(r'[äöüÄÖÜß]')
WORD_RE = re.compile(r'\b([A-Za-zÄÖÜäöüß]+)\b')


def main():
    hits = []
    for rel, path in sources():
        try:
            text = open(path, encoding='utf-8').read()
        except (UnicodeDecodeError, IsADirectoryError):
            continue
        for nr, line in enumerate(text.splitlines(), 1):
            # A narrow escape hatch for the rare legitimate case: migrating AWAY
            # from an old German name has to name it. Every use carries a reason.
            if 'german-ok:' in line:
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
    if hits:
        print(f'  {len(hits)} lines with German outside web/i18n/:')
        for rel, nr, why, txt in hits[:60]:
            print(f'      {rel}:{nr}  [{why}]  {txt}')
        if len(hits) > 60:
            print(f'      … and {len(hits) - 60} more')
        return 1
    print('  no German in the code (only web/i18n/)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
