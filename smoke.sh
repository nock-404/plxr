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
# The `wait` is not politeness: without it the shell prints "Terminated: 15"
# for the background job after the run, and that line reads like a failure in
# the middle of an otherwise clean report.
cleanup() {
	# `|| true` on both: wait returns 143 for the daemon that was just killed,
	# and under `set -e` inside an EXIT trap that becomes the exit status of the
	# whole script. A green run then reported itself as failed.
	if [ -n "$DAEMON" ]; then
		kill "$DAEMON" 2>/dev/null || true
		wait "$DAEMON" 2>/dev/null || true
	fi
	rm -rf "$PLXR_PROBE"
}
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

# A real session, in a real git repository. Without one the whole right half
# of the interface is unreachable: files, rules, marks, sharing. The first
# version of this test ran against an empty app and therefore saw none of it —
# which is how a marks pane that threw on every open survived a green run.
WORK="$PLXR_PROBE/work"
mkdir -p "$WORK"
printf 'hello\n' >"$WORK/file.txt"
git init -q "$WORK" 2>/dev/null || true
git -C "$WORK" -c user.email=probe@plxr -c user.name=probe add -A >/dev/null 2>&1 || true
git -C "$WORK" -c user.email=probe@plxr -c user.name=probe commit -qm probe >/dev/null 2>&1 || true

# daemon.json is written indented, so the space after the colon has to be in
# the pattern. Without it sed matches nothing, PORT stays empty, and the error
# reads "the session could not be started" — which points at the wrong place.
PORT=$(sed -n 's/.*"port": *\([0-9]*\).*/\1/p' "$PLXR_PROBE/daemon.json")
TOKEN=$(sed -n 's/.*"token": *"\([^"]*\)".*/\1/p' "$PLXR_PROBE/daemon.json")
[ -n "$PORT" ] && [ -n "$TOKEN" ] || { echo "  could not read port/token out of daemon.json"; exit 1; }
curl -s -m 10 -X POST -H "X-Plxr-Token: $TOKEN" -H 'Content-Type: application/json' \
	-d "{\"cwd\":\"$WORK\",\"cmd\":[\"bash\",\"--norc\"],\"name\":\"probe\"}" \
	"http://127.0.0.1:$PORT/api/sessions" >/dev/null || { echo "  the session could not be started"; exit 1; }
sleep 2

# `set -e` would abort on a failing node before the exit code could be read —
# and then the screenshots of the run that actually found something never get
# saved, which are the ones worth looking at.
code=0
node "$PLXR_PROBE/smoke.mjs" || code=$?

echo "  screenshots: $PLXR_PROBE/shots"
# rm first: cp -R into an existing directory nests instead of replacing, and
# then you look at yesterday's picture and believe it is today's.
rm -rf "${TMPDIR:-/tmp}/plxr-shots"
cp -R "$PLXR_PROBE/shots" "${TMPDIR:-/tmp}/plxr-shots" 2>/dev/null || true

# Note down WHICH state was clicked through. check.sh reads this and refuses to
# call a tree green that nobody has looked at. Inside .git, so it can never end
# up in a commit and never changes the hash it is describing.
if [ "$code" = "0" ]; then
	./treehash.sh >"$(git rev-parse --git-dir)/plxr-smoke-passed" 2>/dev/null || true
fi
exit $code
