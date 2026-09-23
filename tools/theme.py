#!/usr/bin/env python3
"""Pack a stylesheet and a palette into one theme file.

A theme that brings its own look is one JSON file with the stylesheet inside
it, which is not a thing anybody wants to edit by hand. So the look is written
as CSS beside a small description, and this puts the two together.

    tools/theme.py my-look.css my-look.json
"""
import json
import os
import sys

# What the file says about itself, beside the stylesheet of the same name.
ABOUT = ".about.json"


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 1
    css_path, out_path = argv[1], argv[2]
    about_path = os.path.splitext(css_path)[0] + ABOUT
    if not os.path.exists(about_path):
        print(f"  {about_path} is not there — it holds the name, the palette and what the look asks for")
        return 1
    theme = json.load(open(about_path, encoding="utf-8"))
    theme["css"] = open(css_path, encoding="utf-8").read()
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(theme, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"  {out_path} — {len(theme['css'])} bytes of stylesheet, {len(theme.get('palette', {}))} colours")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
