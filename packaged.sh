#!/usr/bin/env bash
# Started the way people start it, not the way it is developed.
#
# Every fault of one long evening had the same shape: it appeared only when plxr
# was started from the Applications folder and never when it was started from a
# terminal. A program launched by the system inherits nobody's shell — macOS
# hands out no PATH at all — so it saw /usr/bin:/bin:/usr/sbin:/sbin and could
# not find a single tool anybody had installed. Every check in this suite starts
# it from a shell with a full environment, which is precisely why none of them
# ever touched it.
#
# So this one strips the environment down to what the system gives an
# application, runs the packaged build, and asks it to do the things that
# depend on finding programs.
# What it proves, and how that was shown.
#
# With AdoptLoginPath turned into a no-op — the fault of that evening, exactly
# as it stood — this check fails: the session is refused with
# `exec: "claude": executable file not found in $PATH`. With the real code it
# passes. It was run both ways before being let into the suite.
#
# The second claim below is for the subtler one. The first attempt at finding
# the login PATH took whatever the shell said, and a .zshrc here prints a usage
# line that contains a colon, so "Usage: prompt <options>" became the front of
# the PATH of every session. Nothing broke — the real directories were still
# behind it — which is why it survived. Finding a program is therefore not
# enough to check: what the session is handed has to be looked at as well.

set -u
cd "$(dirname "$0")"

app="build/plxr.app/Contents/MacOS/plxr"
if [ ! -x "$app" ]; then
	echo "      no bundle to test — run ./bundle-macos.sh first"
	exit 1
fi

home=$(mktemp -d)
trap 'kill "$(python3 -c "import json;print(json.load(open(\"$home/daemon.json\"))[\"pid\"])" 2>/dev/null)" 2>/dev/null; rm -rf "$home"' EXIT

# What launchd hands an application: no PATH of its own, nothing else either.
env -i HOME="$HOME" USER="$USER" SHELL="$SHELL" \
	PATH=/usr/bin:/bin:/usr/sbin:/sbin \
	PLXR_HOME="$home" "$app" daemon >"$home/daemon.log" 2>&1 &

for _ in $(seq 1 40); do [ -f "$home/daemon.json" ] && break; sleep 0.5; done
if [ ! -f "$home/daemon.json" ]; then
	echo "      it did not come up at all with a bare environment"
	sed 's/^/        /' "$home/daemon.log" | head -5
	exit 1
fi

read -r port token < <(python3 -c "
import json
d = json.load(open('$home/daemon.json'))
print(d['port'], d['token'])")

fail=0

# The one that cost the evening: can it start the CLI people use it for?
#
# The failure does not come back in the answer to the request — a session is
# created either way, and the command failing to start is written into the
# session's own output. Looking at the answer alone was the first version of
# this check, and it reported everything fine with the fault put back in.
if ! command -v claude >/dev/null 2>&1; then
	echo "      claude is not installed here, so that half cannot be checked"
else
	created=$(curl -s -H "X-Plxr-Token: $token" -H 'Content-Type: application/json' \
		-d "{\"cwd\":\"$home\",\"cmd\":[\"claude\",\"--version\"],\"name\":\"packaged\"}" \
		-X POST "http://127.0.0.1:$port/api/sessions")
	case "$created" in
	*'"id"'*) ;;
	*)
		echo "      the session was refused outright: $(printf '%s' "$created" | head -c 90)"
		fail=1
		;;
	esac

	sleep 4
	said=$(curl -s -H "X-Plxr-Token: $token" "http://127.0.0.1:$port/api/sessions" |
		python3 -c "
import json, sys
for s in json.load(sys.stdin):
    print((s.get('preview') or '').strip())")
	case "$said" in
	*"executable file not found"* | *"not found"*)
		echo "      it could not find claude with a bare PATH:"
		printf '        %s\n' "$(printf '%s' "$said" | head -c 120)"
		fail=1
		;;
	"")
		echo "      the session produced nothing at all in four seconds"
		fail=1
		;;
	esac
fi

# What the sessions are actually handed.
#
# Asked from inside a session, through /bin/sh, which is on the bare system PATH
# and so starts whatever went wrong with the rest of it. Every entry has to be
# an absolute path with no whitespace in it — which is the contract shell.usable
# keeps. Not "a directory that exists": a PATH that names directories which are
# not there is normal and harmless, and half of this machine's is exactly that
# (the cryptexd bootstrap paths, a ~/.bin nobody made). Requiring them to exist
# turned this into a check that fails on a healthy system, which is the other
# way for a gate to be worthless.
ask=$(curl -s -H "X-Plxr-Token: $token" -H 'Content-Type: application/json' \
	-d "{\"cwd\":\"$home\",\"cmd\":[\"/bin/sh\",\"-c\",\"printf 'PATHIS:%s\\\\n' \\\"\$PATH\\\"\"],\"name\":\"path\"}" \
	-X POST "http://127.0.0.1:$port/api/sessions")
case "$ask" in
*'"id"'*) ;;
*)
	echo "      could not even start /bin/sh to ask: $(printf '%s' "$ask" | head -c 90)"
	fail=1
	;;
esac

sleep 3
handed=$(curl -s -H "X-Plxr-Token: $token" "http://127.0.0.1:$port/api/sessions" |
	python3 -c "
import json, sys
for s in json.load(sys.stdin):
    if s.get('name') != 'path':
        continue
    for line in (s.get('preview') or '').splitlines():
        line = line.strip()
        if line.startswith('PATHIS:'):
            print(line[len('PATHIS:'):])
            break")

if [ -z "$handed" ]; then
	echo "      the session never said what its PATH was"
	fail=1
else
	junk=$(printf '%s' "$handed" | python3 -c "
import os, sys
bad = []
for dir in sys.stdin.read().strip().split(os.pathsep):
    if dir == '':
        bad.append('(empty entry)')
    elif not os.path.isabs(dir):
        bad.append(dir + '  (not an absolute path)')
    elif dir.strip() != dir or ' ' in dir or chr(9) in dir:
        bad.append(dir + '  (whitespace — this is prose, not a path)')
print('\\n'.join(bad))")
	if [ -n "$junk" ]; then
		echo "      the PATH handed to sessions has entries that are not paths:"
		printf '%s\n' "$junk" | sed 's/^/        /'
		fail=1
	fi
fi

if [ "$fail" = 0 ]; then
	echo "      found its tools with nothing but the system PATH, and handed sessions a clean one"
fi
exit "$fail"
