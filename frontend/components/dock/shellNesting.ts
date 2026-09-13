"use client";

/* The bottom tool window under everything.
 *
 * He described the frame in one line (translated): "left - main - right. under
 * everything, the bottom" — the way PhpStorm has it, the bottom window running
 * the whole width under the left window, main and the right window. dockview
 * 8.3.1 builds its shell the other way round: an outer horizontal splitview
 * [left | middle column | right] whose middle column is vertical [top | grid |
 * bottom], so its bottom edge is only ever as wide as main. The class that
 * builds it is not exported and dockview makes it itself, so it can be neither
 * subclassed nor handed in.
 *
 * So the nesting is rebuilt once, on the live instance, before any edge group
 * exists:
 *
 *   .dv-shell
 *     a vertical Splitview, new here          [row, bottom]
 *       row: dockview's own outer splitview, moved in whole   [left | middle | right]
 *       bottom: the bottom edge group
 *
 * dockview's shell goes on doing everything it did — adding an edge, showing,
 * hiding and sizing it, toJSON and fromJSON. It reaches the middle column
 * through one field, and for "bottom" that field now leads to the new
 * splitview; "top" still goes to the real middle column, which stays where it
 * was and still holds main. The shell's layout is shadowed on the instance so
 * the new splitview is laid out first and hands the row its height. Nothing
 * that is stored changes: an edge's size and visibility are read back through
 * the same calls, so a layout saved before this reads the same after it.
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

  /* What the shell calls its middle column, for "bottom": the column's second
     view. Asked about a bottom edge that is not there, it answers the way the
     real one does — not visible, no size — and never throws. */
  const BOTTOM = 1;
  let hasBottom = false;
  const facade: MiddleLike = {
    get minimumSize() {
      return real.minimumSize;
    },
    get axisSize() {
      return column.size;
    },
    addTopView: (view, size) => real.addTopView(view, size),
    addBottomView: (view, size) => {
      column.addView(view, size, BOTTOM);
      hasBottom = true;
    },
    removeView: (position) => {
      if (position === "top") real.removeView("top");
      else if (hasBottom) {
        column.removeView(BOTTOM);
        hasBottom = false;
      }
    },
    setViewVisible: (position, visible) => {
      if (position === "top") real.setViewVisible("top", visible);
      else if (hasBottom) column.setViewVisible(BOTTOM, visible);
    },
    isViewVisible: (position) => (position === "top" ? real.isViewVisible("top") : hasBottom && column.isViewVisible(BOTTOM)),
    getViewSize: (position) => (position === "top" ? real.getViewSize("top") : hasBottom ? column.getViewSize(BOTTOM) : 0),
    getViewCachedVisibleSize: (position) =>
      position === "top" ? real.getViewCachedVisibleSize("top") : hasBottom ? column.getViewCachedVisibleSize(BOTTOM) : undefined,
    resizeView: (position, size) => {
      if (position === "top") real.resizeView("top", size);
      else if (hasBottom) column.resizeView(BOTTOM, size);
    },
    updateMargin: (gap) => {
      real.updateMargin(gap);
      column.margin = gap;
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
  shell._disposables.addDisposables(column, row);
  el.dataset.bottomSpan = "full";

  /* dockview laid the shell out before handing the dock over, but its own
     record of the size stays at zero until its resize observer runs, so the
     size is read off the element: without this the row would stand at its
     floor for a frame. */
  const width = el.clientWidth;
  const height = el.clientHeight;
  if (width > 0 && height > 0) shell.layout(width, height);
  return true;
}
