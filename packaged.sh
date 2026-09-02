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
# NOT PART OF THE SUITE YET, AND HERE IS WHY.
#
# It runs, and it says green with the fault put back in — so it does not yet
# prove anything. What went wrong is not settled either: the session it starts
# to test with came back running a login shell rather than the command it was
# given, which is exactly the thing that would hide the fault, because a login
# shell reads the profile and finds every tool by itself.
#
# It stays out of check.sh until it can be shown to fail on the fault it was
# written for. A check that cannot do that is worse than no check: it is a green
# line that means nothing, and there were four of those in this suite before
# today.
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

if [ "$fail" = 0 ]; then
	echo "      started with nothing but the system PATH, and still found its tools"
fi
exit "$fail"
