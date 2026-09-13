# plxr: tool stripes (JetBrains-style tool windows)

Date: 2026-09-13
Status: design, awaiting owner review. No code until approved.
Base: plxr3 HEAD 99ee563, dockview-core / dockview-react 8.3.1.
Inputs: the window code map (taken at 9ce4c2e), the dockview 8.3.1 edge-group research, the
gate inventory, and two competing designs: A, "dockview-native" (the stripe is the edge group's own
tab header), and B, "own stripes over grid groups" (tool windows are ordinary grid groups).

Marks used below:
- **[read]**: seen in the source or in the dockview bundle.
- **[unrun]**: an assumption that step 0 has to measure in the real window before anything depends on it.

Line numbers: the code map was taken at 9ce4c2e. Five commits since then changed `Dock.tsx` by about
150 lines (`holdsOnlyDocuments` D:1417, `lastDocuments` D:1203, `place` D:1541, `hold` D:1628,
`openOrFocus` D:1728, `shareWidth` D:1763, `toggleRegion` D:1800). Look up every D: reference by
symbol name, not by line.

---

## 1. What he asked for

- Icons only, on three sides: left, right and bottom. Clicking an icon opens its tool window. He can
  move an icon to another side.
- The left side is mainly the file tree. Like VS Code, it may also hold project tools such as source
  control.
- Global things (inbox, usage, ports, archive, notes) are not project tools.
- The rail goes. Today it mixes global views, project views, a command ("New shell") and the session
  list in one wide column of words.
- Tools have no close ×. Only documents do.
- A side window closes and comes back at the width it had.
- Every action has a visible control, not only a keyboard chord.
- Main stays freely splittable for terminals, editors and diffs.

---

## 2. Decision

### 2.1 Chosen: plain React stripes that show and hide tool windows held in dockview's core edge groups

The approach has two layers, and they are kept separate on purpose.

1. **The stripes are plain React, outside `DockviewReact`** (taken from B).
   - A CSS grid places a left stripe, a right stripe and a full-width bottom stripe around the dock.
   - They never move and never change thickness.
   - Every icon is a normal button, so skins, icon packs, tooltips, badges and CDP-driven gates treat
     it like any other control.
   - Dragging an icon to another stripe is plxr's own pointer handling.
2. **The tool windows are dockview core edge groups** (taken from A's research).
   - There is one edge group each for left, right and bottom. Each holds the tool panels of its stripe.
   - The edge group's own tab header is hidden (`group.model.header.hidden = true`, typed at
     `dockviewGroupPanelModel.d.ts:97`) [read].
   - The group is locked with `'no-drop-target'` (`:119`) [read].
   - Showing and hiding use `api.setEdgeGroupVisible(edge, bool)` [read, B:15108].
     - The outer or middle splitview calls `viewItem.setVisible(visible, viewItem.size)`, which caches
       the size, and `_flushPendingSizes()` runs on show (B:1004-1011, B:15108-15122) [read].
     - A hidden edge takes no space. When shown it comes back at the width it had.
     - Size and visibility are serialized in `toJSON().edgeGroups` (B:15218-15279) [read].
   - Edge groups live in dockview's ShellManager, outside the grid (B:14932 onward) [read]. The grid
     therefore holds only documents. Splitting, floating or maximizing in main cannot change the shape
     of the tool windows, and tool windows cannot change the shape of main.

The core API is used, but not the core's collapsed tab strip. Only the non-enterprise pieces are
needed: `addEdgeGroup`, `setEdgeGroupVisible`, `group.api.setSize`, `toJSON`/`fromJSON`. Nothing here
needs dockview-enterprise.

The part that talks to dockview sits behind one small interface, `ToolHost` (§5.1). If step 0 shows
the edge groups cannot do it, a second implementation replaces them (§2.3). The stripes, registry,
header, keys, switchers, persistence keys and gates stay the same either way.

### 2.2 Rejected: design A as written (the stripe is the edge group's collapsed tab header)

- **The bottom stripe would move.** An edge group's header is part of its group. The bottom group sits
  between left and right (B:14932 onward) [read]. When the left window opens, every bottom icon would
  shift right by the window's width. He asked for icons "on every side", not icons that wander.
- **All of main's dragging would change.** A tool icon has to be draggable between edges, and gates
  can only drive that with CDP mouse events. That forces `dndStrategy: "pointer"` for the whole dock
  (B:5806-5817) [read]. Main tab drags would lose the native drag image. Main is the part he most
  wants to keep working.
