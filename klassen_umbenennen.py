#!/usr/bin/env python3
"""Benennt CSS-Klassen um, ohne deutschen Fließtext anzufassen.

Eine Klasse wie `karte` steht auch mitten in einem Satz, den der Nutzer zu
sehen bekommt. Stumpf zu ersetzen würde aus "die Karte ist leer" englischen
Kauderwelsch machen. Deshalb wird nur dort ersetzt, wo ein Klassenname
tatsächlich als Klassenname steht:

  CSS   .karte, .karte:hover, .a .karte, .karte.aktiv
  HTML  class="karte etwas"
  JS    querySelector('.karte'), className = 'karte', classList.add('karte'),
        und class="karte" in zusammengebauten HTML-Schnipseln

Alles andere bleibt unberührt. Zur Kontrolle wird vorher und nachher gezählt,
wie oft der alte Name noch irgendwo steht — bleibt etwas übrig, wird es
gemeldet statt stillschweigend hingenommen.
"""
import json
import re
import sys
from pathlib import Path


def css_ersetzen(text, karte):
    """In CSS zählt nur, was hinter einem Punkt steht."""
    def tausch(m):
        return '.' + karte.get(m.group(1), m.group(1))
    return re.sub(r'\.([A-Za-z][A-Za-z0-9]*)\b', tausch, text)


def klassenliste(wert, karte):
    """Ein class-Attribut ist eine Liste durch Leerzeichen getrennter Namen."""
    return ' '.join(karte.get(t, t) for t in wert.split(' '))


def html_ersetzen(text, karte):
    """In HTML nur innerhalb von class="…"."""
    return re.sub(
        r'(\bclass=")([^"]*)(")',
        lambda m: m.group(1) + klassenliste(m.group(2), karte) + m.group(3),
        text,
    )


# Zeichenketten in JS, die Klassennamen tragen können.
SELEKTOR = re.compile(r"^[.#][A-Za-z][\w .#>:\[\]=\"'-]*$")


def js_ersetzen(text, karte):
    """In JS: Selektoren, class-Attribute in HTML-Schnipseln, classList/className.

    Zeichenketten werden einzeln angesehen. Sieht eine wie ein Selektor aus,
    werden ihre Klassenteile ersetzt; enthält sie class="…", nur das. Ein
    deutscher Satz erfüllt beides nicht und bleibt, wie er ist.
    """
    def in_zeichenkette(inhalt):
        if 'class="' in inhalt:
            return html_ersetzen(inhalt, karte)
        if SELEKTOR.match(inhalt):
            return css_ersetzen(inhalt, karte)
        # Bare Klassennamen, wie sie an classList.add() gehen: ein einzelnes
        # Wort, das genau einer bekannten Klasse entspricht.
        teile = inhalt.split(' ')
        if teile and all(t in karte for t in teile if t):
            return klassenliste(inhalt, karte)
        return inhalt

    muster = re.compile(r"""('(?:[^'\\\n]|\\.)*')|("(?:[^"\\\n]|\\.)*")|(`(?:[^`\\]|\\.)*`)""")

    def tausch(m):
        roh = m.group(0)
        anf, inhalt = roh[0], roh[1:-1]
        return anf + in_zeichenkette(inhalt) + anf

    return muster.sub(tausch, text)


def main():
    karte = json.loads(sys.argv[1])
    geaendert = 0
    for p in sys.argv[2:]:
        pfad = Path(p)
        alt = pfad.read_text()
        if pfad.suffix == '.css':
            neu = css_ersetzen(alt, karte)
        elif pfad.suffix == '.html':
            neu = html_ersetzen(alt, karte)
        elif pfad.suffix in ('.js', '.mjs'):
            neu = js_ersetzen(alt, karte)
        else:
            continue
        if neu != alt:
            pfad.write_text(neu)
            geaendert += 1
    print(f'  {geaendert} Datei(en) geändert')

    # Was ist vom alten Namen noch übrig? Wenn hier etwas auftaucht, steckt es
    # an einer Stelle, die dieses Werkzeug nicht kennt — dann lieber wissen.
    rest = {}
    for p in sys.argv[2:]:
        text = Path(p).read_text()
        for alt_name in karte:
            for m in re.finditer(r'[.\'"\s]' + re.escape(alt_name) + r'[\'"\s.:,{]', text):
                rest.setdefault(alt_name, []).append(Path(p).name)
    for name, orte in sorted(rest.items()):
        print(f'  PRÜFEN: "{name}" steht noch in {sorted(set(orte))}')


if __name__ == '__main__':
    main()
