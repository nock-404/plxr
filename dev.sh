#!/bin/bash
# Entwicklungsstand bauen und starten — neben einer Installation, nicht statt ihr.
#
# Drei Dinge, die hier schon schiefgegangen sind:
#
# 1. PLXR_HOME muss woanders hinzeigen. Sonst teilen sich Entwicklungsstand und
#    Installation dieselbe daemon.json und damit denselben Daemon; der eine
#    beendet dem anderen die Sitzung.
# 2. Gestartet wird über den ABSOLUTEN Pfad. Mit einem relativen steht in der
#    Prozessliste etwas anderes, als pkill sucht — die alten Fenster überleben
#    und häufen sich im Dock.
# 3. Kein `open`: LaunchServices reicht die Umgebung der Shell nicht durch,
#    PLXR_HOME käme nie an.
set -e
cd "$(dirname "$0")"
WURZEL="$PWD"
export PATH="/opt/homebrew/bin:$HOME/go/bin:$PATH"
export PLXR_HOME="$HOME/.plxr-dev"

APP="$WURZEL/build/bin/plxr.app"
BIN="$APP/Contents/MacOS/plxr"

node --check web/app.js
node --check web/ui.js
python3 klassen.py
wails build "$@" | grep -E 'Built|rror' || true
./sign.sh "$APP"

# Alles beenden, was aus DIESEM Verzeichnis stammt — Fenster wie Daemon.
# Was unter ~/.plxr läuft, bleibt unangetastet.
pkill -f "$APP" 2>/dev/null || true
rm -f "$PLXR_HOME/daemon.json"
sleep 1

# macOS merkt sich Symbole je Bündelpfad. Nach einer neuen Signatur zeigt der
# Dock sonst weiter das alte — oder Wails' Standard-W.
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
print(f"  Entwicklungsstand auf http://127.0.0.1:{d['port']}/?token={d['token']}")
EOF
else
	echo "  WARNUNG: kein Daemon unter $PLXR_HOME" >&2
fi

laufend=$(pgrep -fc "$APP/Contents/MacOS/plxr" 2>/dev/null || echo 0)
[ "$laufend" -gt 2 ] && echo "  WARNUNG: $laufend Prozesse aus dem Baubaum — hier häuft sich etwas" >&2
exit 0
