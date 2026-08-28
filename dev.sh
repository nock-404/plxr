#!/bin/bash
# Build and start the development version — beside an installation, not instead
# of it.
#
# Three things that have gone wrong here before:
#
# 1. PLXR_HOME has to point somewhere else. Otherwise the development version
#    and the installation share one daemon.json and therefore one daemon; each
#    one ends the other's sessions.
# 2. Started through the ABSOLUTE path. With a relative one the process list
#    shows something other than what pkill looks for — the old windows survive
#    and pile up in the dock.
# 3. No `open`: LaunchServices does not pass the shell's environment through,
#    so PLXR_HOME would never arrive.
set -e
cd "$(dirname "$0")"
ROOT="$PWD"
export PATH="/opt/homebrew/bin:$HOME/go/bin:$PATH"
export PLXR_HOME="$HOME/.plxr-dev"

APP="$ROOT/build/bin/plxr.app"
BIN="$APP/Contents/MacOS/plxr"

node --check web/app.js
node --check web/ui.js
python3 classes.py
wails build "$@" | grep -E 'Built|rror' || true
./sign.sh "$APP"

# End everything that came out of THIS directory — window as well as daemon.
# Whatever runs under ~/.plxr stays untouched.
pkill -f "$APP" 2>/dev/null || true
rm -f "$PLXR_HOME/daemon.json"
sleep 1

# macOS remembers icons per bundle path. After a new signature the dock would
# otherwise keep showing the old one — or Wails' default W.
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
	-f "$APP" >/dev/null 2>&1 || true

nohup "$BIN" >/dev/null 2>&1 &
disown
sleep 3

if [ -f "$PLXR_HOME/daemon.json" ]; then
	python3 - "$PLXR_HOME/daemon.json" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
print(f"  development build on http://127.0.0.1:{d['port']}/?token={d['token']}")
EOF
else
	echo "  WARNING: no daemon under $PLXR_HOME" >&2
fi

running=$(pgrep -fc "$APP/Contents/MacOS/plxr" 2>/dev/null || echo 0)
[ "$running" -gt 2 ] && echo "  WARNING: $running processes from the build tree — something is piling up here" >&2
exit 0
