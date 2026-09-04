#!/usr/bin/env python3
"""What the window puts in a request body, the daemon has to read out of it.

routes.py proves a route exists and answers. It cannot see this: the window
sent {"account": "..."} in the body of POST /api/sessions/{id}/account while the
handler read r.URL.Query().Get("target"). Both sides were perfectly valid Go and
TypeScript, the route was there, it answered 200 — and the daemon received an
empty target every single time. Switching accounts killed the session and
started it again on the account it was already on, which looks exactly like
nothing happening. Somebody whose account had just run into its limit sat in
front of that.

So: for every api.ts call that sends a JSON body, the handler must decode a body,
and the field names in it must be ones the handler's struct actually carries.

It also catches the other shape of the same mistake, which the first version of
this file walked straight past: a call that sends something that is not a JSON
object at all. api.writeFile sent the bare file text as the body with the path
in the query string, while the handler decoded {path,text,mod} — so every save
from the editor met json.Decode with a line of source code and came back
err.badJSON, 400, file untouched. Measured end to end: the editor could open a
file and had never been able to write one.

What it cannot see, it says out loud rather than passing over: a handler it
cannot resolve is counted and named, never silently skipped.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

api = open(os.path.join(HERE, "frontend", "lib", "api.ts"), encoding="utf-8").read()
go = open(os.path.join(HERE, "internal", "server", "server.go"), encoding="utf-8").read()

# ---- what the window sends ------------------------------------------------
# req<T>(`/api/...`, { method: "POST", body: JSON.stringify({ a, b }) })
# A call spans several lines and nests braces, so it is read by balancing the
# parentheses rather than by one pattern that has to be lucky.
def calls(text):
    for m in re.finditer(r"req<[^>]*>\(", text):
        i, depth = m.end() - 1, 0
        while i < len(text):
            if text[i] in "([{":
                depth += 1
            elif text[i] in ")]}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        yield text[m.end() : i]


# The path is read by scanning, not by one pattern: a template literal may hold
# quotes inside its interpolation — `/reply${raw ? "?raw=1" : ""}` — and a
# pattern that stops at the first quote cuts the path in half. routes.py learned
# this first; the same shape is used here.
def first_path(text):
    text = text.lstrip()
    if not text or text[0] not in "`\"'":
        return None
    quote, i, depth, out = text[0], 1, 0, []
    while i < len(text):
        c = text[i]
        if c == "\\":
            i += 2
            continue
        if text.startswith("${", i):
            depth += 1
            i += 2
            out.append("{}")
            continue
        if depth:
            if c == "}":
                depth -= 1
            i += 1
            continue
        if c == quote:
            break
        out.append(c)
        i += 1
    literal = "".join(out).split("?")[0]
    # A placeholder glued to the end of a word is a suffix, not a path segment.
    literal = re.sub(r"(?<!/)\{\}", "", literal)
    return literal.rstrip("/") or "/"


METHOD = re.compile(r"method:\s*[\"']([A-Z]+)[\"']")
BODYKEYS = re.compile(r"body:\s*JSON\.stringify\(\{([^}]*)\}\)")
# Any body at all, so a call that sends something which is not JSON is seen
# rather than skipped. JSON.stringify of a variable is still JSON — there are
# simply no field names to check — and only a body that is not stringified at
# all can collide with a handler that decodes.
ANYBODY = re.compile(r"body:\s*([^,\n}]+)")
ISJSON = re.compile(r"body:\s*JSON\.stringify\(")

sent = []  # (method, path, [keys])
for body in calls(api):
    where = first_path(body)
    verb = METHOD.search(body)
    keys_at = BODYKEYS.search(body)
    any_at = ANYBODY.search(body)
    if not (where and verb and any_at):
        continue
    if verb.group(1) not in ("POST", "PUT", "PATCH"):
        continue
    clean = where
    if keys_at:
        keys = [k.strip().split(":")[0].strip() for k in keys_at.group(1).split(",") if k.strip()]
        sent.append((verb.group(1), clean, keys))
    elif ISJSON.search(body):
        # JSON, but built from a variable: nothing to hold the field names
        # against, and nothing wrong either.
        sent.append((verb.group(1), clean, []))
    else:
        # A body that is not an object literal. Legitimate when the handler reads
        # the bytes itself — the skin editor sends CSS — and a plain mistake when
        # the handler decodes JSON.
        sent.append((verb.group(1), clean, None))

if len(sent) < 5:
    print(f"  found only {len(sent)} calls with a body — the pattern is wrong")
    sys.exit(1)

# ---- what the daemon reads ------------------------------------------------
# A route is registered either with a function literal or with a bare method
# value — mux.HandleFunc("POST /api/sessions", s.createSession). The second kind
# has to be followed to the method, or three perfectly good handlers look as
# though they never read a body.
def method_source(name):
    m = re.search(r"func \(s \*Server\) " + name + r"\(w http\.ResponseWriter, r \*http\.Request\) \{", go)
    if not m:
        return None
    i, depth = m.end() - 1, 0
    while i < len(go):
        if go[i] == "{":
            depth += 1
        elif go[i] == "}":
            depth -= 1
            if depth == 0:
                return go[m.start() : i + 1]
        i += 1
    return None


handlers = {}
for m in re.finditer(r'mux\.HandleFunc\("(\w+) ([^"]+)",', go):
    verb, route = m.group(1), re.sub(r"\{[^}]*\}", "{}", m.group(2))
    rest = go[m.end() :]
    named = re.match(r"\s*s\.(\w+)\)", rest)
    if named:
        handlers[(verb, route)] = method_source(named.group(1))
        continue
    i, depth = m.end(), 0
    started = False
    while i < len(go):
        if go[i] == "{":
            depth += 1
            started = True
        elif go[i] == "}":
            depth -= 1
            if started and depth == 0:
                break
        i += 1
    handlers[(verb, route)] = go[m.end() : i + 1]

structs = {}
for m in re.finditer(r"type (\w+) struct \{(.*?)\n\}", go, re.S):
    structs[m.group(1)] = set(re.findall(r'json:"([^",]+)', m.group(2)))

faults, checked, unresolved = [], 0, []
for method, path, keys in sent:
    body = handlers.get((method, path))
    if body is None:
        unresolved.append(f"{method} {path}")
        continue
    checked += 1
    if "r.Body" not in body:
        faults.append(f"{method} {path}  sends a body, and the handler never reads one")
        continue
    decodes = "Decode" in body
    if keys is None:
        if decodes:
            faults.append(
                f"{method} {path}  sends a plain body, and the handler decodes JSON out of it"
            )
        continue
    if not decodes:
        # The handler takes the bytes itself. That is a deliberate shape here —
        # an agent profile is stored as the JSON text it arrives as — so there
        # are no field names to hold it against and nothing to complain about.
        continue
    var = re.search(r"var \w+ (\w+)\s", body)
    known = structs.get(var.group(1), set()) if var else set()
    if not known:
        continue
    for key in keys:
        if key not in known:
            faults.append(f"{method} {path}  sends \"{key}\", which {var.group(1)} does not carry")

if unresolved:
    print(f"  {len(unresolved)} routes whose handler could not be read:")
    for u in unresolved:
        print(f"      {u}")
    sys.exit(1)

if faults:
    print(f"  {len(faults)} bodies the daemon does not read:")
    for f in faults:
        print(f"      {f}")
    sys.exit(1)

print(f"  every body the window sends is read where it lands — {checked} calls")
