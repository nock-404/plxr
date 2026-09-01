# plxr3 — build log & feature parity checklist

Goal (given 31.08.2026, night): rebuild EVERY feature of the old plxr in plxr3,
state of the art. Old plxr (`../plxr`) is already Wails v3 with the full feature
set — reused as the DAEMON CORE. plxr3 = that daemon + a NEW Next.js/React
frontend against the same HTTP/WS API. English only, generic components, rem,
central CSS. Never mark a line done without running and seeing it.

## Architecture
- Daemon (`internal/`, reused): owns PTYs, serves `/api/*` + `/ws/*` on
  127.0.0.1:<random> guarded by a token in `~/.plxr/daemon.json`.
- Window (`main.go`): frameless frosted v3 window loading `http://127.0.0.1:PORT/?token=…`.
- Frontend (`frontend/`, NEW): Next.js static export, served by the daemon at `/`.
  Reads token from `?token=` → sessionStorage, then `X-Plxr-Token` header / `?token=` on WS.

## API contract (from old server.go) — the fixed target
sessions: GET/POST /api/sessions, DELETE /api/sessions/{id},
  POST /api/sessions/{id}/reply|freeze|unfreeze|account|resume
global: POST /api/freeze|unfreeze, GET /api/health|version|running|shell|prefs, PUT /api/prefs
themes/skins: GET/POST /api/themes, DELETE /api/themes/{name}, GET/PUT /api/skins/{name}, GET /skins/*
templates: GET/POST /api/templates, POST /api/templates/{name}/start, DELETE /api/templates/{name}
agents: GET /api/agents, GET/PUT/DELETE /api/agents/{name}, GET /api/agents/{name}/starter
archive: GET /api/archive, DELETE /api/archive/{id}, POST /api/archive/{id}/resume
playback/search: GET /api/playback/{id}, /api/playback/{id}/timeline, /api/search, /api/search/terminals
marks: GET /api/marks/{id}, /api/marks/{id}/{tree}, POST /api/marks/{id}/{tree}/restore
usage/wait: GET /api/usage?days=, /api/waiting?days=, /api/tempo, /api/rules, /api/replies?q=
ports: GET /api/ports, DELETE /api/ports/{pid}?hard=1
files: GET /api/files/{id} (dir), /api/paths, /api/file/{id} (read), PUT /api/file/{id} (write)
accounts: GET /api/accounts ; hook: GET/POST /api/hook
update: GET/POST /api/update, POST /api/restart ; log: POST /api/window-log
ws: GET /ws/tiles (full state 1/s), GET /ws/session/{id} (terminal io + resize)

## Status  (✅ done+seen · 🔨 in progress · ⬜ not started)
### Foundation
- ✅ copy internal/ + go.mod/sum + data (themes/agents/skins/i18n) into plxr3
- ✅ purge German from reused Go + data (mitschnitt.go, comments, theme names)
- ✅ main.go: daemon subcmd + Ensure + window; embed frontend/out; serve out
- ✅ backend builds & `plxr daemon` runs; /api/health returns
- ✅ frontend: token handling + typed API client + WS helper
- ✅ real React app loads in window against live daemon (seen)

### Feature views (frontend parity)
- ✅ themes: CRT skin, green+amber palettes, live glow/scanline/text-size controls (seen, switch verified live + persisted)
- ✅ skins: crt, win95, sketch, pixel — same layout, only the dressing changes (all four seen)
- ✅ CRT palette generator (hue → full palette, contrast floor kept; seen in ice blue)
- ✅ session tiles grid (live via /ws/tiles): status, cli, path, account
- ✅ terminal view (xterm 6 + WebGL renderer over /ws/session/{id}) — scrollback, resize, typing verified
- ✅ create session (path picker + agent/cli choice)
- ✅ session controls: freeze/unfreeze, resume, kill, account switch (greyed out where impossible)
- ✅ emergency brake (PAUSE ALL, only shown while something runs)
- ✅ files browser + editor (GET files/paths/file, PUT file)
- ✅ marks (list + restore; empty state seen)
- ✅ usage view (cost, days)
- ✅ wait account (worked vs waited, shown beside usage)
- ✅ reply memory (what was answered to the same question before, in the inbox)
- ✅ workshop (⇧F12, writes CSS live over the skin via a cascade layer, saved per viewer)
- ✅ agent management (list, edit, per-line probe verified on 3 cases)
- ✅ ports view (list + kill, hard)
- ✅ archive view (list, delete, resume)
- ✅ accounts list + hook state (settings ▸ status)
- ✅ templates (list, start, add, delete)
- ✅ update band (check, install, restart)
- ✅ search (conversations + terminals) and playback (recording + scrubber, seen)
- ✅ workbench (in-window console, F12 — captures log/warn/error, seen)
- ✅ keyboard shortcuts overview (?)
- ✅ notification sound when a session starts waiting
- ✅ empty states everywhere
- ✅ i18n (en primary, tr/trN against the daemon's tables)
- ✅ error codes (errText turns err.* into a sentence; errors.py keeps every code covered)

### Gates (adapt from old check.sh)
- ✅ gates: no-german, no-css-in-components, rem-not-px, no-native-elements, vet, gofmt, tests, tsc, build
- ✅ smoke gate: no green without having clicked the current build through

## Log
- 31.08 04:10 the fifth way a gate lies, found by somebody running check.sh the
  plain way: the window checks read ~/.plxr/daemon.json, which points at the
  INSTALLED plxr — another program. They passed here and failed there, and while
  failing they clicked around inside a live window and wrote its prefs. Fixed
  twice over: the checks compare the page the daemon serves against this build's
  own index.html and refuse a stranger, and check.sh now starts its own daemon in
  a throwaway home, creates one session, and takes both away again.
- 31.08 04:00 the gates were audited for the one failure they all share: passing
  without looking. Four kinds found and closed — a path that resolves to
  nothing, a file extension nobody collected, a hash of an empty file list, and
  an empty set that `go test` calls "ok". Every rule now counts what it read,
  fails at zero, prints the number, and has been watched going red on a planted
  fault. `clicked through` kept its job (proving a person looked) and gained a
  sibling, `window works`, that checks 23 claims about the running window
  against what the daemon reports.
- 31.08 02:45 gates audited after two were found blind. german.py never opened
  .ts/.tsx; three steps in check.sh pointed at paths that only exist under
  frontend/ and matched nothing at all. Rewritten as german.py / errors.py /
  style.py, each counting the files it reads, failing at zero, and printing the
  count. Every rule proved by planting a violation and watching it go red.
- 31.08 02:13 feature pass done: playback, search, reply memory, workshop,
  templates, theme import/delete, update install, hook + accounts, split panes,
  find in terminal, sound on a session starting to wait. Themes now come from
  the daemon (Game Boy palette verified), so import and delete mean something.
  check.sh all green including the click-through gate.
- 31.08 02:00 layout measured against the reference: rem was anchored to the
  text-size setting (font-size on :root), so the whole layout shrank with it —
  moved to body. Bar 59/58, rail 195/195, status strip 28/28, mark 26/26.
- 31.08 02:00 terminal was blank: measured that frames arrived and the xterm
  buffer filled while the DOM renderer never painted; only a resize brought it
  out. Switched to the WebGL renderer (with a fallback) — scrollback, split
  panes and typing all verified in the window.
- 31.08 01:00 four skins done and seen; agents editor with working probe; workbench; files+editor; rules; marks; templates; usage/ports/archive/inbox all on real data.
- 31.08 00:47 shell rebuilt against the REAL old UI (index.html/base.css/skin.css):
  bar with path filter, status strip, rail (overview/inbox/ports/usage/archive +
  session groups), tile grid with corner brackets, session view with FILES/RULES/
  MARKS/SPLIT/account/PAUSE/TERMINATE, labelled terminal pane, files tree + editor,
  settings (skin/palette/glow/scanlines/size) and the shortcut list. Layout and skin
  are separate layers again, exactly as the old contract demands.
- 31.08 00:xx started: theme foundation (CRT green/amber, IBM Plex Mono, live controls) built & seen in browser; native window running. Now: wire the daemon.
