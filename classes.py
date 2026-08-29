#!/usr/bin/env python3
"""Match the classes the JavaScript creates against the ones the CSS knows.

The reason this script exists: while base.css was being rewritten, classes got
renamed and ui.js was not brought along. The result was completely unstyled
prompts — and neither the syntax check nor the compiler notices such a thing.
A look at the screen would have shown it, but that is exactly what does not
happen on every run.

Both directions are checked:
  * JS creates a class no stylesheet knows      -> unstyled
  * one skin knows a class less than the others -> styling missing there
"""
import re, sys, glob, os, pathlib

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web')

# Classes that are deliberately layout only and need not appear in any skin:
# they carry no colour, no border, no typeface.
#
# This list was once too generous: .emptybox, .zhaupt and .auswahlPfeil were in
# it although individual skins did colour them — and the gaps in the others
# went unnoticed because of it. When in doubt a class does NOT belong here.
LAYOUT_ONLY = {
    'app', 'body', 'content', 'spacer', 'hidden',
    'xterm', 'xterm-screen',        # belongs to xterm.js
    'panes', 'sesssplit', 'tools', 'brand', 'rtext',
    'zeile2', 'griff', 'feld',
    'auswahl', 'auswahlText',       # shell without a look of its own
    'pfadListe',                    # inherits everything from .auswahlListe
    'farbwert',                     # hidden field, holds only the value
    'stil', 'stilzeile',            # grid inside the editor
    'farbwahl', 'farbflaeche', 'farbton', 'farbpunkt', 'farbtonpunkt',
    'wahl',                         # container of the start choice
}

def classes_from_js():
    """Every class name the JavaScript sets."""
    found = set()
    for f in glob.glob(os.path.join(WEB, '*.js')):
        s = open(f).read()
        # className = 'a b c'  and  className = 'a ' + x
        for m in re.finditer(r"className\s*=\s*'([^']+)'", s):
            found.update(m.group(1).split())
        # classList.add('x') / .toggle('x', …)
        for m in re.finditer(r"classList\.(?:add|toggle)\('([^']+)'", s):
            found.update(m.group(1).split())
        # class="a b" inside templates
        for m in re.finditer(r'class="([^"]+)"', s):
            found.update(m.group(1).split())
    return {k for k in found if k and not k.startswith('${')}

def classes_from_html():
    s = open(os.path.join(WEB, 'index.html')).read()
    found = set()
    for m in re.finditer(r'class="([^"]+)"', s):
        found.update(m.group(1).split())
    return found

def classes_from_css(path):
    """Classes this sheet actually styles.

    Counted is the LAST class of every selector — it is the one whose look the
    rule decides. `.tfoot .act` styles .act, not .tfoot; whoever searches by
    name alone thinks .act is covered although no skin colours it.
    """
    s = open(path).read()
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    out = set()
    for block in re.findall(r'([^{}]+)\{[^{}]*\}', s):
        for sel in block.split(','):
            sel = sel.strip()
            if not sel or sel.startswith('@'):
                continue
            # Last part of the selector, without states and attributes.
            last = re.split(r'[\s>+~]+', sel)[-1]
            last = re.sub(r'::?[a-z-]+(\([^)]*\))?', '', last)
            last = re.sub(r'\[[^\]]*\]', '', last)
            for k in re.findall(r'\.([A-Za-z][\w-]*)', last):
                out.add(k)
    return out

def main():
    created = (classes_from_js() | classes_from_html()) - LAYOUT_ONLY

    # The workbench brings its own complete sheet along and is deliberately
    # untouched by any skin: it is the tool you look through to find out why a
    # skin did not load. If it helped itself from base.css or a skin it would be
    # unreadable in exactly the case it exists for. So its classes count here
    # neither as unstyled nor as a gap in a skin — they all sit in devpanel.css.
    workbench = classes_from_css(os.path.join(WEB, 'devpanel.css'))
    created -= workbench

    base = classes_from_css(os.path.join(WEB, 'base.css'))
    skins = {os.path.basename(os.path.dirname(p)): classes_from_css(p)
             for p in sorted(glob.glob(os.path.join(WEB, 'skins', '*', 'skin.css')))}

    failed = 0

    # 1. What does nobody know at all?
    all_css = base.union(*skins.values()) if skins else base
    nowhere = sorted(created - all_css)
    if nowhere:
        failed = 1
        print('  UNSTYLED — created, but in no stylesheet:')
        for k in nowhere:
            print(f'      .{k}')

    # 2. What does one skin style and another not?
    #
    # base.css is NOT subtracted here: it holds layout only. A class can be
    # positioned in base and still need colouring in every skin — that is
    # exactly how .act, .emptybox and .zhaupt stayed colourless in win95.
    styled = created & all_css
    for name, k in skins.items():
        others = set().union(*[v for n, v in skins.items() if n != name]) if len(skins) > 1 else set()
        missing = sorted((styled & others) - k)
        if missing:
            failed = 1
            print(f'  {name}: {len(missing)} classes the other skins style:')
            print('      ' + ' '.join('.' + x for x in missing))

    failed |= same_ignore_list()
    failed |= check_ids()
    failed |= check_overrides()

    if not failed:
        print('  classes and ids agree')
    return failed


