# Open

Everything said, shown or measured that is not done yet. New things land here
when they turn up, not when there is time for them. What is finished leaves —
there is no archive.

Checked against the running build on 31.08.2026, not from memory; added to on 11.09.2026.

## From the live session on 12.09.2026 — everything he hit (his words, translated)

He ran 0.74.0 (installed and running — verified), watched it in the real crt
skin, and reported one thing after another. None of it was caught by the gates,
because they run headless and never opened a menu over a terminal or ended a
session and looked. This is the whole list, captured so he has a status instead
of watching me push to git blind ("and I have zero status").

1. **Popovers are see-through over content.** ("what the hell is this?", images
   6 + 7) The overflow menu and the hover tooltip let the terminal text behind
   them bleed through, so nothing in them is readable. Cause found: the crt skin
   turns surfaces into glass (`--panel-glass` + a backdrop blur), and at his low
   solidity setting it double-mixed to ~18% opaque. Fine over the desktop, wrong
   over app content. Every floating surface — context menu, overflow menu,
   tooltip, account dropdown, palette, select, dialog — must be opaque, not glass.

2. **The terminal does not fill its height.** ("why doesn't the terminal have
   full height?", image 4) A dead session panel leaves a large empty area below
   the terminal instead of the terminal reaching the bottom.

3. **The path is cut off.** ("why is the path cut off?") The folder path in the
   session bar is truncated with no way to see or copy the full path.

4. **A stopped session cannot be resumed.** ("why can't I resume there?") It
   shows "[plxr] this session is not running" and offers no way to start it again
   — only, at best, to close it.

5. **Ctrl+C / the command ending does not leave a shell.** ("when I end a session
   with Ctrl+C, why don't I just get a shell back?") When the CLI in a session
   exits, the session dies. A terminal replacement must drop back to a live shell
   in the same folder, the way a real terminal does.

6. **There is no real, visible menu.** ("why is there no proper menu anywhere?")
   Only the hidden palette and the settings button exist. He wants a proper,
   visible menu with all the settings, reachable without knowing a shortcut.

7. **There is no context menu where he right-clicks.** ("why is there no context
   menu anywhere?") The context menus I added are not reaching the places he
   actually right-clicks.

8. **The rail opens everything into the same panel.** ("why does everything in
   the left menu open in the same panel?") Every view from the left rail replaces
   the content of one panel instead of behaving like a real window manager.

9. **He has no status.** ("and here you are working, pushing to git all nicely,
   and I have zero status") While I work and push releases, the app gives him no
   overview of what is happening or what is tracked — above all no live view of
   the code changes / git diff, which is the whole point of a VS Code replacement.

10. **The process failed him.** ("what are you even doing?") I reported work as
    done from headless screenshots and green gates without ever looking at the
    real skinned window over a terminal, or the real session lifecycle. The rule
    from here: verify in the actually-rendered app, in the skin, over real
    content — a gate is only proof of what it looks for.

## Planned windows/panels I said I would build (not yet done)

The window-manager is meant to fill up with panels — everywhere — each a small
window you dock beside the terminal. Shipped so far: Preview (web page beside the
terminal), Changes (git source control). Still owed, and part of the windows he
wants added:

A. **A real settings window** — everything configurable in one visible place:
   terminal (font, size, scrollback, cursor), editor (CodeMirror keymap, wrap,
   tabs), keybindings, skins/palette, accounts, layout presets. This is also
   answer to complaint 6 (no real, visible menu).

B. **Live usage / cost meter panel** — spend and context over time as its own
   window, not a number hidden in a strip. He asked for this explicitly: usage
   gets interesting with the window manager too — think up what else can live in
   windows like that.

C. **Notes / scratchpad panel** — a place to keep notes beside the work.

D. **Session grid panel** — all sessions at a glance as live tiles in one
   window, openable/arrangeable like the rest.

E. **Layout presets** — named default layouts you can reset to; otherwise the
   arrangement you set is kept. (Reset-to-default exists; named presets do not.)

F. **More panel ideas to design out** — a terminal-only panel (plain shell, no
   CLI), a diff/review panel across a whole branch, a ports/preview pairing,
   an inbox that groups sessions needing an answer. To be brainstormed with him,
   not guessed.

Deferred long-term (named so they are not forgotten, not scheduled): hunk-level
staging, an LSP for the editor, a Windows code-signing certificate, and the
~20 remaining audit findings.

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

Said on 11.09.2026, in this order of weight. The first two are the big ones and
are deliberately NOT built unattended — they reshape the window (Dockview) or
need a design call (accounts); both want you awake to steer. Everything after
them is done as of 11.09 unless it says otherwise.

**Dockview — the first version is in (11.09).** The content is a dock now:
every view and every session is a panel you can split, tab, drag and float; the
arrangement is saved and comes back at the next start; a ⟲ in the header resets
to the default. The rail stays the launcher. Dressed in all four skins. Still
open, when you want them: the rich per-panel widgets (web preview of a detected
port, live usage/cost meter, a changes panel, a notes scratchpad, a session
grid), floating panels popping out into their own OS window, and — your call —
whether the rail itself goes away so the whole thing is one dock.

**Account management — done 11.09 (both a and b).** Settings → STATUS →
ACCOUNTS: each account can be named, made the default (new sessions start under
it), and removed (its directory stays). Two ways to add: "+ SIGN IN NEW" makes
a fresh numbered config directory and starts a session in it to log in
(option b), and "+ EXISTING" takes a directory you already have (option a).
Proved in the accounts package (create/default/rename/remove) and the window
gate (the section and its actions render).



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
- **Fonts — done 11.09.** A `.woff2`, `.otf` or `.ttf` imported in Settings →
  LOOK → FONTS lands in a `fonts/` folder plxr owns, is served under
  `/userfonts/`, gets its `@font-face` written by the window, and can be chosen
  for the interface and the terminal. The terminal waits for
  `document.fonts.load` before it re-fits, so no column is the wrong width.
  Nothing is downloaded — the file the user picks is served from this machine.
  Path traversal on the name is refused; the window gate imports one, declares
  it, picks it and measures that `--font` changed.
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
- **Even more — 11.09.** RESTORE now tells the tree and the changes panel to
  look again, so a file put back stops showing as changed at once. A directory
  that cannot be read says why instead of expanding to nothing.
- **Still open from the audit (all minor):** the Windows path form of the
  git-mark keying; a failed save possibly leaving a .plxr-tmp; an update
  offered for a platform with no archive; a fish login shell yielding no PATH.
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
