"use client";

/* The bottom tool window under everything, in two halves.
 *
 * He described the frame in one line (translated): "left - main - right. under
 * everything, the bottom" — the way PhpStorm has it, the bottom window running
 * the whole width under the left window, main and the right window, and later
 * (translated): "in the bottom section I want a left and a right tabs" — two
 * windows side by side down there, each with its own tabs, the way that same
 * program has a terminal beside a build log. dockview 8.3.1 gives neither: it
 * builds its shell the other way round — an outer horizontal splitview [left |
 * middle column | right] whose middle column is vertical [top | grid |
 * bottom], so its bottom edge is only ever as wide as main — and it keeps one
 * group per edge, refusing a second at the same position. The class that
 * builds the shell is not exported and dockview makes it itself, so it can be
 * neither subclassed nor handed in.
 *
 * So the nesting is rebuilt once, on the live instance, before any edge group
 * exists:
 *
 *   .dv-shell
 *     a vertical Splitview, new here          [row, floor]
 *       row: dockview's own outer splitview, moved in whole   [left | middle | right]
 *       floor: a horizontal Splitview, new here  [bottom edge | top edge]
 *
 * The floor's two halves are dockview's own "bottom" and "top" edge groups.
 * There is no third position to ask for, and the top edge is a place this
 * window has no use for — the header is not a dock — so "top" is where the
 * right half lives. Everything dockview does to an edge goes on working:
 * adding it, showing it, hiding it, sizing it, writing it out and reading it
 * back. Two things read differently, and only here:
 *
 *   - the size of "bottom" is the floor's height, the height both halves
 *     share, and the size of "top" is the right half's width;
 *   - an edge view dockview built for a vertical splitview is laid out in a
 *     horizontal one, so both halves have their axes swapped back on the way
 *     in (see `beside`).
 *
 * dockview's shell goes on doing everything it did — adding an edge, showing,
 * hiding and sizing it, toJSON and fromJSON. It reaches the middle column
 * through one field, and that field now leads to the new column and its floor;
 * the real middle column stays where it was and still holds main. The shell's
 * layout is shadowed on the instance so the new column is laid out first and
 * hands the row its height. Nothing that is stored changes: an edge's size and
 * visibility are read back through the same calls, so a layout saved before
 * this reads the same after it.
 *
 * What this relies on in dockview, none of it promised, all of it held against
 * the installed dockview by frontend/lib/shellNesting.test.mjs:
 *   - DockviewApi.component._shellManager, and on it element, _shellElement,
 *     _outerSplitview, _middleColumn, _gap, _disposables, _flushPendingSizes,
 *     layout and hasEdgeGroup;
 *   - the shell calling exactly the ten members of _middleColumn in MIDDLE;
 *   - ShellManager.layout being the one place the outer splitview is laid out,
 *     and every layout of the shell going through this.layout;
 *   - a Splitview touching the element it was made in only while it is made.
 * Should the shell not look like that, nothing is changed, the bottom edge
 * stays under main, and the console says why.
 */
import { DockviewEmitter, LayoutPriority, Orientation, Sizing, Splitview, type DockviewApi, type IView } from "dockview-react";

type Position = "top" | "bottom";

// Every member of the middle column dockview's shell calls, and no other.
const MIDDLE = [
  "addTopView",
  "addBottomView",
  "removeView",
  "setViewVisible",
  "isViewVisible",
  "getViewSize",
  "getViewCachedVisibleSize",
  "resizeView",
  "axisSize",
  "updateMargin",
] as const;

interface MiddleLike {
  readonly minimumSize: number;
  readonly axisSize: number;
  addTopView(view: IView, size: number): void;
  addBottomView(view: IView, size: number): void;
  removeView(position: Position): void;
  setViewVisible(position: Position, visible: boolean): void;
  isViewVisible(position: Position): boolean;
  getViewSize(position: Position): number;
  getViewCachedVisibleSize(position: Position): number | undefined;
  resizeView(position: Position, size: number): void;
  updateMargin(gap: number): void;
}

