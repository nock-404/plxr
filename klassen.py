#!/usr/bin/env python3
"""Abgleich zwischen den Klassen, die JavaScript erzeugt, und denen, die CSS kennt.

Der Grund für dieses Skript: beim Neuschreiben von base.css wurden Klassen
umbenannt, ui.js aber nicht mitgezogen. Ergebnis waren völlig ungestylte
Rückfragen — und weder die Syntaxprüfung noch der Compiler merkt so etwas.
Ein Blick ins Bild hätte es gezeigt, aber genau der passiert nicht bei jedem
Durchlauf.

Geprüft wird beides:
  * JS erzeugt eine Klasse, die kein Stylesheet kennt  -> ungestylt
  * ein Skin kennt eine Klasse weniger als die anderen -> dort fehlt Gestaltung
"""
import re, sys, glob, os, pathlib

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web')

# Klassen, die absichtlich nur die Anordnung betreffen und in keinem Skin
# auftauchen müssen.
# Klassen, die wirklich nur Anordnung sind — sie tragen keine Farbe, keinen
# Rahmen, keine Schrift und müssen deshalb in keinem Skin auftauchen.
#
# Die Liste war schon einmal zu großzügig: .emptybox, .zhaupt und
# .auswahlPfeil standen darin, wurden aber sehr wohl von einzelnen Skins
# eingefärbt — und die Lücken in den anderen fielen dadurch nicht auf.
# Im Zweifel gehört eine Klasse NICHT hierher.
NUR_LAYOUT = {
    'app', 'body', 'content', 'spacer', 'hidden',
    'xterm', 'xterm-screen',        # gehört xterm.js
    'panes', 'sesssplit', 'tools', 'brand', 'rtext',
    'zeile2', 'griff', 'feld',
    'auswahl', 'auswahlText',       # Hülle ohne eigenes Aussehen
    'pfadListe',                    # erbt alles von .auswahlListe
    'farbwert',                     # verstecktes Feld, hält nur den Wert
    'stil', 'stilzeile',            # Raster im Editor
    'farbwahl', 'farbflaeche', 'farbton', 'farbpunkt', 'farbtonpunkt',
    'wahl',                         # Behälter der Startauswahl
}

def klassen_aus_js():
    """Alle Klassennamen, die im JavaScript gesetzt werden."""
    treffer = set()
    for datei in glob.glob(os.path.join(WEB, '*.js')):
        s = open(datei).read()
        # className = 'a b c'  und  className = 'a ' + x
        for m in re.finditer(r"className\s*=\s*'([^']+)'", s):
            treffer.update(m.group(1).split())
        # classList.add('x') / .toggle('x', …)
        for m in re.finditer(r"classList\.(?:add|toggle)\('([^']+)'", s):
            treffer.update(m.group(1).split())
        # class="a b" in Vorlagen
        for m in re.finditer(r'class="([^"]+)"', s):
            treffer.update(m.group(1).split())
    return {k for k in treffer if k and not k.startswith('${')}

def klassen_aus_html():
    s = open(os.path.join(WEB, 'index.html')).read()
    treffer = set()
    for m in re.finditer(r'class="([^"]+)"', s):
        treffer.update(m.group(1).split())
    return treffer

def klassen_aus_css(pfad):
    """Klassen, die dieses Blatt wirklich gestaltet.

    Gezählt wird die LETZTE Klasse jedes Selektors — sie ist die, deren
    Aussehen die Regel bestimmt. `.tfoot .act` gestaltet .act, nicht .tfoot;
    wer nur nach Namen sucht, hält .act für abgedeckt, obwohl kein Skin es
    einfärbt.
    """
    s = open(pfad).read()
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    out = set()
    for block in re.findall(r'([^{}]+)\{[^{}]*\}', s):
        for sel in block.split(','):
            sel = sel.strip()
            if not sel or sel.startswith('@'):
                continue
            # Letzter Teil des Selektors, ohne Zustände und Attribute.
            letzter = re.split(r'[\s>+~]+', sel)[-1]
            letzter = re.sub(r'::?[a-z-]+(\([^)]*\))?', '', letzter)
            letzter = re.sub(r'\[[^\]]*\]', '', letzter)
            for k in re.findall(r'\.([A-Za-z][\w-]*)', letzter):
                out.add(k)
    return out

