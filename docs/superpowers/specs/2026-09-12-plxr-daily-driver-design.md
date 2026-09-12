# plxr — daily-driver design (VS Code + terminal replacement)

Date: 2026-09-12
Status: design, awaiting owner review — NO code until approved
Grounded by: 16-agent design workflow reading the real code (file:line throughout),
plus an adversarial critique pass whose findings are folded in below.

## North star (honest)

plxr is the one window you live in: a background service owns real **login-shell**
PTYs (not CLI wrappers) that survive a flaky link and multi-machine viewing, and a
Dockview window manager arranges everything around the live terminal as co-resident,
resizable panels — file tree, editable CodeMirror editor with a live git gutter,
source control that **follows the focused session** and updates as an agent writes,
plus overview/inbox/ports/usage/archive. Coding CLIs (claude/codex/aider) run
**inside** the shell, so Ctrl+C, Ctrl+D or `/exit` drop back to a live shell in the
same cwd instead of a dead panel; a dead session restarts in place under the same id
(recording/timeline/marks continuous). Every action and setting is reachable from a
**visible** surface (a header MENU, a discoverable ⌘K palette, right-click plxr menus
everywhere), spend is always visible, and the whole thing is skinnable with **no
terminal text bleeding through any popover**.

**Two survival boundaries stated up front, not buried:**
- Reattach survives WS drops (wifi stall, sleep) and multi-machine viewing **while the
  service lives**. It does **not** survive a restart of the background service or the
  host — the PTY child dies with the service; sessions come back orphaned and restart
  with `--resume`. True cross-restart survival needs an external pty-host process and
  is a separate subsystem (deferred, named).
- Multi-viewer sizing is **smallest-viewer-wins** (host.go:481-494): a kitchen laptop
  and a bedroom monitor of different sizes squeeze the terminal to the smaller. This is
  documented behavior, verified explicitly, not called "in sync" as if solved.

## Scope — this cycle vs. next

