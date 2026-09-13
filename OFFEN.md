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

1. **Popovers are see-through over content.** (shipped 0.75/0.76: opaque surfaces, overflow menu above the terminal)  ("what the hell is this?", images
   6 + 7) The overflow menu and the hover tooltip let the terminal text behind
   them bleed through, so nothing in them is readable. Cause found: the crt skin
   turns surfaces into glass (`--panel-glass` + a backdrop blur), and at his low
   solidity setting it double-mixed to ~18% opaque. Fine over the desktop, wrong
   over app content. Every floating surface — context menu, overflow menu,
   tooltip, account dropdown, palette, select, dialog — must be opaque, not glass.

2. **The terminal does not fill its height.** (shipped 0.75/0.77: every panel root fills its host)  ("why doesn't the terminal have
   full height?", image 4) A dead session panel leaves a large empty area below
   the terminal instead of the terminal reaching the bottom.

3. **The path is cut off.** (0.77: the whole path shows on hover; COPY PATH everywhere)  ("why is the path cut off?") The folder path in the
   session bar is truncated with no way to see or copy the full path.

4. **A stopped session cannot be resumed.** (shipped 0.76: RESTART in place, same id)  ("why can't I resume there?") It
   shows "[plxr] this session is not running" and offers no way to start it again
   — only, at best, to close it.

5. **Ctrl+C / the command ending does not leave a shell.** (shipped 0.76: the CLI runs inside the login shell)  ("when I end a session
   with Ctrl+C, why don't I just get a shell back?") When the CLI in a session
   exits, the session dies. A terminal replacement must drop back to a live shell
   in the same folder, the way a real terminal does.

6. **There is no real, visible menu.** (shipped 0.76: header MENU; 0.77: Settings window)  ("why is there no proper menu anywhere?")
   Only the hidden palette and the settings button exist. He wants a proper,
   visible menu with all the settings, reachable without knowing a shortcut.

7. **There is no context menu where he right-clicks.** (shipped 0.76/0.77: a menu on every object)  ("why is there no context
   menu anywhere?") The context menus I added are not reaching the places he
   actually right-clicks.

8. **The rail opens everything into the same panel.** (shipped 0.76: two lanes; 0.77: open in a new group, float)  ("why does everything in
   the left menu open in the same panel?") Every view from the left rail replaces
   the content of one panel instead of behaving like a real window manager.

9. **He has no status.** (shipped 0.76: live source control that follows the session; spend readout)  ("and here you are working, pushing to git all nicely,
   and I have zero status") While I work and push releases, the app gives him no
   overview of what is happening or what is tracked — above all no live view of
   the code changes / git diff, which is the whole point of a VS Code replacement.

10. **The process failed him.** ("what are you even doing?") I reported work as
    done from headless screenshots and green gates without ever looking at the
    real skinned window over a terminal, or the real session lifecycle. The rule
    from here: verify in the actually-rendered app, in the skin, over real
    content — a gate is only proof of what it looks for.

11. **Notifications wear the wrong app.** (shipped 0.77: the window posts with the icon; click opens the session)  (image 15) A plxr notification arrives with
    no icon, and clicking it opens Script Editor with a file dialog. Measured:
    notify_darwin.go has a native UserNotifications path (icon, click opens plxr) but
    it is sent by the background service, whose native call fails (no app run loop /
    no granted permission), so it falls back to osascript — and osascript
    notifications belong to Script Editor. Fix: post notifications from the window
    process (the real app, which can hold the permission and the run loop); the
    service uses the fallback only when no window is open.

12. **The Claude account management does not work properly for him.** (his words,
    translated: "if at least the AI account management worked") What exactly fails is
    not yet measured; measure it, make it actually work — it is the base the
    identities work in pillar 8 stands on.

## Pillar 8 — Comms & Identities (next cycle; ONLY after everything above is COMPLETELY done)

His words: a real, full integration — plxr becomes the client for Slack, Teams and
Outlook (mail + calendar), with an AI layer (triage, summaries, drafts in his voice,
action items, daily digest) and full identity management (Claude accounts fixed,
GitHub/gh accounts, git identity). No API key — the AI layer runs on his subscription
through Claude Code (`claude -p`), batched and on demand; HE picks which account it
runs on, plxr never distributes on its own. The full design is in
docs/superpowers/specs/2026-09-12-plxr-daily-driver-design.md, "Pillar 8".

## The real list — derived from what a finished daily driver needs, not from his examples

Produced 12.09.2026 by a read-only audit of the tree that shipped as 0.76.0: ten areas, each held to the bar of VS Code / GitLens / iTerm-Warp, every requirement checked against the code. His examples (1–56 in chat) are a subset and are marked where they map. **394 open items — 265 must / 107 should / 22 nice; 136 missing, 258 partial.**

Counts as the auditor put them: 395 open items after cross-area dedupe (from 530 audit findings; 27 done). must: 202 partial + 63 missing = 265 · should: 52 partial + 56 missing = 108 · nice: 5 partial + 17 missing = 22. Sizes: ~150 S, ~205 M, ~40 L. Owner's examples map onto 32 of the 395 items (marked ownerExample); the remaining 363 he never named.

**Verdict:** The tree is a working shell around the right architecture — daemon-owned PTYs, Dockview panels, CodeMirror with a live git gutter, a coalesced watcher, opaque-surface tokens, atomic prefs, a real Settings window — but it is roughly a quarter of "finished": 27 of 557 derived requirements are done, 265 must-items are open, and the gaps cluster at the structural layer (no command registry, no key dispatch, no focus layer, no close guards, no custom tabs, no real-window verification) rather than at the edges, which is exactly why fixing his examples one at a time never converges. Terminal and layout are the closest (most items are partial polish on working code); editor, files and status are half-built; source control, accounts/identities, notifications and first-run are viewers or absent. Two things are live-dangerous today (⌘R/⌘W through Wails' default menu; silent discard of unsaved edits) and one process gap makes every other claim unprovable (no WKWebView capture path). Realistic order: the ~15 structural musts first (registry, dispatch, focus, guards, tabs, native suppression, real-window gate), then terminal/editor musts, then git — that is months of work, not the "remaining audit findings" OFFEN.md describes.

**The ten most consequential gaps:**
1. C16: Wails default menu is live — ⌘R reloads the page over every terminal and ⌘W closes the window; native context menu on tabs/editor/dialogs.
2. E03/T07: no close guard anywhere — dirty editors and running sessions are discarded on tab ×, ⌘W, preset, reset, quit.
3. C07+C10+C24: no command registry, no dispatch layer, no focus management — the structural reason every fix stays an example.
4. T02+ST03: Ctrl+C on a CLI without a SIGINT trap still kills the session, and a dropped-to shell still reads 'Claude waiting'.
5. ST20: notifications still posted by the daemon via osascript → no icon, click opens Script Editor, no permission state, no DND.
6. T11: ctrlKey mapped to Mod steals Ctrl+K/F/N/1-8 from readline/TUIs; ⌘F fires once per open session.
7. T09: a viewer that falls behind gets the whole 2 MB ring appended — duplicated terminal output.
8. G06–G28: no hunk staging, discard, stash, push/pull/fetch, merge/rebase, conflicts, blame, log actions — git is a viewer.
9. T23+E02+F33: no clickable file:line links, no ⌘P quick open, no recent files — navigation is a tree crawl.
10. P20+P01: nothing verified in the real WKWebView window; docs/verify does not exist, so every 'partial' is unproven on screen.

### terminal (47 open · already there: 4 done (restart-in-place, orphan return, mouse reporting, freeze/resume))

| id | requirement | status | gap | weight | size | his example |
|---|---|---|---|---|---|---|
| T01 | Login-shell env parity (LC_*, PATH order, fish) | partial | LC_ALL unset, fish untested, PATH is a merged union | must | M | chat: fish PATH |
| T02 | Ctrl+C on CLI drops to shell | partial | SIGINT to pgrp kills wrapper; only SIGTERM tested | must | M | #5 no shell after Ctrl+C |
| T03 | Ended state: last lines, time, CLOSE, RESTART everywhere, persists | partial | xterm unmounted, no ended time, purged after 90 s loses RESTART, rail has none | must | M | #4 cannot resume; chat: RESTART lost after 90 s |
| T04 | New shell here (rail, menu, shortcut, focused cwd) | partial | Only the dialog; never seeds focused session cwd | must | M |  |
| T05 | New-session dialog: recents, missing CLI disabled, unattended flag | partial | No recents, no LookPath, no skip-permissions toggle | must | M |  |
| T06 | Terminate escalates TERM/HUP/KILL, no orphans, panel shows ended | partial | No SIGHUP, setsid children escape, TERMINATE closes panel | must | M |  |
| T07 | Closing panel/window with running process asks keep/terminate | missing | No prompt on ⌘W, tab close, window close | must | M |  |
| T08 | Reconnect as panel state, buffered keys, wake listener, WebGL re-create | partial | Text line in scrollback, keys dropped, no visibility/wake hook, WebGL never rebuilt | must | M |  |
| T09 | Slow viewer resync without duplication | partial | 2 MB ring appended as plain chunk after fall-behind | must | M |  |
| T11 | App chords never steal terminal keys; Option-as-Meta | partial | ctrlKey=Mod steals Ctrl+K/F/N/1-8, F12 stolen, ⌘F fires per mounted session, Esc closes settings | must | S |  |
| T12 | Terminal fits pane exactly in every skin (measured) | partial | No last-row gate; sketch/pixel borders unaccounted | must | M |  |
| T13 | Resize throttled, no fit while hidden, send only on change | partial | SIGWINCH per ResizeObserver tick | must | S |  |
| T14 | Scrollback restore from recording; clear-screen/reset commands | partial | Restore from byte ring; one Clear only, not in palette | must | M |  |
| T15 | Terminal find: incremental, regex/case/word, n of m, highlight, focus return | partial | Enter-only search, no toggles/count/decorations | must | M |  |
| T16 | Selection options (word separators, option-click) | partial | xterm defaults only, unverified in WKWebView | must | S |  |
| T17 | Clipboard: copy-on-select, HTML copy, paste fallback/confirm/chunking, verified in WKWebView | partial | No native fallback, no multi-line confirm, Blink-only proof (editor too) | must | M |  |
| T18 | Terminal context menu: split, rename, copy path, restart, close | partial | Five entries only | must | S |  |
| T19 | Unicode-11 widths, Nerd/powerline fallback fonts | partial | No unicode11 addon, no fallback family | must | S |  |
| T20 | Emulation verified (vttest-style, real TUI) | partial | No verification exists | must | M |  |
| T23 | ⌘-click URLs and file:line:col → editor | missing | No link provider at all | must | M |  |
| T26 | Font weight, line height, letter spacing settings | partial | Family/size only, lineHeight hard-coded | must | S |  |
| T29 | Per-skin 16-colour ANSI palette, bold-as-bright, min contrast | partial | Skins set bg/fg only; xterm VGA defaults everywhere | must | M |  |
| T30 | Cursor inactive style, contrast per skin | partial | cursorInactiveStyle unset, no contrast gate | must | S |  |
| T31 | Backpressure to PTY, latency/stall measurement | partial | Drops + full resend; nothing measured | must | M |  |
| T32 | Hidden tabs stop rendering; bounded memory; soak test | partial | Every tabbed-away xterm renders and streams; no measurement | must | M |  |
| T34 | Player: play/pause, time scrub, speed, marks, search | partial | Byte-offset slider and ⏮ only | must | L |  |
| T36 | Status on dock tab/session bar/dock badge; stale eviction | partial | Rail/tile only; no eviction on host exit | must | M |  |
| T37 | Inbox option buttons; clickable earlier answers; handled mark | partial | Free-text only, suggestions are plain text | must | M |  |
| T38 | Queue edit/reorder, pending count on tile/rail/tab, survives end | partial | Add/drop only; cleared on session end; count nowhere | must | M |  |
| T39 | Hazard mark on the session panel itself | partial | Tile/rail only | must | S |  |
| T40 | Live cwd (OSC 7/process) shown full with tooltip + copy; followers use it | partial | cwd static, cut to 34 chars, no tooltip/click | must | M | #3 path cut off |
| T42 | Spawn failures actionable in panel (missing CLI, cwd gone, PTY, recording dir) | partial | No fix actions; missing binary unexplained; recording failure silent | must | M |  |
| T43 | Live age / idle-for on tile, rail, inbox, ended | missing | `since` never rendered | must | S |  |
| T44 | Settings › Terminal exposes every option | partial | Missing bell, Option-Meta, copy-on-select, paste warn, ligatures, renderer, shell/args, env, min contrast, confirm-on-close | must | M |  |
| T10 | Smallest-viewer sizing shown in pane | partial | No 'sized by another viewer' hint | should | S |  |
| T21 | OSC 8 links, OSC 0/2 title, OSC 52 opt-in | missing | Nothing wired | should | M |  |
| T22 | Shell integration OSC 133 (prompt jump, exit badge, last output) | missing | Nothing exists | should | L |  |
| T24 | BEL → flash/sound + tab badge | missing | No onBell | should | S |  |
| T25 | Unread/activity indicator on tab, rail, tile | missing | No unread tracking | should | M |  |
| T27 | Ligatures with toggle | missing | No addon, no setting | should | S |  |
| T28 | Per-pane zoom ⌘+/−/0 | missing | Global slider only | should | M |  |
| T33 | Prompt ≤1 s after START | partial | AdoptLoginPath up to 20 s, `-l` shell cost per session | should | M |  |
| T35 | Recording cap surfaced; recordings archive with size/delete/export | missing | Cap only logged; no list | should | M |  |
| T41 | Titles from OSC/process; inline rename persisted; tab follows | partial | Folder name only, no rename, tab title frozen | should | M |  |
| T45 | Screen-reader mode, high contrast, labelled terminal actions | missing | One aria-label; no toggle | should | S |  |
| T46 | Copy whole scrollback / save text | missing | No serialize | nice | S |  |
| T47 | Inline images (iTerm2/Sixel) | missing | No addon | nice | S |  |

### editor (46 open · already there: 2 done (bracket matching, prefs sync))

| id | requirement | status | gap | weight | size | his example |
|---|---|---|---|---|---|---|
| E01 | One editor per resolved absolute file across session/workspace roots | missing | Id is rootId:path; relative vs absolute spellings double-buffer | must | S | chat: duplicate editor identity |
| E02 | Quick open ⌘P (fuzzy files, :NN, recency, lazy index, 100k files) | missing | No file index, no ⌘P, palette lists commands only | must | M |  |
| E03 | Dirty close guard on every route (tab ×, ⌘W, group, rebuild, preset, quit, reload) | missing | Only 'open another file' asks; all others discard silently | must | M | chat: unsaved-close regression |
| E04 | Restore cursor/scroll; gone-file state with CLOSE | partial | Nothing persisted; gone file renders empty editable body | must | M |  |
| E05 | Save: clean no-op, tmp never orphaned, fsync | partial | Clean ⌘S writes; tmp left on WriteFile error; no fsync | must | S | chat: .plxr-tmp |
| E06 | 409 conflict offers Compare/Reload/Overwrite | partial | Sentence in bar, no actions | must | M |  |
| E07 | Save errors translated, Save As ⌘⇧S via plxr picker | partial | Raw OS strings truncated; no Save As | must | M |  |
| E11 | Changed-on-disk: detection independent of Changes panel, diff option, deleted-on-disk state, cursor/folds kept | partial | Signal only while Changes panel subscribed; whole-doc replace; deletion swallowed | must | M |  |
| E12 | Rename/move retargets open editor (title, id, save path) | missing | Editor becomes dead buffer under old name | must | M |  |
| E13 | Undo history survives Dockview move/popout | partial | Unproven; remount destroys view | must | S |  |
| E14 | Multi-cursor (⌥-click, ⌘D, ⌘⇧L, column select) | missing | allowMultipleSelections not enabled | must | S |  |
| E15 | Line ops with VS Code keys, listed in keybindings | partial | Join/shrink/⌘L absent; none listed | must | S |  |
| E16 | ⌘/ and ⌥⇧A comments, fallback syntax for undetected files | partial | Block key differs; no fallback | must | S |  |
| E17 | Auto-close brackets/quotes, surround, toggles | partial | closeBrackets unused; no settings | must | S |  |
| E18 | Tabs vs spaces, indent size detection, switchable | partial | tabSize only; no detection/insertSpaces | must | M |  |
| E19 | CRLF/LF detected and preserved; mixed reported | missing | CRLF silently normalised on save | must | M |  |
| E23 | Edit files ≥8 MB with degradation; stated hard cap | missing | 512 KiB read-only cap; silent gutter cutoff | must | M |  |
| E26 | Go-to-line ⌃G/⌘L on --surface popover | partial | CM raw panel on ⌥G, untranslated | must | S |  |
| E27 | Find/replace panel: skinned, i18n, n of m, ⌥⌘F, count, no double-fire with terminal find | partial | CM native controls, English literals, no count, ⌘F opens both finds | must | M |  |
| E28 | Search hit opens at column with match selected | partial | Line only, nothing selected | must | S |  |
| E30 | Status row: line:col, selection, indent, EOL, encoding, language (clickable) | missing | No status row | must | M |  |
| E31 | Header shows full path with tooltip, copy rel/abs, reveal | missing | Basename only | must | S |  |
| E32 | Same-basename tabs disambiguated; title follows rename; sessions get short id | missing | Gate enshrines two identical 'same.txt' tabs | must | S |  |
| E34 | Editor fills group at all sizes (measured) | partial | No gate; unverified in WKWebView | must | S |  |
| E37 | Git gutter: hunk popover, revert/stage, next/prev, editor→diff; non-repo shows no marks | partial | Marks inert; file outside git shows every line added | must | M |  |
| E39 | Language by shebang/dotfile; manual override | partial | Extension match only | must | S |  |
| E40 | ≥5 distinct syntax classes per skin | partial | Effectively three colours | must | S |  |
| E42 | Typed plugin contract (save cancel, diagnostics/completion/hover slots) proven by stub test | partial | Three empty compartments, unused save hook, no test | must | M |  |
| E44 | Read errors translated with retry; EISDIR opens tree | partial | Raw OS strings, no retry, empty editable body | must | S |  |
| E08 | ⌘N untitled buffer | missing | No concept | should | M |  |
| E09 | Save All ⌥⌘S with per-file report | missing | Absent | should | S |  |
| E10 | Revert file / compare with saved | missing | Absent | should | S |  |
| E20 | BOM preserved; non-UTF-8 read-only with reopen-with-encoding | missing | Latin-1 declared binary; no readout | should | M |  |
| E21 | Trim whitespace / final newline on save (off by default) | missing | Save hook dead code | should | S |  |
| E22 | Render whitespace, indent guides | missing | Absent | should | S |  |
| E24 | Image preview; binary shows type/size/reveal/open-with | partial | 'not text' dead end | should | M |  |
| E25 | Long-line guard; per-file wrap toggle | partial | Global wrap only; unmeasured | should | S |  |
| E29 | Folds preserved across reload/restore | partial | Lost on every reload | should | S |  |
| E33 | Split editor ⌘\ sharing doc/history | missing | Absent | should | M |  |
| E35 | Editor keymap listed/rebindable; vim option | partial | Keybindings tab ignores editor; no vim | should | M |  |
| E36 | Relative line numbers, click/⇧-click selects lines | partial | Absent | should | S |  |
| E41 | Editor font/size separate from terminal; ⌘=/⌘- zoom | partial | Borrows --term-font; no zoom | should | S |  |
| E43 | Word completion ⌃Space | missing | autocomplete installed, unused | should | S |  |
| E45 | Offline: ⌘S queued with visible state | missing | Single fetch | should | M |  |
| E46 | Performance budgets measured (open/keystroke/tab switch), 20k-line notice | partial | Nothing timed; silent gutter skip | should | M |  |
| E38 | Minimap / scrollbar markers decision | missing | Undecided | nice | S |  |

### git (48 open · already there: 6 done (follows focus, rename unstage, subfolder commit scope, diff ids, external change reflection, coalesced watcher core))

| id | requirement | status | gap | weight | size | his example |
|---|---|---|---|---|---|---|
| G01 | Merge-conflict group; collapsible groups with badges | partial | UU file listed twice; no collapse | must | M |  |
| G02 | One watcher per resolved repo; no side pollers; quiet at idle | partial | Files.tsx 4 s poll per tree, Folders self-fetch, per-folder loops, never idles while panel open | must | M | chat: flaky git-quiet claim |
| G03 | Row: dir dimmed/basename, status letter, rename old→new, abs tooltip | partial | Word instead of letter; rename loses new path | must | S |  |
| G04 | Stage/unstage via context menu, keyboard, optimistic | partial | Row buttons only, busy-locked | must | S |  |
| G05 | Stage/unstage all (repo); multi-select rows | partial | Per-group only, no selection model | must | S |  |
| G06 | Hunk-level stage/unstage/revert | missing | Absent | must | L | chat: hunk staging |
| G07 | Discard/restore with named confirmation | missing | Absent | must | M |  |
| G08 | Three diff modes, switchable in header | partial | No working-vs-HEAD; mode fixed in id | must | S |  |
| G09 | Side-by-side/inline, syntax + word-level highlight | partial | Inline plain text only | must | L |  |
| G10 | Diff edge cases: binary sizes, submodule, symlink, size limit, whitespace toggle | partial | None handled specially | must | M |  |
| G11 | Arrow-key row navigation updating diff; scroll kept | partial | No key handler | must | S |  |
| G12 | Tree decorations: ancestors inherit, renamed/ignored states, same tick | partial | No propagation, own poll | must | M |  |
| G13 | .gitignore awareness in tree/search, 'Add to .gitignore' | partial | Hard-coded noise list; no check-ignore | must | M |  |
| G14 | Commit box: multi-line, ruler, ⌘Enter, stage-all-and-commit | partial | Single-line Input hidden when nothing staged | must | M |  |
| G15 | Commit failures with copyable stderr, live hook output | partial | Hook stderr dropped; no copy | must | S |  |
| G16 | Amend with prefilled message, pushed check | missing | Backend flag only | must | S |  |
| G18 | Blame (inline + gutter, ignore-revs) | missing | Absent | must | L |  |
| G19 | Log panel: paged, search, refs, graph, author | partial | Fixed 8 rows inside Changes | must | L |  |
| G20 | Commit actions: files, diff, copy hash, checkout, cherry-pick, revert, reset | missing | Rows inert | must | L |  |
| G22 | Branch indicator: no-upstream state, clickable, in status row | partial | Not clickable, no strip item | must | S |  |
| G23 | Branch picker: remotes, fuzzy, create-from-ref, rename, track, live, reachable from Changes/palette | partial | Local only, manual refresh, Folders tab only | must | L |  |
| G24 | Dirty checkout: show paths, offer stash-and-switch | partial | Fixed sentence, no stash | must | M |  |
| G25 | Merge/rebase with abort/continue incl. terminal-started | missing | Absent | must | L |  |
| G26 | Conflict tooling: ours/theirs/both, three-way, auto-resolve mark | missing | Absent | must | L |  |
| G27 | Stash create/list/apply/pop/drop/show, partial | missing | Absent | must | M |  |
| G28 | Fetch/pull/push/set-upstream/force-with-lease with progress+cancel | missing | Absent; ahead/behind goes stale | must | L |  |
| G30 | Auth prompts (passphrase/2FA) surfaced; git identity shown | missing | git runs without stdin — prompts hang to timeout | must | L |  |
| G33 | Worktrees listed; branch-elsewhere marked | partial | Only git's refusal mapped | must | M |  |
| G34 | Multi-repo picker; 'Initialize repository' | partial | Neither exists | must | M |  |
| G35 | Symlink entry rendered as link change | partial | Plain typechange word | must | S |  |
| G36 | Large repos: progressive render, virtualised rows, cancel, grandchild kill | partial | Opens every untracked file per tick; unvirtualised | must | M |  |
| G37 | Idle backoff when window unfocused; refresh on focus | partial | No visibility handling | must | S |  |
| G38 | Every git action a palette/menu command with VS Code keys | partial | Only 'open panel' | must | M |  |
| G39 | Keyboard navigation in Changes panel | missing | Absent | must | M |  |
| G40 | Progress+cancel, per-repo serialisation, index.lock explained | partial | Busy flag only | must | M |  |
| G41 | Distinct states: unborn, bare, git missing, permission, corrupt — with action | partial | Collapse into raw err.git.failed | must | M |  |
| G47 | No truncation without tooltip/copy; hook stderr kept | partial | logsubject ellipsised without tooltip | must | S |  |
| G48 | Changes/diff/gutter/log dressed per skin, narrow-width rows | partial | skin-base only; no narrow rule; no real-window proof | must | M |  |
| G17 | Message history, conventional-commit completion, trailers, template | missing | Absent | should | M |  |
| G21 | Per-file history following renames | missing | Absent | should | M |  |
| G29 | Auto-fetch with backoff and last-fetch time | missing | Absent | should | S |  |
| G31 | Tags list/create/delete/push; log decorations | missing | Absent | should | M |  |
| G32 | Submodules as one entry with sub-state | missing | Plain M row | should | M |  |
| G42 | Changes panel state survives relayout (message, collapsed, diff mode) | partial | Component state only | should | S |  |
| G43 | Branch-wide review against base | missing | Absent | should | L |  |
| G44 | Compare any two refs | missing | Absent | nice | M |  |
| G45 | Copy hash/rel path/hunk/permalink | partial | Tree COPY PATH only | nice | S |  |
| G46 | Line history, file at revision | missing | Absent | nice | M |  |

### files (41 open · already there: 1 done (path containment))

| id | requirement | status | gap | weight | size | his example |
|---|---|---|---|---|---|---|
| F01 | Tree panel: expansion/hidden/filter persisted, restore guard, in presets, one implementation | partial | State lost on relaunch; errors after service restart; two tree impls | must | M |  |
| F02 | Tree follows focused session or pins; root tooltip + copy | partial | Always pinned; root truncated without tooltip | must | M |  |
| F03 | Loading row; unreadable folder error inline | partial | Top banner, no loading state | must | S |  |
| F04 | Empty states: no root, empty folder, root gone + Reload | partial | Nothing rendered for empty dir | must | S |  |
| F06 | Natural-order sort | partial | Lexical | must | S |  |
| F07 | Home/End/PageUp/Down, type-ahead, Space preview | partial | Arrows/Enter only | must | S |  |
| F08 | Explorer keys F2/Delete/⌘C/V/D/N, rebindable | missing | None exist | must | M |  |
| F11 | Inline create at depth, collision keeps input | partial | Modal dialog; name lost on collision | must | M |  |
| F12 | Inline rename with basename selected, case-only rename, illegal names refused | partial | Modal; case-only refused; no validation | must | M |  |
| F13 | Delete to Trash with count, permanent alternative | partial | RemoveAll only | must | M |  |
| F14 | Drag-and-drop move/copy with highlights and overwrite/skip | partial | No DnD; collision is flat refusal | must | M |  |
| F16 | Copy relative path; clipboard refusal visible | partial | Absolute only; failure swallowed | must | S |  |
| F19 | Reveal active file; auto-reveal option | missing | Tree unaware of editors | must | S |  |
| F20 | Tree relists on external change, keeps state; two windows converge | missing | Only git marks refresh; agent-created files invisible | must | M |  |
| F21 | Filter prunes folders, hit count, Esc, bounded I/O | partial | Lists whole tree per keystroke | must | M |  |
| F22 | Virtualised rows, 'showing first N' cap | missing | All rows in DOM | must | M |  |
| F23 | Op failure inline at row, tree rolled back | partial | Banner; no relist | must | S |  |
| F24 | ⇧⌘F focuses search prefilled from selection; results persist | partial | Mod+8, no focus/prefill, remount wipes results | must | M |  |
| F25 | Search toggles persisted with keys; regex error translated | partial | useState only | must | S |  |
| F26 | Include/exclude globs (**, commas, negation), ignored toggle, scope shown | partial | One basename glob | must | M |  |
| F27 | Per-file counts, collapse, dismiss | partial | Absent | must | S |  |
| F28 | Streaming, cancellable search with progress | partial | One synchronous 5 s call | must | M |  |
| F31 | Replace in files with preview, $1, mtime guard, undo | missing | Absent | must | L |  |
| F33 | Recent files MRU (quick open, MENU › Open Recent) | missing | Absent | must | M |  |
| F35 | Multi-root tree; search spans roots; session+workspace on same folder share ids | partial | One panel per id | must | L |  |
| F36 | Open/unsaved marker on tree rows | partial | None | must | S |  |
| F37 | Selection/badges/focus styled in all four skins | partial | skin-base only; literal scrim colour | must | S |  |
| F05 | Symlinks marked; broken links shown | partial | No link flag | should | S |  |
| F09 | Single-click preview tab, double-click pins | missing | Every click opens a permanent panel | should | M |  |
| F10 | Multi-selection with bulk actions (tree, rail, changes, search) | missing | Single selection everywhere | should | M |  |
| F15 | Duplicate 'name copy.ext' | missing | Absent | should | S |  |
| F17 | Open in default app / new session here / reveal in palette | partial | Reveal only | should | S |  |
| F18 | Drag file → terminal quoted path / → editor / from Finder | missing | No drag handlers | should | M |  |
| F29 | Scope: folder from tree, subfolder, open files | partial | Whole root only | should | M |  |
| F30 | Search history with recall | missing | Absent | should | S |  |
| F32 | '@' symbols via provider registry | missing | No slot | should | M | chat: LSP |
| F34 | Recent folders in path field and MENU | partial | Workspaces double as list | should | S |  |
| F38 | ARIA tree semantics, focusable rows | partial | Div soup | should | M |  |
| F40 | Settings › Files (tree/search prefs) | missing | Absent | should | S |  |
| F39 | Breadcrumbs above editor | missing | Absent | nice | S |  |
| F41 | Windows/Linux path parity | partial | Untested; drive-letter case | nice | S | chat: Windows git-mark keying |

### layout (40 open · already there: 5 done (role lanes, openOrFocus, terminal fills group, restart keeps panel, no auto-open steals focus))

| id | requirement | status | gap | weight | size | his example |
|---|---|---|---|---|---|---|
| L01 | Rules/Marks/Player/Queue as panels; Notes panel; drop in-session Files/SPLIT | partial | Overlays cover terminal; no notes panel | must | L | chat: notes scratchpad (OFFEN C) |
| L02 | Recreated aside lane at rem default width | partial | Half of reference group | must | S |  |
| L03 | Companions open beside source (diff in Changes group) | partial | Third desk lane instead | must | S |  |
| L04 | Active panel visibly distinct in every skin | partial | Text colour only; no per-skin rules | must | S |  |
| L05 | Tab strip overflow/active skinned, width tokens | partial | Unstyled dropdown | must | S |  |
| L06 | Split right/down commands (palette, menu, tab menu) | partial | Drag only; SPLIT is nested terminal | must | S |  |
| L07 | Drop preview matches result (verified) | partial | Unverified, translucent overlay | must | S |  |
| L08 | Minimum sizes per panel kind | missing | None passed | must | S |  |
| L10 | Maximise/restore via dblclick, key, menu | missing | Nothing calls maximizeGroup | must | S |  |
| L13 | Close via ⌘W/middle-click/menu; empty groups removed | partial | No ⌘W action; middle-click unverified | must | S |  |
| L16 | Layout restored before first paint | partial | Dock blank until prefs arrive | must | S |  |
| L17 | connected = first snapshot; loading placeholders for editor/files/diff | partial | Restored panels flash 'not running' | must | S |  |
| L18 | Uniform dead-target state (Restart/Choose folder/Close) | partial | Inconsistent per panel kind | must | M |  |
| L19 | Version-guarded layout JSON with backup + notice | partial | Bare try/catch | must | S |  |
| L20 | Per-window layout key; second window from preset | missing | One `dock` key overwritten by every window | must | M |  |
| L21 | Presets with role slots, default-for-activity | partial | Raw toJSON with session ids/px | must | M |  |
| L23 | Refit every xterm/CodeMirror after preset/reset | partial | RO-only | must | S |  |
| L24 | Dock chrome tokens in rem; re-assert on type-size change; Window px only x/y | partial | Rail px not re-asserted; sizes stored px | must | S |  |
| L26 | Dock chrome per skin; opaque drop overlay above .fx; CM tooltips themed | partial | skin-base only; 22% overlay under scanlines | must | M |  |
| L27 | Custom tab: tooltip, dirty dot, status dot, context menu, middle-click, keyboard reorder, pin | missing | Default dockview tab; browser menu on right-click | must | M |  |
| L28 | Transactional addPanel with reported errors | partial | Unwrapped, no notice | must | S |  |
| L29 | Watermark empty state (new terminal/open folder/preset) | missing | Blank dock | must | S |  |
| L31 | Esc cancels drag | partial | No handling | must | S |  |
| L34 | Settings window geometry persisted, resize all edges | partial | In-memory Map only | must | S |  |
| L35 | MENU › Layout submenu with all panel verbs | partial | Separate LAYOUTS button, reset only | must | S |  |
| L37 | Background-open API with badge | partial | Absent (vacuous) | must | S |  |
| L09 | Splitter rem size, hover state per skin, dblclick reset | partial | Defaults | should | S |  |
| L11 | Float/dock commands; floating frame on --surface per skin | partial | Shift-drag only, glass titlebar | should | S |  |
| L12 | Pop out to OS window with skin/rem/session; remembers geometry | missing | No multi-window plumbing | should | L | chat: pop-out panels |
| L14 | Context menu on empty dock/splitters | missing | Absent | should | S |  |
| L22 | Built-in terminal presets with shell placeholder, documented | partial | No preset contains a terminal | should | M |  |
| L25 | Rail min width, non-closable, collapsible; decide rail vs one dock | partial | Draggable to zero, closable; decision open | should | S | chat: rail-goes-away decision |
| L30 | Click/modifier-click placement grammar | missing | Absent | should | M |  |
| L32 | Narrow-window aside fallback | missing | Absent | should | M |  |
| L33 | Main window geometry persisted; DPR change refit | missing | Fixed 1440×900 | should | S |  |
| L36 | Per-panel view state saved (scroll, filter, cursor) | partial | Params frozen at creation | should | M |  |
| L40 | 20+ panel jank gate; throttled fits | partial | No gate | should | S |  |
| L15 | Pinned panels | missing | Absent | nice | S |  |
| L38 | Reopen closed panel ⌘⇧T / undo layout | missing | Absent | nice | S |  |
| L39 | Keyboard-operable dock (tab roles, sash keys) | partial | Default divs | nice | M |  |

### commands (43 open · already there: 0 done)

| id | requirement | status | gap | weight | size | his example |
|---|---|---|---|---|---|---|
| C01 | MENU lists every command grouped (session, terminal, editor, git, search, window, layout, recovery) | partial | 14 shell rows; Find is menu-less | must | M | #6 no visible menu; chat: all settings |
| C02 | Keybinding hints on every row; parity gate menu↔keymap | partial | Palette views/new session lack hints; literals in terminal menu | must | S |  |
| C03 | Inapplicable items disabled with reason tooltip | partial | Hidden instead; no reasons | must | S |  |
| C04 | Toggle state in palette rows | partial | No on/off | must | S |  |
| C05 | ARIA menu keyboard navigation, focus return to invoker | missing | Escape only | must | M |  |
| C06 | Menus re-clamp/flip on resize; palette closes on blur | partial | Stale position; shift never flips | must | S |  |
| C07 | Single command registry driving menu/palette/context/keys/tooltips | missing | Five hand-maintained lists | must | L |  |
| C08 | Palette: ⇧⌘P, MRU/recents, aliases, highlighted matches, PgUp/Dn, no 50-row cap, categories | partial | Substring, ⌘K only, silent cap | must | M |  |
| C09 | Prefix modes > : @ # | missing | Single command list | must | M |  |
| C10 | One keybinding dispatch layer with priority and reserved chords | missing | Ten scattered listeners; every Escape fires all | must | M |  |
| C12 | Keybindings tab: all commands, search, when/source, multi-stroke, ⌃ separate from ⌘, export/import, orphans shown | partial | 15 rows, no search/when, ctrl folded into Mod | must | M |  |
| C13 | Conflict dialog keep/replace/cancel before save | partial | Silently unbinds the other row | must | S |  |
| C16 | Suppress native WebView: explicit Wails menu (no ⌘R/⌘W/⌘Q roles), global contextmenu, beforeunload, drop-nav, title= gate, ⌘M/full-screen | missing | ⌘R reloads over terminals, ⌘W closes window, browser menu on tabs/editor/dialogs | must | M |  |
| C17 | plxr context menu on every object (tabs, editor body, changes rows, search hits, usage, status row, inbox, dock background, dialogs) | partial | 6 of ~15 surfaces; existing menus thin | must | L | #7 context menus everywhere |
| C18 | Open context menu via ⇧F10/Menu key, first item focused | partial | Right-click only | must | S |  |
| C19 | Right-click selects target first | partial | Tree keeps old highlight | must | S |  |
| C20 | All destructive actions via Ask (terminate, reset layout, ports kill, forget, theme delete, RESET ALL keys, remove folder); Ask = real modal, Cancel default, focus trap/restore | partial | Six paths bypass; danger button is primary; no trap | must | M |  |
| C21 | One shared popover primitive: exclusive surface, top-most Esc, outside click not passed through, focus return | partial | Five hand-rolled listeners; menu over palette; click passes through | must | M |  |
| C23 | Core shortcut set (⌘T/W/⇧T/⇧S/O/⇧F/G/B/J/\/⌃Tab/⌥⌘arrows/⌘`/zoom/⌘K Z, next/prev session, focus pane dirs, split, close, maximise, group N) | partial | ~5 of ~30 exist; ⌘1-8 hijacked by views | must | L |  |
| C24 | Focus management layer: activation focuses xterm/CodeMirror, focus returns after menu/palette/dialog/find/settings, never lost to body, focus commands, ring + SR announce | missing | No term.focus() anywhere; every close drops focus | must | L |  |
| C25 | :focus-visible on bare rows (rail, menu, palette, tab, changes, search) in all skins | partial | Buttons only; skins have none of their own | must | S |  |
| C26 | ARIA roles/names: icon buttons, palette combobox, tree, dialogs, tabs, status | partial | ~10 unnamed buttons, no dialog/tree roles | must | M |  |
| C28 | prefers-reduced-motion everywhere + Settings override | partial | crtbreath, transitions, cursor blink ignore it | must | S |  |
| C30 | Tooltip aria-describedby, keybinding suffix, portalled surfaces gated | partial | No aria link; keys omitted | must | S |  |
| C31 | Settings window: focus on open, arrow-key tabs, trap, restore, last tab remembered, ⌘, closes from inputs | partial | None of it | must | M |  |
| C33 | View titles i18n in tabs/palette | partial | VIEW_TITLES English-only | must | S |  |
| C35 | Focused-session commands (restart/pause/kill/find) via lastActiveSessionId | partial | None; ⌘F per mounted session | must | S |  |
| C42 | Chords on event.code; ⌥ chords usable; layout labels | partial | event.key only; ⌥K unbindable | must | S |  |
| C11 | In-app toast for command failures | partial | ~15 calls `.catch(() => undefined)`; no toast surface | should | M |  |
| C14 | Keymap validation with warning (grammar, duplicates) | partial | Silent drops | should | S |  |
| C15 | Multi-stroke chords with pending feedback | missing | Absent | should | M |  |
| C22 | Overflow ⋯ on every toolbar; reflow while open; ARIA/arrow keys; hints | partial | Session bar only; closes on resize | should | M |  |
| C27 | Live-region announcements | missing | Absent | should | S |  |
| C29 | WCAG AA contrast measured per skin (focus, disabled, placeholder, ANSI) | missing | No measurement; crt placeholder ≈2.9:1 | should | M |  |
| C32 | window.plxr.commands seam, JSON-dumpable registry | missing | Absent | should | S |  |
| C36 | Window-management commands (new/next window, move panel) | partial | None; SingleInstance | should | S |  |
| C37 | Recovery commands with confirm (reset keys, reload, logs, diagnostics) | partial | Half missing, no confirms | should | S |  |
| C39 | Busy/re-entrancy on every mutating button | partial | pause/kill/ports/inbox/forget fire-and-forget | should | S |  |
| C40 | Menu variants per skin; danger from palette token | partial | --warn undefined → #e66 literal | should | S |  |
| C41 | Pointer edge cases (right-click during modal/drag, editor body) | partial | Native menu leaks | should | S |  |
| C43 | Registry gate: every command in MENU+palette, no conflicts, aria-labels, contextmenu preventDefault | missing | Hand-written row list | should | S |  |
| C34 | Shortcuts reference grouped by area, complete | partial | Flat 15-row list | nice | S |  |
| C38 | About dialog, release notes, what's new once per version | partial | Help has 'Keyboard' only | nice | S |  |

### settings (38 open · already there: 2 done (single entry points, skin CSS carries no sizes))

| id | requirement | status | gap | weight | size | his example |
|---|---|---|---|---|---|---|
| S01 | Per-skin --surface/--shadow | partial | Global fallback only | must | S |  |
| S02 | Every knob in Settings (updates, spend ceiling, shell, remote, notify in prefs) | partial | Scattered or absent | must | M | chat: all settings (OFFEN A) |
| S03 | Settings search across tabs | missing | Absent | must | M |  |
| S04 | Language/backdrop apply live without reload | partial | location.reload() | must | M |  |
| S05 | Default readout, modified marker, per-setting/tab/all reset with confirm | partial | Keys/colours only | must | M |  |
| S06 | Per-machine vs synced classification | missing | Flat blob | must | M |  |
| S07 | Export/import settings with diff, scope, atomic apply, unknown keys preserved | missing | Theme import only | must | M |  |
| S08 | Schema version, migrations, corrupt-file notice + restore (prefs, accounts, layout) | partial | Renamed .broken silently, no version | must | M |  |
| S09 | Inline validation with range; invalid never persisted | partial | Silent clamps (-5 → 10000) | must | S |  |
| S10 | No native controls (number input spinner, file chooser skinned) | partial | Agents number input | must | S |  |
| S11 | Skin class gate checks token-backing and state variants | partial | Presence only | must | S |  |
| S12 | Chosen skin applied before first paint in every window | partial | crt-green first frame | must | S |  |
| S16 | Fonts: system enumeration, preview, ligatures, editor font, weight/lh, per-machine | partial | Three options, no preview | must | M |  |
| S17 | Failed font load warns and reverts | partial | Rejection swallowed | must | S |  |
| S19 | Editor tab: spaces, line numbers, gutters, brackets, auto-close, format, trim, newline, rulers, cursor, vim | partial | Three knobs | must | M |  |
| S20 | Layouts tab: set default, reorder, rename/delete any row, version message | partial | Incompatible presets vanish silently | must | S |  |
| S21 | Preset apply keeps dirty editors/sessions with fallback group + notice | partial | Dropped without prompt | must | S |  |
| S22 | Notification settings: ceiling/git/build/update/reconnect events, per-event channel, quiet hours, real test notification | partial | Four events, sound test only | must | M |  |
| S23 | Agents tab: defaults (model, flags, cwd policy, auto-approve, timeout, retention) + command preview | partial | Recognition profiles only | must | M |  |
| S24 | Updates tab: build/commit/channel, check-now, auto-check, last check, changelog, copyable | partial | Version line in footer only | must | M |  |
| S27 | Open Settings re-renders on prefs from other window; no whole-blob clobber | partial | State copied once at mount | must | S |  |
| S28 | Service unreachable: read-only banner, retry; no silent write loss | missing | All pref writes `.catch(() => undefined)` | must | M |  |
| S32 | Full state-variant token set per skin (focus, selection, disabled, danger, invalid, drag-over) + control-sheet gate | partial | Tokens missing; no visual diff | must | M |  |
| S13 | Light/dark declaration, Auto follows macOS | missing | Absent | should | M |  |
| S14 | Per-token picker with contrast readout and reset | partial | Hex fields only | should | M |  |
| S15 | Save/duplicate/rename/export user skins; delete confirmed | partial | Import/delete only | should | M |  |
| S18 | Remove imported fonts, in-use prompt, magic-byte check | partial | No button | should | S |  |
| S25 | Appearance: zoom keys, density, animation toggle, rail position, status items, tooltip delay, confirm-quit | partial | Two sliders | should | M |  |
| S26 | Description under every setting | partial | Coverage incomplete | should | S |  |
| S30 | Per-project .plxr/settings override | missing | Absent | should | M |  |
| S33 | Correct at min width / 200% zoom (tab overflow, truncation) | partial | Tabs wrap; rows unverified | should | S |  |
| S34 | Diagnostics: paths, log reveal, both versions + mismatch, PID/uptime, port, pairing, hook per account, copy-diagnostics | partial | Version + hook only; /api/running unused | should | S |  |
| S35 | Safe mode / reset everything from MENU and launch flag | partial | Layout only | should | S |  |
| S36 | No console errors/layout shift during changes (measured) | missing | Nothing measured | should | S |  |
| S37 | Sliders debounced, wheel, typed entry | partial | Refit + PUT per pixel | should | S |  |
| S29 | Schema-validated JSON view | missing | Absent | nice | M |  |
| S31 | Recently changed with undo | missing | Absent | nice | S |  |
| S38 | Deep links plxr://settings/… and panels/sessions/files | missing | No scheme | nice | M |  |

### status (36 open · already there: 3 done (ceiling wording, daemon-side edge, meter sync))

| id | requirement | status | gap | weight | size | his example |
|---|---|---|---|---|---|---|
| ST01 | Status row never covered by windows/dialogs/palette | partial | Overlays can sit on it | must | S |  |
| ST02 | Counts unified with stateOf; idle-shell bucket; 'connecting' before first frame | partial | Frozen mismatch; '0 sessions' before data | must | S |  |
| ST03 | 'shell' state at CLI exit; hook state evicted by age/TTY | partial | Bare prompt reads 'Claude waiting' forever | must | M |  |
| ST04 | 'unknown' shown with cause and INSTALL HOOK action | missing | Renamed 'running' | must | S |  |
| ST05 | No stale last message after restart; no German 'Suche:' | partial | LastMessage kept | must | S |  |
| ST06 | Connection state: attempt n / next in, jitter, stale 'as of' markers, actions disabled, no full reload on service restart | partial | Text swap; fixed 1 s hammer; keepDaemon reloads page | must | S |  |
| ST07 | Per-session git summary (branch, ± count, dirty) on tile/rail/bar | partial | Branch from Claude transcript only | must | M |  |
| ST08 | Nothing rendered before data; failure keeps last value + stale marker; 150 ms loading rule | partial | Inbox/Overview/Usage lie before first frame; Ports blank | must | M |  |
| ST09 | Per-hour rate in the readout | partial | Tooltip only | must | S |  |
| ST10 | Ceiling input refuses invalid, shows saved/error; reaction at limit decided | partial | Typo clears ceiling silently | must | S | chat: leash |
| ST11 | Usage buckets per hour/session/account; byAccount rendered or explained | done | shipped: hour buckets in the cache, a section per account leading with the session and weekly windows, and the shared-transcript case named instead of split | must | M | OFFEN B usage panel |
| ST14 | Inbox rows: account, age; permission > waiting, oldest first | partial | Newest first, no account/age | must | S |  |
| ST15 | Failed reply keeps draft and shows error | partial | Draft cleared before request | must | S |  |
| ST17 | Header needs-answer badge → inbox | partial | Rail only | must | S |  |
| ST20 | Notifications from the window process with icon, permission state + System Settings link, click routes to session/usage, launch-from-notification | missing | Daemon → osascript → Script Editor unchanged | must | L | #11 notifications without icon |
| ST21 | Edge dedupe across service restart; one beep across windows | partial | Refires after restart; beep per window | must | S |  |
| ST22 | DND with durations, quiet hours, strip indicator | missing | Absent | must | M |  |
| ST26 | Workbench: capture before React, source column, copy-all, level filter, dropped marker | partial | Starts in effect; no source/copy/filter | must | M |  |
| ST27 | Service faults streamed to Workbench with codes | missing | log.Printf only | must | M |  |
| ST28 | Fault banner slot in status row linked to Workbench | partial | Connection/update only | must | M |  |
| ST29 | 'daemon' out of all fallbacks/logs with gate; stale advice fixed | partial | state.ts:51, err.remote.notListening | must | S |  |
| ST31 | Status row complete and clickable: service, counts→inbox, spend→usage, branch, update, faults; collapses at 12rem | partial | Nothing clickable, half missing | must | M |  |
| ST34 | Honest degradation: error + retry per surface, last good kept | partial | Inbox/Usage/Status/Overview swallow errors | must | M |  |
| ST12 | Attribution line: tokens measured, currency/plan unavailable | done | shipped: the foot says which file the percentages came from and how old they are, how many transcripts the tokens were counted from, and that both are approximate and local | should | S |  |
| ST13 | Window start/bounds in pace tooltip | done | shipped: every window shows when it opened and when it comes back, in the reader's timezone; a window whose start is unknown says so instead of guessing | should | S |  |
| ST16 | Drafts survive panel close | partial | Component state | should | S |  |
| ST18 | Inbox keyboard (rows, Esc, open session) | partial | Enter sends only | should | S |  |
| ST19 | Hazard style on inbox rows per skin | partial | Absent | should | S |  |
| ST23 | Suppress when window frontmost and session visible | missing | Absent | should | S |  |
| ST24 | Rune-safe truncation; question excerpt + short cwd in body | partial | Byte cut | should | S |  |
| ST25 | In-app notification log/center | missing | Absent | should | M |  |
| ST30 | Non-colour 'hot' cue; win95/pixel | partial | Colour only | should | S |  |
| ST33 | macOS dock badge + bounce | missing | Absent | should | S |  |
| ST35 | Session grid tiles: age, spend share, changes count | partial | State/preview only | should | S | chat: session grid (OFFEN D) |
| ST36 | Account named in inbox/notification when non-default/collision | missing | Absent | should | S |  |
| ST32 | Remote viewer notify capability note | missing | Absent | nice | S |  |

### accounts (29 open · already there: 4 done (remove keeps dir, never reads credentials, secret env not recorded, one service across windows))

| id | requirement | status | gap | weight | size | his example |
|---|---|---|---|---|---|---|
| A01 | Login state measured per account; missing dir greyed/not pickable; sign-in completion observed with e-mail/plan; one-click log in | missing | No such state exists | must | M | #12 account management broken |
| A02 | Label everywhere; account on tile/rail/overview; picker defaults to default account (radiogroup); shell = 'no account' | partial | 'account N'/raw name; picker sends accounts[0] | must | M | #12 |
| A04 | Switch explains + confirms + states continuation | partial | Fires on Select change | must | S |  |
| A05 | 'AI layer runs on' account setting; claude -p uses only it | missing | No code | must | M | chat: AI layer |
| A06 | Accounts atomic write, pushed to all windows; live sync verified with two real windows | partial | Plain WriteFile; loaded once at mount | must | S | chat: kitchen-to-bedroom sync |
| A08 | GitHub/gh account + git identity per workspace: show, switch, set, drift/mismatch warnings, gh missing/expired | missing | No code (7 requirements) | must | L | chat: GitHub accounts |
| A11 | Token never in URLs (window load, WS upgrades) | partial | ?token= everywhere | must | M |  |
| A12 | Secrets in Keychain/0600; store named in Status; per-client credential not raw token | partial | Raw token in 30-day cookies | must | M |  |
| A14 | Pairing code as QR; never in URL/argv | partial | --browser puts code in URL | must | S | chat: phone page |
| A15 | Paired clients listed, individually unpairable | missing | No registry | must | M |  |
| A16 | Bind address always visible | partial | Hidden when off | must | S |  |
| A17 | Route-guard audit test (no prefix-only guard) | partial | /userfonts, /skins open; no test | must | S |  |
| A18 | Remote window says remote/machine/connection | missing | Absent | must | S |  |
| A19 | Sync semantics written in UI | missing | Stale comment only | must | S | chat: kitchen-to-bedroom sync |
| A20 | prefsRev precondition; losing write rejected and shown | missing | Silent last-writer-wins | must | M | chat: kitchen-to-bedroom sync |
| A21 | Update shows notes/asset; no offer without archive | partial | Web path never checks asset | must | S | chat: update-without-archive |
| A22 | Downloaded asset verified (checksum/signature) | missing | None | must | S |  |
| A23 | Single-rename swap; rollback material kept; recovery at next start | partial | Two renames, .old deleted | must | M |  |
| A24 | Update restart asks with session count; 'later' re-offered at idle | partial | Unused i18n keys | must | S |  |
| A26 | Writability checked before download | partial | After full download | must | S |  |
| A03 | Add existing dir validated inline | partial | Typo creates empty dir | should | S |  |
| A07 | Label validation (non-empty, unique) | missing | Anything accepted | should | S |  |
| A13 | Revoke/rotate service token | missing | Minted once | should | S |  |
| A25 | Rollback on failed health check | missing | Absent | should | M |  |
| A27 | Offline check with last-success time + backoff | partial | Fixed 30 min | should | S |  |
| A28 | Window update with old service: reconnect or ask; never kill sessions silently | missing | daemon.Ensure stops old service, sessions end | should | M | chat: PTY survival |
| A29 | Account/pairing/update actions in MENU/palette | partial | Settings only | should | S |  |
| A09 | Signing key shown, failing sign warned | missing | Absent | nice | S |  |
| A10 | Identities panel with extension point | missing | Claude-only | nice | M |  |

### polish (20 open · already there: 0 done)

| id | requirement | status | gap | weight | size | his example |
|---|---|---|---|---|---|---|
| P01 | Opaque surfaces proven per skin at panelSolid 0/100 over a terminal in WKWebView; custom palette path | partial | Code contract only, Blink proof | must | M | #1 see-through popovers |
| P02 | Find portalled; z-ladder covers dockview layers | partial | Find local stacking under scanlines | must | S |  |
| P03 | All popovers flip/clamp at open and resize | partial | Menu stale, Select off-edge | must | S |  |
| P04 | One truncation rule: ellipsis + Tooltip + copy for title/cwd/branch/root | partial | Two mechanisms, no tooltips | must | S | #3 path cut off |
| P05 | Every panel correct at 12/20/40rem × 8rem; all toolbars overflow; measured | partial | OverflowBar on session bar only; no gate | must | M |  |
| P06 | List/grid/empty panels fill dockview host | partial | .list/.grid collapse to content height | must | S | #2 terminal not full height (same class) |
| P07 | Designed empties for Queue/Accounts/Branches with actions; Usage loading ≠ empty | partial | Usage no longer lies before the answer; Queue/Accounts/Branches still missing | must | S |  |
| P08 | Designed starting/offline screen; never WebKit error page; log-open action | missing | log.Fatal or WebKit error page | must | M |  |
| P09 | First-run onboarding, skippable, re-openable | missing | Absent | must | M |  |
| P11 | i18n complete: no English flash, DE overflow sweep, missing keys, aria labels | partial | Renders English first; 2 keys missing; 62 long DE strings unchecked | must | M |  |
| P13 | Cold-start timing measured and logged | missing | Nothing measured | must | S |  |
| P14 | Tiles tick: structural equality, no whole-dock re-render, pause when hidden, CPU measured | partial | Every consumer re-renders per second | must | M |  |
| P15 | Per-panel error boundary; window crash recovery page | missing | One throw unmounts root | must | S |  |
| P16 | Service panic recovery, crash marker, 'restarted unexpectedly at' | partial | No marker/message | must | S |  |
| P17 | Logs: rotation, service log file, level+time, no secrets; MENU open-logs/copy-diagnostics | partial | stderr only, half-truncate | must | M |  |
| P20 | Real-window WKWebView capture path: per-phase screenshots per skin/tab under docs/verify, pixel-diffed, in check.sh | missing | docs/verify does not exist; every gate is Blink | must | M | #10 process failed |
| P10 | Prerequisite check at start (CLIs, git, gh, shell PATH) | missing | Missing CLI = dead terminal later | should | S |  |
| P12 | Skinned scrollbars everywhere, verified | partial | Unbounded lists; unverified | should | S |  |
| P18 | Paths/logs/diagnostics selectable; no blurred text at 2x | partial | Only joinline selectable | should | S |  |
| P19 | Deep links from palette/notification/plxr://; not-found state | missing | Absent | nice | M |  |

### owner-only (6 open · already there: —)

| id | requirement | status | gap | weight | size | his example |
|---|---|---|---|---|---|---|
| O01 | packaged.sh builds a working bundle | missing | Reported failing by owner; not in any audit | must | S | chat: packaged.sh failing |
| O02 | plxr as MCP server | missing | Draft only | should | L | chat: MCP server |
| O04 | Slack/Teams/Outlook client + AI layer (Pillar 8) | missing | Spec only; gated on everything above | should | L | chat: Slack/Outlook/Teams/AI layer |
| O05 | LSP for the editor (diagnostics, completion, hover, symbols) | missing | Plugin slots do not exist (E42) | should | L | chat: LSP |
| O03 | Night shift auto-answer (decision + rules) | missing | Awaiting owner decision | nice | M | chat: night shift |
| O06 | Windows code-signing certificate | missing | Deferred | nice | S | chat: Windows signing |

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

## The window manager and the menu — 13.09.2026, after he drove it

His words: the whole navigation is not a VS Code replacement, "nobody presses
Search", and the window manager needs a lot of rework — look at how other tools
do it. PhpStorm solves it far better: regions, and inside each region tabs plus
one main view. Left, main, right, and bottom under all of them. Left and right
split vertically, main splits both ways for editors, bottom splits
horizontally, and every single thing lives in a tab.

What he hit, exactly: menu open and overview beside it, clicking Inbox opened a
THIRD column; clicking Folders then joined that third column. Closing the third
column made columns one and two 50% each instead of giving the space back to
the second.

### W — the window manager

- **W1 There are no regions, only lanes that grow.** (on main 13.09, not released: four regions, never a fourth column) Any new kind of panel may
  invent a column, which is why Inbox opened a third one. Fixed regions —
  left, main, right, bottom — and never a fifth column.
- **W2 Closing a column redistributes width proportionally**, (on main 13.09: side regions keep their size, main takes what is freed) so the menu
  column doubles. Regions need remembered widths and min/max constraints, and
  main must absorb what is freed.
- **W3 The menu column is itself a panel in the grid.** (on main 13.09: the menu stands beside the grid) It can be tabbed into,
  closed and moved. It belongs to the window chrome, outside the grid.
- **W4 There is no bottom region at all.** (on main 13.09: bottom region through Move to, folded with ⌘J) Ports, usage, output, problems have
  no natural home.
- **W5 Splitting has no direction.** (on main 13.09: split to the right, split downwards) "Open in a new group" always goes right.
  Main must split right and down; left and right must stack vertically.
- **W6 A region cannot be collapsed**, (on main 13.09: ⌘B, ⌥⌘B, ⌘J fold and bring back the same panels) only closed, and closing loses what was
  in it. PhpStorm collapses and remembers.
- **W7 No maximise.** (on main 13.09: Maximise and Restore size on every tab, double-click toggles; measured 1085 → 1405 → 1085px) No zen mode, no "make this panel big".
- **W8 Floating has no way home.** (on main 13.09: dock returns to the panel's own region) "Dock" guesses a lane instead of returning
  the panel to the region it came from.
- **W9 Where a panel goes is my rule, not his choice.** (on main 13.09: Move to sticks per kind of panel) Once he moves a panel,
  that choice must stick for that view.
- **W10 Tab overflow is unsolved.** Many editors and the strip only scrolls —
  no most-recently-used, no quick switch, no overflow list.
- **W11 Drag and drop does not respect regions.** Dockview's own edge drops can
  break the four-region shape.
- **W12 Region sizes are not remembered** (on main 13.09: kept while the window runs and across a restart, measured at 400px through a reload) across close and reopen.

### N — the menu and navigation

- **N1 The rail is a flat list of ten nouns.** Nobody presses "Search". An
  activity bar carries five or six things and each is a place you live in.
- **N2 Places and commands are mixed.** Search, Review and Changes are
  commands; Overview, Folders and Archive are places; "New shell" is a
  command. Places belong on the stripe, commands in the palette and the keys.
- **N3 The most important object is at the bottom.** The running sessions sit
  under ten view buttons.
- **N4 Every click opens a tab.** (on main 13.09: one tool per side region, a second click puts it away) In the side regions one view at a time
  belongs there, not a growing stack.
- **N5 There is no file-first navigation.** (on main 13.09: go to file from ⌘K by typing part of a name; ⌃- and ⌃⇧- walk back and forward through the panels that were in front; symbol jumps are not wanted, see V) No go-to-file, no find-in-project
  from the keyboard, no go-to-symbol, no back and forward through history.
- **N6 There is no go-to-anything.** (half, on main 13.09: ⌘K reaches commands, views, sessions, recently closed panels and files; settings pages and symbols not yet) Files, sessions, commands, settings and
  symbols in one box, the way double-shift works in PhpStorm.
- **N7 The keys are numbered.** view1 to view10 by rail order, which nobody
  remembers. The familiar VS Code chords are what a replacement must answer to.
- **N8 The badges are on the wrong things.** Inbox, ports and archive carry
  counts; sessions waiting for an answer have no priority in the ordering.
- **N9 The rail cannot shrink to icons.** It always eats its full width.
- **N10 Settings is a floating window**, (on main 13.09: settings are a dock panel) so it cannot be docked or put beside
  what it changes.
- **N11 The header MENU duplicates the rail** without sharing its model.
- **N12 No recently closed, no recent files.** (half, on main 13.09: ⇧⌘T reopens the last panel closed by hand where it was, the palette lists the last ten; recent files still open)
- **N13 No editor breadcrumb**, so a file gives no sense of where it sits.

### D — how it should look: the three references he sent (13.09.2026)

"Make it beautiful. The current tab rubbish is not beautiful. There are so
many great IDE concepts." Three shots of modern editors followed. What is in
them, and what plxr has to take from them:

- **D1 An icon activity bar, then the tool panel.** The far left is a narrow
  column of icons only, the active one marked with a bar on its outer edge.
  The tool panel is a second column beside it with its own heading — "Project",
  "WORKSPACE", "Explorer · Search · Git". plxr's rail mixes both jobs in one
  wide column of words.
- **D2 Every region has a head.** A title, and the two or three buttons that
  belong to that tool, not to the window. plxr's regions are bare tab strips.
- **D3 Document tabs carry an icon and a mark.** (half, on main 13.09: mark bar and glyph per kind; real icon packs in progress) A file-type glyph in the
  file's own colour, the name, a close that appears on hover, and the tab in
  front marked with a line in the accent along the edge it meets the content.
  A count sits on the tab when there is something to count.
- **D4 A status line along the bottom** with the breadcrumb of what is open:
  project, folder, folder, file. plxr has no breadcrumb anywhere.
- **D5 A search field in the middle of the top bar**, labelled with its own
  chord, not a hidden palette.
- **D6 Air.** Rounded corners, real padding, hairline separators instead of
  boxes around everything, and type that is not all one weight.
- **D7 Colour used to mean something.** File kinds, states and counts carry
  it; everything else is two greys and the accent.
- **D8 The bottom region is part of the work**, tabbed — tests, console,
  output — rather than an afterthought.

### U — usage: the wrong number, and only one of it (13.09.2026)

He has three Claude accounts in plxr and the usage view shows him one total.
His words, translated: "I have three Claude accounts set up here and I see
overall usage or what? What interests me far more is the CURRENT usage." He
showed Claude Code's own /usage screen as the reference.

- **U1 Usage is not split by account.** (on main 13.09: every figure per account, total underneath) Three accounts, one number. Every
  figure must be per account first, with a total underneath, not instead.
- **U2 The interesting number is missing: what is left right now.** (on main 13.09: session and week windows from Claude Code's own reading) The
  reference screen leads with the current session (percent used, when it
  resets) and the current week (percent used, when it resets, per model
  family). plxr leads with a cost total for a period nobody asked about.
- **U3 Resets are not shown.** (on main 13.09: reset time and countdown in his timezone) A percentage without the time it goes back to
  zero cannot be planned around — and planning around it is the whole reason
  he watches it, because a run that hits the limit costs him an evening.
- **U4 It does not say where the numbers come from or how fresh they are.** (on main 13.09: source and age at the foot; the reading refreshes about every 20 minutes, measured)
  The reference screen says it is approximate and local-only; plxr says
  nothing.
- **U5 Per model, not just per account.** (on main 13.09: input, output, cache read, cache written per model) The reference breaks the spend down
  by model with cache reads and writes; that is the line that explains a bill.
- **U6 No warning before the wall.** (on main 13.09: rail mark, picker mark, one notification at his threshold) He lost a whole wave of work to "you have
  hit your weekly limit" with no notice. plxr knows the numbers and must say
  so — a mark on the account in the rail, a notification at the threshold he
  sets, and a refusal to start a wave on an account that cannot finish it.
- **U7 It must be reachable where it matters**, (half, on main 13.09: new-session picker proven; the session bar's picker not proven on screen) not only in a view: the
  account picker on a session should show what that account has left.

### P — the windows next to PhpStorm, side by side (13.09.2026, on 0.78.0)

He put PhpStorm's new UI and plxr 0.78.0 side by side, translated: "the windows
are still not right ... compare them and make a list of what is different".
Then, on the menu: "you are mixing levels completely. New is already at the top
right. Some things are project-specific, some are global. And I told you before
that I do not agree with the menu as such."

#### The frame
- **P1 The left edge is a wide column of words; PhpStorm's is a stripe of icons.**
  About 40px, icons only, tooltips with the name and the chord. The tool window
  opens beside the stripe. plxr's rail is 195px of capitals and takes that width
  whether anything is open or not.
- **P2 PhpStorm has stripes on both sides, and icons for the bottom.** Tools that
  open on the right have their icons on the right stripe (notifications,
  database); tools that open at the bottom have theirs at the bottom of the left
  stripe (run, terminal, problems, git). Where an icon sits says where its window
  opens. plxr's rail says nothing about where a view will land.
- **P3 A tool window is toggled by its stripe icon, not closed with an ×.** The
  icon is lit while the window is open. plxr puts an × on every tool tab — Search,
  Usage — as if a tool were a document.
- **P4 Only documents have tabs with ×.** In PhpStorm the editor tabs carry file
  icons and a close; tool windows have none. plxr gives Overview, Archive,
  Folders and Settings the same closable tab as a file.
- **P5 Every tool window has a header, not a tab strip.** Its name with a drop-down
  ("Project ▾"), its own tabs inside the header when it has several ("Git: Log
  +"), and on the right its actions (⋮) and hide (—). plxr's tool regions show a
  bare dockview tab strip, and each view repeats its own "search>" / "usage>"
  prompt bar underneath in another style.
- **P6 The bottom is used.** Git log sits under the tree and the editor by
  default, with its own internal panes (branches · commits · changed files).
  plxr's bottom region exists but nothing opens there on its own.
- **P7 A status bar along the very bottom**: the project breadcrumb on the left,
  line endings, encoding, indent and the branch on the right. plxr has its status
  row at the top, under the toolbar, and no bottom bar.
- **P8 The top toolbar is project and run, not a text field and word buttons.**
  Project switcher with its badge, branch switcher, run configuration, run and
  debug, then search and settings as icons. plxr has "path>" as a free text
  field and LAYOUTS, MENU, TEMPLATES, + NEW as words.
- **P9 Empty tool windows do not take a column.** plxr opened Search on the left
  showing "NO FOLDER" over the whole column height.

#### The menu mixes levels
- **P10 Global things and project things are in one list.** Overview, Inbox,
  Ports, Usage, Archive and Notes are about the whole machine; Folders, Changes,
  Review and Search only mean anything for one project or folder. PhpStorm keeps
  project tools in the stripe and machine-wide things in the toolbar and
  settings.
- **P11 A command sits among the places.** "New shell" is an action, and "+ NEW"
  already exists at the top right.
- **P12 Sessions sit inside the menu,** under a project heading, in the same
  column as the views. In PhpStorm the project is chosen at the top and the
  stripe is about that project.
- **P13 He has said before that he does not agree with the menu at all** (N1-N3);
  this is the same point, now with a reference.

#### His direction for the left side (13.09.2026)
- **P18 The left column is the file tree.** Translated: "in PhpStorm the left
  column is really just the file tree. In VS Code there are plugin things too,
  that is good, things like git." So: the left region belongs to the project —
  the tree first, and beside it, reachable from an activity stripe, the
  project's other tools such as source control (changes, review, branches) and
  search. Global things (inbox, usage, ports, archive) do not belong there.

- **P19 No collapsible sidebars.** Translated: "and you don't have all those
  sidebar tab collapse things either!" In PhpStorm and VS Code a side panel
  collapses to its stripe with one click on the active icon and comes back with
  the next, and the panel remembers its width. plxr can fold a region only with
  ⌘B / ⌥⌘B / ⌘J, and nothing on screen shows or does it.

- **P20 The model he wants, in his words (translated): "actually it is only icons
  on every side. Left, right, bottom, and then it opens when you click on it, and
  then you can also move the icons to a side."** So: an icon stripe on the left,
  the right and the bottom edge and nothing else there; a click on an icon opens
  that tool at its edge and a click on the lit icon collapses it again; an icon
  dragged onto another edge moves the tool there for good. That is the
  JetBrains tool-window model. It replaces the rail as a menu, the × on tools,
  and the Move to rows as the main way of choosing a side.

#### How it reads
- **P14 PhpStorm writes its chrome in a proportional UI font** at a normal size
  and case; monospace is for code. plxr writes every label in spaced capitals in
  a monospace, which is the skin's look but costs reading speed everywhere.
- **P15 Air and weight.** Rows around 24px, rounded selection, one subtle
  background step between tool windows and editor, thin overlay scrollbars.
  plxr: square highlights, hairlines everywhere, a thick scrollbar in CRT.
- **P16 Proportions.** PhpStorm's tree takes about a third, the bottom tool about a
  third of the height. plxr's side regions are 320px, too narrow for Usage, whose
  per-model table wraps.
- **P17 Hiding a tool is visible.** The — in the header; plxr's fold is only on
  ⌘B / ⌘J with nothing on screen saying so.

### Found while building the icon packs (13.09.2026), already on main

- **A long folder name wraps out of its rail heading in the Pixel skin.** (fixed on main 13.09: the heading stays on one line) The
  group heading above a folder's sessions breaks onto a second line and runs
  over the entry under it.
- **The first letter of tree names is clipped in Windows 95 at 1x.** (fixed on main 13.09: an icon's slot is never narrower than the largest icon; measured in all four skins and packs) The icon
  column and the name overlap by a pixel or two at normal density.
- **clicked.mjs fails when run twice against one service,** and its count of
  ports can be off by one when a port opens or closes during the run.

### Left open by the row-actions fix (13.09.2026)

- **In the pixel skin at 320px most port names are still cut** (13 of 17) and
  the pid reads "PID …": the narrow-column drop-out widths are in rem and do
  not allow for pixel's much wider typeface.
- **Archive has no narrow-column rules.** At 320px its titles get 40–55px because
  the date and model columns keep their full width.
- **The crt hover overlay behind row actions is solid**, so it shows as a darker
  chip over the see-through rows. Seen only in headless Chrome.
- **A clicked row action keeps focus in Chrome**, so its group stays visible
  until focus moves.

### Left open by the tab close rebuild (13.09.2026)

- **No lasting gate for the close's behaviour:** hidden but spaced on inactive
  tabs, the hover colours, and a title that does not move were measured with a
  throwaway script. They belong in tabs.mjs.
- **Touch screens:** the close should show on every tab there; not measured.
- **Pixel icon pack on a 1x screen:** its 24px icon is wider than the 20px hover
  square; the hover was not looked at.

### V — classic IDE features: deliberately NOT wanted (13.09.2026)

He read this list and answered, translated: "you don't need any of that rubbish
any more with AI programming. Remember it, but it is not up next."
So none of it is work. It stays written down because it is the reason plxr is
not an IDE: the agent reads the code, so the tooling that exists to help a
human read code is not the product. Do not start any of it without him asking.

#### Written down, not planned

- **V1 No language server.** No go-to-definition, no hover types, no rename, no
  find references, no completion.
- **V2 No problems panel, no output panel, no run or debug.**
- **V3 No search and replace across files.** There is find, not replace.
- **V4 No git graph and no inline blame.** That is the GitLens half he asked
  for.
- **V5 No task runner.** npm scripts and make targets from the folder.
- **V6 No extension model.** He wants VS Code *including its plugins*
  replaced.
- **V7 Editor basics unaudited:** minimap, folding, multiple cursors, bracket
  matching, breadcrumb.
- **V8 No split of the same file twice**, no per-panel zoom.

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
