#!/usr/bin/env python3
"""Check that every Wails binding the frontend calls exists in Go.

The bindings are the only crossing between window and Go that no compiler
checks. Rename a Go method and the frontend keeps calling the old name — and
because there is usually a `?.()` in front of it, nothing happens at all. That
is exactly how the restart after an update would have vanished silently.
"""
import re, sys, pathlib

go = pathlib.Path('app.go').read_text()
present = set(re.findall(r'^func \(a \*App\) (\w+)', go, re.M))
present.discard('startup')  # callback from Wails, not a binding for the window

js = pathlib.Path('web/app.js').read_text()
called = set(re.findall(r'\bNative\.(\w+)', js))

missing = sorted(called - present)
unused = sorted(present - called)

if missing:
    print('FAILED: the frontend calls bindings that do not exist in Go:')
    for n in missing:
        print(f'  Native.{n}')
    print(f'present: {sorted(present)}')
    sys.exit(1)

if unused:
    print(f'  note: bound in Go but never called: {unused}')
print(f'  {len(called)} bindings, all present')
