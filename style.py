#!/usr/bin/env python3
"""The frontend rules, enforced instead of asserted.

Three of these lived in check.sh as one-line greps against `app/styles/*.css`
and `components app` — paths that exist under frontend/, not at the repo root.
They matched nothing and reported green for hours. So every rule here counts the
files it read and fails when that count is zero: a check that looked at nothing
must never be able to say "ok".

The rules:
  1. Sizes in rem, never px.
  2. No styles inside components — except a computed value, which cannot live
     in a stylesheet because it is worked out at runtime.
  3. Nothing native: feature code goes through the Ui components.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(HERE, "frontend")
SKIP = ("node_modules", ".next", "out", "public")

# Components that ARE the wrapper: they are allowed the native element they wrap.
# components/ui is where our controls are built, and building one means using a
# native element — that is the whole point of the folder. Named as a directory
# rather than as a list of files: the list went stale the moment a control was
# added, and a stale exemption list is how a check stops checking.
WRAPPER_DIR = "components/ui/"

# There used to be a list of class names here that were allowed to be raw
# elements — rows, tabs, list items, "our own controls built out of a native
# element on purpose". Measured after Button learned a bare form, not one of the
# eleven was doing any work: every one of them is a Button now. An exemption
# that protects nothing is an exemption waiting to protect something.


def walk(exts):
    for root, dirs, files in os.walk(FRONTEND):
        dirs[:] = [d for d in dirs if d not in SKIP]
        for name in sorted(files):
            if name.endswith(exts):
                path = os.path.join(root, name)
                yield os.path.relpath(path, HERE), path


def report(rule, seen, bad):
    TOTAL[0] += seen
    if seen == 0:
        print(f"  {rule}: read no files at all — the paths are wrong")
        return 1
    if bad:
        print(f"  {rule}: {len(bad)} violations in {seen} files")
        for line in bad[:20]:
            print(f"      {line}")
        return 1
    print(f"  {rule}: ok, {seen} files")
    return 0


fail = 0
TOTAL = [0]

# 1 — rem, not px.
seen, bad = 0, []
px = re.compile(r"[^a-zA-Z-][0-9]+(\.[0-9]+)?px")
for rel, path in walk((".css",)):
    seen += 1
    text = open(path, encoding="utf-8").read()
    # Comments are prose: "31px, measured against the reference" explains a
    # value, it is not one. Blanked rather than skipped by line, because a
    # comment can start mid-line and run over several.
    text = re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group(0)), text, flags=re.S)
    for n, line in enumerate(text.splitlines(), 1):
        if px.search(line):
            bad.append(f"{rel}:{n}  {line.strip()[:90]}")
fail |= report("rem not px", seen, bad)

# 2 — no styles in components; a computed value is the exception.
seen, bad = 0, []
for rel, path in walk((".tsx", ".ts")):
    seen += 1
    for n, line in enumerate(open(path, encoding="utf-8"), 1):
        if re.search(r"<style|styled\.|css`", line):
            bad.append(f"{rel}:{n}  {line.strip()[:90]}")
        if "style={{" in line:
            # A computed value cannot live in a stylesheet: it is worked out at
            # runtime. What must not be here is a fixed one. Both a template
            # (`${pct}%`) and a bare variable (`value`) are computed; a quoted
            # string or a number is not.
            inside = line.split("style={{", 1)[1]
            values = re.findall(r":\s*([^,}]+)", inside)
            fixed = [v for v in values if re.fullmatch(r"""\s*(["'][^"']*["']|[0-9.]+)\s*""", v)]
            if fixed and not any("${" in v for v in values):
                bad.append(f"{rel}:{n}  static inline style — belongs in the stylesheet")
fail |= report("no css in components", seen, bad)

# 3 — nothing native.
#
# The pattern used to demand a space after the tag name, so every multi-line
# element — which is most of them in JSX — walked past it: thirteen raw controls
# were sitting in feature code with this check reporting green. And it knew
# nothing of the system's own dialogs, which are the most native thing a page
# can reach for: drawn by the operating system, wearing none of the skin, and
# stopping the whole window while they stand.
seen, bad = 0, []
# Checked line by line, so the tag name is often the last thing on its line —
# requiring a character after it let "<textarea" followed by a newline through,
# which is how most of them are written.
native = re.compile(r"<(input|button|select|textarea|a|dialog|details|summary|form|progress|meter)(?=[\s>/]|$)")
system_dialog = re.compile(r"\b(?:window\.)?(confirm|alert|prompt)\s*\(")
for rel, path in walk((".tsx",)):
    if WRAPPER_DIR in rel.replace(os.sep, "/"):
        continue
    seen += 1
    text = open(path, encoding="utf-8").read()
    # A comment explaining why a native element is NOT used is not a use of one.
    text = re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group(0)), text, flags=re.S)
    text = re.sub(r"//[^\n]*", lambda m: " " * len(m.group(0)), text)
    for n, line in enumerate(text.splitlines(), 1):
        if native.search(line):
            bad.append(f"{rel}:{n}  {line.strip()[:90]}")
        found = system_dialog.search(line)
        if found:
            bad.append(f"{rel}:{n}  {found.group(1)}() is the system's dialog — use Ask")
fail |= report("nothing native", seen, bad)

if not fail:
    print(f"  {TOTAL[0]} files read in all")
sys.exit(fail)
