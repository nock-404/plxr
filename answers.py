#!/usr/bin/env python3
"""Every route the window reads actually answers something.

`routes match` proves that a route the window calls is one the daemon serves.
It says nothing about what comes back — and a handler can return 200 with an
empty body without anybody noticing. One did: the notification settings handed
the encoder a function instead of the list that function returns, encoding
failed, the failure went to a log nobody reads, and the window received a
perfectly successful nothing. The sound picker had no sounds in it for as long
as that lasted, silently, and no gate said a word.

So each of them is called and the answer read. What is checked is deliberately
weak — valid JSON, and not empty — because that is the part that is the same for
every route. What each one should contain is the business of the checks that
know about it.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.environ.get("PLXR_HOME") or os.path.join(os.path.expanduser("~"), ".plxr")

try:
    info = json.load(open(os.path.join(HOME, "daemon.json")))
except OSError:
    print(f"  no daemon under {HOME} — this check needs a live one")
    sys.exit(1)

BASE = f"http://127.0.0.1:{info['port']}"
HEAD = {"X-Plxr-Token": info["token"]}


def get(path):
    req = urllib.request.Request(BASE + path, headers=HEAD)
    with urllib.request.urlopen(req, timeout=10) as answer:
        return answer.status, answer.read(), answer.headers.get("Content-Type", "")


# The GET routes, read from the daemon itself rather than written down here.
server = open(os.path.join(HERE, "internal", "server", "server.go"), encoding="utf-8").read()
routes = sorted(set(re.findall(r'HandleFunc\("GET (/api/[^"]*)"', server)))

# Something to put where a route wants a name. A route with a placeholder this
# cannot fill is skipped, and says so, rather than being quietly counted.
try:
    _, body, _ = get("/api/sessions")
    sessions = json.loads(body or b"[]")
except (urllib.error.URLError, ValueError):
    sessions = []
try:
    _, body, _ = get("/api/agents")
    agents = json.loads(body or b"[]")
except (urllib.error.URLError, ValueError):
    agents = []

fillers = {
    "{id}": sessions[0]["id"] if sessions else None,
    "{name}": agents[0]["name"] if agents else None,
}

bad, checked, skipped = [], 0, []
for route in routes:
    path = route
    for slot, value in fillers.items():
        if slot in path:
            if value is None:
                skipped.append(f"{route} (nothing to put in {slot})")
                path = None
                break
            path = path.replace(slot, value)
    if path is None:
        continue
    if re.search(r"\{[a-z]+\}", path):
        skipped.append(f"{route} (no filler for it)")
        continue
    try:
        status, body, kind = get(path)
    except urllib.error.HTTPError as e:
        # A refusal with a reason is an answer; a 500 is not.
        if e.code >= 500:
            bad.append(f"{route}: answered {e.code}")
        checked += 1
        continue
    except urllib.error.URLError as e:
        bad.append(f"{route}: did not answer at all ({e.reason})")
        continue
    checked += 1
    # What a route promised is what it is held to.
    #
    # Only JSON has to be JSON, and only JSON has to be there: a recording is a
    # stream of bytes, and none of them is a valid amount for a session that has
    # not written anything yet. Requiring a body from that one made this check
    # fail on correct behaviour, which is how a check ends up being switched off
    # rather than fixed.
    if "json" in kind.lower():
        if not body.strip():
            bad.append(f"{route}: said it was JSON and answered {status} with nothing")
            continue
        try:
            json.loads(body)
        except ValueError as e:
            bad.append(f"{route}: said it was JSON and was not ({e})")
    elif not (200 <= status < 400):
        bad.append(f"{route}: answered {status}")

if checked == 0:
    print("  no route was actually called — the daemon or the list is wrong")
    sys.exit(1)

for line in bad:
    print("  " + line, file=sys.stderr)
for line in skipped:
    print("  skipped: " + line)
print(f"  {checked} routes answered" + (f", {len(skipped)} skipped" if skipped else ""))
sys.exit(1 if bad else 0)
