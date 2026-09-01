#!/usr/bin/env bash
# Build plxr3: Next.js static export, merge the daemon's data dirs into it so a
# single embed carries everything, then compile the Go binary.
set -e
cd "$(dirname "$0")"
(cd frontend && npx next build >/tmp/plxr3-next.log 2>&1) && echo "next: ok" || { echo "next: FAILED"; tail -20 /tmp/plxr3-next.log; exit 1; }
for d in themes agents skins i18n; do
  rm -rf "frontend/out/$d"
  cp -R "assets/$d" "frontend/out/$d"
done
echo "data merged into frontend/out"
# The version the binary will report, and the one the update band compares
# against. Without it every build calls itself "dev", and a build called "dev"
# is deliberately never offered an update — it is built from source, and
# overwriting it with a release would throw the source away. So a build with no
# tag says "dev" on purpose, and a build made from a tag says so.
VERSION="${VERSION:-$(git describe --tags --exact-match 2>/dev/null || echo dev)}"
echo "version: $VERSION"

go build -ldflags "-X main.version=$VERSION" -o /tmp/plxr3-app . 2>/tmp/plxr3-go.log && echo "go: ok ($(ls -lh /tmp/plxr3-app | awk '{print $5}'))" || { echo "go: FAILED"; grep -v '^ld: warning' /tmp/plxr3-go.log | head -30; exit 1; }
