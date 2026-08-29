#!/bin/bash
# The hash of the working tree exactly as it stands — committed or not.
#
# Deliberately not `git rev-parse HEAD`: the question is what is on disk right
# now, because that is what gets built and clicked through. A temporary index
# keeps the real index and the worktree untouched.
cd "$(dirname "$0")"
# -u: only the name. git wants to create the index itself — an existing
# empty file makes it abort with "index file smaller than expected".
idx=$(mktemp -u)
trap 'rm -f "$idx"' EXIT
GIT_INDEX_FILE="$idx" git add -A >/dev/null 2>&1
GIT_INDEX_FILE="$idx" git write-tree
