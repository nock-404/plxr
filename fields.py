#!/usr/bin/env python3
"""Abgleich zwischen den JSON-Feldern aus Go und dem, was das JavaScript liest.

Der Grund für dieses Skript: die Verbrauchsansicht hat wochenlang Balken ohne
Beschriftung gezeigt. Go schickte das Feld als `json:"schluessel"`, app.js las
`z.key`. Kein Fehler, keine Warnung — nur eine leere Spalte, die aussieht wie
"da war halt nichts".

Diese Klasse fängt sonst kein Tor ab: der Go-Compiler kennt die JS-Seite nicht,
klassen.py sieht nur Klassen und IDs, routen.py nur Pfade. Zwischen den beiden
Sprachen steht allein der Name in einem String-Tag, und den prüft niemand.

Geprüft wird eine Richtung: jedes Feld, das an die Oberfläche geht, braucht
einen Leser. Andersherum wäre kein Fund — die Oberfläche darf ein Feld
ignorieren, ohne dass etwas kaputt ist.
"""
import re
import os
import sys
import glob

HIER = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HIER, 'web')

# Pakete, deren Strukturen der Server als JSON hinausgibt. Alles andere wird
# nicht geprüft: ein Zwischenspeicher auf der Platte hat eigene Feldnamen und
# geht die Oberfläche nichts an.
AN_DIE_OBERFLAECHE = (
    'internal/usage', 'internal/session', 'internal/rules', 'internal/theme',
    'internal/search', 'internal/ports', 'internal/archive', 'internal/update',
    'internal/accounts', 'internal/template', 'internal/core', 'internal/server',
)

# Felder, die absichtlich niemand liest.
#
# Im Zweifel gehört ein Feld NICHT hierher: genau so verschwindet die nächste
# leere Spalte aus dem Blick. Jeder Eintrag braucht seinen Grund daneben.
OHNE_LESER = {
    # --- Geprüft: gehen gar nicht an die Oberfläche ---------------------
    # Antworten von GitHub, die hereinkommen statt hinauszugehen.
    'tag_name': 'GitHub-Release, eingehend',
    'browser_download_url': 'GitHub-Release, eingehend',
    'assets': 'GitHub-Release, eingehend',
    'prerelease': 'GitHub-Release, eingehend',
    'published_at': 'GitHub-Release, eingehend',
    # Felder aus den Claude-Transkripten, ebenfalls eingehend.
    'input_tokens': 'Transkript, eingehend',
    'output_tokens': 'Transkript, eingehend',
    'cache_creation_input_tokens': 'Transkript, eingehend',
    'cache_read_input_tokens': 'Transkript, eingehend',
    'usage': 'Transkript, eingehend',
    'timestamp': 'Transkript, eingehend',
    'role': 'Transkript, eingehend',
    'content': 'Transkript, eingehend',
    # Zwischenspeicher auf der Platte, eigenes Format.
    'version': 'Zwischenspeicher',
    'groesse': 'Zwischenspeicher',
    'mod': 'Zwischenspeicher',
    'tage': 'Zwischenspeicher',
    # Nur serverseitig gebraucht.
    'assetUrl': 'nur der Updater lädt damit',
    'assetName': 'nur der Updater lädt damit',

    # --- Altbestand: noch nicht nachgesehen -----------------------------
    #
    # Diese standen schon so da, als das Tor gebaut wurde. Sie sind hier
    # eingetragen, damit NEUE Abweichungen sofort rot werden statt in einer
    # langen Liste unterzugehen. Jeder Eintrag ist eine offene Frage, keine
    # Freigabe: entweder liest die Oberfläche das Feld unter falschem Namen
    # (dann ist es ein Fehler wie "frage" gegen tile.confirm), oder es wird
    # wirklich nicht gebraucht und der Tag gehört weg.
    'ab': 'ungeprüft',
    'aiTitle': 'ungeprüft',
    'author': 'ungeprüft',
    'claude_session_id': 'ungeprüft',
    'ebene': 'ungeprüft',
    'ended_at': 'ungeprüft',
    'gitBranch': 'ungeprüft',
    'loop': 'ungeprüft',
    'rolle': 'ungeprüft',
    'started_at': 'ungeprüft',
    'termFont': 'ungeprüft',
    'tty': 'ungeprüft',
    'user': 'ungeprüft',
}


def go_felder():
    """Alle json-Tags aus den Paketen, die an die Oberfläche gehen."""
    treffer = {}
    for paket in AN_DIE_OBERFLAECHE:
        for pfad in glob.glob(os.path.join(HIER, paket, '*.go')):
            if pfad.endswith('_test.go'):
                continue
            for nr, zeile in enumerate(open(pfad, encoding='utf-8'), 1):
                for m in re.finditer(r'json:"([^",]+)', zeile):
                    name = m.group(1)
                    if name == '-' or not name:
                        continue
                    treffer.setdefault(name, f'{os.path.relpath(pfad, HIER)}:{nr}')
    return treffer


def js_namen():
    """Alles, was im JavaScript als Eigenschaft gelesen werden könnte."""
    text = ''
    for datei in sorted(glob.glob(os.path.join(WEB, '*.js'))):
        text += open(datei, encoding='utf-8').read()
    namen = set(re.findall(r'\.([A-Za-z_]\w*)', text))          # z.key
    namen |= set(re.findall(r"""\[['"](\w+)['"]\]""", text))     # z['key']
    namen |= set(re.findall(r"""['"](\w+)['"]\s*:""", text))     # { 'key': … }
    namen |= set(re.findall(r'\b(\w+)\s*:', text))               # { key: … }
    namen |= set(re.findall(r'{\s*([\w,\s]+)\s*}\s*=', text))    # const { key } = …
    zerlegt = set()
    for gruppe in list(namen):
        for teil in re.split(r'[,\s]+', gruppe):
            if teil:
                zerlegt.add(teil)
    return zerlegt


def main():
    felder = go_felder()
    gelesen = js_namen()
    ohne = sorted(n for n in felder if n not in gelesen and n not in OHNE_LESER)
    if ohne:
        print(f'  {len(ohne)} JSON-Felder gehen hinaus, aber niemand liest sie:')
        for n in ohne:
            print(f'      "{n}"  ({felder[n]})')
        return 1
    print(f'  {len(felder)} JSON-Felder, alle werden gelesen')
    return 0


if __name__ == '__main__':
    sys.exit(main())
