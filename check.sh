#!/usr/bin/env bash
# Every step here exists because something once slipped through it.
#
# Deliberately not `cmd && echo ok`: with an && chain, `set -e` does NOT abort
# on failure, and a red step would scroll past unnoticed.
set -u
cd "$(dirname "$0")"

fail=0
# A scanning step prints how much it read, and that stays on screen. Three
# checks here once matched no files at all and reported ok for hours; a coverage
# number nobody can see is a coverage number nobody checks.
step() {
	printf '  %-22s ' "$1"
	shift
	if out=$("$@" 2>&1); then
		coverage=$(echo "$out" | grep -oE '[0-9]+ files' | tail -1)
		if [ -n "$coverage" ]; then echo "ok — $coverage"; else echo "ok"; fi
	else
		echo "FAILED"
		echo "$out" | sed 's/^/      /' | head -20
		fail=1
	fi
}

echo
echo "  plxr3"
echo

# --- the language rule -------------------------------------------------------
step "no german" python3 german.py

step "error codes" python3 errors.py

# --- the layer contract ---
# Styles live in app/styles, sizes in rem, feature code goes through the Ui
# components. All three used to be one-line greps here against paths that only
# exist under frontend/ — they matched nothing and reported ok. style.py counts
# what it reads and fails when that count is zero.
step "frontend rules" python3 style.py

# A skin may look like anything; it may not forget a class. When it does, that
# part of the interface renders undressed, and only in that one skin.
step "skins complete" python3 classes.py

# A skin dresses, it does not measure. The frame belongs to layout.css.
step "skins set no sizes" python3 skinrules.py
# What the stylesheets address, something on one side of the wire or the other
# has to set — including the values, which are typed twice in two languages.
step "attributes match" python3 attributes.py
# The daemon's list of allowed palette entries against the window's.
step "palettes match" python3 palette.py

# The two programs are joined by strings: a path and a field name. Both are read
# from the source on each side and held against each other.
step "three systems" python3 platforms.py
step "routes match" python3 routes.py
step "fields match" python3 fields.py

# --- the code ----------------------------------------------------------------
step "go vet" go vet ./...
step "gofmt" bash -c '[ -z "$(gofmt -l . | grep -v "^build/")" ]'
# `go test` says "ok" for a package with no tests, and for a project with none.
# This counts them first, so a green test line means something was checked.
step "tests exist" python3 tests.py
step "go test" go test ./...
step "palette maths" node --experimental-strip-types frontend/lib/crtPalette.test.mjs
# The other crossing that has no compiler: an error code from Go turning back
# into a sentence, with its untranslatable detail intact.
step "errors read back" node --experimental-strip-types frontend/lib/i18n.test.mjs

printf '  %-22s ' "typescript"
if out=$(cd frontend && npx tsc --noEmit 2>&1); then echo "ok"; else echo "FAILED"; echo "$out" | head -20; fail=1; fi

step "build" ./build.sh

# One layout in every skin, measured in a real browser rather than compared by
# eye. It reads whatever the running daemon serves, so it follows a restart —
# after changing the frame, restart the daemon before trusting a green here.
# --- the window, against a daemon of our own ---------------------------------
# Not against whatever plxr happens to be running: on this machine that is the
# installed one, a different program. Checked against it these two steps
# reported a settings panel with three tabs and a skin change that did nothing —
# and they were right, they were looking at another application, and clicking
# around inside somebody's live window while they did it.
#
# So the checks bring their own daemon: this build, a throwaway state directory,
# one session to look at, and both are gone again afterwards.
CHECK_HOME=$(mktemp -d)
export PLXR_HOME="$CHECK_HOME"
/tmp/plxr3-app daemon >"$CHECK_HOME/daemon.log" 2>&1 &
CHECK_DAEMON=$!
for _ in $(seq 1 40); do [ -f "$CHECK_HOME/daemon.json" ] && break; sleep 0.25; done

# The daemon detaches itself, so the shell's background pid is not the process
# that ends up listening — killing it leaves the real one running. Its own pid
# is in daemon.json, which is the one to end.
cleanup_check_daemon() {
	if [ -f "$CHECK_HOME/daemon.json" ]; then
		pid=$(python3 -c "import json;print(json.load(open('$CHECK_HOME/daemon.json'))['pid'])" 2>/dev/null || true)
		[ -n "${pid:-}" ] && kill "$pid" 2>/dev/null || true
	fi
	kill "$CHECK_DAEMON" 2>/dev/null || true
	rm -rf "$CHECK_HOME"
}
trap cleanup_check_daemon EXIT

if [ -f "$CHECK_HOME/daemon.json" ]; then
	CHECK_PORT=$(python3 -c "import json;print(json.load(open('$CHECK_HOME/daemon.json'))['port'])")
	CHECK_TOKEN=$(python3 -c "import json;print(json.load(open('$CHECK_HOME/daemon.json'))['token'])")
	# One session, in this directory, so there is a terminal and a file tree to
	# look at. It dies with the daemon.
	curl -s -H "X-Plxr-Token: $CHECK_TOKEN" -X POST "http://127.0.0.1:$CHECK_PORT/api/sessions" \
		-d "{\"cwd\":\"$(pwd)\",\"cmd\":[],\"name\":\"\",\"account\":\"\"}" >/dev/null
	sleep 2
else
	printf '  %-22s %s\n' "window daemon" "FAILED — it did not come up"
	fail=1
fi

# Every read route is called and its answer read. "routes match" only proves a
# route exists; one of them answered 200 with nothing for as long as nobody
# looked.
step "routes answer" python3 answers.py

step "one layout" node geometry.mjs

# What the click-through gate below cannot do: say whether anything is right.
# This one makes claims about the running window and checks them against what
# the daemon reports — tile counts, every view opening with content or an empty
# state, a terminal that paints, a skin change that takes effect.
step "window works" node clicked.mjs

# Two windows on one control room, one changing the skin: the other has to end
# up on it too. "Which of them wins?" used to have no answer.
step "windows agree" node agree.mjs

# --- started the way people start it -----------------------------------------
# Everything above starts plxr from this shell, with a full environment. The
# faults of one long evening all lived in the gap between that and how an
# application is really launched: by the system, inheriting no PATH at all.
# packaged.sh strips the environment down to what launchd hands out and runs the
# bundle. Proved both ways before it was let in here — a no-op AdoptLoginPath
# makes it fail, and so does a PATH with a profile's prose in it.
#
# macOS only, because it needs the bundle. It builds it, rather than skipping
# when it is missing: a check that quietly stands aside is the green line that
# means nothing.
if [ "$(uname)" = "Darwin" ] && [ -f packaged.sh ]; then
	if ./bundle-macos.sh >/dev/null 2>&1; then
		step "packaged app" ./packaged.sh
	else
		printf '  %-22s %s\n' "packaged app" "FAILED — the bundle could not be built"
		fail=1
	fi
fi

# --- seen with your own eyes -------------------------------------------------
# The last gate is not a script: no green without having clicked through the
# built window. smoke.sh records the hash of what was last looked at.
if [ -f smoke.sh ]; then
	step "clicked through" ./smoke.sh
fi

echo
if [ "$fail" -ne 0 ]; then
	echo "  CHECK FAILED"
	exit 1
fi
echo "  all green"
