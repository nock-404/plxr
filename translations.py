#!/usr/bin/env python3
"""Every text the window asks for exists in both languages.

tr(key, english) falls back to its second argument when the key is not in the
loaded table, and only one table is ever loaded — the active language. So a key
missing from de.json is not an error anybody sees as an error: it is an English
sentence in a German window, sitting quietly among German ones.

Seventy-eight of them had built up that way, across the empty states, the
keyboard help, the port list, the player, the viewer and the usage view. None of
the other gates could see it: german.py checks that no German is in the code,
which was true, and errors.py only looks at error codes.

Keys are read from tr() calls and from the tables that hand tr() a key from a
field — {key, fallback} and {text, english}. err.* codes belong to errors.py and
are skipped here.

A key built at runtime is refused outright. There was one — tr(`settings.tab.${t}`)
— and four of its five keys did not exist, so four tabs in the settings showed
their own identifier instead of a word. In English "look" and "status" read like
words, which is why it stood for as long as it did; in German the row said
"look colours Töne agents status". Nothing can check a key that is only known
while the program runs, so the rule is that there are none.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKIP = {"node_modules", "out", ".next"}

# Comments are stripped before anything is looked for. The first version of the
# built-key rule below reported the comment that explains the rule: the example
# in the prose is the very shape it forbids. A gate that trips over its own
# explanation is a gate somebody switches off.
BLOCK = re.compile(r"/\*.*?\*/", re.S)
LINE = re.compile(r"^\s*//.*$", re.M)


def code(text):
    return LINE.sub("", BLOCK.sub("", text))


CALL = re.compile(r'\btr\(\s*"([^"]+)"', re.S)
BUILT = re.compile(r'\btr\(\s*`([^`]*)`')
FIELD = re.compile(r'\b(?:key|text)\s*:\s*"([a-z][\w]*(?:\.[\w]+)+)"')

keys, files, built = set(), 0, []
for root, dirs, names in os.walk(os.path.join(HERE, "frontend")):
    dirs[:] = [d for d in dirs if d not in SKIP]
    for name in names:
        if not name.endswith((".ts", ".tsx")):
            continue
        files += 1
        text = code(open(os.path.join(root, name), encoding="utf-8").read())
        keys |= set(CALL.findall(text)) | set(FIELD.findall(text))
        rel = os.path.relpath(os.path.join(root, name), HERE)
        built += [(rel, k) for k in BUILT.findall(text)]

keys = {k for k in keys if not k.startswith("err.")}

# A count nobody can see is a count nobody checks: three gates here once read no
# files at all and reported ok for hours.
if files < 20 or len(keys) < 50:
    print(f"  read {files} files and found {len(keys)} keys — the paths are wrong")
    sys.exit(1)

tables = {
    lang: json.load(open(os.path.join(HERE, "assets", "i18n", f"{lang}.json"), encoding="utf-8"))
    for lang in ("en", "de")
}

faults = [f"{where}  tr(`{key}`) — assembled while it runs, so nothing can check it"
          for where, key in built]

for lang, table in tables.items():
    for key in sorted(k for k in keys if k not in table):
        faults.append(f"{lang}.json  {key}")

# The same holes on both sides, too: a {n} the other language dropped is a word
# missing from a sentence, and nothing else notices.
for key in sorted(keys):
    holes = {lang: set(re.findall(r"\{(\w+)\}", tables[lang].get(key, ""))) for lang in tables}
    if key in tables["en"] and key in tables["de"] and holes["en"] != holes["de"]:
        faults.append(
            f"both      {key}  en has {sorted(holes['en']) or 'none'}, "
            f"de has {sorted(holes['de']) or 'none'}"
        )

# The German file's own spelling, which nothing else watches.
#
# Two kinds turned up in it the first time somebody read the German window: an
# umlaut written out as ae/oe/ue — "es laeuft", "endgueltig loeschen" — and a
# word that drifted. The file has said "Session" 47 times since it was written;
# a batch of new entries said "Sitzung", so the same thing had two names in one
# window. The file that is already there decides.
GERMAN_SPELLING = {
    "laeuft": "läuft", "geloescht": "gelöscht", "haette": "hätte",
    "endgueltig": "endgültig", "loeschen": "löschen", "gewaehlten": "gewählten",
    "auswaehlen": "auswählen", "waehlen": "wählen", "koennen": "können",
    "muessen": "müssen", "fuer": "für", "ueber": "über", "zurueck": "zurück",
    "Anwendungsbuendel": "Anwendungsbündel", "Sitzung": "Session",
    "Sitzungen": "Sessions",
}
for key, text in sorted(tables["de"].items()):
    for bad, good in GERMAN_SPELLING.items():
        if re.search(rf"\b{bad}\b", text, re.I):
            faults.append(f'de.json    {key}  says "{bad}" where this file says "{good}"')

if faults:
    print(f"  {len(faults)} texts the window asks for and does not get:")
    for f in faults[:40]:
        print(f"      {f}")
    if len(faults) > 40:
        print(f"      … and {len(faults) - 40} more")
    sys.exit(1)

print(f"  every text exists in both languages — {len(keys)} keys, {files} files")
