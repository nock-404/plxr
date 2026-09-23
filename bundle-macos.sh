#!/usr/bin/env bash
# Package plxr as a macOS application.
#
# A bare executable has no identity: no icon in the Dock, no name in the menu
# bar, and a notification it sends wears whoever delivered it — Script Editor,
# in the case of osascript. All of that comes from the bundle around it, so the
# bundle is not packaging, it is part of the program working.
#
# This is the macOS half. plxr runs on Linux and Windows too, and each wants a
# different wrapper for the same reason — a .desktop entry and an icon in the
# hicolor theme there, an .exe with an embedded icon and a Start-menu shortcut
# on Windows. Those are not written yet; the name of this file says so rather
# than leaving somebody to find out by running it.
#
# Only tools macOS already has: sips and iconutil.
set -eu
cd "$(dirname "$0")"

version="${1:-dev}"

# A lane of its own, for trying a build beside the one that is working.
#
# ./bundle-macos.sh 0.97.0 beta makes "plxr beta.app": another bundle
# identifier, so macOS treats it as its own application — its own Dock entry,
# its own notification settings, its own folder permissions — and PLXR_CHANNEL
# in its environment, so it keeps its sessions and settings in ~/.plxr-beta
# and never touches the ones the ordinary build is holding.
channel="${2:-}"
if [ -n "$channel" ]; then
	app="build/plxr $channel.app"
	name="plxr $channel"
	ident="dev.plxr.app.$channel"
else
	app="build/plxr.app"
	name="plxr"
	ident="dev.plxr.app"
fi

# Not >/dev/null: build.sh reports its failures on standard output, so throwing
# that away turned a compile error into a bundle that simply did not appear.
if ! out=$(./build.sh 2>&1); then
	printf '%s\n' "$out"
	exit 1
fi

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

go build -ldflags "-X main.version=$version" -o "$app/Contents/MacOS/plxr" . 2>/dev/null

sed -e "s/VERSION/$version/g" -e "s|dev.plxr.app|$ident|" -e "s|<string>plxr</string>|<string>$name</string>|" build/darwin/Info.plist > "$app/Contents/Info.plist"
if [ -n "$channel" ]; then
	# The lane, in the bundle: an application started from the Finder inherits
	# nobody's shell, so the only way it can know is to carry it.
	/usr/libexec/PlistBuddy -c "Add :LSEnvironment dict" -c "Add :LSEnvironment:PLXR_CHANNEL string $channel" "$app/Contents/Info.plist" >/dev/null
fi

# The icon, in every size macOS asks for.
iconset=$(mktemp -d)/plxr.iconset
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
	sips -z $size $size build/appicon.png --out "$iconset/icon_${size}x${size}.png" >/dev/null 2>&1
	sips -z $((size * 2)) $((size * 2)) build/appicon.png --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null 2>&1
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/iconfile.icns"
rm -rf "$(dirname "$iconset")"

# Signed to itself: unsigned, macOS treats every launch as a new, unknown
# program and the notification permission is asked for again each time.
#
# Against an empty keychain, made for this one call and thrown away after it.
# The signature needs no key — it is ad-hoc, and there is no signing identity
# on this machine at all — but codesign searches the keychains all the same,
# and on a machine whose login keychain holds a private key it stops the build
# with a password prompt about a key it has no use for ("what is this for if
# nobody needs it?", 23.09.2026). Measured: same signature, 0.04 s, no prompt.
signing_keychain="$(mktemp -d)/signing.keychain-db"
security create-keychain -p "" "$signing_keychain" >/dev/null 2>&1
codesign --force --deep --sign - --keychain "$signing_keychain" "$app" >/dev/null 2>&1 ||
	codesign --force --deep --sign - "$app" >/dev/null 2>&1 || true
security delete-keychain "$signing_keychain" >/dev/null 2>&1 || true
rm -rf "$(dirname "$signing_keychain")"

echo "  $app  ($version)"
