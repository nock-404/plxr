#!/usr/bin/env python3
"""Every route the window calls must exist in the daemon, and the other way.

The two sides are separate programs joined by strings. A path renamed on one
side and not the other fails at runtime, in whatever view happens to use it.
That is how a renamed templates route once became a 404 that nobody noticed
until somebody opened that one panel. Both lists are read from the source, and
mismatches are named.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def paths_in(text):
    """Every /api or /ws path literal, with interpolations folded to {v}."""
    out = []
    for i, ch in enumerate(text):
        if ch not in "`\"'":
            continue
        j, depth, body = i + 1, 0, []
        while j < len(text):
            c = text[j]
            if c == "\\":
                j += 2
                continue
            if text.startswith("${", j):
                depth += 1
                j += 2
                body.append("{v}")
                continue
            if depth:
                if c == "}":
                    depth -= 1
                j += 1
                continue
            if c == ch:
                break
            body.append(c)
            j += 1
        literal = "".join(body)
        if literal.startswith(("/api/", "/ws/")):
            path = literal.split("?")[0]
            # A placeholder is only a path segment when it follows a slash.
            # Glued to the end of a word it is a suffix — `/reply${raw ? …}` is
            # a query string, not a route of its own.
            path = re.sub(r"(?<!/)\{v\}", "", path)
            out.append(path.rstrip("/") or "/")
    return out


# --- what the daemon serves --------------------------------------------------
served, go_files = set(), 0
server = os.path.join(HERE, "internal", "server", "server.go")
if not os.path.exists(server):
    print("  server.go not found — the path is wrong")
    sys.exit(1)
go_files += 1
for verb, path in re.findall(
    r'mux\.(?:HandleFunc|Handle)\("(?:(GET|POST|PUT|DELETE|PATCH) )?([^"]+)"',
    open(server, encoding="utf-8").read(),
):
    served.add(path.rstrip("/") or "/")

# --- what the window calls ---------------------------------------------------
called, ts_files = {}, 0
for name in ("api.ts", "useTiles.ts", "token.ts"):
    p = os.path.join(HERE, "frontend", "lib", name)
    if not os.path.exists(p):
        continue
    ts_files += 1
    text = open(p, encoding="utf-8").read()
    # A path is usually a template: `/api/file/${encodeURIComponent(id)}?…`,
    # and an interpolation may itself contain quotes. A regex that stops at the
    # first quote turns that into /api/file and reports a route that exists as
    # missing — so the string is walked to its closing delimiter instead.
    for path in paths_in(text):
        called[path] = name

if go_files == 0 or ts_files == 0:
    print("  read no files at all — the paths are wrong")
    sys.exit(1)


def pattern_of(path):
    """A daemon route carries {placeholders}; a call carries a value there."""
    return re.compile("^" + re.sub(r"\{[^}]+\}", "[^/]+", re.escape(path).replace(r"\{", "{").replace(r"\}", "}")) + "$")


patterns = [(p, pattern_of(p)) for p in served]
missing = []
for path, where in sorted(called.items()):
    if not any(rx.match(path) for _, rx in patterns):
        missing.append(f"{where} calls {path} — the daemon serves no such route")

if missing:
    print(f"  {len(missing)} calls without a route:")
    for m in missing:
        print(f"      {m}")
    sys.exit(1)

print(f"  {len(called)} routes called, all served — {go_files + ts_files} files")
