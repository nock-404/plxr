#!/usr/bin/env python3
"""Check that every daemon call in the JavaScript hits a route in Go.

This seam took the whole app apart once already, and nobody saw it: the
JavaScript calls, Go answers 404, the caller gets a text instead of data.
Nothing crashes, it just does not work.

The compiler knows neither side — one is a string, the other is a string. What
gets compared is method plus path, with placeholders instead of substituted
values:

    req(`/api/themes/${encodeURIComponent(name)}`, { method: 'DELETE' })
    mux.HandleFunc("DELETE /api/themes/{name}", …)

The query part behind ? is of no interest — no router checks it.

The path is read by bracket matching, not with one expression: `${hard ? '?x' :
''}` contains a question mark and quotes itself, and a naive pattern then reads
the path right into the middle of the substitution. A false alarm costs more
here than no test at all — it is the reason people switch tests off.

One direction is checked: every call needs a route. The other way round would
be no finding. A route without a caller is allowed: the hook talks to the
daemon directly, without going through the interface.
"""
import re
import sys
from pathlib import Path

JS = 'web/app.js'
GO = 'internal/server/server.go'


def closing_paren(text, i):
    """Index after the closing paren matching text[i] == '('.

    Strings are skipped, otherwise a parenthesis inside a text ends the call
    too early.
    """
    depth, n = 0, len(text)
    while i < n:
        c = text[i]
        if c in '\'"`':
            i += 1
            while i < n and text[i] != c:
                i += 2 if text[i] == '\\' else 1
            i += 1
            continue
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


def read_literal(text, i):
    """Read a string starting at text[i]; returns (content, index after it).

    Inside template strings the substitutions are skipped by bracket matching
    and replaced with {} — even when they contain braces or texts themselves.
    """
    quote = text[i]
    i += 1
    out, n = [], len(text)
    while i < n and text[i] != quote:
        if text[i] == '\\':
            out.append(text[i:i + 2])
            i += 2
            continue
        if quote == '`' and text.startswith('${', i):
            depth, j = 1, i + 2
            while j < n and depth:
                if text[j] == '{':
                    depth += 1
                elif text[j] == '}':
                    depth -= 1
                j += 1
            out.append('{}')
            i = j
            continue
        out.append(text[i])
        i += 1
    return ''.join(out), i + 1


def normalise(path):
    path = re.sub(r'\{\}(?:\{\})+', '{}', path.split('?')[0].rstrip('/'))
    # A {} stuck to a word rather than following a / is not a path segment: in
    # Go a placeholder is always a whole segment. It is a substitution carrying
    # the query part — `/reply${raw ? '?raw=1' : ''}` — and that is no longer
    # part of the path once the question mark inside it has gone.
    while re.search(r'[^/]\{\}$', path):
        path = path[:-2]
    return path.rstrip('/')


def from_go(text):
    return {(m.group(1), normalise(re.sub(r'\{[a-zA-Z]\w*\}', '{}', m.group(2))))
            for m in re.finditer(r'mux\.(?:HandleFunc|Handle)\(\s*"([A-Z]+)\s+([^"]+)"', text)}


def from_js(text):
    text = re.sub(r'/\*[\s\S]*?\*/', ' ', text)
    text = re.sub(r'//[^\n]*', ' ', text)

    calls = set()
    for m in re.finditer(r'\breq\(', text):
        start = m.end() - 1
        end = closing_paren(text, start)
        call = text[start + 1:end - 1]

        i = 0
        while i < len(call) and call[i].isspace():
            i += 1
        if i >= len(call) or call[i] not in '\'"`':
            continue
        path, i = read_literal(call, i)
        if not path.startswith('/api/'):
            continue
        # Concatenation: req('/api/sessions/' + id) — what follows is a value.
        rest = call[i:].lstrip()
        if rest.startswith('+'):
            path += '{}'
            rest = rest.split(',', 1)[1] if ',' in rest else ''
        method = re.search(r"""method:\s*'([A-Z]+)'""", rest)
        calls.add((method.group(1) if method else 'GET', normalise(path)))
    return calls


routes = from_go(Path(GO).read_text())
calls = from_js(Path(JS).read_text())

missing = sorted(c for c in calls if c not in routes)
for method, path in missing:
    print(f'  {method} {path} — no route in {GO}')
if missing:
    sys.exit(1)

unused = len(routes) - len({r for r in routes if r in calls})
print(f'  {len(calls)} call(s) hit a route, {unused} route(s) without a caller')
