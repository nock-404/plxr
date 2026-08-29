#!/usr/bin/env python3
"""Do the two palette lists still agree?

There are two: theme.Allowed in Go decides what an imported theme may contain,
PALETTE in app.js decides what actually reaches the CSS. A key in only one of
them fails silently and in a way nobody traces back — the theme loads, the
colour never arrives, and the interface simply looks the way it did before.

That happened twice at once: `onAccent` was allowed and then dropped, so white
stayed on a yellow accent; `term-bg` and `term-fg` were allowed for a year and
never applied, so no theme could colour its terminal.
"""
import re
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def go_keys():
    text = open(os.path.join(HERE, 'internal/theme/theme.go'), encoding='utf-8').read()
    block = re.search(r'var Allowed = map\[string\]bool\{(.*?)\n\}', text, re.S)
    if not block:
        print('  theme.Allowed not found — this check proves nothing')
        sys.exit(1)
    body = re.sub(r'//[^\n]*', '', block.group(1))
    return set(re.findall(r'"([\w-]+)"\s*:\s*true', body))


def js_keys():
    text = open(os.path.join(HERE, 'web/app.js'), encoding='utf-8').read()
    block = re.search(r'const PALETTE = \[(.*?)\];', text, re.S)
    if not block:
        print('  PALETTE not found — this check proves nothing')
        sys.exit(1)
    return set(re.findall(r"'([\w-]+)'", block.group(1)))


def main():
    go, js = go_keys(), js_keys()
    if not go or not js:
        print('  one of the two lists is empty')
        return 1
    only_go, only_js = sorted(go - js), sorted(js - go)
    if only_go or only_js:
        print('  the palette lists have drifted apart:')
        for k in only_go:
            print(f'      "{k}" is allowed in Go but never reaches the CSS')
        for k in only_js:
            print(f'      "{k}" is applied in app.js but rejected by Go')
        return 1
    print(f'  {len(go)} palette entries, Go and app.js agree')
    return 0


if __name__ == '__main__':
    sys.exit(main())
