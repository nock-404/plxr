#!/bin/bash
# Neu bauen UND den Daemon beenden.
#
# Der Daemon liefert die Oberfläche aus seinen eingebackenen Dateien. Läuft er
# nach einem Rebuild weiter, serviert er weiter den alten Stand — der Fehler,
# den man dann sucht, existiert im Quelltext längst nicht mehr.
set -e
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:$HOME/go/bin:$PATH"
node --check web/app.js
wails build "$@" | grep -E 'Built|rror' || true
./sign.sh build/bin/plxr.app

# Nur den Daemon beenden, nicht das Fenster: der Daemon liefert die Oberfläche
# aus seinen eingebackenen Dateien und muss nach einem Rebuild neu starten.
# Das Fenster merkt den Abriss selbst und holt sich einen neuen.
pkill -f 'plxr daemon' 2>/dev/null || true
rm -f "$HOME/.plxr/daemon.json"

# Läuft noch kein Fenster, eines öffnen.
pgrep -f 'MacOS/plxr$' >/dev/null 2>&1 || open build/bin/plxr.app
