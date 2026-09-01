# Draft: managing accounts

**Not built. This is the page to nod at or throw away.**

## What exists today, measured

- `accounts.Discover()` finds `~/.claude`, `~/.claude2`, `~/.claude3` — any
  `.claude` plus digits that has a `projects` directory inside it.
- The order is by path, the number comes from the directory name, and the
  interface builds "account 2" from that number.
- A session is bound to an account through one environment variable:
  `CLAUDE_CONFIG_DIR`. Nothing else distinguishes them.
- `GET /api/accounts` returns the list with a session count.
- **`accounts.Save()` exists and is called from nowhere.** `load()` reads an
  `accounts.json` and `Discover()` prefers it over looking at the disk — so the
  half that remembers a decision is built, and the half that makes one is not.

So the gap is exactly this: everything is derived from directory names, and
nothing he decides about an account survives.

## What managing them would mean

Four things, in the order they are worth having:

1. **A name.** "account 2" says nothing. "work" and "private" say everything.
   One field, stored in `accounts.json`, shown everywhere the number is shown.
2. **A default.** Which account a new session uses when he does not pick one.
   Today it is whichever sorts first by path, which is an accident.
3. **Hiding one.** A third directory that exists but is not in use clutters
   every picker. Hidden, not deleted — the directory stays untouched.
4. **Adding one by hand.** A config directory somewhere other than `~`, or one
   whose name does not fit the pattern. This is the only one that needs a new
   field: a path he types.

Deliberately not in the list: **creating or deleting a Claude account.** plxr
does not own those. A directory it did not create is a directory it does not
remove.

## How it would work

`accounts.json` becomes the answer, and discovery the fallback for what it does
not mention:

```
[
  { "name": "claude",  "label": "work",    "dir": "…/.claude",  "default": true },
  { "name": "claude2", "label": "private", "dir": "…/.claude2" },
  { "name": "claude3", "hidden": true }
]
```

- Anything found on disk and missing from the file is appended as it is found —
  a new account appears by itself, as it does now.
- Anything in the file that is no longer on disk is shown greyed out with the
  reason, not silently dropped. A missing directory is usually a mistake.
- `PUT /api/accounts` writes the whole list, the way `PUT /api/prefs` does.
- The interface: the existing accounts panel in settings gains a name field, a
  radio for the default, and a checkbox for hiding. No new view.

## What it costs

Half a day, most of it in the interface. The daemon side is `Save()` — already
written — plus one route and the two rules above about appending and greying
out.

## The question for him

Is a name and a default enough? Adding a directory by hand is the one piece that
brings a new input field, and it may be for a case that never comes up.
