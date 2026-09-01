#!/usr/bin/env python3
"""Do the two lists of palette entries still agree?

There are two, and neither knows about the other. `theme.Allowed` in Go decides
which entries an imported theme may carry. `TOKENS` in the window decides which
ones are written onto the page as CSS custom properties.

An entry in only one of them fails in a way nobody traces back. In Go only: the
theme imports cleanly and that colour never appears. In the window only: the
importer strips the entry, so a theme file that names it loses it without a
word. Both look like "the theme is broken" and neither leaves a trace.

This file replaces one of the same name that was carried over from the old
project. That one looked for app.js, which does not exist here — it crashed on
every run, and nothing ran it, so nobody found out.
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

go_path = os.path.join(HERE, "internal", "theme", "theme.go")
ts_path = os.path.join(HERE, "frontend", "lib", "theme.ts")

try:
    go_src = open(go_path, encoding="utf-8").read()
    ts_src = open(ts_path, encoding="utf-8").read()
except OSError as e:
    print(f"  cannot read one of the two lists: {e}")
    sys.exit(1)

block = re.search(r"var Allowed = map\[string\]bool\{(.*?)\n\}", go_src, re.S)
if not block:
    print("  theme.Allowed is not where this expects it — the check is wrong, not the code")
    sys.exit(1)
go_keys = set(re.findall(r'"([^"]+)"\s*:', block.group(1)))

block = re.search(r"const TOKENS = \[(.*?)\] as const", ts_src, re.S)
if not block:
    print("  TOKENS is not where this expects it — the check is wrong, not the code")
    sys.exit(1)
ts_keys = set(re.findall(r'"([^"]+)"', block.group(1)))

if not go_keys or not ts_keys:
    print(f"  read {len(go_keys)} entries on the Go side and {len(ts_keys)} in the window — one of them is empty")
    sys.exit(1)

only_go = sorted(go_keys - ts_keys)
only_ts = sorted(ts_keys - go_keys)

if only_go:
    print(f"  allowed by the daemon, never written to the page: {', '.join(only_go)}", file=sys.stderr)
if only_ts:
    print(f"  written to the page, refused on import: {', '.join(only_ts)}", file=sys.stderr)

if not (only_go or only_ts):
    print(f"  both lists carry the same {len(go_keys)} entries")
sys.exit(1 if (only_go or only_ts) else 0)
