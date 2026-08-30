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

# Two ways, and the second one is not a nicety. The API allows sixty calls an
# hour per address, without a token and shared with everything else on the
# machine — one afternoon on the gh command and it answers 403. Then this
# script died with "no release found", which points at the wrong thing
# entirely: the release is there, the asking was refused.
#
# So when the API says no, the website is asked. /releases/latest redirects to
# the tag, and the download address follows from it.
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
	| grep -o "https://[^\"]*$ASSET" | head -1)

if [ -z "$URL" ]; then
	dim "the API is not answering — asking the website instead"
	TAG=$(curl -fsSI "https://github.com/$REPO/releases/latest" \
		| tr -d '\r' | sed -n 's|^[Ll]ocation:.*/releases/tag/||p' | head -1)
	[ -n "$TAG" ] || die "no release found containing $ASSET"
	URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"
	# Built by hand, so it has to be confirmed to exist — otherwise the error
	# would only show up as an unzip failure further down.
	curl -fsI "$URL" >/dev/null 2>&1 || die "$TAG has no $ASSET"
fi
dim "$URL"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

bold "Downloading"
curl -fL --progress-bar "$URL" -o "$TMP/plxr.zip"
unzip -q "$TMP/plxr.zip" -d "$TMP/unpacked"

if [ "$OS" = macos ]; then
	bold "Putting the app into /Applications"
	APP=$(find "$TMP/unpacked" -maxdepth 1 -name '*.app' | head -1)
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
	cp -R "$TMP/unpacked/." "$HOME/.local/lib/plxr/"
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
	PATH_HINT=1
fi
ln -sf "$BIN" "$TARGET/plxr"
dim "$TARGET/plxr"

# The daemon outlives the window on purpose — it owns the terminals, which is
# why sessions survive closing plxr. The flip side: replacing the files on disk
# does not touch the process that is already running. It keeps executing the
# code it started with, sometimes for weeks, and from then on a new window
# talks to an old daemon. Nothing about that is visible from outside.
#
# So it is dealt with here, where it is known that something was just replaced.
# With sessions running it is not decided unilaterally: a restart orphans them,
# and that is the user's call, not an installer's.
INFO="$HOME/.plxr/daemon.json"
if [ -f "$INFO" ]; then
	PORT=$(sed -n 's/.*"port": *\([0-9]*\).*/\1/p' "$INFO")
	TOKEN=$(sed -n 's/.*"token": *"\([^"]*\)".*/\1/p' "$INFO")
	if [ -n "$PORT" ] && [ -n "$TOKEN" ]; then
		ALIVE=$(curl -fsS -m 5 -H "X-Plxr-Token: $TOKEN" \
			"http://127.0.0.1:$PORT/api/sessions" 2>/dev/null \
			| grep -o '"alive":true' | wc -l | tr -d ' ')
		if [ "${ALIVE:-0}" = 0 ]; then
			bold "Restarting the daemon"
			OLDPID=$(sed -n 's/.*"pid": *\([0-9]*\).*/\1/p' "$INFO")
			# The answer is cut off on purpose: the daemon ends itself while
			# replying. Reading that as a failure is what the first version of
			# this did — it reported "it did not answer" while the restart had
			# worked perfectly.
			curl -fsS -m 10 -X POST -H "X-Plxr-Token: $TOKEN" \
				"http://127.0.0.1:$PORT/api/restart" >/dev/null 2>&1 || true

			# So it is not guessed but looked at: wait until a different process
			# has written the file, then say which version answers.
			i=0
			while [ "$i" -lt 40 ]; do
				NEWPID=$(sed -n 's/.*"pid": *\([0-9]*\).*/\1/p' "$INFO" 2>/dev/null)
				[ -n "$NEWPID" ] && [ "$NEWPID" != "$OLDPID" ] && break
				sleep 0.25
				i=$((i + 1))
			done
			NEWPORT=$(sed -n 's/.*"port": *\([0-9]*\).*/\1/p' "$INFO" 2>/dev/null)
			NEWTOKEN=$(sed -n 's/.*"token": *"\([^"]*\)".*/\1/p' "$INFO" 2>/dev/null)
			NOW=$(curl -fsS -m 8 -H "X-Plxr-Token: $NEWTOKEN" \
				"http://127.0.0.1:$NEWPORT/api/running" 2>/dev/null \
				| sed -n 's/.*"daemon": *"\([^"]*\)".*/\1/p')
			if [ -n "$NOW" ]; then
				dim "running: $NOW (PID ${NEWPID:-?})"
			else
				dim "it will come back by itself the next time plxr is opened"
			fi
		else
			printf '\n  \033[33m%s session(s) are running.\033[0m\n' "$ALIVE"
			printf '  The daemon keeps them alive and stays on the old version until it\n'
			printf '  is restarted. plxr says so in the window and offers a button for it.\n'
		fi
	fi
fi

printf '\n\033[32mdone.\033[0m\n'
if [ "${PATH_HINT:-0}" = 1 ]; then
	printf '\n  %s is not on the PATH. Put this line into your shell config:\n\n' "$TARGET"
	printf '    export PATH="%s:$PATH"\n\n' "$TARGET"
fi
printf '  plxr             open the window\n'
printf '  plxr help        every command\n'
printf '  plxr setup-hook  let Claude Code report its state\n\n'
