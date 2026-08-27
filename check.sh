#!/bin/bash
# Alles prüfen, was vor einem Commit geprüft sein muss.
#
# Bewusst ohne `cmd && echo ok`: bei einer &&-Verkettung bricht `set -e` genau
# dann NICHT ab, wenn die linke Seite fehlschlägt — ein Prüfskript, das so
# gebaut ist, meldet Fehler und läuft trotzdem weiter durch.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:$HOME/go/bin:$PATH"

fehler=0
schritt() {
	local name="$1"; shift
	printf '  %-16s ' "$name"
	if out=$("$@" 2>&1); then
		echo "ok"
	else
		echo "FEHLER"
		echo "$out" | sed 's/^/      /' | head -20
		fehler=1
	fi
}

schritt "javascript" node --check web/app.js
schritt "javascript ui" node --check web/ui.js
schritt "javascript werkbank" node --check web/devpanel.js
schritt "klassen" python3 klassen.py
schritt "merkmale" python3 merkmale.py
# Ohne diese Regeln lässt sich das Fenster nicht bewegen. Beim Neuschreiben von
# base.css sind sie schon einmal spurlos verschwunden.
schritt "fenstergriff" grep -q -- '--wails-draggable: drag' web/base.css
# Ohne diesen Rand sitzt die macOS-Ampel auf dem Schriftzug.
schritt "ampelrand" grep -q 'data-titlebar-inset' web/base.css
schritt "go vet" go vet ./...
schritt "bindungen" python3 bindungen.py
schritt "js-parser" node web/parser_test.mjs
schritt "js-aufrufe" node aufrufe.mjs web/app.js web/ui.js
schritt "routen" python3 routen.py
schritt "werkbank" node web/devpanel_test.mjs
schritt "i18n" node web/i18n_test.mjs

printf '%-16s' "go test"
go test ./... >/dev/null || { echo "FEHLER"; go test ./...; exit 1; }
echo "ok"
schritt "bau" go build -o /dev/null .
for t in darwin/arm64 darwin/amd64 windows/amd64 linux/amd64 linux/arm64; do
	printf '  %-16s ' "$t"
	if out=$(GOOS=${t%/*} GOARCH=${t#*/} go build -o /dev/null ./internal/... 2>&1); then
		echo "ok"
	else
		echo "FEHLER"
		echo "$out" | sed 's/^/      /' | head -10
		fehler=1
	fi
done

if [ "$fehler" != "0" ]; then
	echo
	echo "  PRÜFUNG FEHLGESCHLAGEN"
	exit 1
fi
echo "  alles grün"
