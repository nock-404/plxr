#!/usr/bin/env python3
"""Match the error codes Go sends against the translation tables.

Go does not send prose to the interface but a code — see internal/uierr for the
why. That code is part of the contract between the two sides, exactly like a
JSON field name, and it fails in exactly the same way: nobody notices. A code
without an entry ends up on screen as "err.file.tooLarge", and only in the
moment something has already gone wrong.

Both directions are checked:
  * a code Go sends that no table knows   -> raw code on screen
  * an entry that nothing produces        -> dead weight the next person keeps
                                             in sync for nothing
"""
import json
import re
import sys
import glob
from pathlib import Path

codes = set()
with_detail = set()
for path in glob.glob('**/*.go', recursive=True):
    if path.startswith('build/'):
        continue
    text = Path(path).read_text(encoding='utf-8')
    codes |= set(re.findall(r'uierr\.(?:New|With)\("([\w.]+)"', text))
    # With() carries something the translation cannot know — a path, a name, a
    # status code. If the sentence has no place for it, it is dropped on the
    # way and the message says less than it was given: "GitHub answers with"
    # and nothing behind it.
    with_detail |= set(re.findall(r'uierr\.With\("([\w.]+)"', text))

# Not every err. key comes from Go: the window raises a few itself — no token,
# daemon gone. Those go through tr() like any other text.
from_js = set()
for path in ('web/app.js', 'web/ui.js'):
    src = Path(path).read_text(encoding='utf-8')
    from_js |= set(re.findall(r"""\btr\(\s*['"](err\.[\w.]+)['"]""", src))

tables = {f[len('web/i18n/'):-len('.json')]: json.loads(Path(f).read_text(encoding='utf-8'))
          for f in sorted(glob.glob('web/i18n/*.json'))}

failed = 0
for name, table in tables.items():
    missing = sorted(c for c in codes if c not in table)
    if missing:
        failed = 1
        print(f'  {name}.json: {len(missing)} error code(s) without an entry:')
        for c in missing:
            print(f'      {c}')

en = tables.get('en', {})
silent = []
for code in sorted(with_detail):
    for lang, table in tables.items():
        if code in table and '{detail}' not in table[code]:
            silent.append(f'{lang}.json: {code} — "{table[code]}"')
if silent:
    failed = 1
    print(f'  {len(silent)} messages drop their detail:')
    for m in silent:
        print(f'      {m}')

dead = sorted(k for k in en if k.startswith('err.') and k not in codes and k not in from_js)
if dead:
    failed = 1
    print(f'  {len(dead)} entr(ies) under err. that nothing produces:')
    for k in dead:
        print(f'      {k}')

if not failed:
    print(f'  {len(codes)} error codes from Go plus {len(from_js)} from the window, all translated')
sys.exit(failed)