- **Several fragile workarounds would be needed:** vetoes for tools dropped into the grid, a native
  `pointerdown` listener to stop shift-drag floating (React's listener runs too late), a veto for
  whole-group header drags (B:18094), and icons and badges inside `writing-mode: vertical-rl` headers.
- **Kept from A:** the edge groups themselves, `placeDocument` on the last main group, the
  `api.location.type` filters, the save triggers for edge sizes, the pure `migrateLayout`, the load
  pipeline, tool bodies that stop polling while hidden, the step-0 spike, and the geometry "missing box
  fails" fix.

### 2.3 Rejected: design B as written (tool windows as ordinary grid groups under a "ring rule")

- **It rebuilds the failure class he is complaining about.**
  - Tools and documents would share one grid tree.
  - The frame shape would depend on the order of absolute inserts.
  - Opening a side tool while the bottom one is open would close and remount the bottom tool.
  - A `frameIsCanonical` box check would have to run after every operation.
  - Today's `regionOfGroup` / `groupOfRegion` / `clearTools` / `hold` code is exactly this kind of
    logic, and it produced the bugs behind this redesign (`toggleRegion` reopening panels with empty
    params, panels closed by `clearTools`).
- **Hiding would close the panel,** so every hide loses state and a `home` placeholder is needed to
  stop main from emptying.
- **Kept from B:**
  - the stripes outside dockview and the full-width bottom stripe
  - own pointer drag with a ghost and a gap marker, and "a click without movement toggles"
  - `gatekit.mjs` as the first step
  - the pure registry with unit tests (`normalize`, `fromRegions`, `moveInLayout`, `dropIndex`)
  - JetBrains chord semantics (`chordTool`) and ⇧⎋ to hide
  - `toolMemory`
  - the App-owned project model, the switchers, `MenuItem.icon/sub/status`
  - preset `tools` and `exitMaximizedGroup` before stripe actions
- **B's fallback becomes this design's fallback.** If step 0 fails a must, `ToolHost` is implemented as
  plain React columns outside dockview (`components/ui/Splitter.tsx` exists) that render the tool
  bodies directly. The ring rule is not used in either case.

### 2.4 Limits this accepts (put them to him, §14)

- **One tool window visible per edge.** A second icon on the same edge swaps the content. JetBrains'
  split mode is a follow-up.
- **One remembered size per edge,** not per tool.
- **The bottom window sits between the left and right windows,** not under them. This is the core
  layout. The bottom *stripe* still spans the full width.
- **No peek or overlay mode.** In dockview that is an enterprise feature; plxr does not build its own.

---

## 3. Frame and component tree

```
App                                              components/App.tsx
└ .app
  ├ header.bar
  │  ├ .brand
  │  ├ ProjectSwitch      components/topbar/ProjectSwitch.tsx   replaces the .filter "path>" field
  │  ├ SessionSwitch      components/topbar/SessionSwitch.tsx   replaces the rail's session list
  │  ├ .draghandle
  │  └ .tools: PAUSE ALL · EdgeToggles · reset · LAYOUTS · help · settings · MENU · TEMPLATES · + NEW
  ├ UpdateBar · NotifyAsk · .statusrow           unchanged (P7/P8 are separate work)
  └ .body > .work > .workrow > main.content
     └ Dock (Ctx.Provider, InlineStrip)          components/Dock.tsx
        └ .dockShell   CSS grid, 3 columns × 2 rows
           ├ Stripe edge="left"                  components/stripes/Stripe.tsx
           ├ DockviewReact.plxrDock   dndEdges={false}  watermarkComponent={MainWatermark}
           │   ├ edge group "left"    header hidden, locked 'no-drop-target'
           │   │    panels: files, changes, search, review → ToolWindow > body
           │   ├ grid = main: documents only, PanelTab with ×
           │   ├ edge group "bottom"  (between left and right windows)
           │   └ edge group "right"   panels: inbox, usage, ports, archive, notes
           ├ Stripe edge="right"
           ├ Stripe edge="bottom"                grid-column 1 / 4, full width
           └ StripeGhost                         only while dragging (components/stripes/Stripes.tsx)
```

- **`Stripes.tsx`** owns the three `Stripe`s and the drag state, because the drop target may be a
  different stripe from the one the drag started in. It is rendered inside `Dock`, so it reads the
  tool layout, the open state, badges and limits directly.
- **`EdgeToggles`** sits in the App header. It sends new layout requests through the existing channel
  (A:372 → Dock): `{type:"toggleEdge", arg: Edge}`, `{type:"showTool", arg: ToolId}` and
  `{type:"resetTools"}`. Dock reports back through a new prop, `onToolsChanged(open: Record<Edge, ToolId | null>)`,
  which drives `aria-pressed`.
- **`Focus`** (the type used by `setFocus`) becomes:
  ```ts
  type Focus =
    | { kind: "tool"; id: ToolId; how: "toggle" | "reveal" | "chord" }
    | { kind: "doc"; id: "overview" | "folders" | "settings" }
    | { kind: "session"; id: string; name: string }
    | null;
  ```
- **Removed:** `Rail.tsx`, `RailPanel`, the `.railHost` aside, and the old flex `.dockShell`.

---

## 4. Tools

### 4.1 Registry: `frontend/lib/tools.ts`

This one list replaces the nine today: R:18 `View`, R:23 `VIEW_ICONS`, R:37 `HOME`, D `components`
(tool part), D `VIEW_TITLES`, D `isMainPanel`, D `HOME_REGION`, K:109 `VIEW_ORDER`, A:47 `VIEW_LABELS`.

```ts
export type Edge = "left" | "right" | "bottom";
export const EDGES: readonly Edge[] = ["left", "right", "bottom"];
export type ToolId = "files" | "changes" | "search" | "review" | "inbox" | "usage" | "ports" | "archive" | "notes";
export type ToolDef = {
  id: ToolId; icon: IconName; key: string; fallback: string;
  scope: "project" | "global";
  edge: Edge;            // default edge
  keepMounted: boolean;  // body stays mounted while hidden (tree state, unsaved text)
};
export const TOOLS: readonly ToolDef[];
export const DOCS = { overview, folders, settings } as const;  // icon + key per document
export type ToolLayout = { v: 1; order: Record<Edge, ToolId[]> };
export const CHORD_ORDER = ["overview","inbox","files","changes","ports","usage","archive","search","notes"] as const;

// pure; unit-tested in frontend/lib/tools.test.mjs
export const isTool: (id: string) => id is ToolId;
export function defaultToolLayout(): ToolLayout;
export function normalizeToolLayout(raw: unknown): ToolLayout; // drops unknown ids and duplicates, appends missing ids to their default edge
export function fromRegions(dockRegions: unknown): ToolLayout;  // one-time migration from prefs.dockRegions
export function edgeOf(layout: ToolLayout, id: ToolId): Edge;
export function moveInLayout(layout: ToolLayout, id: ToolId, to: Edge, index: number): ToolLayout;
export function dropIndex(centres: number[], pointer: number): number;
export function chordOf(id: ToolId | "overview"): string;      // replaces R:52-55 viewChord
```

Rules:
- Every tool id appears exactly once across `order`. A tool's edge is derived from `order`; there is no
  second store.
- The panel id is the tool id, and so is the content component name. Old saved JSON therefore still
  resolves.

### 4.2 The tools and their default edges

| Tool | Icon | Scope | Default edge, position | Chord | keepMounted | Body |
|---|---|---|---|---|---|---|
| files | `files` (new) | project | left 1 | ⌘3 | yes | `components/Files.tsx` on the project root; replaces the `files:<rootId>` panels |
| changes | `changes` | project | left 2 | ⌘4 | no (stops the git status loop) | ChangesDockPanel |
| search | `search` | project | left 3 | ⌘8 | no (query in `toolMemory`) | SearchDockPanel |
| review | `review` | project | left 4 | none, rebindable `toolReview` | no | ReviewDockPanel |
| inbox | `inbox` | global | right 1 | ⌘2 | no | InboxPanel |
| usage | `usage` | global | right 2 | ⌘6 | no | UsagePanel |
| ports | `ports` | global | right 3 | ⌘5 | no | PortsPanel |
| archive | `archive` | global | right 4 | ⌘7 | no | ArchivePanel (moves out of main) |
| notes | `notes` | global | right 5 | ⌘9 | yes (unsaved text) | NotesPanel (moves out of main) |
| — | — | — | bottom: **empty by default** | — | — | open question §14.1 |

- The bottom stripe is always drawn, even when empty. It is a drop target, and he named the bottom as
  a side.
- No new tool is invented for it. Adding one would be work nobody asked for.

### 4.3 Documents (main only, with ×)

- `overview` (the board, ⌘1)
- `settings` (⌘,)
- `folders` (the project overview; reached from ProjectSwitch; open question §14.3)
- `session:*`, `editor:*`, `diff:*`, `preview:*`

### 4.4 Callers that change

| Caller | Now | After |
|---|---|---|
| Limits chip (A:737) | `setFocus` view; a second click closes the tool | `revealTool("usage")`; never hides |
| Session CHANGES button (`Session.tsx`) | `openPanel("changes")` | `revealTool("changes")` |
| GonePanel archive button | `openPanel("archive")` | `revealTool("archive")` |
| ChangesPanel `openFiles` | opens `files:<rootId>` | `revealTool("files")` |
| Palette "Files of X" | opens `files:<rootId>` | pick the project X, then `revealTool("files")` |
| Rail "New shell" | rail row | MENU actions, SessionSwitch footer, palette, ⌘⇧N |

The two new-shell implementations (D `newShell` and A `shell.newShell`) are not merged in this work.

---

## 5. Interaction

### 5.1 `ToolHost`: the only code that knows where tool windows live

New file `frontend/components/dock/toolHost.ts`:

```ts
export interface ToolHost {
  ensure(): void;                                  // edges exist, tools reconciled onto them
  reconcile(layout: ToolLayout): void;             // every tool exactly once, on its edge, in order
  shown(edge: Edge): ToolId | null;                // null when hidden or empty
  show(id: ToolId): void;                          // activate on its edge and make the edge visible
  hide(edge: Edge): void;                          // make the edge invisible; nothing unmounts
  move(id: ToolId, to: Edge, index: number): void;
  size(edge: Edge): number;                        // px of the window, stripe not included
  setSize(edge: Edge, px: number): void;
  onChange(fn: () => void): () => void;            // shown/hidden, active tool, size (debounced by the caller)
  toState(): unknown; fromState(s: unknown): void; // wraps dockview JSON in the edge implementation
}
export function edgeHost(dv: DockviewApi, sizes: Sizes): ToolHost;   // the chosen implementation
```

The edge implementation, `edgeHost`:

- **`ensure`**
  - For each edge where `!dv.getEdgeGroup(e)`:
    ```ts
    dv.addEdgeGroup(e, { id: e, initialSize, minimumSize, maximumSize })
    ```
    - `initialSize` = `dockSizes[e]`, falling back to `--side-w` or `--bottom-h`.
    - `minimumSize` = `--side-min` or `--bottom-min`.
    - `maximumSize` is not set; it is clamped dynamically instead (§5.7).
    - All values are converted with `remToPx`.
  - Then `group.model.header.hidden = true` and `group.api.locked = "no-drop-target"`.
  - Then `setEdgeGroupVisible(e, false)` unless restored JSON says the edge is visible.
- **`reconcile`**
  - A missing tool gets:
    ```ts
    addPanel({ id, component: id, title, position: { referenceGroup: e, index }, inactive: true })
    ```
    (`inactive` is at options.d.ts:759 [read]).
  - A tool on the wrong edge gets `panel.api.moveTo({ group, position: "center", index })`.
  - Any copy of a tool in the grid or in a floating group is removed.
  - It runs after every load, `clear()`, preset apply, reset and sync.
- **`show(id)`** runs in this order:
  1. `dv.exitMaximizedGroup()` if a group is maximized (confirm the name in step 0).
  2. `panel.api.setActive()`.
  3. If `group.api.isCollapsed()`, call `group.api.expand()`. An edge group emptied earlier collapses on
     its own (B:16676-16682) [read], and a collapsed group has min = max = collapsed size (B:14712).
  4. `setEdgeGroupVisible(edge, true)`.
  5. Focus the first focusable element in the body.
- **`hide(edge)`**: `setEdgeGroupVisible(edge, false)`.
- **`size` / `setSize`**: `group.api.width` or `height`, and `group.api.setSize`. A size set on a hidden
  edge is applied when it is shown (`_pendingSizes`, B:15108-15122) [read].
- **`onChange`** subscribes to:
  - each edge group's `api.onDidDimensionsChange` (panelApi.d.ts:18) [read; firing on a shell sash drag
    is unrun]
  - `api.onDidActivePanelChange`
  - plxr's own show/hide calls
  - `onDidLayoutChange` (B:15995) [read] does not report visibility or edge sashes, so it is not enough
    on its own.
  - Fallback if `onDidDimensionsChange` does not fire on a sash drag: a `pointerup` listener on
    `.plxrDock .dv-sash` calls the save.

