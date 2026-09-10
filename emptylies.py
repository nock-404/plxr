#!/usr/bin/env python3
"""A view may not say "there is nothing" before it has asked.

Every list in the window starts with an empty array and fills it when the
answer arrives. Until then it renders its empty state — so opening PORTS says
"nothing listening" for as long as the daemon takes to look, and on macOS that
is not a flicker: asking the system who holds which port takes its time. The
same pattern sat in five views.

It is a lie in the exact place where the window is supposed to be trustworthy,
and it is invisible in a screenshot taken a second later. The check that
caught it reported "0 of 19 ports" one run and all 19 the next.

The rule: a list whose empty state is on screen must be able to tell "not
asked yet" from "asked, and there is nothing". Holding the state as null until
the first answer does that; an empty array cannot.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WHERE = os.path.join(HERE, "frontend", "components")

# useState<Thing[]>([])  — an empty list from the start
BLIND = re.compile(r"useState<[^>]*\[\]>\(\s*\[\s*\]\s*\)")


def main():
    offenders = []
    for root, dirs, names in os.walk(WHERE):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for name in sorted(names):
            if not name.endswith(".tsx"):
                continue
            full = os.path.join(root, name)
            with open(full, encoding="utf-8") as fh:
                text = fh.read()
            if "emptyNote" not in text:
                continue
            for i, line in enumerate(text.splitlines(), 1):
                if BLIND.search(line):
                    offenders.append(f"{os.path.relpath(full, HERE)}:{i}  {line.strip()}")

    if offenders:
        print()
        print('      these show their empty state before the answer is in,')
        print('      so the window says "there is nothing" while it is still asking:')
        print()
        for o in offenders:
            print(f"          {o}")
        print()
        print("      hold the list as null until the first answer.")
        print()
        return 1

    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
