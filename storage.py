#!/usr/bin/env python3
"""Nothing worth keeping is kept in the window's storage alone.

The window is served from a port the daemon picks afresh at every start, and to
a browser a different port is a different origin — with a localStorage of its
own. Measured on one machine: eight separate stores under dev.plxr.app, one per
port the daemon had ever taken. So anything written only there is gone at the
next start, which the person using it reads as "every update throws my settings
away". It did exactly that to the CSS written in the workshop.

The rule: a file that writes to localStorage also hands the same thing to the
daemon, which keeps one copy in ~/.plxr/prefs.json whatever the port. The
window's own storage stays useful as the copy that is already there on the
first paint — a cache, never the record.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOTS = [os.path.join(HERE, "frontend", "components"), os.path.join(HERE, "frontend", "lib"), os.path.join(HERE, "frontend", "app")]

WRITES = re.compile(r"localStorage\.(setItem|removeItem)\(")
# What counts as handing it to the daemon: the prefs endpoint, or the one
# function that wraps it.
KEEPS = re.compile(r"setPrefs\(|persistVia\(|\bkeep\(")

# Files that write to storage and have nothing to keep: what they store is
# about this window at this moment and means nothing to the next one.
ALLOWED = {
    # The theme's own file hands its state to whatever App gave persistVia,
    # which is the prefs endpoint; the call by that name is in App.tsx.
    "frontend/lib/theme.ts",
}


def main() -> int:
    bad = []
    scanned = 0
    for root in ROOTS:
        for path, _, names in os.walk(root):
            for name in names:
                if not name.endswith((".ts", ".tsx")) or name.endswith(".test.ts"):
                    continue
                full = os.path.join(path, name)
                rel = os.path.relpath(full, HERE)
                scanned += 1
                text = open(full, encoding="utf-8").read()
                if not WRITES.search(text):
                    continue
                if rel in ALLOWED or KEEPS.search(text):
                    continue
                line = next((n for n, l in enumerate(text.splitlines(), 1) if WRITES.search(l)), 0)
                bad.append(f"{rel}:{line}")
    if scanned == 0:
        print("  no frontend sources found — the paths are wrong")
        return 1
    if bad:
        print(f"  {len(bad)} places keep something in the window's storage and nowhere else:")
        for b in bad:
            print(f"      {b}")
        print("      Hand it to the daemon as well (api.setPrefs), or say here why it need not last.")
        return 1
    print(f"  nothing is kept in the window's storage alone — {scanned} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
