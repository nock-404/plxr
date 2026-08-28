#!/bin/bash
# Everything that has to be checked before a commit.
#
# Deliberately not `cmd && echo ok`: with an && chain, `set -e` does NOT abort
# precisely when the left-hand side fails — a check script built that way
# reports the error and carries on regardless.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:$HOME/go/bin:$PATH"

failed=0
step() {
	local name="$1"; shift
	printf '  %-20s ' "$name"
	if out=$("$@" 2>&1); then
		echo "ok"
	else
		echo "FAILED"
		echo "$out" | sed 's/^/      /' | head -20
		failed=1
	fi
}

step "javascript" node --check web/app.js
step "javascript ui" node --check web/ui.js
step "javascript workbench" node --check web/devpanel.js
step "classes" python3 classes.py
step "attributes" python3 attributes.py
# Without these rules the window cannot be moved. They vanished without a trace
# once already, while base.css was being rewritten.
step "drag handle" grep -q -- '--wails-draggable: drag' web/base.css
# Without this inset the macOS traffic lights sit on top of the wordmark.
step "titlebar inset" grep -q 'data-titlebar-inset' web/base.css
step "go vet" go vet ./...
step "bindings" python3 bindings.py
step "js parser" node web/parser_test.mjs
step "js calls" node calls.mjs web/app.js web/ui.js
step "routes" python3 routes.py
step "fields" python3 fields.py
step "workbench" node web/devpanel_test.mjs
step "i18n" node web/i18n_test.mjs
# gofmt is not cosmetic here: renaming shifts every aligned block, and drifted
# formatting hides real diffs in the next review.
step "gofmt" bash -c '[ -z "$(gofmt -l . | grep -v "^build/")" ]'

printf '  %-20s ' "go test"
go test ./... >/dev/null || { echo "FAILED"; go test ./...; exit 1; }
echo "ok"
step "build" go build -o /dev/null .
for t in darwin/arm64 darwin/amd64 windows/amd64 linux/amd64 linux/arm64; do
	printf '  %-20s ' "$t"
	if out=$(GOOS=${t%/*} GOARCH=${t#*/} go build -o /dev/null ./internal/... 2>&1); then
		echo "ok"
	else
		echo "FAILED"
		echo "$out" | sed 's/^/      /' | head -10
		failed=1
	fi
done

if [ "$failed" != "0" ]; then
	echo
	echo "  CHECK FAILED"
	exit 1
fi
echo "  all green"
