#!/usr/bin/env python3
"""Every git call goes through internal/git, so it is asked in one language.

git answers in the language of the machine. plxr decides what happened by
reading git's own words — "nothing to commit", "did not match any files" — and
on a German machine none of them match: a commit with nothing staged reports
an unknown error instead of saying so, and unstaging a path git no longer
knows takes the whole batch down with it.

internal/git.Command pins the language for the call. The rule this holds is
that nothing starts git any other way. It is worth a gate rather than a note,
because the package already claimed to be "the one place plxr runs git" while
four other places did it themselves, and none of them was asked in a language
this program can read.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DOOR = os.path.join("internal", "git", "git.go")

# exec.Command("git", ...) / exec.CommandContext(ctx, "git", ...)
CALL = re.compile(r'exec\.Command(?:Context)?\([^)]*?"git"')

def main():
    offenders = []
    for root, dirs, names in os.walk(HERE):
        dirs[:] = [d for d in dirs if d not in {".git", "node_modules", "out", "build", "drafts"}]
        for name in names:
            if not name.endswith(".go") or name.endswith("_test.go"):
                continue
            full = os.path.join(root, name)
            rel = os.path.relpath(full, HERE)
            if rel == DOOR:
                continue
            with open(full, encoding="utf-8") as fh:
                text = fh.read()
            for i, line in enumerate(text.splitlines(), 1):
                if CALL.search(line):
                    offenders.append(f"{rel}:{i}  {line.strip()}")

    if offenders:
        print()
        print("      these start git themselves instead of through git.Command,")
        print("      so git answers them in the language of the machine:")
        print()
        for o in offenders:
            print(f"          {o}")
        print()
        return 1

    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
