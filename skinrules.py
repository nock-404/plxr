#!/usr/bin/env python3
"""A skin dresses; it does not measure.

The frame belongs to layout.css: bar height, rail width, row pitch, control
metrics. When a skin set its own padding the header grew from 59 pixels to 78 in
that one skin, and nobody saw it, because nobody had two skins open side by side.

So the rule is written down rather than remembered: no size in a skin file.
Colour, border, shadow, typeface, rounding, capitalisation, transform — all of
that is a skin's own business and stays untouched.

`font-size` and `line-height` remain allowed: a skin brings its own typeface and
that is the point of it. What keeps them from stretching a row is that the rows
have a height in layout.css — checked separately by geometry.mjs, which measures
the real window in every skin.
"""
import os
import re
import sys
from glob import glob

HERE = os.path.dirname(os.path.abspath(__file__))
STYLES = os.path.join(HERE, "frontend", "app", "styles")

# Properties that decide where something sits and how big it is.
SIZING = (
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "width", "height", "min-width", "min-height", "max-width", "max-height",
    "gap", "row-gap", "column-gap", "top", "right", "bottom", "left", "inset",
    "flex", "flex-basis", "flex-grow", "flex-shrink", "grid-template",
    "grid-template-columns", "grid-template-rows", "grid-column", "grid-row",
)

# A number: 4px, 1.5rem, 60%, 0. A keyword like `auto` or `none` decides nothing
# about size, so `display: none` on an effect layer stays a look decision.
NUMBER = re.compile(r"(^|[^\w-])[0-9]")

files = sorted(glob(os.path.join(STYLES, "skin-*.css")))
if not files:
    print("  read no skins at all — the path is wrong")
    sys.exit(1)

bad = []
for path in files:
    rel = os.path.relpath(path, HERE)
    text = open(path, encoding="utf-8").read()
    # Comments explain; they do not style.
    text = re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group(0)), text, flags=re.S)

    # Declarations live between braces. Splitting the file by lines and then by
    # semicolons hides them: in `.tile { padding: 2rem; }` the first piece is
    # the selector plus the property, and the property is never seen. So the
    # blocks are found first, and only what is inside them is read.
    for block in re.finditer(r"\{([^{}]*)\}", text):
        line_no = text.count("\n", 0, block.start()) + 1
        for decl in block.group(1).split(";"):
            if ":" not in decl:
                continue
            name, _, value = decl.partition(":")
            name = name.strip().lower()
            if name in SIZING and NUMBER.search(value):
                bad.append(f"{rel}:{line_no}  {name}: {value.strip()[:40]} — sizes belong in layout.css")

if bad:
    print(f"  {len(bad)} sizes set inside a skin:")
    for b in bad[:20]:
        print(f"      {b}")
    sys.exit(1)
print(f"  no skin sets a size — {len(files)} files")
