#!/usr/bin/env python3
"""Prüft Daten-Merkmale: was das CSS anspricht, muss das JavaScript auch setzen.

Ein Skin schreibt `.selectRow[data-gewaehlt]`, das JavaScript setzt
`dataset.picked` — und nichts sagt etwas. Kein Fehler, keine Warnung, die Zeile
steht einfach nie hervorgehoben da. Genau so ist es passiert: die Umbenennung
hat die JavaScript-Seite mitgenommen und die vier Skins vergessen, und im
Neue-Session-Dialog war danach unsichtbar, welchen Starttyp man gewählt hat.

Klassen sind über klassen.py abgedeckt. Daten-Merkmale nicht — sie stehen im
CSS in eckigen Klammern und im JavaScript hinter einem Punkt, in anderer
Schreibweise (dataset.langerName ⇒ data-langer-name), und keine der beiden
Seiten fällt um, wenn die andere sich ändert.

Geprüft wird eine Richtung: jedes im CSS angesprochene Merkmal braucht einen
Schreiber. Andersherum wäre es kein Fund — ein Merkmal darf reiner Zustand für
das JavaScript sein, ohne dass es je jemand einfärbt.
"""
import re
import sys
from pathlib import Path

CSS = ['web/base.css'] + sorted(str(p) for p in Path('web/skins').glob('*/skin.css'))
QUELLE = ['web/app.js', 'web/ui.js', 'web/index.html']

# Merkmale, die nicht wir setzen: der Browser, Wails oder die Auszeichnung
# selbst bringen sie mit.
FREMD = {
    'data-theme', 'data-wails-drag', 'data-titlebar-inset',
}


def kebab(name):
    """dataset.langerName ⇒ data-langer-name"""
    return 'data-' + re.sub(r'([A-Z])', lambda m: '-' + m.group(1).lower(), name)


def aus_css(text):
    # [data-x], [data-x="ja"], [data-x='ja'] — der Name reicht, der Wert nicht.
    return set(re.findall(r'\[\s*(data-[a-z0-9-]+)', text))


def aus_quelle(text):
    treffer = set()
    # dataset.name = …  und  dataset.name in HTML-Schnipseln als data-name="…"
    for m in re.finditer(r'\bdataset\.([A-Za-z][\w$]*)', text):
        treffer.add(kebab(m.group(1)))
    # dataset['name']
    for m in re.finditer(r"""\bdataset\[\s*['"]([\w-]+)['"]""", text):
        treffer.add(kebab(m.group(1)) if '-' not in m.group(1) else 'data-' + m.group(1))
    # data-name="…" im Markup und in zusammengebauten Schnipseln
    for m in re.finditer(r'\b(data-[a-z0-9-]+)\s*=', text):
        treffer.add(m.group(1))
    # setAttribute('data-name', …)
    for m in re.finditer(r"""setAttribute\(\s*['"](data-[a-z0-9-]+)['"]""", text):
        treffer.add(m.group(1))
    return treffer


gesetzt = set()
for d in QUELLE:
    gesetzt |= aus_quelle(Path(d).read_text())

fehler = 0
gesamt = 0
for d in CSS:
    text = Path(d).read_text()
    for merkmal in sorted(aus_css(text)):
        gesamt += 1
        if merkmal in FREMD or merkmal in gesetzt:
            continue
        fehler = 1
        # Wo genau, damit man nicht suchen muss.
        for i, zeile in enumerate(text.split('\n'), 1):
            if f'[{merkmal}' in zeile.replace('[ ', '['):
                print(f'  {d}:{i}: {merkmal} wird nirgends gesetzt')
                break

if not fehler:
    print(f'  {gesamt} Merkmal-Selektor(en), alle werden gesetzt')

sys.exit(fehler)