### 5.2 Operations

These are in `frontend/components/dock/tools.ts` and use only `ToolHost`.

| Function | Used by | Behaviour |
|---|---|---|
| `toggleTool(id)` | stripe icon click | Shown → `hide(edge)`. Otherwise → `show(id)`. |
| `revealTool(id)` | Limits chip, CHANGES button, GonePanel, palette, watermark | `show(id)`; never hides |
| `chordTool(id)` | ⌘2-9, `toolReview` | Hidden → show and focus. Shown but focus elsewhere → focus. Shown and focused → hide (JetBrains). |
| `toggleEdge(edge)` | ⌘B, ⌥⌘B, ⌘J, EdgeToggles | Visible → hide. Hidden with tools → show the edge group's `activePanel` (the last one shown), else `order[edge][0]`. Empty edge → the stripe gets `data-flash="yes"` for 600 ms and nothing else changes. |
| `hideFocusedTool()` | ⇧⎋, ⌘W, ToolWindow hide button | Hides the edge whose `.toolWindow` contains `document.activeElement` |
| `moveTool(id, to, index)` | drag, ⋮ Move to, icon right-click | See §5.5 |

**Tools never enter:**
- the back/forward history (D `history`)
- the reopen list (D `remember`)
- the close guard (D `requestClose`). Called on a tool id, `requestClose` hides the tool instead.

**Lit icon.** `data-lit="yes"` is set exactly when `host.shown(edge) === id`. It is recomputed on
`onChange` and read once on mount, because `fromJSON` sets visibility without firing an event.

**Code that counts panels or groups filters by `api.location.type === "grid"`** (edge panels and
groups now appear in `dv.panels` and `dv.groups`; step 0 confirms this). The places:
- `settle`: "empty dock" means no grid panels
- `hold` and its reassert on group add and remove (grid groups only; the side and bottom pinning is
  deleted)
- groupPrev/Next
- the debounced layout saver's "main" size logic

### 5.3 Hidden tools stop working

- `ToolWindow` renders its body only while `lit || def.keepMounted`. Hidden Changes, Usage, Ports,
  Inbox and Archive therefore unmount and stop polling. dockview-react keeps the panel's portal mounted
  [read], so the gate is plxr's own.
- **`frontend/lib/toolMemory.ts`** is a module-level `Map` for the window's lifetime, not persisted:
  ```ts
  export function useToolMemory<T>(key: string, initial: T): [T, (v: T) => void];
  ```
  It holds:
  - Search's `text`, `glob` and `regex`
  - Archive's search field
  - Files' `at`, `expanded` and `filter`, keyed `files:${rootId}`
  - the `scrollTop` of `.toolBody` per tool, written on hide and restored after mount

### 5.4 The tool window header

`components/stripes/ToolWindow.tsx` wraps every tool component in the `components` map:
`files: tool("files", FilesTool)`, and so on.

```
[icon] Title  scope                                   [tool actions…] [⋮] [—]
       Files  alpha · main · following session beta
```

- **Height** is `var(--toolhead-h)`.
- **Title:** `tr(def.key, def.fallback)`.
- **Scope (`.toolScope`):**
  - project tools show the project label, branch and a follow note; the tooltip holds the full path
  - global tools show a count, e.g. Inbox "3 waiting"
- **Actions slot:** `useToolActions()` (context plus portal). The first cut has none; §13 step 12 fills it.
- **⋮** (`data-do="tool-more"`, icon `more`) opens a window `Menu`:
  - a "Move to" heading with rows Left / Right / Bottom, the current edge `checked`
  - a separator
  - "Hide", with its chord hint
  - "Reset tool positions"
- **—** (`data-do="tool-hide"`, icon `hide`) hides the edge. Its tooltip is "Hide ⌘B" (the edge chord).
- **Not in the header:** ×, maximize, double-click action, tab strip. `PanelTab` also gets an
  `isTool(id)` guard (no close button, no middle-click close) in case an old layout shows a tool tab
  before `reconcile` runs.
- **Focus mark.** `data-focus="yes|no"` on `.toolWindow`, set from `focusin`/`focusout`. Skins use it
  for the active title bar.
- **Inline strip.** A view's `TopStrip` renders as `.toolBar` directly under the header. `ToolWindow`
  provides a `ToolStrip` context that `TopStrip.tsx` checks before `InlineStrip`. The prompt labels
  "usage>", "search>" and so on are dropped (P5).
- **A project tool with no project** shows an `.emptyNote` with one button, "Choose a project", which
  opens ProjectSwitch.

### 5.5 Moving an icon to another edge

There are three visible routes, and all of them end in `moveTool`:
1. drag the icon onto a stripe
2. ⋮ → Move to
3. right-click the icon: Open or Hide (with its chord), Move to Left / Right / Bottom (current one
   ticked), Reset tool positions

**Pointer drag** (`Stripes.tsx`). Each `.stripeIcon` is a `Button bare` with `touch-action: none`.
1. **`pointerdown`** (button 0): remember `{tool, pointerId, x0, y0}`. Nothing else happens yet.
2. **`pointermove`** (window listener while armed): once the pointer has moved more than
   `remToPx("0.25rem")`:
   - `setPointerCapture`
   - `document.body.dataset.draggingTool = "yes"`
   - render `StripeGhost` with `transform: translate(x, y)` (a computed style, allowed by style.py rule 2)
3. **Target on every move:**
   - the `.stripe[data-edge]` under `document.elementsFromPoint`
   - otherwise the stripe whose outer dock edge is within `2 × --stripe-w` of the pointer
   - index = `dropIndex(centres of the other icons along the stripe axis, pointer coordinate)`
   - the target stripe gets `data-drop="yes"` and renders a `.stripeGap` at that index, so the icons
     shift as live feedback
4. **`pointerup`:**
   - dragging with a target → `moveTool(id, edge, index)`
   - dragging without a target → nothing
   - a `dragged` ref swallows the click that follows
   - no movement → the click runs `toggleTool`
5. **`pointercancel`, `lostpointercapture` or Escape** cancel the drag and remove every listener.

Tool icons are not dockview tabs, so dockview's drag and drop never sees them. `dndStrategy` stays at
its default, and main's tab dragging is unchanged.

**`moveTool(id, to, index)`:**
1. `layout = moveInLayout(layout, id, to, index)`, then `api.setPrefs({ toolLayout: layout })`.
2. `wasLit = host.shown(from) === id`.
3. `host.move(id, to, index)`.
4. If `wasLit`: `hide(from)`, then `show(id)` on the new edge. This replaces whatever was showing there,
   and that icon goes dark. A tool that was not showing stays hidden.
5. Reordering within one stripe goes through the same path.

**Two windows.** Dock listens to `PREFS_CHANGED` (`lib/prefsEvents.ts`, announced by the sync loop at
A:224-262). When `detail.toolLayout` differs from the local layout (compared as JSON, not trusting its
own echo) and no drag is running, it adopts the new layout and calls `host.reconcile`. A tool that is
lit here keeps showing, on its new edge. Which tools are open stays per window.

### 5.6 Main stays freely splittable

- **Only documents live in the grid.** These all stay: split right and down, float, dock, maximize,
  PanelTab with ×, the close guard, ⌘W, ⇧⌘T, and the recent "a file opens beside the tree it was
  clicked in" (`holdsOnlyDocuments`, `shareWidth`).
- **`placeDocument(dv, source?)`** replaces every call to `addPanel` without a position. Without a
  position, `addPanel` uses `activeGroup` (B:~17400) [read], which is an edge group whenever a tool was
  clicked last.
  - source is a grid group → today's `place` rule (beside it when it holds non-documents, else tabbed)
  - source is a tool, or no source → `referenceGroup` = `lastDocuments` (D:1203) if it still exists,
    else the last active grid group (`onDidActiveGroupChange` filtered to grid), else any grid group
  - no grid group at all → `{ direction: "right" }` on the empty grid [unrun, step 0]
  - used by `openOrFocus`, `openEditor`, `openDiff`, `openPreview`, `newShell`, `reopen` and `dockPanel`
- **Drops:**
  - `dndEdges={false}`: a document cannot be dropped at the grid's outer edge.
  - The edge groups are locked `'no-drop-target'`.
  - Belt and braces: `api.onWillShowOverlay` and `api.onWillDrop` call `preventDefault()` when the
    target group's `api.location.type === "edge"` (DockviewEvent, events.d.ts:15-19) [read].
- **PanelTab menu:** Close · Close others in group · Close group | Float/Dock | Split to the right ·
  Split downwards | Maximize/Restore | Copy title. The "Move to" rows, `REGIONS` and `REGION_TITLES` go.