def same_ignore_list():
    """Does the workbench ignore the same classes as this gate?

    The workbench shows what a skin does not style yet. If its ignore list and
    LAYOUT_ONLY drift apart, that column fills up with classes nobody should
    ever style — a hundred entries, and the useful three drown in them. A
    column that cries wolf gets ignored, and then it is worth nothing.
    """
    js = pathlib.Path('web/app.js').read_text()
    m = re.search(r'const WB_NOT_MINE = new Set\(\[(.*?)\]\);', js, re.S)
    if not m:
        print('  the workbench has no ignore list any more')
        return 1
    theirs = set(re.findall(r"'([\w-]+)'", m.group(1)))
    missing = sorted(LAYOUT_ONLY - theirs)
    extra = sorted(theirs - LAYOUT_ONLY)
    if missing or extra:
        print('  the workbench ignores other classes than LAYOUT_ONLY:')
        if missing:
            print('      only here:           ' + ' '.join(missing))
        if extra:
            print('      only in the workbench: ' + ' '.join(extra))
        return 1
    return 0


def check_overrides():
    """Does a later rule in the same sheet undo an earlier one?

    The case it exists for: win95 had `.listbody { background: #fff }`, and 117
    lines further down `.grid, .listbody, … { background: transparent }`. Same
    specificity, the later one wins — the list was see-through, the teal desktop
    shone through, and only the even rows were opaque. No error, no warning,
    just a striped pattern that looks like intent.

    It came into being while satisfying this very file: a class was missing in
    one skin, so it was added to a collective line — with a value that does
    nothing. A gate that gets fed mechanically becomes a source of bugs.
    """
    failed = 0
    for path in sorted(glob.glob(os.path.join(WEB, 'skins', '*', 'skin.css'))) + \
            [os.path.join(WEB, 'base.css')]:
        s = re.sub(r'/\*.*?\*/', '', open(path, encoding='utf-8').read(), flags=re.S)
        seen = {}
        for i, m in enumerate(re.finditer(r'([^{}]+)\{([^{}]*)\}', s)):
            sel, body = m.group(1), m.group(2)
            values = re.findall(r'(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)', body)
            if not values:
                continue
            for part in sel.split(','):
                part = part.strip()
                if re.search(r'[:\[]', part):
                    continue          # states and attributes may override
                last = re.split(r'[\s>+~]+', part)[-1]
                for k in re.findall(r'^\.([A-Za-z][\w-]*)$', last):
                    seen.setdefault(k, []).append(values[-1].strip())
        for k, v in sorted(seen.items()):
            if len(v) > 1 and v[-1] in ('transparent', 'none') and v[0] not in ('transparent', 'none'):
                failed = 1
                rel = os.path.relpath(path, os.path.dirname(WEB))
                print(f'  {rel}: .{k} gets "{v[0]}" and further down "{v[-1]}" — '
                      f'the later rule undoes the earlier one')
    return failed


def check_ids():
    """Does the JavaScript call an element id the HTML does not have?

    $('#doesNotExist') returns null, and the next access to it throws — or,
    worse, sits behind a ?. and silently does nothing. That is exactly how the
    restart after an update would have disappeared during the rename. The match
    costs nothing and catches the whole class.
    """
    import re
    html = pathlib.Path('web/index.html').read_text()
    present = set(re.findall(r'\bid="([A-Za-z][A-Za-z0-9]*)"', html))

    js = ''
    for f in ('web/app.js', 'web/ui.js'):
        js += pathlib.Path(f).read_text()
    called = set(re.findall(r"""\$\(['"]#([A-Za-z][A-Za-z0-9]*)""", js))

    # Also ids that do not sit next to $() but inside a list.
    #
    # The reason: DIALOGS = ['#settings', '#vorlagen', …] and then $(d) in the
    # loop. To the search above that is invisible, and that is exactly how
    # '#vorlagen' survived the rename — the line threw at startup, everything
    # after it in app.js never ran, and the interface stood there without a skin.
    #
    # Deliberately only lists whose entries are ALL id selectors. A single
    # string with a hash is too little: '#ton' is a salt for a hash function and
    # '#ffcf5c' is a colour — both would look the same.
    for group in re.findall(r"""\[\s*((?:['"]#[A-Za-z][\w-]*['"]\s*,\s*)+['"]#[A-Za-z][\w-]*['"])\s*,?\s*\]""", js):
        called |= set(re.findall(r"""['"]#([A-Za-z][\w-]*)['"]""", group))
    called |= set(re.findall(r"""getElementById\(['"]([A-Za-z][A-Za-z0-9]*)""", js))
    called |= set(re.findall(r"""querySelector(?:All)?\(['"]#([A-Za-z][A-Za-z0-9]*)""", js))

    missing = sorted(called - present)
    if missing:
        print(f'  {len(missing)} ids are called but appear in no HTML:')
        print('      ' + ' '.join('#' + x for x in missing))
        return 1
    return 0

sys.exit(main())
