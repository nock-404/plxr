#!/usr/bin/env bash
# The last gate is not a source check: it asks whether the built window has been
# looked at since it changed.
#
# It keeps the hash of the build that was last clicked through in .seen. If the
# build has moved on, this fails — deliberately with no switch to skip it. The
# rule it enforces: nothing is reported as working that nobody has watched work.
set -u
cd "$(dirname "$0")"

files=$(find frontend/app frontend/components frontend/lib internal main.go \
	-type f \( -name '*.tsx' -o -name '*.ts' -o -name '*.css' -o -name '*.go' \) 2>/dev/null)
count=$(printf '%s\n' "$files" | grep -c . || true)

# A hash of nothing is a hash. Once recorded it would match for ever, and this
# gate would report that a build had been looked at while it had not seen a
# single file. So: no files, no verdict.
if [ "$count" -lt 20 ]; then
	echo
	echo "      only $count source files found — the paths are wrong,"
	echo "      and a hash of nothing would pass for ever."
	echo
	exit 1
fi

hash=$(printf '%s\n' "$files" | xargs shasum | shasum | cut -d' ' -f1)

if [ -f .seen ] && [ "$(cat .seen)" = "$hash" ]; then
	echo "$count files"
	exit 0
fi

echo
echo "      This build has not been clicked through."
echo "      Start it, look at it, then record what you saw:"
echo
echo "          ./smoke.sh --seen"
echo
[ "${1:-}" = "--seen" ] || exit 1
echo "$hash" > .seen
echo "      recorded"
