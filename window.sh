#!/bin/bash
# Check the REAL window, not the browser.
#
# Everything the browser run cannot see lives here. It found none of these,
# because none of them exist in Chrome:
#
#   - the window's own storage keeps nothing, so every setting was back to
#     default on the next start
#   - the window was never able to let anything through, so see-through only
#     made it lighter
#   - a request went out before the daemon's address was known and came back 404
#
# Every one of those was found by hand and cost an afternoon. This is what
# stops that repeating.
#
# It opens a window on the screen and photographs it — there is no headless way
# to do that. So it is run by hand, like smoke.sh, and not from check.sh.
set -e
cd "$(dirname "$0")"

WORK="${TMPDIR:-/tmp}/plxr-window.$$"
mkdir -p "$WORK/home"
APP="$WORK/plxr.app"

cleanup() {
	pkill -f "$APP/Contents/MacOS/plxr" 2>/dev/null || true
	sleep 1
	rm -rf "$WORK"
}
trap cleanup EXIT

fail=0
say() { printf '  %-42s %s\n' "$1" "$2"; }
bad() { fail=1; printf '  FAILED: %s\n' "$1"; }

# The desktop build needs its tags AND a framework the plain build does not
# pull in — without UniformTypeIdentifiers the link fails on _OBJC_CLASS_$_UTType.
echo "  building the window"
CGO_LDFLAGS="-framework UniformTypeIdentifiers" \
	go build -tags "desktop,production" -ldflags "-X main.version=0.0.0-window" \
	-o "$WORK/plxr" . 2>&1 | grep -viE "warning:|note:|^#" || true
[ -x "$WORK/plxr" ] || { echo "  the window build produced nothing"; exit 1; }

# A bundle, because macOS gives a bare binary no window. The Info.plist in the
# repo is a Wails template and has to be filled in.
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$WORK/plxr" "$APP/Contents/MacOS/plxr"
sed -e 's|{{.Name}}|plxr|g' -e 's|{{.Info.ProductVersion}}|0.0.0|g' \
	-e 's|{{.Info.Copyright}}|window check|g' -e 's|dev.plxr.app|dev.plxr.windowcheck|' \
	build/darwin/Info.plist > "$APP/Contents/Info.plist"

# Two passes, and the second one is why.
#
# The colour is measured with see-through OFF. With it on, what shows through
# the window counts as well — a check run in front of a blue terminal found its
# blue and passed with the settings deliberately switched off.
#
# Then the same thing again with see-through ON. If the window really lets
# light past, the two pictures must differ; if it only got lighter, they will
# not. That difference is the only honest proof of transparency there is.
prefs_with() {
	cat > "$WORK/home/prefs.json" <<JSON
{
 "plxr.theme": "crt",
 "plxr.style.crt": "{\"changes\":{\"fg\":\"#7fd4ff\",\"bg\":\"#050a0d\",\"accent\":\"#b0e5ff\",\"dim\":\"#3b85b3\",\"panel\":\"#0a121d\"},\"seethrough\":$1,\"gradient\":0,\"glowLevel\":50,\"phosphor\":\"#7fd4ff\"}"
}
JSON
	printf '{"seethrough":%s,"dark":true}\n' "$1" > "$WORK/home/window.json"
}

# The environment has to survive, so the binary is started directly. `open`
# drops it, and the window then runs against YOUR daemon and your settings —
# which is exactly what happened the first time this was tried.
shoot() {
	# The window's own storage, thrown away first.
	#
	# It is not written to disk in any way that survives — that is the bug this
	# whole check exists for — but WebKit keeps it in memory, and two launches
	# a few seconds apart share it. A run with the loading deliberately removed
	# came back with the right colour anyway, straight out of that memory. A
	# check that cannot be made to fail is no check.
	rm -rf "$HOME/Library/WebKit/dev.plxr.windowcheck" 2>/dev/null || true

	PLXR_HOME="$WORK/home" nohup "$APP/Contents/MacOS/plxr" >"$WORK/window.log" 2>&1 &
	for _ in $(seq 40); do [ -f "$WORK/home/daemon.json" ] && break; sleep 0.5; done
	sleep 6

	PID=$(pgrep -f "$APP/Contents/MacOS/plxr$" | head -1)
	[ -n "$PID" ] || { bad "the window did not start — $(tail -2 "$WORK/window.log" | tr '\n' ' ')"; return 1; }

	# The window on its own, and only if it is really in front.
	#
	# Two attempts failed before this one. Photographing the whole screen
	# counted blue pixels anywhere and stayed green with the settings
	# deliberately switched off. Cropping afterwards got the arithmetic between
	# points and pixels wrong and cut out somebody else's window. -R takes a
	# rectangle in points, which is what the system reports, so nothing has to
	# be converted at all.
	# Patiently: the second run comes up while the first is still going away,
	# and a window that is not yet in front photographs somebody else.
	for _ in $(seq 8); do
		osascript -e "tell application \"System Events\" to set frontmost of (first process whose unix id is $PID) to true" >/dev/null 2>&1 || true
		sleep 1
		FRONT=$(osascript -e 'tell application "System Events" to get unix id of first process whose frontmost is true' 2>/dev/null)
		[ "$FRONT" = "$PID" ] && break
	done
	# Hard stop, not a note. Carrying on photographs whatever IS in front and
	# then counts its colours — which is how a deliberately broken run came
	# back with four thousand pixels of the right blue and passed.
	if [ "$FRONT" != "$PID" ]; then
		bad "the window did not come to the front — every number after this would be about somebody else's window"
		pkill -f "$APP/Contents/MacOS/plxr" 2>/dev/null || true
		return 1
	fi

	BOUNDS=$(osascript -e "tell application \"System Events\" to tell (first process whose unix id is $PID) to get {position, size} of window 1" 2>/dev/null | tr -d ' ')
	[ -n "$BOUNDS" ] || { bad "the window's position could not be read"; return 1; }
	X=$(echo "$BOUNDS" | cut -d, -f1); Y=$(echo "$BOUNDS" | cut -d, -f2)
	W=$(echo "$BOUNDS" | cut -d, -f3); H=$(echo "$BOUNDS" | cut -d, -f4)
	screencapture -x -t png -R"$X,$Y,$W,$H" "$1" 2>/dev/null || true
	[ -s "$1" ] || bad "no screenshot — screen recording permission?"

	PORT=$(sed -n 's/.*"port": *\([0-9]*\).*/\1/p' "$WORK/home/daemon.json" 2>/dev/null)
	TOKEN=$(sed -n 's/.*"token": *"\([^"]*\)".*/\1/p' "$WORK/home/daemon.json" 2>/dev/null)
	pkill -f "$APP/Contents/MacOS/plxr" 2>/dev/null || true
	sleep 2
	rm -f "$WORK/home/daemon.json"
}

echo "  opening it — opaque"
prefs_with 0
shoot "$WORK/solid.png" || exit 1
say "window process" "ran"
say "settings on disk" "kept"

echo "  opening it again — see-through"
prefs_with 45
shoot "$WORK/glass.png" || exit 1

python3 window_check.py "$WORK" || fail=1

cp "$WORK/solid.png" "${TMPDIR:-/tmp}/plxr-window.png" 2>/dev/null || true
cp "$WORK/glass.png" "${TMPDIR:-/tmp}/plxr-window-glass.png" 2>/dev/null || true
echo "  screenshot: ${TMPDIR:-/tmp}/plxr-window.png"
[ "$fail" = 0 ] || { echo; echo "  WINDOW CHECK FAILED"; exit 1; }
echo "  the window opens, keeps its settings and lets light through"
