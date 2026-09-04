#!/usr/bin/env python3
"""Every skin dresses every class that needs dressing.

A skin is allowed to look completely different; it is not allowed to forget a
class. When it does, that part of the interface falls back to nothing — unstyled
text on a bare surface — and it only shows up when somebody happens to open that
one panel in that one skin. So the layout layer names the classes, and this
check reports which skin has never heard of them.

Not every class needs a skin. The ones listed under LAYOUT_ONLY carry nothing
but arrangement — a grid, a spacer, a flex row — and a skin that styles them
would be reaching into the layer below it.
"""
import os
import re
import sys
from glob import glob

HERE = os.path.dirname(os.path.abspath(__file__))
STYLES = os.path.join(HERE, "frontend", "app", "styles")

# Arrangement only: position, flex, grid, overflow. Nothing to colour in.
#
# This list was once much longer, and every entry past the honest ones was added
# for the same reason: a skin had forgotten a class, the gate said so, and the
# name went in here. Measured afterwards, 41 of them were dressed by every skin
# anyway — exemptions protecting nothing — and 23 were dressed by one skin and
# no other, which is precisely the defect this file exists to find. An exemption
# list is where a check quietly stops checking, so a name earns its place here
# only by carrying no colour, border or typeface in any skin at all.
LAYOUT_ONLY = {
    # Boxes and rails that only place what sits inside them.
    "app", "body", "stage", "content", "grid", "list", "listbody", "panes",
    "work", "workstrip", "workrow",
    # A card with a width, and a readout that is nothing but a row of numbers.
    "folderpick", "meter",
    # A mark's file list and one row in it: arrangement, and the two things in
    # the row carry their own colour.
    "markfiles", "markfile",
    "panel", "session", "sesssplit", "spacer", "splitList", "tabbody", "tall",
    "wide", "queue", "queuelist", "tools", "viewer", "viewerwrap", "ask",
    "viewermarks", "filetree", "playterm", "wbBody", "ruleslist", "urow",
    # Rows, cells and handles: geometry with no surface of their own.
    "field", "rowInline", "choice", "cardButtons", "dialogFoot", "keyCell",
    "hitMain", "hitAction", "draghandle", "brand", "rtext", "rname", "rmain",
    "fname", "style", "styleRow", "pathfield", "colourPicker", "settingsbody",
    # The CRT screen furniture, drawn from tokens rather than dressed.
    "crest", "cursor", "hint", "line", "progress", "screenbar", "term", "title",
    # xterm and CodeMirror bring their own stylesheets; a skin colours them
    # through the --term-* tokens, not by reaching into another project's
    # classes. "editor" is the box one of them is put in.
    "xterm", "xterm-viewport", "xterm-rows", "xterm-screen", "editor",
    # The bare box xterm is opened into. It exists so that what the fit addon
    # measures is the room the terminal actually has: the padding and border
    # belong to .pterm around it, and this one carries nothing at all — which
    # is the whole point of it, not an oversight.
    "ptermbox",
}

# What a skin must have an opinion about: anything that carries colour, a
# border, a typeface or a state.
def classes_of(path):
    css = re.sub(r"/\*.*?\*/", "", open(path, encoding="utf-8").read(), flags=re.S)
    return set(re.findall(r"\.([a-zA-Z][\w-]*)", css))


layout_file = os.path.join(STYLES, "layout.css")
if not os.path.exists(layout_file):
    print("  layout.css not found — the path is wrong")
    sys.exit(1)

named = classes_of(layout_file) - LAYOUT_ONLY
skins = sorted(p for p in glob(os.path.join(STYLES, "skin-*.css"))
             if os.path.basename(p) != "skin-base.css")
base_file = os.path.join(STYLES, "skin-base.css")
if not skins:
    print("  read no skins at all — the path is wrong")
    sys.exit(1)

fail = 0

# A class a component renders but nobody styles.
#
# The check below asks whether every skin dresses what layout.css names — which
# says nothing about a class that layout.css never heard of. `.emptyNote` was
# rendered in nine views and styled in no file at all: raw text, running
# together, across the whole window, and every gate green.
def rendered_classes():
    out = {}
    for root, dirs, files in os.walk(os.path.join(HERE, "frontend")):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".next", "out")]
        for name in files:
            if not name.endswith(".tsx"):
                continue
            path = os.path.join(root, name)
            text = open(path, encoding="utf-8").read()
            for quoted, templated in re.findall(r'className=(?:"([^"]*)"|\{`([^`]*)`\})', text):
                # An interpolation is a value, not a class: `dot ${state}` names
                # one class and one variable.
                cleaned = re.sub(r"\$\{[^}]*\}", " ", quoted + " " + templated)
                for chunk in cleaned.split():
                    if re.fullmatch(r"[a-zA-Z][\w-]*", chunk):
                        out.setdefault(chunk, set()).add(name)
    return out


styled_anywhere = set()
for path in [layout_file, base_file] + skins:
    styled_anywhere |= classes_of(path)

unstyled = {n: where for n, where in rendered_classes().items() if n not in styled_anywhere}
if unstyled:
    fail = 1
    print(f"  {len(unstyled)} classes are rendered but styled nowhere:")
    for n, where in sorted(unstyled.items()):
        print(f"      .{n}  ({', '.join(sorted(where))})")


