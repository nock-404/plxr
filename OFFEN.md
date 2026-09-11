# Open

Everything said, shown or measured that is not done yet. New things land here
when they turn up, not when there is time for them. What is finished leaves —
there is no archive.

Checked against the running build on 31.08.2026, not from memory; added to on 11.09.2026.

## Waiting for you — three decisions, two minutes

**1. Night shift: should plxr answer for you?**
The half that only *shows* an unattended session is built. The other half would
have plxr reply to permission prompts itself inside a set window — this program
approving changes in your name while you sleep. To build it I need: which
answer, to which prompts, in which window, and what it must never approve.
*My advice: leave it. The queue already keeps work moving, and it only ever
sends what you typed yourself.* Cost if you want it: a day, most of it spent on
the rules for what it refuses.

**2. Leash: which counter, and what happens at the limit?**
Only useful against accumulated spend, not context size — the context number
says nothing about cost. Decide the limit and the reaction: halt the session,
ask, or just say so in the status strip.
*My advice: say so first, halt later. A leash that stops work in the middle of
something is worse than the spend it saved.* Cost: half a day; the usage data
is already there.

**3. Phone: a page in the local network, or nothing?**
Real push notifications need a foreign cloud, so that is out. What is possible
is a page on your own network that shows the same tiles and lets you answer —
but it will not ring, you have to look.
*My advice: build it only if you would actually open it. A page nobody opens is
the most expensive kind of feature.* Cost: a day, and the daemon has to listen
beyond 127.0.0.1, which is a security decision of its own.

**Two drafts are ready for the same treatment** — `drafts/mcp-server.md` and
`drafts/accounts.md`. Both are one page, both end with the one question I could
not answer for you.

## Verified fixed — the old list, item by item

- **The terminal matches the theme.** Every skin sets `--term-bg`, `--term-fg`
  and its own `--term-font`; the terminal is monospace in all four even where
  the interface is not.
- **The pane label no longer overlaps the first line.** Measured at 7px of
  overlap, now 5px of clearance, identical in all four skins.
- **Account switching is not offered where it cannot work.** Without a Claude
  session id the control is plain text with a tooltip saying why.
- **Resume replaces the tile instead of leaving it.** `ResumeOrphaned` clears
  the old entry first; measured 4 sessions before and 4 after.
- **Two daemons at once.** Racing two starts: one comes up, the other says
  "another daemon is already running — stepping aside".
- **German is gone**, and a gate reads all 154 source files to keep it that way.
- **Theme names are English**, and the palettes come from the daemon.
- **Unattended sessions are marked.** A session started with
  `--dangerously-skip-permissions` wears hazard stripes and a red dot, in all
  four skins — the warning coat the old app had and this one had lost.
- **The update swap works end to end.** Run against a versioned build of this
  code: the check found 0.35.0, the asset was downloaded, unpacked and swapped
  in, and the result ran and reported its own version. No half copies left
  behind. It replaces the running executable, so it can never reach an
  installation it was not started from.
- **Queue.** Instructions can be lined up; the daemon sends the next one when
  the agent is actually ready — an agent when it asks, a shell when it has been
  quiet at its prompt. It lives on disk, so it keeps going with the window
  closed and survives a restart. Verified: three queued through the API and
  three through the interface, all six ran in order.
- **Collision watch.** Starting a session in a folder that already has one says
  so and asks again; the button reads START ANYWAY until it is acknowledged. A
  trailing slash does not fool it.

## Still open

Said on 11.09.2026, in this order of weight:

- **The path field is the place you are.** Choosing a folder there used to
  narrow the overview and nothing else — + NEW then asked for the same folder
  again, and FOLDERS did not know about it. In progress: a committed folder
  (Enter, or ↵) is opened in FOLDERS, is where + NEW starts, and is remembered.
  Still to come: opening files straight from there, and whether the whole git
  side holds up in daily use — the aim is to replace VS Code with its plugins
  and the terminal, nothing less.
- **Panels that dock — Dockview.** Chosen over FlexLayout, rc-dock and the
  grid engines: framework-free core with a React binding, deep nesting, tabs,
  `toJSON`/`fromJSON` for saving, and panels that pop out into a window of
  their own — usage on the second screen. Dressed through its CSS variables in
  the four skins; xterm gets a fit on every panel resize. Layout saved and
  restored at the next start. Needed so that usage
  and accounts can be on screen all the time instead of behind a tab.
- **Usage visible at any time.** A panel, not a view — see the point above.
- **Managing accounts.** There is `GET /api/accounts` and nothing else — no
  adding, naming or setting a default. Wanted properly: add, name, default,
  switch, and see which one a session is on.
- **Fonts.** None can be brought in today. The plan: a `fonts/` folder next to
  everything else plxr owns; a file dropped there — .ttf, .otf, .woff2 — is
  served by the daemon under `/fonts/`, the window writes the `@font-face` for
  it, and the settings offer it for the interface and, if it is monospace, for
  the terminal. The terminal has to wait for `document.fonts.load` before it
  measures, or every cell is the wrong width. No foreign server involved; a
  download by URL into that folder is an explicit action, never automatic.
- **Audit findings, git and marks — done 11.09.** Commit from a subfolder no
  longer sweeps in work staged outside it (refused, with a message); unstaging
  a rename across the folder edge undoes both halves; the batch retry finishes
  the batch; the diff of a deleted file opens; a staged rename's diff shows the
  move, not a whole-file rewrite; an unchanged-in-this-direction file reads as
  "no difference"; git's deadline is held even when git leaves a grandchild on
  the pipe; RESTORE survives a rename since the mark, recreates a removed
  directory, and never writes through a symlink out of the repo; the untracked
  line count is streamed, not read whole; blank context lines keep the diff's
  line numbers right.
- **The session bar is dynamic — done 11.09.** No more wrapping onto a second
  line: it measures what fits at the panel's real width and moves the rest
  under a single "\u22ef" menu. Survives any width the window manager hands it.
- **Editor safety — done 11.09.** Unsaved edits are no longer dropped in
  silence when another file is opened: the window asks first. And two files of
  the same name no longer share one editor and one undo history — the editor is
  keyed on the whole path now.
- **More audit fixes — 11.09.** Git marks now show when the folder is reached
  through a symlink (every entry carries a stable `rel` the marks are keyed by);
  the `--browser` open uses a single-use code instead of putting the token on
  stdout, in `ps`, and in browser history; a symlink to a directory is a
  directory in the tree and opens; a failed file read clears the old text
  instead of leaving it under the new name.
- **Still open from the audit:** the Windows path form of the same git-mark
  keying; a directory that cannot be read expanding to nothing without saying
  why; RESTORE not refreshing the list it changed; a handful of minor ones.
- **plxr as an MCP server.**

## Details behind the decisions

The night shift's two readings, spelled out, because the difference is the whole
point: *(a)* mark a session he starts himself with its prompts turned off — this
is built, such a tile wears hazard stripes; *(b)* plxr replies to the prompts
itself inside a window — not built, and not something to infer from one line on
a wish list.

The two drafts carry the same shape: what it would do, what it must never do,
what it costs, and the one question left over.

## On his machine, not in this code

- **Two installed daemons are running right now** — PIDs 10092 (since 29.08.
  08:14) and 55041 (since 30.08. 22:37), both `/Applications/plxr.app`. That is
  the old build without the lock. They hold his terminals, so they are his to
  end, not mine.
- **`mg-pr/plxr` deletion.** `gh repo delete mg-pr/plxr --yes`. His old company
  address is still in that history.
