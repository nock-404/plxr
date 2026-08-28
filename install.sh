#!/bin/sh
# Install plxr.
#
#   curl -fsSL https://raw.githubusercontent.com/nock-404/plxr/main/install.sh | sh
#
# Fetches the latest release from GitHub, puts the app into /Applications
# (macOS) or ~/.local/lib (Linux) and links the command into a directory that
# is on the PATH and belongs to the user.
#
# Deliberately without sudo: the script usually runs inside a pipe, and there
# sudo cannot ask for a password — it would break off halfway through.
set -eu

REPO="nock-404/plxr"

red()   { printf '\033[31m%s\033[0m\n' "$1" >&2; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
dim()   { printf '\033[2m  %s\033[0m\n' "$1"; }
die()   { red "plxr: $1"; exit 1; }

case "$(uname -s)" in
	Darwin) OS=macos ;;
	Linux)  OS=linux ;;
	*) die "macOS and Linux only; for Windows download the archive from the releases page" ;;
esac
case "$(uname -m)" in
	arm64|aarch64) ARCH=arm64 ;;
	x86_64|amd64)  ARCH=amd64 ;;
	*) die "unknown architecture $(uname -m)" ;;
esac
ASSET="plxr-$OS-$ARCH.zip"

for tool in curl unzip; do
	command -v "$tool" >/dev/null || die "$tool is missing"
done

bold "Looking for the latest version"
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
	| grep -o "https://[^\"]*$ASSET" | head -1)
[ -n "$URL" ] || die "no release found containing $ASSET"
dim "$URL"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

bold "Downloading"
curl -fL --progress-bar "$URL" -o "$TMP/plxr.zip"
unzip -q "$TMP/plxr.zip" -d "$TMP/aus"

if [ "$OS" = macos ]; then
	bold "Putting the app into /Applications"
	APP=$(find "$TMP/aus" -maxdepth 1 -name '*.app' | head -1)
	[ -n "$APP" ] || die "the archive held no app bundle"
	rm -rf /Applications/plxr.app
	if command -v ditto >/dev/null; then ditto "$APP" /Applications/plxr.app
	else cp -R "$APP" /Applications/plxr.app; fi
	# Without this Gatekeeper takes the app for a download and blocks it.
	xattr -dr com.apple.quarantine /Applications/plxr.app 2>/dev/null || true
	BIN=/Applications/plxr.app/Contents/MacOS/plxr
else
	bold "Putting it into ~/.local/lib"
	mkdir -p "$HOME/.local/lib/plxr"
	rm -rf "$HOME/.local/lib/plxr"
	mkdir -p "$HOME/.local/lib/plxr"
	cp -R "$TMP/aus/." "$HOME/.local/lib/plxr/"
	BIN=$(find "$HOME/.local/lib/plxr" -maxdepth 1 -type f -perm -u+x | head -1)
	[ -n "$BIN" ] || die "the archive held nothing executable"
	chmod +x "$BIN"
fi

# Look for a directory that is on the PATH AND belongs to the user. sudo would
# be the wrong way here: inside a pipe there is no terminal to type into.
bold "Linking the command"
TARGET=""
for d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin "$HOME/bin"; do
	[ -d "$d" ] && [ -w "$d" ] || continue
	case ":$PATH:" in *":$d:"*) TARGET="$d"; break ;; esac
done
if [ -z "$TARGET" ]; then
	# None found: create one and say how it gets onto the PATH.
	TARGET="$HOME/.local/bin"
	mkdir -p "$TARGET"
	NACHTRAG=1
fi
ln -sf "$BIN" "$TARGET/plxr"
dim "$TARGET/plxr"

printf '\n\033[32mdone.\033[0m\n'
if [ "${NACHTRAG:-0}" = 1 ]; then
	printf '\n  %s is not on the PATH. Put this line into your shell config:\n\n' "$TARGET"
	printf '    export PATH="%s:$PATH"\n\n' "$TARGET"
fi
printf '  plxr             open the window\n'
printf '  plxr help        every command\n'
printf '  plxr setup-hook  let Claude Code report its state\n\n'