interface SplitLike {
  readonly element: HTMLElement;
  layout(size: number, orthogonalSize: number): void;
  addView(view: IView, size?: number | Sizing, index?: number): void;
}

interface ShellInternals {
  readonly element: HTMLElement;
  _shellElement: HTMLElement;
  _outerSplitview: SplitLike;
  _middleColumn: MiddleLike;
  _gap: number;
  _disposables: { addDisposables(...items: { dispose(): void }[]): void };
  _flushPendingSizes(): void;
  layout(width: number, height: number): void;
  hasEdgeGroup(position: "top" | "bottom" | "left" | "right"): boolean;
}

const isFunction = (v: unknown): boolean => typeof v === "function";

/* Whether the shell is the one this file was written against — read by what
   it has, not by its class, which is not exported. It also has to be
   untouched: no bottom edge made yet, and no layout of its own already. */
function fits(shell: Partial<ShellInternals> | undefined): shell is ShellInternals {
  if (!shell || !(shell.element instanceof HTMLElement) || shell._shellElement !== shell.element) return false;
  const outer = shell._outerSplitview;
  if (!outer || !(outer.element instanceof HTMLElement) || outer.element.parentElement !== shell.element) return false;
  if (!isFunction(outer.layout) || !isFunction(outer.addView)) return false;
  const middle = shell._middleColumn as unknown as Record<string, unknown> | undefined;
  if (!middle || typeof middle.minimumSize !== "number") return false;
  if (!MIDDLE.every((name) => (name === "axisSize" ? typeof middle[name] === "number" : isFunction(middle[name])))) return false;
  if (typeof shell._gap !== "number" || !isFunction(shell._disposables?.addDisposables)) return false;
  if (!isFunction(shell._flushPendingSizes) || !isFunction(shell.layout) || !isFunction(shell.hasEdgeGroup)) return false;
  if (shell.hasEdgeGroup?.("bottom")) return false;
  return !Object.prototype.hasOwnProperty.call(shell, "layout");
}

/* spanBottom puts dockview's bottom edge under both side edges. Called once,
   first thing, before an edge group is added or a layout loaded; a second call
   on the same dock changes nothing. False when the shell is not what this was
   written for, in which case nothing was touched. */
