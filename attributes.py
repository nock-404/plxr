#!/usr/bin/env python3
"""What the stylesheets address, something has to set.

A skin writes `.frow[data-git="modified"]`, the component sets `data-git` to
"changed", and nothing anywhere says a word: no error, no warning, the row
simply never carries its mark. The same holds the other way for a rule that
addresses an attribute nobody sets at all — dead styling that looks like a
feature.

Values are checked as well as names, because that is where the mistake actually
happens. Names survive a rename; values are typed twice, in two languages, and
they drift.

This replaces a file of the same name carried over from the old project. That
one read paths which do not exist here, crashed on every run, and was never
called by anything — so it looked like a check for months while checking
nothing.
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STYLES = os.path.join(HERE, "frontend", "app", "styles")
CODE = os.path.join(HERE, "frontend")
SKIP = {"node_modules", ".next", "out"}

# Set by the browser or by a library, not by us.
NOT_OURS = {"theme"}


def css_text():
    out = []
    for name in sorted(os.listdir(STYLES)):
        if name.endswith(".css"):
            out.append(open(os.path.join(STYLES, name), encoding="utf-8").read())
    return re.sub(r"/\*.*?\*/", "", "\n".join(out), flags=re.S)


def code_text():
    """Both sides of the wire.

    The values are not all written in the window. `data-git="modified"` is styled
    here and the word itself is a constant in the daemon, which sends it over the
    API — so a scan of the frontend alone reports six styled values as unset and
    is wrong six times. Reading Go as well is not thoroughness for its own sake:
    that crossing is precisely where a rename goes unnoticed, because no compiler
    sees both ends of it.
    """
    out = []
    for base, exts in ((CODE, (".tsx", ".ts")), (os.path.join(HERE, "internal"), (".go",))):
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in SKIP]
            for name in sorted(files):
                if name.endswith(exts):
                    out.append(open(os.path.join(root, name), encoding="utf-8").read())
    return "\n".join(out)


css = css_text()
code = code_text()

# What the stylesheets ask for: the bare name, and each value they single out.
asked_names = set(re.findall(r"\[data-([a-z-]+)", css))
asked_pairs = set(re.findall(r'\[data-([a-z-]+)\s*[~^$*|]?=\s*"([^"]*)"', css))

# What the code sets, however it is written: as a JSX attribute, through
# setAttribute, or through the dataset.
set_names = set(re.findall(r'data-([a-z-]+)\s*=', code))
set_names |= set(re.findall(r'setAttribute\(\s*"data-([a-z-]+)"', code))
set_names |= {
    re.sub(r"([A-Z])", r"-\1", name).lower()
    for name in re.findall(r"dataset\.([A-Za-z]\w*)", code)
}

# Every string the code could put into one. Deliberately generous: a value
# assembled at run time is not something a text search can follow, and a check
# that guesses would cry wolf.
# Word-shaped literals only. Pairing quotes naively across a line swallows the
# code between two real strings — `? "seethrough" : "", state.gradient ? "` was
# read as one literal, and the word after it disappeared with it. A value that
# is nothing but letters, digits and dashes cannot span code, so it cannot be
# eaten that way.
values = set(re.findall(r'"([\w-]{1,32})"', code)) | set(re.findall(r"'([\w-]{1,32})'", code))


bad = []
for name in sorted(asked_names - set_names - NOT_OURS):
    bad.append(f"the stylesheets address data-{name}, and nothing sets it")

for name, value in sorted(asked_pairs):
    if name in NOT_OURS or name not in set_names:
        continue
    if value and value not in values:
        bad.append(f'data-{name}="{value}" is styled, and that value is never set')

for line in bad:
    print("  " + line, file=sys.stderr)
if not bad:
    print(f"  {len(asked_names)} attributes and {len(asked_pairs)} of their values, all set somewhere")
sys.exit(1 if bad else 0)