def main():
    erzeugt = (klassen_aus_js() | klassen_aus_html()) - NUR_LAYOUT

    # Die Werkbank bringt ihr eigenes, vollständiges Blatt mit und wird
    # absichtlich von keinem Skin angefasst: sie ist das Werkzeug, mit dem man
    # nachsieht, warum ein Skin nicht geladen hat. Würde sie sich aus base.css
    # oder einem Skin bedienen, wäre sie in genau dem Fall unlesbar, für den es
    # sie gibt. Deshalb zählen ihre Klassen hier weder als ungestylt noch als
    # Lücke in einem Skin — sie stehen vollständig in devpanel.css.
    werkbank = klassen_aus_css(os.path.join(WEB, 'devpanel.css'))
    erzeugt -= werkbank
    base = klassen_aus_css(os.path.join(WEB, 'base.css'))
    skins = {os.path.basename(os.path.dirname(p)): klassen_aus_css(p)
             for p in sorted(glob.glob(os.path.join(WEB, 'skins', '*', 'skin.css')))}

    fehler = 0

    # 1. Was kennt überhaupt niemand?
    alle_css = base.union(*skins.values()) if skins else base
    nirgends = sorted(erzeugt - alle_css)
    if nirgends:
        fehler = 1
        print('  UNGESTYLT — erzeugt, aber in keinem Stylesheet:')
        for k in nirgends:
            print(f'      .{k}')

    # 2. Was gestaltet ein Skin, ein anderer nicht?
    #
    # base.css wird hier NICHT abgezogen: dort steht nur Anordnung. Eine
    # Klasse kann in base positioniert und trotzdem in jedem Skin eingefärbt
    # werden müssen — genau so sind .act, .emptybox und .zhaupt in win95
    # unbemerkt farblos geblieben.
    gestaltet = erzeugt & alle_css
    for name, k in skins.items():
        andere = set().union(*[v for n, v in skins.items() if n != name]) if len(skins) > 1 else set()
        fehlt = sorted((gestaltet & andere) - k)
        if fehlt:
            fehler = 1
            print(f'  {name}: {len(fehlt)} Klassen, die andere Skins gestalten:')
            print('      ' + ' '.join('.' + x for x in fehlt))

    fehler |= ids_pruefen()

    if not fehler:
        print('  Klassen und IDs stimmen überein')
    return fehler


def ids_pruefen():
    """Ruft das JavaScript eine Element-ID, die es im HTML nicht gibt?

    $('#gibtsnicht') liefert null, und der nächste Zugriff darauf wirft — oder,
    schlimmer, steht hinter einem ?. und tut wortlos nichts. Genau so wäre bei
    der Umbenennung der Neustart nach einem Update verschwunden. Der Abgleich
    kostet nichts und fängt die ganze Klasse.
    """
    import re
    html = pathlib.Path('web/index.html').read_text()
    vorhanden = set(re.findall(r'\bid="([A-Za-z][A-Za-z0-9]*)"', html))

    js = ''
    for f in ('web/app.js', 'web/ui.js'):
        js += pathlib.Path(f).read_text()
    gerufen = set(re.findall(r"""\$\(['"]#([A-Za-z][A-Za-z0-9]*)""", js))
    gerufen |= set(re.findall(r"""getElementById\(['"]([A-Za-z][A-Za-z0-9]*)""", js))
    gerufen |= set(re.findall(r"""querySelector(?:All)?\(['"]#([A-Za-z][A-Za-z0-9]*)""", js))

    fehlt = sorted(gerufen - vorhanden)
    if fehlt:
        print(f'  {len(fehlt)} IDs werden gerufen, stehen aber in keinem HTML:')
        print('      ' + ' '.join('#' + x for x in fehlt))
        return 1
    return 0

sys.exit(main())
