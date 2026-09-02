#!/usr/bin/env python3
"""Every error code Go sends must have a sentence — and the sentence must fit.

A code without a text reaches the window as "err.dir.missing" — which is worse
than the English sentence it was meant to replace. This is the check that keeps
the contract, the same way the field and route checks do.

It also checks the hole the detail goes into. errText() fills exactly one name,
{detail}. Nine texts were written with {0} instead and shipped: the window put
"There is already an account there: {0}" on the screen, in red, with the path it
was about thrown away. Both languages, and it took driving the dialog to see it,
because a text with the wrong hole is a perfectly valid string to everything
else. So: a code Go sends a detail with must have {detail}, a code sent bare
must have no hole at all, and no err.* text may contain any other name.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

codes = set()
with_detail = set()
bare = set()
scanned = 0
for root, _, files in os.walk(os.path.join(HERE, "internal")):
    for name in files:
        if not name.endswith(".go") or name.endswith("_test.go"):
            continue
        scanned += 1
        text = open(os.path.join(root, name), encoding="utf-8").read()
        codes |= set(re.findall(r'uierr\.(?:New|With)\("([^"]+)"', text))
        with_detail |= set(re.findall(r'uierr\.With\("([^"]+)"', text))
        bare |= set(re.findall(r'uierr\.New\("([^"]+)"', text))

if scanned == 0:
    print("  read no Go files at all — the path is wrong")
    sys.exit(1)

table = json.load(open(os.path.join(HERE, "assets", "i18n", "en.json"), encoding="utf-8"))
missing = sorted(c for c in codes if c not in table)

if missing:
    print(f"  {len(missing)} error codes without a text in en.json:")
    for c in missing:
        print(f"      {c}")
    sys.exit(1)

# The hole, in every language: a text is only useful if what Go sends lands in it.
faults = []
for lang in ("en", "de"):
    words = json.load(open(os.path.join(HERE, "assets", "i18n", f"{lang}.json"), encoding="utf-8"))
    for code, text in sorted(words.items()):
        if not code.startswith("err."):
            continue
        holes = set(re.findall(r"\{(\w+)\}", text))
        for odd in sorted(holes - {"detail"}):
            faults.append(f"{lang}.json  {code}  has {{{odd}}}, which nothing ever fills")
        if code in with_detail and "detail" not in holes:
            faults.append(f"{lang}.json  {code}  is sent with a detail that the text drops")
        if code in bare and code not in with_detail and "detail" in holes:
            faults.append(f"{lang}.json  {code}  wants a detail that Go never sends")

if faults:
    print(f"  {len(faults)} error texts the detail cannot reach:")
    for f in faults:
        print(f"      {f}")
    sys.exit(1)

print(
    f"  every error code has a text and every detail a hole to land in — "
    f"{len(codes)} codes ({len(with_detail)} with a detail), {scanned} files"
)
