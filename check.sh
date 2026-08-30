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
step "javascript palette" node --check web/crtpalette.js
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
step "js properties" node props.mjs web/app.js web/ui.js web/devpanel.js
step "routes" python3 routes.py
step "fields" python3 fields.py
step "palette" python3 palette.py
step "workbench" node web/devpanel_test.mjs
step "crt palette" node web/crtpalette_test.mjs
step "i18n" node web/i18n_test.mjs
step "error codes" python3 errors.py
step "packages" python3 packages.py
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

# Clicked through — in exactly this state, not in some earlier one.
#
# Every gate above reads the source. Not one of them can see an empty pane, a
# button with no size, or a list that answers null and leaves the view blank
# without a word. Only a running window shows that, and reading code and then
# claiming the interface works is a lie with extra steps.
#
# So this does not ask whether smoke.sh was run at some point — it compares the
# hash of the working tree against the state smoke.sh last passed on, and runs
# it when they differ. There is no way to be green without having been looked
# at, and there is deliberately no flag to skip it.
printf '  %-20s ' "clicked through"
tree=$(./treehash.sh 2>/dev/null)
seen=$(cat "$(git rev-parse --git-dir 2>/dev/null)/plxr-smoke-passed" 2>/dev/null)
if [ -n "$tree" ] && [ "$tree" = "$seen" ]; then
	echo "ok (unchanged)"
else
	echo "running"
	if out=$(./smoke.sh 2>&1); then
		echo "$out" | sed 's/^/      /' | tail -3
	else
		echo "$out" | grep -E "FAILED|screenshots" | sed 's/^/      /' | head -12
		failed=1
	fi
fi

if [ "$failed" != "0" ]; then
	echo
	echo "  CHECK FAILED"
	exit 1
fi
echo "  all green"