Owner decision (2026-09-12): **this cycle = the foundation (Phase 0–6) PLUS file
management & project-wide search (Phase 7). LSP/autocomplete/lint = the next cycle**,
planned and named, not dropped. The north star's "incl. plugins" is therefore *begun*
(a named editor-plugin registry with the git gutter as member #1) but not *completed*
this cycle — we do not claim a gutter is "VS Code plugins".

## Architecture — four seams tie the seven subsystems together

Each seam is an existing mechanism given one more job.

1. **The focused session is the pivot.** A **sticky `lastActiveSessionId`** — updated
   only when a *session* panel gains focus, and **not** cleared when a utility panel
   (editor/changes/usage) is focused — is the single follow-signal. (Raw Dock
   `activeId` is the active *panel*, so following it directly breaks the moment you
   click into the editor: source control would jump to the header path. Critique
   [HIGH], fixed here.) Exposing `activeId` + `lastActiveSessionId` in the Dock panel
   context value (absent today, Dock.tsx:247-248) is the **first task of Phase 3**;
   Phases 3–4 depend on it. Every follower honors the restore-before-data guard
   (Dock.tsx:105-128): tolerate an unknown active session, never blank or self-close.

2. **The shell is the durable root.** Every PTY root is the login shell
   (shell.Default). A CLI pick launches via `WrapInShell` →
   `$SHELL -l -c '<Quote(cli)>; exec $SHELL -l'`, so on CLI exit `exec` replaces the
   **same pid** with an interactive shell in the same cwd — drop-to-shell is a shell
   primitive, race-free; the single-shot go-pty Host is never asked to respawn.
   `sess.Cmd` stays the **logical** intent (`["claude"]`) so agents.Match/resume keep
   working; fleet status matches **byTTY** (not byPID), keyed by **(TTY + open
   generation)** and **evicted on host exit** so a recycled `/dev/pts/N` cannot inherit
   stale state (critique [MEDIUM], fixed). Restart re-Starts under the **same id**;
   account-switch (SwitchAccount) is the only id-minting path.
   - `Quote` = proper POSIX single-quote escaping (wrap in `'…'`, replace each `'` with
     `'\''`), with a test matrix (paths with spaces/quotes, resume ids, `$`, `;`) and
     verification that the exec-drop fires on non-zero exit and on signal death, not
     only clean `/exit`; fish/csh `exec` semantics tested, not filed as a caveat
     (critique [HIGH], fixed).
   - Restart-in-place **awaits the old host's Done** (recording close) before reading
     `<id>.log` size for the new offset, and surfaces "recording stopped (cap)" rather
     than silently losing timeline continuity at the 64 MB cap (critique [MEDIUM]).

3. **One live-git signal.** A daemon-side git watcher, **coalesced and ref-counted by
   resolved root path** (two sessions in one repo, or two windows, share ONE poll loop
   and ONE `git status` per tick — no N-process fan-out), pushes `{changes, where, rev}`
   over a new id-scoped `/ws/changes/{id}` mirroring `/ws/tiles`, reusing the existing
   git surface (git.Changes/Position) with no new git logic. It emits the same
   `plxr:files-changed` CustomEvent the tree already uses, so changes panel, open diff,
   tree and editor gutter all refresh off one source. **Poll, not fsnotify** — the
   codebase already settled this (fleet/watcher.go:50-52). Diff ids become
   `diff:<rootId>:<s|u>:<path>` so same-named files across repos stop colliding.
   Poll interval and idle-vs-active debounce are **defined** (target: ≤2 s active,
   quiet on idle — asserted by `pgrep git`), and baseline resolution for
   renamed/submodule/newly-tracked paths falls back to empty-baseline + full-add gutter
   rather than erroring (critique [LOW], fixed).

4. **One opaque-popover contract.** Root cause **confirmed**: crt double-mixes
   `--panelSolid` (skin-crt.css:48 consumes `color-mix(var(--panel-glass) var(--panelSolid))`
   while `--panel-glass` already = `color-mix(var(--panel) var(--panelSolid,62%))`,
   skin-base.css:542) → ~38 % panels, so terminal text bleeds. Principle: **glass** =
   persistent chrome you look at the desktop through (bar/rail/tiles/files/sessbar,
   governed by the panelSolid slider); **opaque** = anything laid over content you must
   read. Fix: (a) crt consumes `var(--panel-glass)` directly (frame 1:1); (b) define a
   central always-opaque `--surface: var(--panel)` and a real per-skin `--shadow`
   (confirmed undefined everywhere — only the rgba fallback fires) in **all four** skin
   files; (c) repoint **every** floating surface — `.menu`, `.palette`, `.selectList`,
   `.find`, `.obarMenu`, and the dialog `.card` — to `--surface` + `--shadow`;
   (d) rationalize the z-ladder so all overlays clear `.fx` (crt scanlines z=50) —
   `.obarMenu`(40) and `.find`(6) currently wear scanlines. The same `--surface`
   contract hosts the two new primitives (`ui/Tooltip` replacing 63 native `title=`,
   `ui/Window` hosting Settings).

**Panels default and cohere.** Fill fix first: `.session` `flex:1` → `height:100%`
(confirmed layout.css:321; dockview's `.dv-react-part` is a plain `height:100%` block,
so `flex:1` collapses to content height — the empty band), and `.emptyNote`
`height:100%` (the dead-panel blank band). Then `openOrFocus` gains **role+placement**
— two lanes: a **stage** group (sessions + overview) and an **aside** group to its
right (utilities usage/inbox/ports/folders/archive + companions changes/diff/preview/
editor/files) — so opening Usage no longer tabs over the terminal (complaint #8). A
**LAYOUTS** registry of per-activity builders replaces the single defaultLayout; named
presets live in a prefs sibling key `dockPresets` (version-guarded by dockview major).
Rail width comes from the orphaned `--rail-w` rem token via a remToPx helper, killing
the 210px literal, re-asserted on load after fromJSON.

## Build order — each phase shippable and verified in the REAL window

**Phase 0 · A real-window verification path (do this first).**
The app's macOS window is a **WKWebView** (Wails v3). Chrome-against-the-daemon renders
in **Blink**, so it cannot prove compositing/opacity/skin claims — that is the exact
headless-adjacent trap that burned this project (critique [CRITICAL]). Establish a
capture path against the actual WKWebView window (launch the packaged app via
bundle-macos.sh; capture the specific window via native `screencapture -l<windowID>` /
CGWindowList, or Wails devtools). Document it; state that Chrome-against-daemon is
**not** acceptable proof for any compositing/skin/opacity claim (Phase 2 especially).
If native window capture proves impossible in this environment, that is surfaced
honestly and the affected claims are marked "verified by you, on screen," not by me.

**Phase 1 · The terminal becomes a real terminal.**
Fill fix (`.session`/`.emptyNote` → full height). Shell-as-root + drop-to-shell
(WrapInShell; `sess.Cmd` logical; fleet byTTY+generation). Reconnect-with-backoff on
the session WS (wire the existing-but-unused `pane.lostLine`, en.json:544). Restart-in-
place under the same id with an ended panel that FILLS the pane and a RESTART button in
the session bar and Overview tile. — *Fixes the loudest live complaints on its own.*
Verify (real crt window): pick claude in a repo → `/exit` lands at a live `$` in the
same cwd, same panel, full height, no "not running"; sleep/kill-wifi → "reconnecting"
→ repaints on wake; Terminate → RESTART in place, Player/Marks continuous; a claude
tile still goes working→waiting→permission as a child of the shell (byTTY).

**Phase 2 · No terminal text bleeds through any popover, on any skin.**
The one opaque-popover contract (seam 4). Verify over a bright scrolling terminal in
crt: context menu, ⌘K palette, a Select dropdown, the overflow menu, the find box, a
dialog — background alpha == 1, no phosphor bleed, overflow menu/find box no longer
wear scanlines; drag panelSolid 0↔100 → frame changes 1:1, every popover stays opaque;
sweep win95/sketch/pixel.

**Phase 3 · Panels default and cohere as a window manager.**
First: expose `activeId` + `lastActiveSessionId` in the Dock context (seam-1 owner).
Then `openOrFocus` role+placement → two lanes; per-activity LAYOUTS registry; rail
width from `--rail-w`; editor and files promoted to real Dockview panels beside the
terminal (drop the overlay-covers-terminal model). Verify: click Usage → opens beside
the terminal, terminal still visible; Changes → aside lane; click a tree row → editor
beside the terminal, both resize on the splitter; type-size change → rail scales;
restart → layout restores without blanking while tiles load.

**Phase 4 · Source control follows the focused session, live, with a live editor gutter.**
Coalesced ref-counted git watcher + `/ws/changes/{id}` + `useChanges` hook. Changes
panel follows `lastActiveSessionId` (session cwd, scoped), updates with no AGAIN;
click-to-diff highlight lit; open diff refreshes live; diff ids repo-qualified. Editor
git-gutter (add/mod/del) inside the CodeMirror Compartment boundary, fed a HEAD
baseline endpoint. **Honest gutter semantics** (critique [HIGH]): the gutter is
HEAD-vs-buffer, **live as the user types**; it is **not** live-repainted from an
agent's on-disk write while the editor is dirty — instead a non-destructive "changed on
disk — reload?" affordance fires on `plxr:files-changed` (reusing the mtime guard). The
"live as an agent writes" claim applies to the **changes panel and diff**, not to an
open dirty editor buffer. Shipped as member #1 of a named editor-plugin registry seam
(LSP/lint/format = declared, unbuilt entries → next cycle). Verify: two sessions in two
different repos → clicking between them switches the one Changes panel's repo+branch;
edit/create/delete in the terminal → files move groups with correct ±counts in seconds;
click a changed file → diff opens beside AND the row lights; `pgrep git` quiet on idle,
one loop even with two windows on one repo.

**Phase 5 · Everything reachable from a visible surface; Settings is a real window.**
One visible header MENU (grouped all-actions incl. Workbench/Workshop/Frame-meter —
today keyboard-only — plus a "Search commands… ⌘K" item). Palette open-state lifted to
App with a typing guard; Keys.tsx corrected. Right-click plxr context menus on rail
sessions, the terminal (copy/paste/select-all/clear/find via xterm), Folders tabs,
session title — never the browser menu. `ui/Tooltip` replaces 63 native `title=`.
`ui/Window` (body-portal, on `--surface`) hosts Settings with tabs skins&palette /
terminal / editor / keybindings / accounts / layouts / notifications / agents / status;
named-preset management + a frontend keymap store ride the prefs blob.
**Terminal Paste** is verified in the real WKWebView (navigator.clipboard read
semantics differ from Chrome; route through a Wails-native clipboard binding if the
async API is unreliable there — critique [MEDIUM]).

**Phase 6 · Spend is always visible.**
`Pace` type + `api.tempo` (endpoint exists, server.go:522, no consumer today) +
`usePace` poll (~5 s, cheap via the size+mtime transcript cache). A live pace readout
in the always-visible statusrow; the same numbers expanded as a "right now" band in the
Usage panel. A user-set **soft** ceiling (prefs `paceLimit`) colours the readout and
fires exactly one edge notification on the rising crossing (daemon-side, works with no
window open) — never halts. **Stated plainly in the UI**: the ceiling is a self-set
target, not the real Anthropic plan cap — plxr has no visibility into the actual plan
window (critique [MEDIUM]).

**Phase 7 · File management & project-wide search (owner-added scope).**
Tree file CRUD — create / rename / delete / move — from the file tree context menu, and
project-wide find-in-files wired to the editor, leveraging the existing but unwired
`internal/search` and `internal/find` packages. Opening a search hit opens the editor
at the line (reuses Phase 3's openEditor + goToLine). This closes the "not a daily
driver without file management or project search" gap (critique [MEDIUM]).

## Cross-cutting invariants (all subsystems must agree)

- **Follow signal**: sticky `lastActiveSessionId` (not raw `activeId`); exposed in the
  Dock context; followers honor the restore-before-data guard.
- **Session identity under shell-as-root**: `sess.Cmd` = logical CLI intent; fleet
  byTTY+generation, evicted on host exit; restart preserves id; account-switch is the
  sole id-minting path. Everything keyed by id (recording/timeline/marks/panel).
- **Live-git signal**: `/ws/changes/{id}` `rev` + `plxr:files-changed` are the shared
  refresh trigger; exactly one watcher per resolved root, ref-counted; never piggyback
  git diffs on the 1 s tiles snapshot.
- **Opaque contract**: `--surface` (opaque) + per-skin `--shadow` in all four skins is
  the single background/shadow token for every floating surface; panelSolid governs
  only the glass frame.
- **Live-settings wire**: `THEME_CHANGED` ("plxr:theme") pushes prefs to the running
  xterm and CodeMirror without reopening (fix Meter.tsx:35 wrong literal).
- **Prefs is the one synced store**: dock, dockPresets, layouts, terminal, editor,
  keymap, paceLimit are top-level prefs keys, cross-window-synced via prefsRev; no new
  endpoints for these.
- **Network reach is not widened**: `/api/tempo`, `/ws/changes` sit behind the existing
  Guard + single-use 10-minute pairing token; no new listener, no weakened auth.
- **Standing rules**: code 100% English (German only in assets/i18n/de.json); rem in
  layout.css (runtime x/y inline px is the sole sanctioned exception, per Menu/Select,
  plus the rem→px dockview boundary); no raw native controls outside components/ui; no
  CSS in components (sizes→layout.css, colours→skin-base + all four skins); the word
  "daemon" never in user-facing text **including pre-i18n fallbacks** (fix state.ts:51).
- **Verification discipline**: every phase proven in the REAL rendered window (crt, over
  a terminal with real content), captured as a screenshot; check.sh gates are necessary,
  never sufficient.

## Risks & de-risking (top)

- go-pty Host is single-shot → make the login **shell** the surviving root; `exec`
  inside WrapInShell; restart = fresh ptyhost.Start under the same id, never a Host
  resurrection.
- Identity/status under shell-as-root → keep `sess.Cmd` logical; match byTTY+generation
  reusing the tty the hook already records; evict on host exit.
- Fan-out (N windows × N sessions × git status) → one coalesced ref-counted watcher per
  resolved root; prove with `pgrep git`.
- Fixing opacity on one skin repeats the exact bug the skin-base header warns about →
  define `--surface`/`--shadow` in all four skins in the same change; full skin sweep.
- Restore-before-data race → mirror the connected-guard in the SC and editor followers;
  verify by quit-and-relaunch.
- Persisted dockview px freezes rail width → re-assert sizeRail from `--rail-w` after
  fromJSON; a user drag is their own arrangement.
- "daemon" as a pre-i18n fallback flash → clean every fallback string; gate with
  german.py plus eyes-on.
- Headless-only proof → Phase 0's WKWebView capture path; Chrome-against-daemon is not
  acceptable proof for compositing.
- Remote reach = full machine control behind the paired token → route every new
  endpoint through the existing Guard + pairing; add no listener.

## Deferred / non-goals (named, not forgotten)

- True PTY survival across a service/host restart (needs an external pty-host process).
- LSP, lint, format-on-save language servers — only the named editor-plugin registry
  seam ships now, gutter as member #1. **Next cycle.**
- A hard spend leash that halts sessions — soft ceiling only.
- Per-account spend attribution and real plan/limit/balance data (non-existent source).
- Slot-memory placement per panel (dockview group ids not stable across restore) — the
  two-lane role policy suffices.
- Backend keymap/layout endpoints — they ride the prefs blob.
- A Dockview floating group for Settings / a persistent top menu bar — body-portal
  `ui/Window` + a single header MENU button instead, to stay on the `--surface` contract.

## Verification method (the thing that must change)

Every phase is proven on screen in the **real Wails WKWebView window**, crt skin, over a
terminal holding real content — captured as a screenshot I actually look at. check.sh
gates (attributes/gitcalls/german/classes/style/skinrules/translations) are run and must
stay green, but they are necessary, never sufficient. Chrome-against-the-daemon is
explicitly **not** proof for any compositing/skin/opacity claim.

## Pillar 8 — Comms & Identities (NEXT cycle — only after Phases 0–7 are COMPLETELY done)

Owner's words (12.09.2026), translated: "a real, full integration" — plxr becomes the
**client** for Slack, Teams and mail; he stops opening those apps. Not a feed. Strictly
sequenced after the current build is finished and shipped — not started before.

**Scope, per platform (full):**
- **Slack:** every workspace; channels, DMs, threads, full history; write, reply in
  thread, reactions, @mentions; file upload/download; search; unread/mention badges;
  presence/status; notifications delivered through plxr (native, with icon — see
  OFFEN.md #11). Connector: Slack Web API + Socket Mode (no public URL needed).
- **Teams:** 1:1 and group chats, channels, replies, reactions, mentions, attachments,
  search, presence, notifications — via Microsoft Graph with delta polling. **Not**
  calls/meetings (audio/video needs the Teams client — the one real API limit). Some
  tenants require admin consent for chat scopes; that is his to grant, not code.
- **Outlook:** the whole mailbox — folders, conversations, read/compose/reply/forward,
  attachments, search, flags/rules — **plus calendar** (see, accept/decline invites).
  Graph Mail + Calendar; same Azure app as Teams.
- Any further platform (Discord, WhatsApp, Signal, Jira…) is one more connector into the
  same model, not a new architecture.

**Architecture:** one **comms core in the service** — per-platform connectors → ONE
unified message model (account, channel/thread, message, attachment, state) → dockable
panels on top (inbox, channel, thread, compose, calendar, digest), all beside the
terminal. **Multi-account everywhere** (several Slack workspaces, several M365 accounts)
through the same identities system as Claude/GitHub.

**AI layer (real, not a score):** triage (priority/urgency, who wants what), thread
summaries, reply drafts in his voice, action items → a task list in plxr, a daily
"what needs you now" digest.
- **No API key. He has none and will not get one.** The AI layer runs on his claude.ai
  subscription through **Claude Code itself** (`claude -p`, print mode) using the
  `CLAUDE_CONFIG_DIR` accounts plxr already manages. Counts against the 5h window, so it
  is **batched and on demand** (digest, triage-the-unread on a button, a draft only when
  he hits reply) — never real-time per message. The spend panel shows what the AI layer
  consumes; the soft ceiling brakes it.
- **HARD RULE — he picks the account.** In Settings › Accounts a fixed assignment:
  "AI layer (triage/drafts) runs on: [account]", optionally split per task (triage on
  X, drafts on Y). plxr NEVER distributes across accounts on its own, never picks a
  different one by itself. Same principle everywhere: default account for new
  sessions, account per session, account for the AI layer — always his choice,
  visible, switchable.
- **Optional tier:** the local LLM on his Mac mini M4 for bulk triage
  (prioritise/rough-summarise) — free and private; Claude only where quality matters
  (drafts). A switch: local / Claude / both.

**Identities (part of this pillar, and the FIRST piece of it):**
- **GitHub / gh accounts:** `gh` supports several accounts natively (`gh auth switch`).
  plxr shows per session/workspace which GitHub account and which git identity
  (user.name/email) is active and switches it — ends the mg-pr-vs-nock-404 wrong-push
  class of mistake. Generalised: an Identities panel — Claude accounts (exist), GitHub,
  git identity; npm/Docker later.
- **The existing Claude account management does not work properly for him** (his
  words, translated: "if at least the AI account management worked"). Before anything is built
  on it: measure what exactly fails, make it actually work.

**What he does once, when this is due (I lay it out step by step):** create + authorise
a Slack app; an Azure app for Teams/Mail + OAuth sign-in; admin consent in the company
tenant if required.

**Order inside the pillar:** Identities (fix Claude accounts + GitHub) → Slack →
Outlook + calendar → Teams → the AI layer over everything.
