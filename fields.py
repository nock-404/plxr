#!/usr/bin/env python3
"""Match the JSON fields Go sends against what the JavaScript reads.

The reason this script exists: the usage view showed bars without labels for
weeks. Go sent the field as `json:"schluessel"`, app.js read `z.key`. No error,
no warning — just an empty column that looks like "there was nothing there".

No other gate catches this class. The Go compiler knows nothing about the JS
side, classes.py sees only classes and ids, routes.py only paths. Between the
two languages there is nothing but a name inside a string tag, and nobody
checks it.

One direction is checked: every field that goes out to the interface needs a
reader. The other way round would be no finding — the interface is allowed to
ignore a field without anything being broken.
"""
import re
import os
import sys
import glob

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, 'web')

# Packages whose structs the server hands out as JSON. Nothing else is checked:
# a cache on disk has field names of its own and is none of the interface's
# business.
TO_THE_INTERFACE = (
    'internal/usage', 'internal/session', 'internal/rules', 'internal/theme',
    'internal/search', 'internal/ports', 'internal/archive', 'internal/update',
    'internal/accounts', 'internal/template', 'internal/core', 'internal/server',
    'internal/hook',
)

# Fields nobody reads on purpose.
#
# When in doubt a field does NOT belong here: that is exactly how the next
# empty column disappears from view. Every entry needs its reason beside it.
WITHOUT_READER = {
    # --- Verified: these never go to the interface ----------------------
    # Answers from GitHub, coming in rather than going out.
    'tag_name': 'GitHub release, incoming',
    'browser_download_url': 'GitHub release, incoming',
    'assets': 'GitHub release, incoming',
    'prerelease': 'GitHub release, incoming',
    'published_at': 'GitHub release, incoming',
    # Fields out of the Claude transcripts, also incoming.
    'input_tokens': 'transcript, incoming',
    'output_tokens': 'transcript, incoming',
    'cache_creation_input_tokens': 'transcript, incoming',
    'cache_read_input_tokens': 'transcript, incoming',
    'usage': 'transcript, incoming',
    'timestamp': 'transcript, incoming',
    'role': 'taken twice: incoming from the transcript, and Hit.Role — the hit '
            'list does not show the role',
    'content': 'transcript, incoming',
    # The hook payload comes IN from Claude Code — those field names are its
    # contract, not ours, and the interface never sees them.
    'hook_event_name': 'hook payload, incoming from Claude Code',
    'session_id': 'hook payload, incoming',
    'transcript_path': 'hook payload, incoming',
    'tool_name': 'hook payload, incoming',
    'tool_input': 'hook payload, incoming',
    'notification_type': 'hook payload, incoming',
    'last_assistant_message': 'hook payload, incoming',
    'agent_id': 'hook payload, incoming',
    'permission_mode': 'hook payload, incoming',
    'updated_at': 'the state file on disk, read by the fleet watcher, not by the interface',
    # Cache on disk, format of its own.
    'version': 'disk cache',
    'groesse': 'disk cache',
    'mod': 'disk cache',
    'days': 'disk cache, never goes to the interface',
    # Needed on the server side only.
    'assetUrl': 'only the updater fetches with it',
    'assetName': 'only the updater fetches with it',
    'level': 'verified: the rules view shows kind, name, description and path — '
             'the level only orders them inside the server',

    # --- Inherited: not looked at yet ------------------------------------
    #
    # These were already there when this gate was built. They are listed so
    # that NEW mismatches turn red at once instead of drowning in a long list.
    # Every entry is an open question, not a clearance: either the interface
    # reads the field under a wrong name (then it is a bug like "frage" against
    # tile.confirm), or it really is not needed and the tag should go.
    'aiTitle': 'not looked at yet',
    'author': 'not looked at yet',
    'claude_session_id': 'not looked at yet',
    'ended_at': 'not looked at yet',
    'gitBranch': 'not looked at yet',
    'loop': 'not looked at yet',
    'started_at': 'not looked at yet',
    'termFont': 'not looked at yet',
    'tty': 'not looked at yet',
    'user': 'not looked at yet',
}


def go_fields():
    """Every json tag from the packages that go out to the interface."""
    found = {}
    for package in TO_THE_INTERFACE:
        for path in glob.glob(os.path.join(HERE, package, '*.go')):
            if path.endswith('_test.go'):
                continue
            for nr, line in enumerate(open(path, encoding='utf-8'), 1):
                for m in re.finditer(r'json:"([^",]+)', line):
                    name = m.group(1)
                    if name == '-' or not name:
                        continue
                    found.setdefault(name, f'{os.path.relpath(path, HERE)}:{nr}')
    return found


def js_names():
    """Everything the JavaScript could possibly read as a property."""
    text = ''
    for f in sorted(glob.glob(os.path.join(WEB, '*.js'))):
        text += open(f, encoding='utf-8').read()
    names = set(re.findall(r'\.([A-Za-z_]\w*)', text))          # z.key
    names |= set(re.findall(r"""\[['"](\w+)['"]\]""", text))     # z['key']
    names |= set(re.findall(r"""['"](\w+)['"]\s*:""", text))     # { 'key': … }
    names |= set(re.findall(r'\b(\w+)\s*:', text))               # { key: … }
    names |= set(re.findall(r'{\s*([\w,\s]+)\s*}\s*=', text))    # const { key } = …
    split = set()
    for group in list(names):
        for part in re.split(r'[,\s]+', group):
            if part:
                split.add(part)
    return split


def main():
    fields = go_fields()
    read = js_names()
    unread = sorted(n for n in fields if n not in read and n not in WITHOUT_READER)
    if unread:
        print(f'  {len(unread)} JSON fields go out, but nobody reads them:')
        for n in unread:
            print(f'      "{n}"  ({fields[n]})')
        return 1
    print(f'  {len(fields)} JSON fields, all of them read')
    return 0


if __name__ == '__main__':
    sys.exit(main())
