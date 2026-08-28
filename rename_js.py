#!/usr/bin/env python3
"""Rename JavaScript identifiers without touching strings and comments.

Same approach as on the Go side: the source is split into code and non-code,
and only the code is replaced. What the user gets to see sits in strings and
stays untouched; the comments are handled in a pass of their own.

Unlike Go, JavaScript has no compiler that reports a forgotten spot. So
afterwards it is verified that the strings demonstrably did not change — and
the rest has to fall out of classes.py, bindings.py, the parser test and
`node --check`.
"""
import json
import re
import sys
from pathlib import Path

# Strings, template strings and comments. Regex literals are deliberately
# NOT recognised: telling them apart from a division reliably takes half a
# parser. Instead it is checked afterwards whether one of them changed —
# then it comes out, instead of happening quietly.
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
            # A template string is not text all the way through: inside ${…}
            # there is executable code. Skipping it would mean that
            # `${shortText(x)}` keeps the old name while the function is
            # already called something else — and JavaScript says nothing
            # until it blows up at runtime.
            s = re.sub(r'\$\{([^{}]*)\}',
                       lambda m: '${' + _im_code(m.group(1), karte) + '}', s)
        stuecke.append(s)
    return ''.join(stuecke)


def unberuehrt(text):
    """Everything that must not change.

    Template strings are exempt: their ${…} hold code that has to be renamed
    along. For them only the text outside the substitutions is checked.
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
