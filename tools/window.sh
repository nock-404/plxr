#!/usr/bin/env bash
# Photograph the real plxr window, whatever Space it sits in.
#
# `screencapture` on its own grabs the Space that is in front, which is the
# terminal whenever it runs fullscreen — for a whole night that made the native
# window impossible to look at. Asking CoreGraphics for the window id and
# capturing that one window works from anywhere.
#
# What it cannot show: the frosted background. A single-window capture excludes
# whatever sits behind the window, so the frost has to be judged on screen.
set -eu
out="${1:-/tmp/plxr-window.png}"

id=$(swift - <<'SWIFT' 2>/dev/null | head -1
import CoreGraphics
import Foundation
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
for w in list {
    let owner = (w[kCGWindowOwnerName as String] as? String) ?? ""
    if owner.hasPrefix("plxr") {
        print(w[kCGWindowNumber as String] as? Int ?? 0)
    }
}
SWIFT
)

[ -n "$id" ] || { echo "no plxr window on screen"; exit 1; }
screencapture -x -o -l"$id" "$out"
echo "$out"
