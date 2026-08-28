#!/usr/bin/env python3
"""Rename CSS classes without touching German prose.

A class such as `karte` also occurs in the middle of a sentence the user gets
to see. Replacing bluntly would turn "die Karte ist leer" into English
gibberish. So the replacement only happens where a class name really stands as
a class name:

  CSS   .karte, .karte:hover, .a .karte, .karte.aktiv
  HTML  class="karte etwas"
  JS    querySelector('.karte'), className = 'karte', classList.add('karte'),
        and class="karte" inside assembled HTML snippets

Everything else stays untouched. As a control, the old name is counted before
and afterwards — whatever is left over gets reported instead of quietly
accepted.
"""
import json
import re
import sys
from pathlib import Path


def css_ersetzen(text, karte):
    """In CSS only what follows a dot counts."""
    def tausch(m):
        return '.' + karte.get(m.group(1), m.group(1))
    return re.sub(r'\.([A-Za-z][A-Za-z0-9]*)\b', tausch, text)


def klassenliste(wert, karte):
    """A class attribute is a list of names separated by spaces."""
    return ' '.join(karte.get(t, t) for t in wert.split(' '))


def html_ersetzen(text, karte):
    """In HTML only inside class="…"."""
    return re.sub(
        r'(\bclass=")([^"]*)(")',
        lambda m: m.group(1) + klassenliste(m.group(2), karte) + m.group(3),
        text,
    )


# Strings in JS that can carry class names.
SELEKTOR = re.compile(r"^[.#][A-Za-z][\w .#>:\[\]=\"'-]*$")


def js_ersetzen(text, karte):
    """In JS: selectors, class attributes in HTML snippets, classList/className.

    Strings are looked at one by one. If one looks like a selector, its class
    parts are replaced; if it contains class="…", only that. A German sentence
    satisfies neither and stays as it is.
    """
    def in_zeichenkette(inhalt):
        if 'class="' in inhalt:
            return html_ersetzen(inhalt, karte)
        if SELEKTOR.match(inhalt):
            return css_ersetzen(inhalt, karte)
        # Bare class names, as they go to classList.add(): a single word that
        # matches exactly one known class.
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


def id_ersetzen(text, karte, ist_js):
    """Element ids: id="x" in the HTML, '#x' as a selector in the JavaScript.

    Ids are less ambiguous than classes — they rarely sit in the middle of a
    sentence. The same rule applies anyway: replace in context only, never in
    prose.
    """
    text = re.sub(
        r'(\bid=")([A-Za-z][A-Za-z0-9]*)(")',
        lambda m: m.group(1) + karte.get(m.group(2), m.group(2)) + m.group(3),
        text,
    )
    if ist_js:
        text = re.sub(
            r"(\$\(['\"]#)([A-Za-z][A-Za-z0-9]*)",
            lambda m: m.group(1) + karte.get(m.group(2), m.group(2)),
            text,
        )
        # getElementById and querySelector('#…') occur as well
        text = re.sub(
            r"(getElementById\(['\"])([A-Za-z][A-Za-z0-9]*)",
            lambda m: m.group(1) + karte.get(m.group(2), m.group(2)),
            text,
        )
        text = re.sub(
            r"(querySelector(?:All)?\(['\"]#)([A-Za-z][A-Za-z0-9]*)",
            lambda m: m.group(1) + karte.get(m.group(2), m.group(2)),
            text,
        )
    return text


def main():
    karte = json.loads(sys.argv[1])
    modus = 'klassen'
    if karte.get('__modus'):
        modus = karte.pop('__modus')
    geaendert = 0
    for p in sys.argv[2:]:
        pfad = Path(p)
        alt = pfad.read_text()
        if modus == 'ids':
            neu = id_ersetzen(alt, karte, pfad.suffix in ('.js', '.mjs'))
        elif pfad.suffix == '.css':
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

    # What is left of the old name? If something shows up here it sits in a spot
    # this tool does not know about — better to know.
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
