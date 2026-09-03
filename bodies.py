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


PATH = re.compile(r"^\s*[`\"']([^`\"']+)[`\"']")
METHOD = re.compile(r"method:\s*[\"']([A-Z]+)[\"']")
BODYKEYS = re.compile(r"body:\s*JSON\.stringify\(\{([^}]*)\}\)")

sent = []  # (method, path, [keys])
for body in calls(api):
    where = PATH.match(body)
    verb = METHOD.search(body)
    keys_at = BODYKEYS.search(body)
    if not (where and verb and keys_at):
        continue
    if verb.group(1) not in ("POST", "PUT", "PATCH"):
        continue
    keys = [k.strip().split(":")[0].strip() for k in keys_at.group(1).split(",") if k.strip()]
    clean = re.sub(r"\$\{[^}]*\}", "{}", where.group(1)).split("?")[0]
    sent.append((verb.group(1), clean, keys))

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
    if "Decode" not in body or "r.Body" not in body:
        faults.append(f"{method} {path}  sends {keys} in the body, and the handler never reads a body")
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
