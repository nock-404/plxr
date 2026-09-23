#!/usr/bin/env python3
"""Every typeface that ships is named, with its licence, and both are in the build.

Four fonts travelled inside every copy of plxr from the first day and the page
that exists to carry third-party notices said nothing about any of them. All
four are under the SIL Open Font License, which asks for exactly two things:
that the copyright notice travels with the files, and that the licence text
does. Neither did.

So this holds three things together: the list in frontend/lib/typefaces.ts, the
font files under frontend/public/fonts, and the licence texts under
frontend/public/licenses. A font file nobody declared, a declaration with no
licence text, a licence text that names nothing — each of them fails here.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LIST = os.path.join(HERE, "frontend", "lib", "typefaces.ts")
PUBLIC = os.path.join(HERE, "frontend", "public")
FONTS = os.path.join(PUBLIC, "fonts")


def main() -> int:
    if not os.path.exists(LIST):
        print(f"  {LIST} is not there — the list of typefaces has moved")
        return 1
    text = open(LIST, encoding="utf-8").read()
    entries = re.findall(
        r"\{\s*id:\s*\"([^\"]+)\",.*?licenceFile:\s*\"([^\"]+)\",\s*file:\s*\"([^\"]+)\"",
        text,
        flags=re.S,
    )
    if not entries:
        print("  the list of typefaces reads as empty — the shape of the file changed")
        return 1

    bad = []
    declared = set()
    for ident, licence, font in entries:
        declared.add(os.path.basename(font))
        if not os.path.exists(os.path.join(PUBLIC, licence)):
            bad.append(f"{ident}: no licence text at frontend/public/{licence}")
        elif os.path.getsize(os.path.join(PUBLIC, licence)) < 500:
            bad.append(f"{ident}: the licence text at frontend/public/{licence} is too short to be one")
        if not os.path.exists(os.path.join(PUBLIC, font)):
            bad.append(f"{ident}: no font file at frontend/public/{font}")

    # A file nobody declared: the one that ships without a notice.
    for name in sorted(os.listdir(FONTS)) if os.path.isdir(FONTS) else []:
        if not name.endswith((".woff2", ".woff", ".ttf", ".otf")):
            continue
        # One declaration may stand for a family shipped in several weights.
        family = re.sub(r"-\d+\.woff2$", "", name)
        if name in declared or any(d.startswith(family) for d in declared):
            continue
        bad.append(f"frontend/public/fonts/{name} ships and is named in no licence")

    if bad:
        print(f"  {len(bad)} things about the typefaces do not hold:")
        for b in bad:
            print(f"      {b}")
        return 1
    print(f"  every typeface that ships carries its licence — {len(entries)} families")
    return 0


if __name__ == "__main__":
    sys.exit(main())
