#!/usr/bin/env bash
# Start the build in this directory, next to whatever is installed.
#
# Trying a change should not mean installing it. This starts the current source
# in a home of its own under /tmp, so the daemon you actually work in is never
# touched: different home, different port, different token, its own sessions.
# Close the window and it is gone.
#
#   ./try.sh                 the window, on a scratch folder with a git repo
#   ./try.sh /path/to/folder the window, with that folder already open
#   ./try.sh --browser       the same in your browser instead of the app window
set -eu
cd "$(dirname "$0")"

home="${PLXR_TRY_HOME:-/tmp/plxr-try}"
browser=""
want=""
for arg in "$@"; do
	case "$arg" in
	--browser) browser="--browser" ;;
	*) want="$arg" ;;
	esac
done

./build.sh

# A folder to look at. Given one, it is used; otherwise a small git repository
# is made, because half of what there is to try only shows up in one.
if [ -z "$want" ]; then
	want="$home/scratch"
	rm -rf "$want"
	mkdir -p "$want/inner"
	printf 'one\ntwo\nthree\n' >"$want/a.txt"
	printf 'hello from the inner folder\n' >"$want/inner/b.txt"
	printf 'notes, in markdown\n' >"$want/README.md"
	printf '{"name":"scratch"}\n' >"$want/package.json"
	if command -v git >/dev/null 2>&1; then
		git -C "$want" init -q -b main .
		git -C "$want" -c user.email=try@plxr -c user.name=try add -A
		git -C "$want" -c user.email=try@plxr -c user.name=try commit -qm "something to compare against"
		printf 'one\nTWO\nthree\n' >"$want/a.txt"
		printf 'not committed yet\n' >"$want/fresh.txt"
	fi
fi

# The daemon first, so the folder can be opened before the window appears.
mkdir -p "$home"
cp /tmp/plxr3-app "$home/plxr" 2>/dev/null || cp /tmp/plxr3-app "$home/plxr"
PLXR_HOME="$home" "$home/plxr" daemon >"$home/daemon.log" 2>&1 &
for _ in $(seq 1 60); do [ -f "$home/daemon.json" ] && break; sleep 0.25; done
if [ ! -f "$home/daemon.json" ]; then
	echo "  the daemon did not come up; its log:"
	sed 's/^/      /' "$home/daemon.log" | head -10
	exit 1
fi

read -r port token < <(python3 -c "
import json
d = json.load(open('$home/daemon.json'))
print(d['port'], d['token'])")

# Wait until it actually answers, not just until the file exists.
for _ in $(seq 1 60); do
	if curl -sf -H "X-Plxr-Token: $token" "http://127.0.0.1:$port/api/version" >/dev/null; then break; fi
	sleep 0.25
done

curl -sf -H "X-Plxr-Token: $token" -H 'Content-Type: application/json' \
	-d "{\"path\":\"$want\"}" -X POST "http://127.0.0.1:$port/api/workspaces" >/dev/null || true

cat <<INFO

  plxr $(PLXR_HOME="$home" "$home/plxr" --version | awk '{print $2}') from this directory, in its own home:

      home    $home
      folder  $want
      url     http://127.0.0.1:$port/?token=$token

  Your own plxr is untouched. FOLDERS in the rail has the folder above open.
  Closing the window leaves the daemon running; to stop it:

      kill $(python3 -c "import json;print(json.load(open('$home/daemon.json'))['pid'])")

INFO

PLXR_HOME="$home" "$home/plxr" $browser