# The daemon and the window each hold a list of what skins exist: the daemon
# validates a theme's `skin` field against the directories it serves, the window
# compiles one stylesheet per skin. Nothing keeps those two in step, so a skin
# added on one side alone would make every theme naming it fail validation —
# or dress nothing.
served = sorted(
    d for d in os.listdir(os.path.join(HERE, "assets", "skins"))
    if os.path.isdir(os.path.join(HERE, "assets", "skins", d))
) if os.path.isdir(os.path.join(HERE, "assets", "skins")) else []
compiled = sorted(os.path.basename(p)[5:-4] for p in skins)
if served != compiled:
    fail = 1
    print(f"  the two lists of skins disagree:")
    print(f"      daemon serves : {', '.join(served) or '(none)'}")
    print(f"      window dresses: {', '.join(compiled) or '(none)'}")

# Where a class may be dressed: in the shared layer, or in every skin.
#
# "In the shared layer or in some skin" is not enough, and letting that stand
# cost an hour: .updatebar was dressed in win95 alone, so the update band came
# up bare in the other three and the gate said nothing. One skin having an
# opinion about a class is proof the class carries dressing — which makes the
# other three's silence the defect, not the exemption.
shared = classes_of(base_file) if os.path.exists(base_file) else set()
per_skin = {os.path.basename(p)[5:-4]: classes_of(p) for p in skins}
holes = {}
for name in sorted(named - shared):
    absent = [s for s, c in per_skin.items() if name not in c]
    if absent:
        holes[name] = absent
if holes:
    fail = 1
    print(f"  {len(holes)} classes are dressed neither in the shared layer nor in every skin:")
    for name, absent in holes.items():
        print(f"      .{name:16} missing from: {', '.join(absent)}")

# A skin file may only speak about its own skin.
#
# All four stylesheets load together, so a rule in one of them without its own
# [data-skin=...] applies to all of them. skin-crt.css had 177 such rules: it
# was the shared base while looking like one skin, changing the tube silently
# changed Windows 95, and three skins seemed to have forgotten classes they had
# simply never needed to mention. The shared layer is skin-base.css now, and
# this keeps it the only one.
def top_level(text):
    text, out, i = re.sub(r"/\*.*?\*/", "", text, flags=re.S), [], 0
    while i < len(text):
        if text[i].isspace():
            i += 1
            continue
        j, depth = i, 0
        while j < len(text):
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
                if depth == 0:
                    j += 1
                    break
            j += 1
        out.append(text[i:j])
        i = j
    return out

for path in skins:
    name = os.path.basename(path)[5:-4]
    scope = f'[data-skin="{name}"]'
    loose = []
    for block in top_level(open(path, encoding="utf-8").read()):
        head = block.split("{", 1)[0].strip()
        if head.startswith("@keyframes"):
            if name not in head:
                loose.append(head + "  (a name any skin could match)")
        elif head.startswith("@"):
            if scope not in block:
                loose.append(head + "  { ... }")
        elif scope not in head:
            loose.append(head)
    if loose:
        fail = 1
        print(f"  {name}: {len(loose)} rules are not scoped to this skin, so they dress all four:")
        for sel in loose[:12]:
            print(f"      {' '.join(sel.split())[:96]}")
        if len(loose) > 12:
            print(f"      ... and {len(loose) - 12} more")

# An animation nobody defined.
#
# Keyframes belong to the document, not to the file they are written in, so a
# movement defined in one stylesheet works from another — measured, in all four
# skins. What does not work is one that was renamed, moved out, or never written:
# the rule stays valid CSS, the element simply never moves, and nothing anywhere
# says so.
def animations(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    words = {
        "infinite", "linear", "ease", "ease-in", "ease-out", "ease-in-out",
        "alternate", "alternate-reverse", "both", "forwards", "backwards",
        "none", "normal", "reverse", "paused", "running", "initial", "inherit",
        "unset", "steps", "cubic-bezier", "step-start", "step-end",
    }
    named = set()
    for m in re.finditer(r"animation(?:-name)?\s*:\s*([^;}]+)", text):
        value = m.group(1)
        # A duration is not a name, and neither is what is inside steps() or a
        # curve — "5s" and "steps(70, end)" both offered one otherwise.
        value = re.sub(r"[A-Za-z-]+\([^)]*\)", " ", value)
        value = re.sub(r"[\d.]+m?s\b", " ", value)
        value = value.replace("!important", " ")
        for token in re.findall(r"[A-Za-z][\w-]*", value):
            if token not in words:
                named.add(token)
    return named

every = [layout_file] + ([base_file] if os.path.exists(base_file) else []) + skins
defined, wanted = set(), {}
for path in every:
    text = open(path, encoding="utf-8").read()
    defined |= set(re.findall(r"@keyframes\s+([\w-]+)", text))
    for name in animations(text):
        wanted.setdefault(name, set()).add(os.path.basename(path))
missing = {n: w for n, w in wanted.items() if n not in defined}
if missing:
    fail = 1
    print(f"  {len(missing)} animations are asked for and defined nowhere:")
    for name, where in sorted(missing.items()):
        print(f"      {name}  (asked for in {', '.join(sorted(where))})")

if not fail:
    print(f"  all {len(named)} laid-out classes dressed, {len(skins)} skins each speaking only for itself")
sys.exit(fail)
