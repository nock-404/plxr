#!/bin/bash
# Click through the interface with a real browser. See smoke.mjs for why.
#
# Deliberately not part of check.sh: it needs a browser and a built binary, and
# a step that quietly skips itself is a step that lies. This one is run by hand
# before a release — and it looks at what no gate can see.
set -e
cd "$(dirname "$0")"

# Built from the working tree, not the installed app. The web files are baked
# into the binary at build time — testing the installed one would mean testing
# yesterday while claiming to test today. That happened on the first run.
BIN="${1:-}"
if [ -z "$BIN" ]; then
	BIN="${TMPDIR:-/tmp}/plxr-smoke-bin"
	go build -o "$BIN" . || { echo "  build failed"; exit 1; }
fi
[ -x "$BIN" ] || { echo "  no binary at $BIN"; exit 1; }

export PLXR_PROBE="${TMPDIR:-/tmp}/plxr-smoke.$$"
mkdir -p "$PLXR_PROBE"

# Clean up by PID, not by pattern. PLXR_HOME is an environment variable and
# does not appear in the process line — a pkill on it matches nothing, and the
# test daemon stays behind. It did, the first time this ran.
DAEMON=""
cleanup() { [ -n "$DAEMON" ] && kill "$DAEMON" 2>/dev/null; rm -rf "$PLXR_PROBE"; }
trap cleanup EXIT

# Playwright out of the npx cache — nothing lands in this repo.
npx --yes playwright@1.62.1 --version >/dev/null 2>&1
MODULES=$(dirname "$(find "$HOME/.npm/_npx" -maxdepth 4 -type d -name playwright -path '*node_modules*' 2>/dev/null | head -1)")
[ -d "$MODULES" ] || { echo "  playwright not found"; exit 1; }
ln -sfn "$MODULES" "$PLXR_PROBE/node_modules"
cp smoke.mjs "$PLXR_PROBE/"

# Its own daemon in a throw-away directory: no session of yours is touched.
PLXR_HOME="$PLXR_PROBE" nohup "$BIN" daemon >"$PLXR_PROBE/daemon.log" 2>&1 &
DAEMON=$!
for _ in $(seq 100); do [ -f "$PLXR_PROBE/daemon.json" ] && break; sleep 0.1; done
[ -f "$PLXR_PROBE/daemon.json" ] || { echo "  the daemon did not come up"; cat "$PLXR_PROBE/daemon.log"; exit 1; }

node "$PLXR_PROBE/smoke.mjs"
code=$?
echo "  screenshots: $PLXR_PROBE/shots"
# rm first: cp -R into an existing directory nests instead of replacing, and
# then you look at yesterday's picture and believe it is today's.
rm -rf "${TMPDIR:-/tmp}/plxr-shots"
cp -R "$PLXR_PROBE/shots" "${TMPDIR:-/tmp}/plxr-shots" 2>/dev/null || true
exit $code
