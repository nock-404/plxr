#!/usr/bin/env python3
"""Every error code Go sends must have a sentence in en.json.

A code without a text reaches the window as "err.dir.missing" — which is worse
than the English sentence it was meant to replace. This is the check that keeps
the contract, the same way the field and route checks do.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

codes = set()
scanned = 0
for root, _, files in os.walk(os.path.join(HERE, "internal")):
    for name in files:
        if not name.endswith(".go") or name.endswith("_test.go"):
            continue
        scanned += 1
        text = open(os.path.join(root, name), encoding="utf-8").read()
        codes |= set(re.findall(r'uierr\.(?:New|With)\("([^"]+)"', text))

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
print(f"  every error code has a text — {len(codes)} codes, {scanned} files")
