#!/usr/bin/env sh
# plxr, installed with one command.
#
#   curl -fsSL https://plxr.dev/install.sh | sh          (or the raw URL below)
#
# What it does: works out which system this is, asks GitHub for the newest
# release, downloads the archive for that system, and puts the program where
# that system keeps programs. Nothing else is touched — no package manager, no
# sudo unless /Applications needs it, no daemon started behind your back.
#
# macOS  → /Applications/plxr.app   (~/Applications when the first is not writable)
# Linux  → ~/.local/bin/plxr        plus a desktop entry
#
# Windows has install.ps1 beside this file.
set -eu

REPO="nock-404/plxr"
say() { printf '  %s\n' "$*"; }
die() { printf '  %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "this needs $1, which is not on this machine"; }
need curl
need unzip

os=$(uname -s)
arch=$(uname -m)
case "$arch" in
	x86_64 | amd64) arch="amd64" ;;
	arm64 | aarch64) arch="arm64" ;;
	*) die "plxr has no build for $arch" ;;
esac
case "$os" in
	Darwin) asset="plxr-macos-$arch.zip" ;;
	Linux) asset="plxr-linux-$arch.zip" ;;
	*) die "plxr has no build for $os — Windows has install.ps1" ;;
esac

# The newest version, read off the redirect /releases/latest sends. No API
# token needed, and no jq: the tag is the last part of the address it points at.
tag=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest" | sed 's#.*/##')
[ -n "$tag" ] || die "could not work out the newest version"
say "plxr $tag, $asset"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM
url="https://github.com/$REPO/releases/download/$tag/$asset"
curl -fSL --progress-bar -o "$tmp/plxr.zip" "$url" || die "the download failed: $url"
unzip -q "$tmp/plxr.zip" -d "$tmp/out" || die "the archive could not be unpacked"

if [ "$os" = "Darwin" ]; then
	app=$(find "$tmp/out" -maxdepth 2 -name "*.app" -type d | head -1)
	[ -n "$app" ] || die "no application in the archive"
	dest="/Applications"
	[ -w "$dest" ] || dest="$HOME/Applications"
	mkdir -p "$dest"
	rm -rf "$dest/plxr.app"
	cp -R "$app" "$dest/plxr.app"
	# Downloaded by a script, not by the browser: the quarantine flag would
	# make the first start a dialog about an unidentified developer.
	xattr -dr com.apple.quarantine "$dest/plxr.app" 2>/dev/null || true
	say "installed: $dest/plxr.app"
	say "start it:  open -a plxr"
	exit 0
fi

bin=$(find "$tmp/out" -maxdepth 2 -type f -perm -u+x | head -1)
[ -n "$bin" ] || die "no program in the archive"
mkdir -p "$HOME/.local/bin"
install -m 0755 "$bin" "$HOME/.local/bin/plxr"
# A desktop entry, so it is in the launcher and not only on the path.
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/plxr.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=plxr
Comment=Control room for coding CLI sessions
Exec=$HOME/.local/bin/plxr
Terminal=false
Categories=Development;
DESKTOP
say "installed: $HOME/.local/bin/plxr"
case ":$PATH:" in
	*":$HOME/.local/bin:"*) say "start it:  plxr" ;;
	*) say "start it:  $HOME/.local/bin/plxr   (that folder is not on your PATH yet)" ;;
esac
