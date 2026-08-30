#!/usr/bin/env python3
"""Match the package table in the README against the directories on disk.

The reason: the table still listed a package weeks after the package had
been renamed to internal/template. Documentation that is wrong is worse than
documentation that is missing — it sends the next person to a place that does
not exist, and nothing ever complains.

Both directions, and both matter: a package nobody documented is invisible, and
an entry without a package is a wrong signpost.
"""
import glob
import os
import re
import sys
from pathlib import Path

here = os.path.dirname(os.path.abspath(__file__))
on_disk = {os.path.basename(p.rstrip('/'))
           for p in glob.glob(os.path.join(here, 'internal', '*/'))}
readme = Path(os.path.join(here, 'README.md')).read_text(encoding='utf-8')
listed = set(re.findall(r'`internal/(\w+)`', readme))

failed = 0
missing = sorted(on_disk - listed)
if missing:
    failed = 1
    print(f'  {len(missing)} package(s) that the README does not mention:')
    for p in missing:
        print(f'      internal/{p}')

gone = sorted(listed - on_disk)
if gone:
    failed = 1
    print(f'  {len(gone)} entr(ies) in the README without a package:')
    for p in gone:
        print(f'      internal/{p}')

if not failed:
    print(f'  {len(on_disk)} packages, all of them documented')
sys.exit(failed)
