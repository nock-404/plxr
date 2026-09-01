#!/usr/bin/env python3
"""The JSON field names Go sends and TypeScript expects must be the same.

types.ts was written by reading what the daemon actually returns. That is the
right way to write it once — and exactly the kind of thing that drifts the first
time a Go struct tag changes, in a view nobody opens for a week. So the tags are
read from the Go structs and held against the interfaces.

Only fields TypeScript claims are checked: the daemon may send more than the
window uses, and that is not an error. A field the window expects and the daemon
never sends is one — it is `undefined` at runtime, and reads as an empty view.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# interface name in types.ts -> the Go struct that fills it
PAIRS = {
    "Session": ("internal/session/session.go", "Session"),
    "Port": ("internal/ports/ports.go", None),
    "Account": ("internal/accounts/accounts.go", None),
    "FileEntry": ("internal/files/files.go", None),
    "AgentProfile": ("internal/agent/agent.go", None),
}


def go_tags(rel):
    path = os.path.join(HERE, rel)
    if not os.path.exists(path):
        return None
    return set(
        t.split(",")[0]
        for t in re.findall(r'json:"([^"]+)"', open(path, encoding="utf-8").read())
        if t.split(",")[0] not in ("-", "")
    )


types_path = os.path.join(HERE, "frontend", "lib", "types.ts")
if not os.path.exists(types_path):
    print("  types.ts not found — the path is wrong")
    sys.exit(1)
types = open(types_path, encoding="utf-8").read()

read, bad = 0, []
for name, (rel, _) in PAIRS.items():
    block = re.search(r"export interface " + name + r"[^{]*\{(.*?)\n\}", types, re.S)
    if not block:
        bad.append(f"types.ts has no interface {name}")
        continue
    tags = go_tags(rel)
    if tags is None:
        bad.append(f"{rel} not found — the path is wrong")
        continue
    read += 1
    wanted = set(re.findall(r"^\s*([a-zA-Z_][\w]*)\??:", block.group(1), re.M))
    for field in sorted(wanted - tags):
        bad.append(f"{name}.{field} is expected by the window, but {rel} never sends it")

if read == 0:
    print("  matched no interface at all — the pairs are wrong")
    sys.exit(1)
if bad:
    print(f"  {len(bad)} mismatches:")
    for b in bad:
        print(f"      {b}")
    sys.exit(1)
print(f"  every field the window expects is sent — {read} interfaces, {read + 1} files")
