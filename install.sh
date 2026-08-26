#!/bin/sh
# plxr installieren.
#
#   curl -fsSL https://raw.githubusercontent.com/mg-pr/plxr/main/install.sh | sh
#
# Holt die neueste Veröffentlichung von GitHub, legt die App nach /Applications
# (macOS) beziehungsweise ~/.local/lib (Linux) und verlinkt das Kommando in ein
# Verzeichnis, das im PATH liegt und dem Nutzer gehört.
#
# Bewusst ohne sudo: das Skript läuft üblicherweise in einer Pipe, und dort
# kann sudo kein Passwort erfragen — es bräche mitten im Vorgang ab.
set -eu

REPO="mg-pr/plxr"

rot()   { printf '\033[31m%s\033[0m\n' "$1" >&2; }
fett()  { printf '\033[1m%s\033[0m\n' "$1"; }
grau()  { printf '\033[2m  %s\033[0m\n' "$1"; }
ende()  { rot "plxr: $1"; exit 1; }

case "$(uname -s)" in
	Darwin) OS=macos ;;
	Linux)  OS=linux ;;
	*) ende "nur macOS und Linux; für Windows das Archiv von der Releases-Seite laden" ;;
esac
case "$(uname -m)" in
	arm64|aarch64) ARCH=arm64 ;;
	x86_64|amd64)  ARCH=amd64 ;;
	*) ende "unbekannte Architektur $(uname -m)" ;;
esac
ASSET="plxr-$OS-$ARCH.zip"

for werkzeug in curl unzip; do
	command -v "$werkzeug" >/dev/null || ende "$werkzeug fehlt"
done

fett "Neueste Fassung suchen"
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
	| grep -o "https://[^\"]*$ASSET" | head -1)
[ -n "$URL" ] || ende "keine Veröffentlichung mit $ASSET gefunden"
grau "$URL"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

fett "Laden"
curl -fL --progress-bar "$URL" -o "$TMP/plxr.zip"
unzip -q "$TMP/plxr.zip" -d "$TMP/aus"

if [ "$OS" = macos ]; then
	fett "App nach /Applications legen"
	APP=$(find "$TMP/aus" -maxdepth 1 -name '*.app' | head -1)
	[ -n "$APP" ] || ende "im Archiv war kein App-Bündel"
	rm -rf /Applications/plxr.app
	if command -v ditto >/dev/null; then ditto "$APP" /Applications/plxr.app
	else cp -R "$APP" /Applications/plxr.app; fi
	# Ohne das hält Gatekeeper die App für heruntergeladen und blockiert sie.
	xattr -dr com.apple.quarantine /Applications/plxr.app 2>/dev/null || true
	BIN=/Applications/plxr.app/Contents/MacOS/plxr
else
	fett "Nach ~/.local/lib legen"
	mkdir -p "$HOME/.local/lib/plxr"
	rm -rf "$HOME/.local/lib/plxr"
	mkdir -p "$HOME/.local/lib/plxr"
	cp -R "$TMP/aus/." "$HOME/.local/lib/plxr/"
	BIN=$(find "$HOME/.local/lib/plxr" -maxdepth 1 -type f -perm -u+x | head -1)
	[ -n "$BIN" ] || ende "im Archiv war nichts Ausführbares"
	chmod +x "$BIN"
fi

# Ein Verzeichnis suchen, das im PATH liegt UND dem Nutzer gehört. sudo wäre
# hier der falsche Weg: in einer Pipe gibt es kein Terminal für die Eingabe.
fett "Kommando verlinken"
ZIEL=""
for d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin "$HOME/bin"; do
	[ -d "$d" ] && [ -w "$d" ] || continue
	case ":$PATH:" in *":$d:"*) ZIEL="$d"; break ;; esac
done
if [ -z "$ZIEL" ]; then
	# Keins gefunden: eines anlegen und sagen, wie es in den PATH kommt.
	ZIEL="$HOME/.local/bin"
	mkdir -p "$ZIEL"
	NACHTRAG=1
fi
ln -sf "$BIN" "$ZIEL/plxr"
grau "$ZIEL/plxr"

printf '\n\033[32mfertig.\033[0m\n'
if [ "${NACHTRAG:-0}" = 1 ]; then
	printf '\n  %s liegt nicht im PATH. Diese Zeile in deine Shell-Konfiguration:\n\n' "$ZIEL"
	printf '    export PATH="%s:$PATH"\n\n' "$ZIEL"
fi
printf '  plxr             Fenster öffnen\n'
printf '  plxr help        alle Kommandos\n'
printf '  plxr setup-hook  Claude Code seinen Zustand melden lassen\n\n'
