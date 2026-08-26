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
import re, sys, glob, os

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web')

# Klassen, die absichtlich nur die Anordnung betreffen und in keinem Skin
# auftauchen müssen.
NUR_LAYOUT = {
    'app', 'body', 'content', 'spacer', 'rtext', 'auswahl', 'auswahlText',
    'auswahlPfeil', 'pfadListe', 'hidden', 'xterm', 'xterm-screen',
    'zeile2', 'splitliste', 'panes', 'sesssplit', 'tools', 'brand',
    'listbody', 'ruleslist', 'filetree', 'grid', 'liste', 'session', 'rail',
    'ubox', 'usum', 'urow', 'ublock', 'emptybox', 'zhaupt', 'ztat', 'rmain',
    'karte', 'hof',
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
    s = open(pfad).read()
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    return set(re.findall(r'\.([A-Za-z][\w-]*)', s))

def main():
    erzeugt = (klassen_aus_js() | klassen_aus_html()) - NUR_LAYOUT
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

    # 2. Was kennt ein Skin, ein anderer nicht?
    gestaltet = erzeugt & alle_css
    for name, k in skins.items():
        # Nur melden, was mindestens ein anderer Skin gestaltet — sonst
        # beschwert sich das Skript über reine Anordnungsklassen.
        andere = set().union(*[v for n, v in skins.items() if n != name]) if len(skins) > 1 else set()
        fehlt = sorted((gestaltet & andere) - k - base)
        if fehlt:
            fehler = 1
            print(f'  {name}: {len(fehlt)} Klassen, die andere Skins gestalten:')
            print('      ' + ' '.join('.' + x for x in fehlt))

    if not fehler:
        print('  Klassen stimmen überein')
    return fehler

sys.exit(main())
