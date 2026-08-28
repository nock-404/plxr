#!/usr/bin/env python3
"""Check data attributes: what the CSS addresses, the JavaScript has to set.

A skin writes `.selectRow[data-gewaehlt]`, the JavaScript sets `dataset.picked`
— and nothing says a word. No error, no warning, the row simply never stands
out. That is exactly what happened: the rename took the JavaScript side along
and forgot the four skins, and afterwards it was invisible in the new-session
dialog which start type had been picked.

Classes are covered by classes.py. Data attributes are not — they sit in square
brackets in the CSS and behind a dot in the JavaScript, spelled differently
(dataset.longName ⇒ data-long-name), and neither side falls over when the other
one changes.

One direction is checked: every attribute addressed in the CSS needs a writer.
The other way round would be no finding — an attribute is allowed to be pure
state for the JavaScript without anyone ever colouring it.
"""
import re
import sys
from pathlib import Path

CSS = ['web/base.css'] + sorted(str(p) for p in Path('web/skins').glob('*/skin.css'))
SOURCE = ['web/app.js', 'web/ui.js', 'web/index.html']

# Attributes we do not set ourselves: the browser, Wails or the markup itself
# bring them along.
FOREIGN = {
    'data-theme', 'data-wails-drag', 'data-titlebar-inset',
}


def kebab(name):
    """dataset.longName ⇒ data-long-name"""
    return 'data-' + re.sub(r'([A-Z])', lambda m: '-' + m.group(1).lower(), name)


def from_css(text):
    # [data-x], [data-x="yes"], [data-x='yes'] — the name is enough, not the value.
    return set(re.findall(r'\[\s*(data-[a-z0-9-]+)', text))


def from_source(text):
    found = set()
    # dataset.name = …  and dataset.name inside HTML snippets as data-name="…"
    for m in re.finditer(r'\bdataset\.([A-Za-z][\w$]*)', text):
        found.add(kebab(m.group(1)))
    # dataset['name']
    for m in re.finditer(r"""\bdataset\[\s*['"]([\w-]+)['"]""", text):
        found.add(kebab(m.group(1)) if '-' not in m.group(1) else 'data-' + m.group(1))
    # data-name="…" in the markup and in assembled snippets
    for m in re.finditer(r'\b(data-[a-z0-9-]+)\s*=', text):
        found.add(m.group(1))
    # setAttribute('data-name', …)
    for m in re.finditer(r"""setAttribute\(\s*['"](data-[a-z0-9-]+)['"]""", text):
        found.add(m.group(1))
    return found


written = set()
for d in SOURCE:
    written |= from_source(Path(d).read_text())

failed = 0
total = 0
for d in CSS:
    text = Path(d).read_text()
    for attribute in sorted(from_css(text)):
        total += 1
        if attribute in FOREIGN or attribute in written:
            continue
        failed = 1
        # Where exactly, so nobody has to go looking.
        for i, line in enumerate(text.split('\n'), 1):
            if f'[{attribute}' in line.replace('[ ', '['):
                print(f'  {d}:{i}: {attribute} is never set')
                break

if not failed:
    print(f'  {total} attribute selector(s), all of them set')

sys.exit(failed)
