#!/bin/bash
# Entwicklungsstand bauen und starten — neben einer Installation, nicht statt ihr.
#
# Zwei Dinge sind hier wichtig:
#
# 1. PLXR_HOME zeigt woanders hin. Sonst teilen sich Entwicklungsstand und
#    Installation dieselbe daemon.json und damit denselben Daemon; der eine
#    beendet dem anderen die Sitzung.
# 2. Die App wird direkt gestartet statt über `open`. LaunchServices reicht die
#    Umgebung der Shell nicht durch — PLXR_HOME käme nie an.
set -e
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:$HOME/go/bin:$PATH"
export PLXR_HOME="$HOME/.plxr-dev"

node --check web/app.js
node --check web/ui.js
wails build "$@" | grep -E 'Built|rror' || true
./sign.sh build/bin/plxr.app

# Den eigenen Stand immer komplett neu starten — Fenster wie Daemon. Ein
# weiterlaufendes Fenster kennt PLXR_HOME nicht und zieht sich seinen Daemon
# wieder nach ~/.plxr; dann sucht man den Fehler an der falschen Stelle.
# Was unter ~/.plxr läuft, bleibt unangetastet.
pkill -f "$PWD/build/bin/plxr.app" 2>/dev/null || true
rm -f "$PLXR_HOME/daemon.json"
sleep 1

nohup ./build/bin/plxr.app/Contents/MacOS/plxr >/dev/null 2>&1 &
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
