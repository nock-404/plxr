#!/bin/bash
# plxr installieren.
#
#   curl -fsSL https://raw.githubusercontent.com/mg-pr/plxr/main/install.sh | sh
#
# Holt die neueste Veröffentlichung von GitHub, legt die App nach /Applications
# (macOS) und verlinkt das Kommando nach /usr/local/bin.
set -e
REPO="mg-pr/plxr"

fehler() { printf '\033[31mplxr: %s\033[0m\n' "$1" >&2; exit 1; }
schritt() { printf '\033[1m%s\033[0m\n' "$1"; }

case "$(uname -s)" in
	Darwin) OS=macos ;;
	Linux)  OS=linux ;;
	*) fehler "nur macOS und Linux; für Windows siehe install.ps1" ;;
esac
case "$(uname -m)" in
	arm64|aarch64) ARCH=arm64 ;;
	x86_64) ARCH=amd64 ;;
	*) fehler "unbekannte Architektur $(uname -m)" ;;
esac
ASSET="plxr-$OS-$ARCH.zip"

schritt "Neueste Fassung suchen"
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
	| grep -o "https://[^\"]*$ASSET" | head -1)
[ -n "$URL" ] || fehler "keine Veröffentlichung mit $ASSET gefunden"
echo "  $URL"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
schritt "Laden"
curl -fL --progress-bar "$URL" -o "$TMP/plxr.zip"
unzip -q "$TMP/plxr.zip" -d "$TMP/aus"

if [ "$OS" = macos ]; then
	schritt "Nach /Applications legen"
	APP=$(find "$TMP/aus" -maxdepth 1 -name '*.app' | head -1)
	[ -n "$APP" ] || fehler "im Archiv war kein App-Bündel"
	rm -rf /Applications/plxr.app
	ditto "$APP" /Applications/plxr.app
	xattr -dr com.apple.quarantine /Applications/plxr.app 2>/dev/null || true
	BIN=/Applications/plxr.app/Contents/MacOS/plxr
else
	schritt "Nach /usr/local/lib legen"
	sudo mkdir -p /usr/local/lib/plxr
	sudo cp -r "$TMP/aus/." /usr/local/lib/plxr/
	BIN=/usr/local/lib/plxr/plxr
	sudo chmod +x "$BIN"
fi

schritt "Kommando verlinken"
if [ -w /usr/local/bin ]; then ln -sf "$BIN" /usr/local/bin/plxr
else sudo ln -sf "$BIN" /usr/local/bin/plxr; fi

printf '\n\033[32mfertig.\033[0m  plxr help  zeigt die Kommandos.\n'