export function spanBottom(dv: DockviewApi): boolean {
  const shell = (dv as unknown as { component?: { _shellManager?: Partial<ShellInternals> } }).component?._shellManager;
  if (shell?.element instanceof HTMLElement && shell.element.dataset.bottomSpan === "full") return true;
  if (!fits(shell)) {
    console.error("plxr: dockview's shell is not the one shellNesting.ts was written for; the bottom edge stays under main");
    return false;
  }
  const el = shell.element;
  const outer = shell._outerSplitview;
  const real = shell._middleColumn;

  /* The column takes the place dockview's splitview had in the shell, so it
     stays ahead of the drop targets and overlays dockview put after it. */
  const column = new Splitview(el, { orientation: Orientation.VERTICAL, proportionalLayout: false, margin: shell._gap });
  el.insertBefore((column as unknown as { element: HTMLElement }).element, outer.element);

  /* The row is dockview's outer splitview itself, moved in whole. Its element
     fills whatever box it stands in, so it needs no size of its own; the class
     only names it for the gates. Its floor is main's: a hundred pixels. */
  outer.element.classList.add("dv-shell-row");
  const changed = new DockviewEmitter<{ size?: number; orthogonalSize?: number }>();
  const row: IView = {
    element: outer.element,
    minimumSize: real.minimumSize,
    maximumSize: Number.POSITIVE_INFINITY,
    priority: LayoutPriority.High,
    onDidChange: changed.event,
    layout: (size, orthogonalSize) => outer.layout(orthogonalSize, size),
    setVisible: () => undefined,
    dispose: () => changed.dispose(),
  };
  column.addView(row, Sizing.Distribute, 0);

  /* The floor: the two halves of the bottom section, side by side, with a
     sash between them. Both are dockview's own edge views, built for a
     vertical splitview — "bottom" and, standing in for the right half, "top" —
     so each is laid out through `beside`, which swaps the two lengths back.

     Everything the shell asks about "bottom" is about the floor as a whole:
     it is the height both halves share. Everything it asks about "top" is
     about the right half alone: there, a size is a width. */
  const pair = new Splitview(el, { orientation: Orientation.HORIZONTAL, proportionalLayout: false, margin: shell._gap });
  const pairEl = (pair as unknown as { element: HTMLElement }).element;
  pairEl.classList.add("dv-shell-floor");
  pairEl.remove();

  const beside = (view: IView): IView => ({
    get element() {
      return view.element;
    },
    get minimumSize() {
      return view.minimumSize;
    },
    get maximumSize() {
      return view.maximumSize;
    },
    get priority() {
      return view.priority;
    },
    get snap() {
      return view.snap;
    },
    onDidChange: view.onDidChange,
    layout: (size, orthogonalSize) => view.layout(orthogonalSize, size),
    setVisible: (visible) => view.setVisible?.(visible),
    // dockview made the view and disposes it; this is only a way in.
    dispose: () => undefined,
  });

  const FLOOR = 1;
  let onFloor: Position[] = [];
  const indexOf = (position: Position) => onFloor.indexOf(position);
  const half = (position: Position) => (indexOf(position) < 0 ? null : indexOf(position));
  /* The floor stands in the column while a half is on it, and is only as tall
     as the halves let it be. */
  const floorChanged = new DockviewEmitter<{ size?: number; orthogonalSize?: number }>();
  const floor: IView = {
    element: pairEl,
    get minimumSize() {
      const floors = onFloor.map((position) => pairView(position)?.minimumSize ?? 0);
      return floors.length ? Math.max(...floors) : 0;
    },
    maximumSize: Number.POSITIVE_INFINITY,
    priority: LayoutPriority.Low,
    onDidChange: floorChanged.event,
    layout: (size, orthogonalSize) => {
      pair.layout(orthogonalSize, size);
      const at = indexOf("top");
      if (rightWidth !== null && at >= 0 && pair.size > 0 && pair.isViewVisible(at)) {
        const want = rightWidth;
        rightWidth = null;
        pair.resizeView(at, want);
      }
    },
    setVisible: () => undefined,
    dispose: () => floorChanged.dispose(),
  };
  const views = new Map<Position, IView>();
  const pairView = (position: Position) => views.get(position);
  /* A half dockview has folded away to its strip: it is empty, and the size it
     asks for then is the strip's, not the section's. */
  const folded = (position: Position) => Boolean((pairView(position) as unknown as { isCollapsed?: boolean } | undefined)?.isCollapsed);
  let standing = false;
  let up = false;
  /* The height of the section, kept here because it belongs to neither half:
     both share it, and an empty half folding away must not take it with it.
     The width the right half was last given waits here until the floor has the
     room to hand it over. */
  let floorHeight = 0;
  let rightWidth: number | null = null;

  /* The floor is in the column exactly while a half wants to be seen, and it
     comes back up at the height it went away with. */
  const settle = (): void => {
    if (!standing) return;
    /* Whatever height the section has right now is the height it has: he may
       have dragged it since it came up, and that is the one to come back to.
       Read before anything is changed, and only while it is up — hidden, the
       column reports nothing to keep. */
    if (up) {
      const live = column.getViewSize(FLOOR);
      if (live > 0) floorHeight = live;
    }
    const seen = onFloor.filter((position) => pair.isViewVisible(indexOf(position)));
    const wanted = seen.length > 0;
    const back = wanted && !up;
    column.setViewVisible(FLOOR, wanted);
    /* Only on the way back up. A half going away while the other stays is no
       reason to touch the height at all — putting the remembered one back then
       threw away the height he had just dragged ("then it goes back to the old
       height! why?", 15.09.2026). */
    if (back && floorHeight > 0) column.resizeView(FLOOR, floorHeight);
    /* A half that stood there alone had the whole width. When the other one
       joins it, the width it kept from being alone would leave nothing for it,
       so the two share the row and he moves the sash from there. */
    if (seen.length === 2 && pair.size > 0 && seen.some((position) => pair.getViewSize(indexOf(position)) > pair.size * 0.85)) {
      rightWidth = null;
      pair.distributeViewSizes();
    }
    up = wanted;
  };
  const stand = (first: number): void => {
    if (standing) return;
    floorHeight = first;
    column.addView(floor, first, FLOOR);
    standing = true;
    up = true;
  };

  /* What the shell calls its middle column. Asked about an edge that is not
     there, it answers the way the real one does — not visible, no size — and
     never throws. */
  const facade: MiddleLike = {
    get minimumSize() {
      return real.minimumSize;
    },
    get axisSize() {
      return column.size;
    },
    addTopView: (view, size) => {
      /* The right half can be the first one there — dockview reads a saved
         layout back in its own order — and then the section starts as tall as
         that half is wide is no answer at all, so it starts at its own floor
         and the next height asked for wins. */
      stand(Math.max(floor.minimumSize, view.minimumSize));
      onFloor = [...onFloor.filter((p) => p !== "top"), "top"];
      views.set("top", view);
      pair.addView(beside(view), size, indexOf("top"));
      rightWidth = size;
      settle();
    },
    addBottomView: (view, size) => {
      stand(size);
      floorHeight = size;
      onFloor = ["bottom", ...onFloor.filter((p) => p !== "bottom")];
      views.set("bottom", view);
      pair.addView(beside(view), Sizing.Distribute, 0);
      column.resizeView(FLOOR, size);
      settle();
    },
    removeView: (position) => {
      const at = half(position);
      if (at === null) return;
      pair.removeView(at);
      onFloor = onFloor.filter((p) => p !== position);
      views.delete(position);
      if (onFloor.length === 0 && standing) {
        column.removeView(FLOOR);
        standing = false;
      } else settle();
    },
    setViewVisible: (position, visible) => {
      const at = half(position);
      if (at === null) return;
      pair.setViewVisible(at, visible);
      settle();
    },
    isViewVisible: (position) => {
      const at = half(position);
      if (at === null || !standing) return false;
      return column.isViewVisible(FLOOR) && pair.isViewVisible(at);
    },
    getViewSize: (position) => {
      const at = half(position);
      if (at === null || !standing) return 0;
      return position === "bottom" ? column.getViewSize(FLOOR) : pair.getViewSize(at);
    },
    getViewCachedVisibleSize: (position) => {
      const at = half(position);
      if (at === null || !standing) return undefined;
      return position === "bottom" ? column.getViewCachedVisibleSize(FLOOR) : pair.getViewCachedVisibleSize(at);
    },
    resizeView: (position, size) => {
      const at = half(position);
      if (at === null || !standing || folded(position)) return;
      if (position === "bottom") {
        floorHeight = size;
        column.resizeView(FLOOR, size);
      } else if (pair.size > 0 && pair.isViewVisible(at)) pair.resizeView(at, size);
      else rightWidth = size;
    },
    updateMargin: (gap) => {
      real.updateMargin(gap);
      column.margin = gap;
      pair.margin = gap;
    },
  };
  shell._middleColumn = facade;

  /* Every layout of the shell — its own resize observer, a theme change, an
     edge added, the dock's layout — goes through this. The column is laid out
     and hands the row its height; the row lays out dockview's splitview as the
     shell used to. */
  const flush = shell._flushPendingSizes;
  shell.layout = (width: number, height: number) => {
    column.layout(height, width);
    flush.call(shell);
  };
  shell._disposables.addDisposables(column, pair, row, floor);
  el.dataset.bottomSpan = "full";

  /* dockview laid the shell out before handing the dock over, but its own
     record of the size stays at zero until its resize observer runs, so the
     size is read off the element: without this the row would stand at its
     floor for a frame. */
  const across = el.clientWidth;
  const down = el.clientHeight;
  if (across > 0 && down > 0) shell.layout(across, down);
  return true;
}
