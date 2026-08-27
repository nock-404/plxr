#!/usr/bin/env python3
"""Benennt JavaScript-Bezeichner um, ohne Zeichenketten und Kommentare anzufassen.

Dasselbe Vorgehen wie auf der Go-Seite: der Quelltext wird in Code und
Nicht-Code zerlegt, ersetzt wird nur im Code. Was der Nutzer zu sehen bekommt,
steht in Zeichenketten und bleibt unberührt; die Kommentare kommen in einem
eigenen Durchgang dran.

Anders als Go hat JavaScript keinen Compiler, der eine vergessene Stelle
meldet. Deshalb wird hinterher geprüft, dass sich an den Zeichenketten
nachweislich nichts geändert hat — und der Rest muss über klassen.py,
bindungen.py, den Parser-Test und `node --check` fallen.
"""
import json
import re
import sys
from pathlib import Path

# Zeichenketten, Vorlagen-Zeichenketten und Kommentare. Regex-Literale werden
# bewusst NICHT erkannt: sie sicher von einer Division zu unterscheiden braucht
# einen halben Parser. Stattdessen wird hinterher geprüft, ob eines sich
# verändert hat — dann fliegt es auf, statt still zu passieren.
STUECKE = re.compile(
    r"""('(?:[^'\\\n]|\\.)*')"""      # 'einfach'
    r"""|("(?:[^"\\\n]|\\.)*")"""     # "doppelt"
    r"""|(`(?:[^`\\]|\\.)*`)"""       # `Vorlage`
    r"""|(//[^\n]*)"""                # Zeilenkommentar
    r"""|(/\*(?:.|\n)*?\*/)""",       # Blockkommentar
    re.S,
)


def teile(text):
    out, pos = [], 0
    for m in STUECKE.finditer(text):
        out.append(('code', text[pos:m.start()]))
        out.append(('roh', m.group(0)))
        pos = m.end()
    out.append(('code', text[pos:]))
    return out


def _im_code(s, karte):
    for alt, neu in karte.items():
        s = re.sub(r'\b' + re.escape(alt) + r'\b', neu, s)
    return s


def anwenden(text, karte):
    stuecke = []
    for art, s in teile(text):
        if art == 'code':
            s = _im_code(s, karte)
        elif s.startswith('`'):
            # Eine Vorlagen-Zeichenkette ist nicht durchgehend Text: in ${…}
            # steht ausfuehrbarer Code. Den zu ueberspringen hiesse, dass
            # `${kurzText(x)}` den alten Namen behaelt, waehrend die Funktion
            # schon anders heisst — und JavaScript sagt dazu nichts, bis es
            # zur Laufzeit knallt.
            s = re.sub(r'\$\{([^{}]*)\}',
                       lambda m: '${' + _im_code(m.group(1), karte) + '}', s)
        stuecke.append(s)
    return ''.join(stuecke)


def unberuehrt(text):
    """Alles, was sich nicht ändern darf.

    Vorlagen-Zeichenketten sind ausgenommen: in ihren ${…} steht Code, der
    mit umbenannt werden muss. Geprüft wird bei ihnen deshalb nur der Text
    außerhalb der Einsetzungen.
    """
    out = []
    for art, s in teile(text):
        if art != 'roh':
            continue
        if s.startswith('`'):
            out.append(re.sub(r'\$\{[^{}]*\}', '${}', s))
        else:
            out.append(s)
    return out


def main():
    karte = json.loads(sys.argv[1])
    for p in sys.argv[2:]:
        pfad = Path(p)
        alt = pfad.read_text()
        neu = anwenden(alt, karte)
        if neu == alt:
            continue
        if unberuehrt(alt) != unberuehrt(neu):
            print(f'  ABBRUCH {p}: eine Zeichenkette oder ein Kommentar hat sich verändert')
            sys.exit(1)
        pfad.write_text(neu)
        print(f'  {p} geändert')


if __name__ == '__main__':
    main()
