#!/usr/bin/env python3
"""Three systems, not one.

plxr runs on Linux, macOS and Windows. The daemon is the part that has to work
everywhere — it owns the terminals — and it is also the part where a convenient
shortcut costs nothing until somebody runs it on the wrong machine. So the
daemon's packages are compiled for all three here, every time.

What this cannot prove is the window: its toolkit needs a compiler for the
target system, and a Mac has no Linux one. That is stated rather than skipped,
because a gate that quietly drops a target reads exactly like one that passed.
"""

import re
import subprocess
import sys
from pathlib import Path

TARGETS = [("darwin", "arm64"), ("linux", "amd64"), ("windows", "amd64")]

# A call that does not exist everywhere, and the systems it is allowed on.
LOCAL = {
    "osascript": "darwin",
    "powershell": "windows",
    "/System/Library": "darwin",
    "NSWorkspace": "darwin",
    "UNUserNotification": "darwin",
    "screencapture": "darwin",
    "xdg-open": "linux",
    "dbus-send": "linux",
    "notify-send": "linux",
    "explorer": "windows",
    "dscl": "darwin",
    "getent": "linux",
    # Not one system but two: a program every unix has and Windows does not.
    "lsof": ("darwin", "linux"),
    "netstat": ("windows",),
    "tasklist": ("windows",),
}

bad = []

for goos, arch in TARGETS:
    r = subprocess.run(
        ["go", "build", "-o", "/dev/null", "./internal/..."],
        capture_output=True, text=True,
        env={**__import__("os").environ, "GOOS": goos, "GOARCH": arch},
    )
    if r.returncode:
        bad.append(f"the daemon does not compile for {goos}/{arch}:\n" + r.stderr.strip())

# A system-only call has to be reachable only on that system: a _<goos>.go
# filename, a build tag, or a runtime.GOOS check naming it. Anywhere else it is
# a Mac-only branch waiting to be discovered as the only branch.
for path in Path("internal").rglob("*.go"):
    head = path.read_text()[:400]
    tag = re.search(r"//go:build\s+(\w+)", head)
    system = tag.group(1) if tag else None
    for part in path.stem.split("_")[1:]:
        if part in ("darwin", "linux", "windows"):
            system = part
    body = re.sub(r"//.*", "", path.read_text())
    guarded = set(re.findall(r'runtime\.GOOS\s*==\s*"(\w+)"', body))
    for call, needs in LOCAL.items():
        wanted = (needs,) if isinstance(needs, str) else needs
        # A file compiled for everything except one system covers the rest.
        excluded = re.search(r"//go:build\s+!(\w+)", head)
        if excluded and excluded.group(1) not in wanted:
            continue
        if call in body and system not in wanted and not (set(wanted) & guarded):
            where = f"in {system}-only code" if system else "in code every system compiles"
            bad.append(f"{path}: uses {call!r}, which exists only on {' and '.join(wanted)}, {where}")

for line in bad:
    print(line, file=sys.stderr)
print(f"compiled the daemon for {len(TARGETS)} systems; the window needs each system's own compiler")
sys.exit(1 if bad else 0)
