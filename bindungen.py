#!/usr/bin/env python3
"""Prüft, ob jede Wails-Bindung, die das Frontend aufruft, in Go existiert.

Die Bindungen sind der einzige Übergang zwischen Fenster und Go, den kein
Compiler prüft. Benennt man eine Go-Methode um, ruft das Frontend weiter den
alten Namen — und weil dort oft ein `?.()` steht, passiert einfach nichts.
Genau so wäre der Neustart nach einem Update stumm verschwunden.
"""
import re, sys, pathlib

go = pathlib.Path('app.go').read_text()
vorhanden = set(re.findall(r'^func \(a \*App\) (\w+)', go, re.M))
vorhanden.discard('startup')  # Rückruf von Wails, keine Bindung fürs Fenster

js = pathlib.Path('web/app.js').read_text()
gerufen = set(re.findall(r'\bNative\.(\w+)', js))

fehlend = sorted(gerufen - vorhanden)
ungenutzt = sorted(vorhanden - gerufen)

if fehlend:
    print('FEHLER: das Frontend ruft Bindungen, die es in Go nicht gibt:')
    for n in fehlend:
        print(f'  Native.{n}')
    print(f'vorhanden: {sorted(vorhanden)}')
    sys.exit(1)

if ungenutzt:
    print(f'  Hinweis: in Go gebunden, aber nie gerufen: {ungenutzt}')
print(f'  {len(gerufen)} Bindungen, alle vorhanden')