- **Empty main.** `watermarkComponent={MainWatermark}` (dockview-react dockview.d.ts:11) [read] shows
  three buttons: Board ⌘1, New session ⌘N, Commands ⌘K. There is no `home` panel.
- **Main floor.** On window resize and on edge size changes: when the grid is narrower than
  `--main-min`, shrink the widest visible side with `setSize`. No side may exceed 45% of the dock width,
  enforced the same way [unrun: the shell's own clamping is measured in step 0].

**Deleted from Dock.tsx:**
- `clearTools`, the `openView` toggle, `toggleRegion` and `folded`
- `regionOf`, `readRegions`, `regionOfGroup`, `groupOfRegion`
- the tool branches of `place` and `sizedFor`
- the side and bottom pinning in `hold`, and `note` for the sides
- `addSplit`, `openFresh` for tools, `moveToRegion`
- `isMainPanel`, `HOME_REGION`, `RailPanel`
- every `"rail"` special case

### 5.7 Keyboard (`lib/keymap.ts`)

The action ids stay, so rebinds saved in `prefs.keymap` still work. Only meanings and texts change.

| Action | Chord | Now | After |
|---|---|---|---|
| view1 | ⌘1 | Overview | Board document: open or focus, never hides |
| view2 | ⌘2 | Inbox | `chordTool("inbox")` on whatever edge it sits |
| view3 | ⌘3 | Folders | `chordTool("files")`. **The meaning changes;** the project overview moves to ProjectSwitch. |
| view4-9 | ⌘4-9 | Changes, Ports, Usage, Archive, Search, Notes | `chordTool` of the same tool |
| toolReview (new) | none | not reachable | `chordTool("review")`; "?" lists it without a key |
| toggleLeft / toggleRight / toggleBottom | ⌘B / ⌥⌘B / ⌘J | close and reopen panels | `toggleEdge`; text "Show or hide the left/right/bottom tool window" |
| hideTool (new) | ⇧⎋ | none | `hideFocusedTool()`; consumed only when focus is inside `.toolWindow`, so a terminal keeps the key |
| sessionSwitch (new) | ⌘E | none | opens SessionSwitch; skipped inside INPUT or TEXTAREA, as the dock handler does today |
| closePanel | ⌘W | close guard | document: guard as today; focus in a tool: `hideFocusedTool()`, and the icon stays |
| reopenPanel | ⇧⌘T | any panel | documents only |
| historyBack / historyForward | ⌃- / ⌃_ | every panel | documents only |
| groupPrev / groupNext | ⌥⌘↑ / ↓ | all groups | grid groups only |
| panelPrev / panelNext | ⌥⌘← / → | | unchanged in main |

- `VIEW_ORDER` becomes `CHORD_ORDER` from tools.ts.
- Stripe tooltips read "Files ⌘3", generated from the live binding with `chordOf`.
- **MENU:** the Views group (A:497-503) splits into "Tool windows" (every tool, `checked` when lit,
  with its chord) and "Documents" (Board ⌘1, Project overview, Settings ⌘,).
- **Palette:** "Show {tool}", "Open board", "Open project overview", "Switch project…",
  "Switch session…" ⌘E, "Reset tool positions".

---

## 6. Top bar: project and sessions

### 6.1 Project model (`frontend/lib/project.ts`)

```ts
export type Project = { path: string; sessionId: string };   // sessionId "" when picked as a folder
export const rootIdOf = (p: Project) => p.sessionId || (p.path ? `dir:${p.path}` : "");  // "dir:" per internal/core/core.go
export const projectLabel = (p: Project) => p.path.split("/").filter(Boolean).pop() ?? "";
```

**App owns `project`.** Two things change it, and the later one wins:
- picking in ProjectSwitch → `goHere(path)`, then `project = {path, sessionId: ""}`
- a session panel coming to the front → `project = {path: tile.cwd, sessionId: id}`. Dock reports this
  through a new prop, `onSessionFront(id)`, fired where it sets `lastActiveSessionId` today.

Where it is read:
- Project tools (Files, Changes, Review, Search) read `d.project`. Today's `gone` restore tolerance
  stays. Files re-roots without remounting (`Files.tsx:219-223`).
- `newShell` and `searchFiles` use `project`.
- The board filter keeps using `here`, the picked folder only, so the board does not jump when a
  session is clicked.
- `plxr.here` stays in localStorage, per window.

**Behaviour change.** Today the last active session always beats the path field. From now on a
switcher pick wins until the next session comes to the front. Without that, the switcher would be
ignored by the very tools it names. Confirm with him (§14.4).

### 6.2 ProjectSwitch (`.switch[data-switch="project"]`)

- **Button:** folder icon, `.switchLabel` (project label or "No project"), branch, chevron-down.
- **Popover** (window `Menu`, extended with an input row):
  1. "All projects" (clears `here`; replaces today's ✕ at A:696)
  2. Recent: `api.workspaces()` sorted by `used_at`, merged with the distinct folders of running
     sessions. The current one is ticked. Each row has the name, the path dimmed, and its session count
     as the hint.
  3. Right-click on a row: COPY PATH, Remove folder (the menu surfaces.mjs checks today on folder tabs)
  4. A `PathField` row, "Open folder…", with completion; Enter calls `goHere`
  5. "Project overview" → the `folders` document
- **No rows before the answer arrives** (emptylies.py).

### 6.3 SessionSwitch (`.switch[data-switch="session"]`)

- **Button:** status dot `.dot ${stateOf(t)}`, `.switchLabel` (`titleOf` the front session, else the
  last one, else "Sessions"), and `.switchBadge` with the number of sessions waiting for an answer
  (`data-waiting="yes"` when it is above zero).
- **Popover:**
  - sessions grouped under one header row per project, the current project first
  - rows `{icon:"terminal", sub: railLine(t), status: stateOf(t)}`
  - click → `openSession`
  - right-click → `sessionMenu` (Open / Pause·Resume / Terminate / COPY PATH, or Restart / Remove from
    the board)
  - separator, then "All sessions (board)" ⌘1 · "New session…" ⌘N · "New shell here" ⌘⇧N
- **Right-click on the button** opens `sessionMenu` for the front session.
- **Code moves:**
  - `Menu.tsx`: `MenuItem` gains `icon?: IconName; sub?: string; status?: string`, with the classes
    `.menuIcon` and `.menuSub`.
  - `frontend/lib/sessionMenu.ts`: `railMenu` moves here from R:88-121 and is shared by the overview
    tile and the switcher.

### 6.4 EdgeToggles (`.edgeToggles`)

- Three icon buttons: `data-do="toggle-left"`, `toggle-bottom` and `toggle-right`.
- Icons: `panel-left`, `panel-bottom`, `panel-right`.
- `aria-pressed` follows the edge's visibility; the tooltip carries the chord.
- On an empty edge the button stays enabled and triggers the stripe flash.

---

## 7. Persistence and migration

### 7.1 Keys

| Key | Status | Content | Written | Read |
|---|---|---|---|---|
| `dock` | kept | dockview `toJSON()`, now including `edgeGroups: {left,right,bottom: {size, visible, group:{views, activeView}}}` | debounced saver (400 ms), fed by `onDidLayoutChange` **and** `host.onChange` | load pipeline §7.2 |
| `toolLayout` | **new** | `{v:1, order:{left:ToolId[], right:ToolId[], bottom:ToolId[]}}`: his placement and order. It beats `dock` and presets. | `moveTool`; Reset writes `null` | load, reconcile, `PREFS_CHANGED` |
| `dockSizes` | kept, same shape | `{left,right,bottom}` px of the window, stripe excluded | `host.onChange` while the edge is visible | `ensure`, reset, activity layouts |
| `dockActivity` | kept | focus / code / review / monitor | unchanged | unchanged |
| `dockPresets` | kept, `dvMajor` unchanged | items gain optional `tools?: ToolLayout` | preset save (A:391) | preset apply |
| `dockRegions` | **retired** | kind → region | sent once as `null` (the daemon deletes null keys, `internal/daemon/prefs.go:65-88`) | `fromRegions`, only when `toolLayout` is absent |
| localStorage `plxr.here` | kept | picked project path | `goHere` | App init |

Not persisted: `toolMemory`, drag state, `project.sessionId`, and, as today, history, the closed list
and `currentPreset`.

### 7.2 Load pipeline

It runs in Dock `onReady`, in `applyLayout` and after `rebuild`'s `clear()`.

1. **`readToolLayout(prefs)`**
   - a valid `toolLayout` → `normalizeToolLayout`
   - otherwise → `fromRegions(prefs.dockRegions)`, then `setPrefs({toolLayout, dockRegions: null})` once
   - `fromRegions` puts a tool whose region was left, right or bottom on that edge; `main` or a missing
     entry goes to the default edge; prefix kinds (`editor:`, `session:`) are ignored
2. **`{ layout, openTools } = migrateLayout(prefs.dock)`**
3. **`try dv.fromJSON(layout)`**; on throw, `dv.clear()` and rebuild the activity layout
4. **`host.ensure()`**, which creates any missing edges. `clear()` keeps existing edges (research §5).
5. **`host.reconcile(layout)`**
6. **Show `openTools`**, at most one per edge, the last one winning
7. **Apply `dockSizes`** to edges that the JSON did not size
8. **`settle`:** if the grid holds no documents, open the board
9. **Save**

### 7.3 `frontend/lib/layoutMigrate.ts`

A pure function, JSON in and JSON out, idempotent on a layout that is already in the new shape. It
is unit-tested in `frontend/lib/layoutMigrate.test.mjs`.

1. Drop the panel `rail` (what `stripRail` does today; `stripRail` itself is deleted).
2. Remove every tool id and every `files:*` panel from grid leaves, `floatingGroups`, `popoutGroups`
   and `panels`. A removed tool or `files:*` that was a leaf's `activeView` goes into `openTools`, the
   latter as `files`.
3. Remove empty leaves and collapse single-child branches. dockview re-proportions the sibling sizes
   [unrun]. If `fromJSON` throws anyway, step 3 of the pipeline falls back.
4. In `edgeGroups`: move views that are not tools into the first grid leaf.

What becomes of old placements:
- An editor or session he had moved "left" stays in its grid column, as a document column.
- A `files:<rootId>` tree is dropped. Its folder stays an open workspace and appears in ProjectSwitch.
- **Presets:** a preset item with `tools` sets `toolLayout` before step 5, and the change is persisted.
  An old preset is repaired each time it is applied and never rewritten silently.

### 7.4 Activity layouts (replacing D:1297-1317)

"Show X" always goes through the tool's current edge, so his placement wins.

| Activity | Main | Tools shown |
|---|---|---|
| focus | board | none |
| code | board | files |
| review | board | changes |
| monitor | board | inbox, plus usage if usage sits on another edge |

Saving a preset stores `tools: toolLayout`.

---

## 8. CSS

### 8.1 `frontend/app/styles/layout.css` (sizes only)

**Remove:**
- the rail block (L:266-297)
- `.dockShell` / `.railHost` (L:1013-1018)
- `--rail-w` (L:22)
- `--row-h` (L:27) and `--group-h` (L:29), once grep shows nothing else uses them

**Keep:** `--side-w`, `--side-min`, `--bottom-h`, `--bottom-min`, `--main-min`. They now size the edge
windows.

**Add:**

```css
:root {
  --stripe-w: 2.5rem;          /* left/right stripe width and bottom stripe height */
  --stripe-pad: 0.25rem;
  --stripe-icon-box: 2rem;     /* holds the pixel pack's 24px icon on whole pixels */
  --stripe-gap: 0.25rem;
  --stripe-mark-w: 0.125rem;   /* lit bar on the outer edge */
  --badge-h: 0.875rem;
  --toolhead-h: 2.25rem;
  --switch-max-w: 16rem;
}
.dockShell { display: grid; grid-template-columns: var(--stripe-w) minmax(0, 1fr) var(--stripe-w);
  grid-template-rows: minmax(0, 1fr) var(--stripe-w); width: 100%; height: 100%; min-height: 0; }
.plxrDock { grid-column: 2; grid-row: 1; min-width: 0; min-height: 0; position: relative; }
.stripe { display: flex; align-items: center; gap: var(--stripe-gap); padding: var(--stripe-pad); min-width: 0; min-height: 0; overflow: hidden; }
.stripe[data-edge="left"]   { grid-column: 1; grid-row: 1; flex-direction: column; }
.stripe[data-edge="right"]  { grid-column: 3; grid-row: 1; flex-direction: column; }
.stripe[data-edge="bottom"] { grid-column: 1 / 4; grid-row: 2; flex-direction: row; }
.stripeIcon { position: relative; flex: 0 0 auto; width: var(--stripe-icon-box); height: var(--stripe-icon-box);
  display: flex; align-items: center; justify-content: center; touch-action: none; }
.stripeIcon::before { content: ""; position: absolute; pointer-events: none; }
.stripe[data-edge="left"]   .stripeIcon::before { left: calc(var(--stripe-pad) * -1); top: 0; bottom: 0; width: var(--stripe-mark-w); }
.stripe[data-edge="right"]  .stripeIcon::before { right: calc(var(--stripe-pad) * -1); top: 0; bottom: 0; width: var(--stripe-mark-w); }
.stripe[data-edge="bottom"] .stripeIcon::before { bottom: calc(var(--stripe-pad) * -1); left: 0; right: 0; height: var(--stripe-mark-w); }
.stripeBadge { position: absolute; top: 0; right: 0; min-width: var(--badge-h); height: var(--badge-h); padding: 0 0.1875rem; line-height: var(--badge-h); text-align: center; }
.stripeGap { flex: 0 0 auto; width: var(--stripe-icon-box); height: var(--stripe-icon-box); }
.stripeGhost { position: fixed; left: 0; top: 0; z-index: 420; width: var(--stripe-icon-box); height: var(--stripe-icon-box);
  display: flex; align-items: center; justify-content: center; pointer-events: none; }
.toolWindow { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.toolHead { flex: 0 0 var(--toolhead-h); display: flex; align-items: center; gap: 0.375rem; padding: 0 0.25rem 0 0.625rem; min-width: 0; }
.toolIcon, .menuIcon { flex: 0 0 auto; width: max(1.15em, var(--icon-box), var(--icon-slot)); display: flex; justify-content: center; }
.toolTitle, .toolScope, .switchLabel { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.toolActions { margin-left: auto; display: flex; gap: 0.125rem; }
.toolBar { flex: 0 0 var(--strip-h); }
.toolBody { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
.toolBody > * { flex: 1 1 auto; min-height: 0; }
.switch { display: inline-flex; align-items: center; gap: 0.375rem; max-width: var(--switch-max-w); min-width: 0; height: 1.875rem; padding: 0 0.5rem; }
.switchRow { display: flex; align-items: center; gap: 0.5rem; }
.edgeToggles { display: inline-flex; gap: 0.125rem; }
```

- **No `writing-mode` and no logical properties.** The stripes are plain flex boxes, so skinrules.py's
  physical-property `SIZING` list is enough, and no change to skinrules.py is needed.
- **Pixel pack:** `(--stripe-icon-box − icon) / 2` has to be a whole number of device pixels at 1x and
  2x. icons.mjs measures this.
- **classes.py `LAYOUT_ONLY`:**
  - add `toolBody`, `toolActions`, `stripeGap`, but only if no skin dresses them
  - remove `rtext` and `rname` once nothing renders them

### 8.2 `skin-base.css` (dressing with tokens)

**Remove:** S:114-144, S:322-324 (`.railhot`) and S:1090-1093 (`.railHost`).

**Add:**

```css
.stripe { background: var(--panel); }
.stripe[data-edge="left"] { border-right: var(--hair) solid var(--line); }
.stripe[data-edge="right"] { border-left: var(--hair) solid var(--line); }
.stripe[data-edge="bottom"] { border-top: var(--hair) solid var(--line); }
.stripe[data-drop="yes"] { background: color-mix(in srgb, var(--accent) 10%, var(--panel)); }
.stripe[data-flash="yes"] { background: color-mix(in srgb, var(--blocked) 12%, var(--panel)); }
.stripeIcon { color: var(--dim); background: none; border: 0; border-radius: .375rem; cursor: pointer; }
.stripeIcon:hover { color: var(--fg); background: color-mix(in srgb, var(--fg) 8%, transparent); }
.stripeIcon[data-lit="yes"] { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.stripeIcon[data-lit="yes"]::before { background: var(--accent); }
.stripeIcon[data-nearly-out="yes"] { color: var(--blocked); }
.stripeIcon:focus-visible { outline: var(--hair) solid var(--accent); }
.stripeBadge { background: var(--accent); color: var(--bg); border-radius: 999px; font-size: .625rem; }
.stripeIcon[data-nearly-out="yes"] .stripeBadge { background: var(--blocked); }
.stripeGap { border: var(--hair) dashed var(--accent); border-radius: .375rem; }
.stripeGhost { color: var(--accent); background: var(--surface); border-radius: .375rem; box-shadow: 0 .5rem 1.5rem var(--shadow); }
body[data-dragging-tool="yes"] { cursor: grabbing; }
.toolWindow { background: var(--panel); color: var(--fg); }
.toolHead { border-bottom: var(--hair) solid var(--line); }
.toolIcon, .toolScope, .menuIcon, .menuSub { color: var(--dim); }
.toolTitle { font-weight: 600; text-transform: uppercase; letter-spacing: .1em; }
.toolWindow[data-focus="yes"] .toolIcon { color: var(--accent); }
.switch { color: var(--fg); background: none; border: var(--hair) solid transparent; border-radius: .375rem; font: inherit; cursor: pointer; }
.switch:hover { border-color: var(--line); background: color-mix(in srgb, var(--fg) 6%, transparent); }
.switchBadge { background: var(--waiting); color: var(--bg); border-radius: 999px; font-size: .7em; }
.menuSub { display: block; font-size: .8em; }
```

If style.py rejects `font-size` somewhere, it moves to wherever style.py allows it. `font-size` is not
a frame size, so it is not a layout.css matter.

### 8.3 The four skins (dressing only; he reviews screenshots, step 13)

| Skin | Remove | Stripe | Icon: idle / hover / lit | Tool header | Badge |
|---|---|---|---|---|---|
| crt | `skin-crt.css` rail rules at :36, :55, :88, :115 | joins the glass selector list with `.bar`/`.statusrow` (`--panel-glass`, backdrop blur, inset highlight) | dim / fg / accent with `filter: drop-shadow(0 0 .25rem var(--accent))` | glass; phosphor spaced capitals | accent with glow |
| win95 | `:140-165`, `:355` | raised toolbar on `--panel-glass` with bevel `--hi`/`--sh` | flat / raised bevel / **pressed in** (inset `--sh`/`--hi`), `::before` transparent | `[data-focus="yes"]`: navy `--accent` title bar with bold `--onAccent`; otherwise grey. ⋮ and — as bevelled caption buttons | square `--blocked` |
| sketch | `:135-160`, `:442` | paper, drawn inner border in `--ink` | ink dim / paper wash / marker highlight `color-mix(accent 25%)` with an irregular radius | ink underline, handwriting, no uppercase | circled accent ink |
| pixel | `:124-150`, `:329` | `--bg-glass`, `var(--px)` hard edges, no radius, no blur | dim / `--panel` / inverted tile (accent ground, `--bg` icon) | `var(--px)` rule underneath | square block |

Every new class and attribute value is dressed at least in skin-base (classes.py: "shared layer or
every skin") [read, classes.py:205-220].

---

## 9. Icons

Change `tools/icons/build.py` and regenerate `frontend/lib/icons.ts` and `frontend/public/icons/*.svg`.
Never hand-edit the generated files.

| Name | Used by | Candidates (tabler · phosphor · lucide · pixel), **unverified at the pinned commits** |
|---|---|---|
| `files` | Files tool | list-tree · tree-structure · folder-tree · `plxr:files` |
| `more` | ⋮ | dots-vertical · dots-three-vertical · ellipsis-vertical · more-vertical |
| `hide` | — button | minus · minus · minus · minus |
| `panel-left` | EdgeToggles | layout-sidebar · sidebar-simple · panel-left · `plxr:panel-left` |
| `panel-right` | EdgeToggles | layout-sidebar-right · `plxr:panel-right` · panel-right · `plxr:panel-right` |
| `panel-bottom` | EdgeToggles | layout-bottombar · `plxr:panel-bottom` · panel-bottom · `plxr:panel-bottom` |

He sees the 6 shapes in all 4 packs before the commit. Icon shapes are his call.

---

## 10. Attributes and texts

- **attributes.py.** Every attribute below needs both a setter and CSS:

  | Attribute | Values |
  |---|---|
  | `data-edge` | left, right, bottom |
  | `data-tool` | tool ids |
  | `data-lit` | yes, no |
  | `data-drop` | yes |
  | `data-flash` | yes |
  | `data-focus` | yes, no |
  | `data-switch` | project, session |
  | `data-waiting` | yes |
  | `data-nearly-out` | yes (already exists; moves from the rail to the stripe icon) |
  | `body[data-dragging-tool]` | yes |

  `aria-pressed` and `aria-label` (title plus count or nearly-out text) are set for accessibility; CSS
  styles the `data-` attributes.
- **translations.py.**
  - New keys: `tool.*` (9), `doc.*`, `edge.left/right/bottom`, `tool.more`, `tool.hide`, `tool.moveTo`,
    `tool.reset`, `tool.chooseProject`, `switch.*`, `watermark.*`, `keys.hideTool`,
    `keys.sessionSwitch`, `keys.toolReview`.
  - Changed: `keys.view3`, `keys.toggleLeft/Right/Bottom`.
  - Removed after their last use: `rail.*` (15), `region.*` (4), `tab.moveTo`, `rail.menuNewGroup`.
  - German only in `assets/i18n/de.json`. He reads the German texts (§14.5).

---

## 11. Gates

### 11.1 First: `gatekit.mjs` (repo root)

This is page-side helper source that every browser gate splices into its `run()` strings:
- `appUp()`
- `openTool(id)`
- `toolLit(id)`
- `stripeIcon(id)`
- `openSession(name)`
- `sessionRows()`
- `openDoc(id)`
- `pickProject(path)`

In step 1 the helpers drive today's rail. Later steps only change what is inside them. That keeps the
13 gate files from being rewritten more than once.

`appUp()` replaces the `.railhome` ready check in all 12 gates (tabs, clicked, surfaces, accounts,
changes, editor, folders, manage, icons, usage, together, focus). After step 9 it waits for
`.stripeIcon` count === 9.

### 11.2 New unit gates (check.sh, `node --experimental-strip-types`)

**"tool layout"**: `frontend/lib/tools.test.mjs` proves:
- the default layout holds every tool exactly once
- `normalizeToolLayout` drops unknown ids and duplicates and appends missing ids to their default edge
- `fromRegions({inbox:"bottom","editor:":"left",folders:"main",usage:"main"})` puts inbox on the
  bottom, leaves usage on the right, and ignores the other two
- `moveInLayout` handles the first index, the last index and a same-edge reorder
- `dropIndex` works before the first icon, after the last one and between two

**"layout migration"**: `frontend/lib/layoutMigrate.test.mjs` proves, on four recorded old layouts
(tools tabbed in main; `files:x` active on the left; usage split under inbox; an editor in the left
group), that:
- no tool and no `files:*` panel remains in the grid, floating groups or popout groups
- `openTools` names the tools that were in front
- the editor survives
- the output passes through `migrateLayout` unchanged (idempotence)

### 11.3 New browser gate: `stripes.mjs` (check.sh step "tool stripes", own daemon like tabs.mjs)

Every claim below is measured.

1. **The stripes stand at the frame.**
   - left x = dock shell x, width = `--stripe-w` ±1
   - right flush with the shell's right edge, same width
   - bottom height = `--stripe-w` ±1, spanning the full shell width
   - `.plxrDock` sits inside all three
   - no `.stripeIcon` is inside `.plxrDock`
2. **Every tool appears exactly once** as `.stripeIcon[data-tool]`, in the default order, and wears its
   registry icon (the `use` href ends in `#<icon>`). No `.dv-tab` inside `.plxrDock` is named after a
   tool.
3. **Clicking an unlit icon (Files):**
   - `data-lit="yes"` and `aria-pressed="true"`
   - `.toolWindow[data-tool=files]` is visible with its left edge at the left stripe's right edge ±1
   - the grid's left edge moves right by the window's width ±2
   - the right and bottom boxes do not change (±1)
4. **Clicking the lit icon:** the window is gone, the icon is still on its stripe and dark, and the grid
   box is back to its start ±1.
5. **Swap:** Files lit, then clicking Changes → the same window box ±1, Files dark, no extra column.
6. **Width memory:**
   - drag the left edge sash with CDP `Input.dispatchMouseEvent` to 400 px
   - hide and show → 400 ±1
   - showing bottom meanwhile → left still 400 ±1
   - reload → 400 ±1 and still lit
7. **Hiding alone is saved:** hide with no other change, reload → still hidden. This catches a missing
   save trigger.
8. **Chords:** ⌘B, ⌥⌘B and ⌘J each toggle their edge. The stripes keep their thickness and main
   absorbs the difference. With an empty bottom, ⌘J changes no box and sets `data-flash`.
9. **EdgeToggles** do the same as claim 8, and their `aria-pressed` follows after a stripe click and
   after ⌘B.
10. **No ×:** no `.panelTabClose` anywhere in an edge group; middle-click in a tool window closes
    nothing; ⌘W with focus in a tool hides it and the icon stays; ⇧⌘T does not bring it back; ⇧⎋ in a
    tool hides it.
11. **Header:** it reads the tool's title; `tool-hide` hides; ⋮ reads exactly Move to (Left, Right,
    Bottom, current ticked), Hide with its chord, Reset tool positions.
12. **Drag:**
    - press on Inbox, move to the bottom stripe at index 0, release → `.stripe[data-edge=bottom]`'s
      first icon is inbox
    - clicking it opens its window between the side windows, above the bottom stripe
    - releasing outside any stripe changes nothing
    - Escape mid-drag changes nothing
    - press and release without movement toggles
13. **Persistence:** after claim 12, reload → inbox is still first on the bottom,
    `prefs.toolLayout.order.bottom[0] === "inbox"`, there is no `dockRegions` key, and it survives
    Reset layout. Reset tool positions puts it back on the right.
14. **⋮ → Bottom and the icon context menu** move a tool the same way as the drag.
15. **Chords follow the icon:** after the move, ⌘2 opens inbox at the bottom; ⌘2 again with focus inside
    it hides it; with focus elsewhere it focuses it.
16. **Documents cannot enter tools:** dragging an editor tab onto a tool window's centre, onto its edges
    and onto the grid's outer edge leaves every edge group holding only tools, and the editor stays in
    main.
17. **Documents open in main:** click a file in the Files tool → the editor opens as a tab of the last
    main group, never inside the left edge group; the Files window keeps its width.
18. **Main split is untouched by tools:** split a session right and an editor down; toggling left, right
    and bottom in all 6 orders leaves the two splits' proportions within ±2 px of each other.
19. **Hidden tools are idle:** with every edge hidden for 5 s, CDP `Network` shows no usage, ports or
    git-status requests from this window. With Changes lit, they appear.
20. **Empty main:** close every document → the watermark shows three buttons and each opens what it
    names.
21. **Migration fixture:** seed an old `dock` (tools tabbed with an editor on the left, usage split under
    inbox, `files:<id>`, `rail`), `dockRegions {inbox:"bottom"}` and a preset containing tools, then
    reload.
    - no tool in the grid
    - inbox on the bottom stripe
    - the editor in main
    - no `files:` panel
    - `dockRegions` gone
    - applying the preset creates no duplicate
22. **Two windows:** an icon moved in window A shows on window B's stripe within 3 s.
23. **Project tools follow the project:** pick folder B in ProjectSwitch → Changes, Files and Search show
    B and `.toolScope` reads B; click into session A → they show A.
24. **Tool memory:** expand a folder in Files, ⌘B twice → still expanded; type a query in Search, hide
    and show → the query is still there.

### 11.4 Existing gates

| Gate | Change |
|---|---|
| geometry.mjs | Remove the `BOXES` rail, railHome, railGroup and railSession. Add stripeLeft, stripeRight, stripeBottom, stripeIcon, toolHead (opens Files first), switchProject, switchSession. **Fail when an expected box is missing in any skin** (the silent drop at L262). |
| tabs.mjs | Documents only. **Moved to stripes.mjs:** rail frame L434-444, drive L483-521, twice L546-551, regions L591-631, Move to L663-694, folding L769-775, old layout L1132. **Dropped:** L887-901 (editor in a side region). **Rewritten:** L600 new 8-row tab menu; L713-723 float/dock on Settings, dock returns to main; L820 rejoin by drag instead of `pick('Main')`; L834 setup through `openDoc`; L936 counts main tabs; L975-983, L1064, L1093 through `openSession`; L993 ⌘W on a clean document (Settings) closes without asking; L1007-1008 × and middle-click on Settings; L1043 walks two main groups made by a split. `railBox`, `declaredRail`, `clickMenu`, `pick('Main'…)` go. |
| clicked.mjs | L246/L345/L539 through `openDoc("overview")`. L272 "the session switcher lists the same sessions as the daemon". L292 loop (Inbox, Ports, Usage, Archive) through `openTool`, plus "opens against its stripe". L682 "a folder picked in the project switcher is what the Files tool shows". L781 at least 3 visible surfaces (Changes left, Usage right, board in main). Reset claim: documents plus lit tools per activity. L804 is stripes claim 1 in short form. L824/L847/L883 through gatekit. |
| surfaces.mjs | L255 MENU "Tool windows" rows with chord hints. L319/L379 through `openSession`. L390 right-click on a SessionSwitch row offers Open/Pause/Terminate/COPY PATH, **plus** right-click on a stripe icon offers Open, Move to (current ticked), Reset tool positions. L425 through a ProjectSwitch row. L467 main group x ≥ the right edge of the left stripe or the lit left window. L494 unchanged. L559 expects "⌘3 Files" and "⌘7 Archive" and no "Folders" row. L570 "⌘6 lights Usage and shows its window, whichever edge it sits on". L613: move usage to the bottom, save a preset, reset, apply → usage on the bottom stripe and lit. L637 through the Files tool. |
| usage.mjs | L348 through `openTool("usage")`. L423 "the Usage stripe icon carries `data-nearly-out="yes"`, its badge shows, and its tooltip names the account". |
| accounts.mjs | L557 through `openSession`. L574-582 through `openTool("usage")`; the detail prints `.stripeIcon[data-tool]`. L512 wording "in main". |
| changes.mjs | L242/L253/L265/L413 through `openSession`. The claims stay and follow the session click. |
| editor.mjs, folders.mjs | The `folders` document through `openDoc("folders")`; tree claims through `openTool("files")`. |
| manage.mjs | L272-273 `openSession` + `openTool("files")`. L351-384 "SEARCH opens from its stripe icon and follows the session". "Beside the terminal": the Search window does not overlap the session group, and the terminal is wider than 200 px. |
| icons.mjs | `arrange()` through gatekit. The pack link is read from `.stripeIcon .uiIcon use`. Groups add `stripe`, `toolHead` and `switch`. Pixel crispness is measured on a stripe icon. `MEASURE` swaps rail, railHome, railHomeName and railSession for stripeLeft, stripeIcon, toolHead and switchProject. |
| together.mjs, focus.mjs | Ready signal and Overview through gatekit. |
| agree.mjs | No change. |
| classes.py / attributes.py / translations.py / emptylies.py | §8.1, §10; both switcher lists render no rows before their answer. |
| check.sh | Reword L194, L218 and L225-229. Add "tool layout", "layout migration" (unit) and "tool stripes" (after "dock tabs"). |
| Text only | `skinrules.py:4` ("rail width" → "stripe thickness"), `try.sh:79`. |

---

## 12. Step 0: the spike (go / no-go)

Throwaway branch, dev server, no gates, nothing merged. Each item is measured in the real window, and
the results are written into OFFEN.md under this spec's name.

| # | Measure | Must |
|---|---|---|
| 1 | `addEdgeGroup` left, right and bottom with `header.hidden = true`: the header measures 0 px and the content fills the group | yes |
| 2 | `setEdgeGroupVisible(e,false)` leaves no footprint; `true` restores the previous size ±1, including after a sash drag | yes |
| 3 | `setSize` on a hidden edge is applied on the next show | no |
| 4 | `toJSON`/`fromJSON` round-trip keeps edge size, visibility, panels and `activeView`; `fromJSON` of a layout *without* `edgeGroups` while edges exist: note what happens | yes |
| 5 | `locked = 'no-drop-target'` plus the `onWillShowOverlay`/`onWillDrop` veto refuse an editor tab dragged onto an edge window; `dndEdges={false}` refuses the outer grid edge | yes |
| 6 | `onDidDimensionsChange` on an edge group fires on its sash drag | no (pointerup fallback) |
| 7 | `addPanel` without a position while an edge panel is active lands in the edge group (expected), and `placeDocument` fixes it; `{direction:"right"}` on an empty grid lands in the grid | yes |
| 8 | An edge group emptied by `moveTo` collapses; `expand()` then `setEdgeGroupVisible(true)` restores it | yes |
| 9 | `dv.panels` / `dv.groups` include edge panels and groups; `api.location.type` tells them apart | no |
| 10 | A maximized grid group with a visible edge: what shows; the name of the exit call | no |
| 11 | Shell clamping when the window narrows below edge sizes plus `--main-min` | no |
| 12 | The watermark shows with an empty grid and edges present | no |
| 13 | Switching the active panel inside an edge group keeps the inactive panels' React mounted (body gating then works as §5.3) | no |

- **Go:** every must passes.
- **No-go:** implement `ToolHost` as `columnHost`: plain React columns outside `DockviewReact`, sized
  with `components/ui/Splitter.tsx`, with the tool bodies rendered directly instead of as dockview
  panels. The `dock` JSON then holds only main, and a new `toolWindows` pref
  `{left,right,bottom: {shown: ToolId|null}}` holds the open state. Everything else in this spec is
  unchanged. Record the choice in OFFEN.md before step 4.

---

## 13. Implementation plan

Rules for every step:
- It ends with `./check.sh` fully green.
- UI steps are looked at in all four skins in the running window before they are called done.
- One commit per step, on a `wip` branch, merged when green.
- Nothing is reported as working unless it was run and seen.

1. **Gate kit and geometry hardening.** Add `gatekit.mjs` against today's rail. Move the 12 `.railhome`
   ready checks and every rail navigation onto it. In geometry.mjs, fail on a missing box.
   - *Verify:* check.sh green with no UI change. `grep -n "railhome\|railitem"` finds hits only in
     gatekit.mjs, geometry.mjs and icons.mjs. Break one box selector on purpose, see geometry go red,
     revert.
2. **Tool registry.** Add `lib/tools.ts` and `tools.test.mjs`, plus the check.sh "tool layout" step.
   Point Rail, Dock (`VIEW_TITLES`, `components`), App (`VIEW_LABELS`) and keymap (`VIEW_ORDER`) at it.
   - *Verify:* the unit gate is green; tsc; every browser gate is unchanged and green; the window looks
     identical in one skin.
3. **Layout migration, pure.** Add `lib/layoutMigrate.ts` and `layoutMigrate.test.mjs` with four
   recorded old layouts, plus the check.sh "layout migration" step. Nothing calls it yet.
   - *Verify:* the unit gate, including idempotence.
4. **Tool windows on edge groups.**
   - `toolHost.ts` (the implementation chosen in step 0) and `dock/tools.ts` (toggle, reveal, chord,
     toggleEdge, hideFocusedTool)
   - `ToolWindow` with title, — and ⋮ Hide only; body gating
   - `placeDocument`, `dndEdges={false}`, the veto, save triggers, the load pipeline with
     `migrateLayout` and `fromRegions`
   - the `location.type` filters
   - deletions: the region code listed in §5.6 and the tab menu's "Move to" rows
   - The rail still exists, and its view rows call `toggleTool`.
   - *Verify:* stripes.mjs claims 3-7, 10 (header and keyboard parts that exist), 16, 17, 18, 19, 21,
     driven through gatekit's rail clicks. tabs.mjs trimmed as in §11.4.
5. **Keyboard.** Remap view1-9 to `chordTool`/board; add `toolReview`, `hideTool` ⇧⎋, and the
   ⌘W/⇧⌘T/history/group-walk rules; `keys.*` texts in en and de; MENU "Tool windows" / "Documents".
   - *Verify:* stripes claims 8 and 15 (same-edge part); surfaces L255, L559, L570.
6. **Session switcher.** `MenuItem.icon/sub/status`, `lib/sessionMenu.ts`, `SessionSwitch`, ⌘E.
   gatekit's `openSession` and `sessionRows` use it. The rail's session rows still exist.
   - *Verify:* clicked L272 and surfaces L390 (session part) through the switcher; changes.mjs,
     accounts.mjs, tabs.mjs session claims green through it; emptylies.
7. **Project model, ProjectSwitch, Files tool.**
   - `lib/project.ts`, App-owned `project`, `onSessionFront`
   - project tools read `d.project`; `FilesTool` registered; `files:<rootId>` retired (palette and
     ChangesPanel callers)
   - ProjectSwitch replaces `.filter`, with the `PathField` row
   - *Verify:* stripes claims 17 and 23; clicked L682; editor, folders, manage and surfaces L425 through
     `pickProject`/`openDoc`.
8. **Icons.** Show him the 6 shapes × 4 packs first. Then add the build.py entries and regenerate.
   - *Verify:* build.py succeeds for all four packs; icons.mjs ink, fill-box and colour claims green.
9. **Stripes replace the rail.**
   - `components/stripes/{Stripes,Stripe}.tsx` (click, badges, nearly-out moved from R:127-140),
     `EdgeToggles`, `MainWatermark`, the §8.1 grid and tokens, skin-base dressing, the right-click icon
     menu without Move to
   - delete `Rail.tsx`, `RailPanel`, the rail CSS in layout.css and all five skin files, and the
     `rail.*` / `region.*` / `tab.moveTo` keys
   - gatekit switches to stripes
   - *Verify:* stripes claims 1, 2, 9, 11 (without Move to), 20; geometry and icons with the new boxes;
     classes, skinrules, attributes and translations green; `grep -rn "rail" frontend/components`
     returns only migration code in layoutMigrate.ts.
10. **Moving icons.** Pointer drag, `StripeGhost`, `.stripeGap`, ⋮ and right-click Move to, `moveTool`,
    `toolLayout` pref, Reset tool positions, `PREFS_CHANGED` adoption.
    - *Verify:* stripes claims 11 (full), 12, 13, 14, 15 (after a move), 22; surfaces L390 (icon part).
11. **Layouts and presets.** §7.4 activities; preset `tools` saved and applied.
    - *Verify:* surfaces L613; clicked reset claim; stripes claim 21 (preset part).
12. **Tool memory and per-tool headers.** `lib/toolMemory.ts` in Files, Search and Archive, plus scroll.
    Then one tool per commit: move its `TopStrip` controls into `ToolWindow` actions and drop the
    "xxx>" prompt.
    - *Verify:* stripes claim 24; each tool's existing gate claims stay green; geometry holds
      `.toolHead` equal across skins.
13. **Skin review with him.** Screenshots of 4 skins × {all hidden, left and right lit, bottom lit,
    dragging}, in the Tabler pack and the pixel pack. He decides; only dressing edits follow.
    - *Verify:* geometry and icons green after his changes.
14. **Bottom content.** Only after his answer to §14.1.
    - *Verify:* a stripes claim for whatever he picked.
15. **OFFEN.md.** Update P1-P5, P9, P17, P19, P20 and the related notes with what was measured, including
    the step-0 results and the version.

---

## 14. Open questions for him (not decided here)

1. **Bottom stripe content:** (a) empty, as a drop target only (the default here); (b) Ports at the
   bottom; (c) the Workbench console (F12) as a bottom tool; (d) no bottom stripe, with bottom tools at
   the lower end of the side stripes (JetBrains New UI).
2. **One visible tool per side and one width per side:** enough, or does he want JetBrains split mode
   or a width per tool? Either would be a follow-up.
3. **The Folders view:** keep it as the "project overview" document, or drop it now that Files is a
   tool?
4. **Project rule:** a switcher pick wins until the next session comes to the front (§6.1). Is that
   right?
5. **Names and shapes:** German names for the tools ("Dateien", …) and the icon shapes from step 8.
6. **Keys:** ⌘E for the session switcher, ⌘3 now opening Files, ⇧⎋ to hide.
7. **Should the board (overview) also be a tool** rather than a document? The registry allows it by
   moving `overview` from `DOCS` to `TOOLS`.

---

## 15. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Edge groups with a hidden header are read, not run | Step 0 go/no-go; `ToolHost` interface; `columnHost` fallback named |
| 2 | Edge visibility and edge sash drags are not reported by `onDidLayoutChange` (B:15995) | `host.onChange` feeds the saver; pointerup fallback; stripes claims 6, 7 |
| 3 | A document lands in an edge group (`addPanel` falls back to `activeGroup`) | `placeDocument` for every add; stripes claim 17 |
| 4 | An emptied edge group collapses and then refuses its size | `expand()` before show; spike item 8 |
| 5 | Hidden tools keep polling (the portal stays mounted) | body gated on lit; `keepMounted` only for Files and Notes; stripes claim 19 |
| 6 | State lost when a body unmounts | `toolMemory`; stripes claim 24 |
| 7 | Code counting `dv.panels`/`dv.groups` now sees tools | `location.type` filters; spike item 9 |
| 8 | Main squeezed below `--main-min` | clamp on resize and size change; spike item 11 |
| 9 | Old layout JSON surgery leaves odd branch sizes | `fromJSON` fallback to the activity; unit fixtures; stripes claim 21 |
| 10 | `dockRegions` deleted, so an older build reading the same prefs loses his region choices | accepted; migration is one-way |
| 11 | Two windows still overwrite each other's `dock` | unchanged; only `toolLayout` is synced |
| 12 | The project rule changes | question 4 |
| 13 | ⌘3 changes meaning; ⌘E may collide in text fields | skip in inputs; tooltips and "?" show the new meaning; question 6 |
| 14 | Icon names may not exist upstream; Phosphor and pixel may need self-drawn `plxr:` shapes | build.py fails on a missing file; icons.mjs ink and grid claims; he sees them |
| 15 | Gate churn across 13 files | gatekit first (step 1) |
| 16 | geometry's missing-box fix may expose failures that were passing silently | fix them in step 1, before any UI change |
| 17 | The Tooltip has no side placement, so right-stripe tooltips may overflow | clamp to the viewport in `Tooltip.tsx` in step 9 |
| 18 | P7/P8 (status bar at the bottom, header word buttons) are not covered | separate work; the bottom stripe leaves room at its right end |
