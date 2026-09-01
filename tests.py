#!/usr/bin/env python3
"""There have to be tests for `go test` to mean anything.

`go test ./...` reports "ok" for a package with no test files, and for a project
with none at all. A green line that says nothing about whether anything was
checked is the failure mode this whole set of gates exists to prevent — the same
one that let three checks run against paths that did not exist.

So the tests are counted. The floor is not a target: it is there to notice a
drop, not to encourage padding.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FLOOR = 20

found, files = [], 0
for root, dirs, names in os.walk(os.path.join(HERE, "internal")):
    for name in names:
        if not name.endswith("_test.go"):
            continue
        files += 1
        text = open(os.path.join(root, name), encoding="utf-8").read()
        for fn in re.findall(r"^func (Test\w+)", text, re.M):
            found.append(f"{os.path.relpath(os.path.join(root, name), HERE)}:{fn}")

if files == 0:
    print("  read no test files at all — the path is wrong")
    sys.exit(1)
if len(found) < FLOOR:
    print(f"  only {len(found)} tests in {files} files — below the floor of {FLOOR}.")
    print("  Either something was deleted, or the floor needs a reason to move.")
    sys.exit(1)
print(f"  {len(found)} tests in {files} files")
