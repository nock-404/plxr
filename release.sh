#!/usr/bin/env bash
# Publish a version, with the names the update band looks for.
#
# Those names are not decoration: internal/update/update.go asks for
# plxr-<os>-<arch>.zip and nothing else, so a file called
# plxr-macos-0.94.1.zip is a release that installs nowhere — the band finds the
# version, offers it, and the download is a 404. That happened, which is why
# the names are no longer typed by hand.
#
# Takes the version without its "v": ./release.sh 0.94.2 "a title" < notes
set -eu
cd "$(dirname "$0")"

version="${1:?the version, without the leading v}"
title="${2:-$version}"
notes="$(cat)"

[ -n "$(git status --porcelain)" ] && { echo "the tree has changes — commit them first"; exit 1; }
git rev-parse "v$version" >/dev/null 2>&1 || git tag "v$version"

VERSION="$version" ./build.sh
VERSION="$version" ./bundle-macos.sh "$version"

out=$(mktemp -d)
ditto -c -k --keepParent build/plxr.app "$out/plxr-macos-$(uname -m | sed 's/x86_64/amd64/').zip"
GOOS=windows GOARCH=amd64 go build -ldflags "-X main.version=$version -H windowsgui" -o "$out/plxr.exe" .
(cd "$out" && zip -q "plxr-windows-amd64.zip" plxr.exe && rm plxr.exe)

git push origin HEAD:main "v$version"
GH_TOKEN=$(gh auth token --user nock-404) gh release create "v$version" "$out"/*.zip \
	--repo nock-404/plxr --title "$title" --notes "$notes"
rm -rf "$out"
