#!/usr/bin/env python3
"""Prüft, dass jeder Daemon-Aufruf im JavaScript eine Route in Go trifft.

Diese Naht hat die App schon einmal komplett zerlegt, und niemand hat es
gesehen: JavaScript ruft, Go antwortet 404, der Aufrufer bekommt einen Text
statt Daten. Nichts stürzt ab, es geht nur nicht.

Der Compiler kennt beide Seiten nicht — die eine ist eine Zeichenkette, die
andere eine Zeichenkette. Verglichen wird Verfahren plus Pfad, mit Platzhaltern
statt eingesetzter Werte:

    req(`/api/themes/${encodeURIComponent(name)}`, { method: 'DELETE' })
    mux.HandleFunc("DELETE /api/themes/{name}", …)

Der Abfrageteil hinter ? interessiert nicht — den prüft kein Router.

Der Pfad wird geklammert gelesen, nicht mit einem Ausdruck: `${hart ? '?x' : ''}`
enthält selbst ein Fragezeichen und Anführungszeichen, und ein naives Muster
liest den Pfad dann bis mitten in die Einsetzung hinein. Ein Fehlalarm ist hier
teurer als kein Test — er ist der Grund, warum man Tests abschaltet.

Geprüft wird eine Richtung: jeder Aufruf braucht eine Route. Andersherum wäre
kein Fund. Eine Route ohne Aufrufer ist erlaubt: der Hook spricht den Daemon
direkt an, ohne durch die Oberfläche zu gehen.
"""
import re
import sys
from pathlib import Path

JS = 'web/app.js'
GO = 'internal/server/server.go'


def klammer_ende(text, i):
    """Index nach der zu text[i] == '(' passenden schließenden Klammer.

    Zeichenketten werden übersprungen, sonst beendet eine Klammer in einem Text
    den Aufruf zu früh.
    """
    tiefe, n = 0, len(text)
    while i < n:
        c = text[i]
        if c in '\'"`':
            i += 1
            while i < n and text[i] != c:
                i += 2 if text[i] == '\\' else 1
            i += 1
            continue
        if c == '(':
            tiefe += 1
        elif c == ')':
            tiefe -= 1
            if tiefe == 0:
                return i + 1
        i += 1
    return n


def literal_lesen(text, i):
    """Liest ab text[i] eine Zeichenkette und gibt (Inhalt, Index danach).

    In Vorlagen-Zeichenketten werden die Einsetzungen geklammert übersprungen
    und durch {} ersetzt — auch wenn in ihnen Klammern oder Texte stehen.
    """
    anf = text[i]
    i += 1
    out, n = [], len(text)
    while i < n and text[i] != anf:
        if text[i] == '\\':
            out.append(text[i:i + 2])
            i += 2
            continue
        if anf == '`' and text.startswith('${', i):
            tiefe, j = 1, i + 2
            while j < n and tiefe:
                if text[j] == '{':
                    tiefe += 1
                elif text[j] == '}':
                    tiefe -= 1
                j += 1
            out.append('{}')
            i = j
            continue
        out.append(text[i])
        i += 1
    return ''.join(out), i + 1


def pfad_normieren(pfad):
    pfad = re.sub(r'\{\}(?:\{\})+', '{}', pfad.split('?')[0].rstrip('/'))
    # Ein {} direkt an einem Wort statt hinter einem / ist kein Wegstueck: in Go
    # ist ein Platzhalter immer ein ganzes Segment. Es ist eine Einsetzung, die
    # den Abfrageteil mitbringt — `/antwort${roh ? '?roh=1' : ''}` — und der
    # steht nicht mehr im Pfad, sobald das Fragezeichen darin verschwunden ist.
    while re.search(r'[^/]\{\}$', pfad):
        pfad = pfad[:-2]
    return pfad.rstrip('/')


def aus_go(text):
    return {(m.group(1), pfad_normieren(re.sub(r'\{[a-zA-Z]\w*\}', '{}', m.group(2))))
            for m in re.finditer(r'mux\.(?:HandleFunc|Handle)\(\s*"([A-Z]+)\s+([^"]+)"', text)}


def aus_js(text):
    text = re.sub(r'/\*[\s\S]*?\*/', ' ', text)
    text = re.sub(r'//[^\n]*', ' ', text)

    aufrufe = set()
    for m in re.finditer(r'\breq\(', text):
        start = m.end() - 1
        ende = klammer_ende(text, start)
        ruf = text[start + 1:ende - 1]

        i = 0
        while i < len(ruf) and ruf[i].isspace():
            i += 1
        if i >= len(ruf) or ruf[i] not in '\'"`':
            continue
        pfad, i = literal_lesen(ruf, i)
        if not pfad.startswith('/api/'):
            continue
        # Verkettung: req('/api/sessions/' + id) — was folgt, ist ein Wert.
        rest = ruf[i:].lstrip()
        if rest.startswith('+'):
            pfad += '{}'
            rest = rest.split(',', 1)[1] if ',' in rest else ''
        verfahren = re.search(r"""method:\s*'([A-Z]+)'""", rest)
        aufrufe.add((verfahren.group(1) if verfahren else 'GET', pfad_normieren(pfad)))
    return aufrufe


routen = aus_go(Path(GO).read_text())
aufrufe = aus_js(Path(JS).read_text())

fehlt = sorted(a for a in aufrufe if a not in routen)
for verfahren, pfad in fehlt:
    print(f'  {verfahren} {pfad} — keine Route in {GO}')
if fehlt:
    sys.exit(1)

ohne = len(routen) - len({r for r in routen if r in aufrufe})
print(f'  {len(aufrufe)} Aufruf(e) treffen eine Route, {ohne} Route(n) ohne Aufrufer')
