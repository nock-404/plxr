"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/* One context menu for the whole window.
 *
 * Right-click anything that offers actions — a file in the tree, a session, a
 * tab — and the same menu appears at the pointer. Never the browser's own menu
 * (it knows nothing about plxr) and never a menu per component: there is one,
 * provided at the root, and anything reaches it through useMenu().
 */
export type MenuItem =
  | { separator: true }
  | {
      separator?: false;
      label: string;
      onClick: () => void;
      danger?: boolean;
      disabled?: boolean;
      hint?: string; // a keyboard shortcut, shown greyed on the right
    };

type Opened = { x: number; y: number; items: MenuItem[] };
type MenuApi = { open: (x: number, y: number, items: MenuItem[]) => void; close: () => void };

const Ctx = createContext<MenuApi | null>(null);

export function useMenu(): MenuApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMenu outside a MenuProvider");
  return v;
}

/* A ready-made handler for the common case: onContextMenu that opens the menu
 * at the pointer with these items and does nothing (no menu) when the list is
 * empty, so the browser's own menu is not suppressed for no reason. */
export function useContextMenu() {
  const menu = useMenu();
  return useCallback(
    (items: MenuItem[]) => (e: React.MouseEvent) => {
      if (items.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      menu.open(e.clientX, e.clientY, items);
    },
    [menu],
  );
}

export function MenuProvider({ children }: { children: ReactNode }) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const api: MenuApi = {
    open: (x, y, items) => setOpened({ x, y, items }),
    close: () => setOpened(null),
  };
  return (
    <Ctx.Provider value={api}>
      {children}
      {opened ? <MenuSurface {...opened} onClose={() => setOpened(null)} /> : null}
    </Ctx.Provider>
  );
}

function MenuSurface({ x, y, items, onClose }: Opened & { onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu on screen: if it would run off the right or bottom edge, it
  // opens to the left or upward of the pointer instead.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 6;
    let left = x;
    let top = y;
    if (left + r.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - r.width - pad);
    if (top + r.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - r.height - pad);
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const shut = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // A right-click elsewhere closes this one before opening the next.
    window.addEventListener("mousedown", shut, true);
    window.addEventListener("contextmenu", shut, true);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", shut, true);
      window.removeEventListener("contextmenu", shut, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div className="menu" role="menu" ref={ref} style={{ left: `${pos.left}px`, top: `${pos.top}px` }}>
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menuSep" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`menuItem${it.danger ? " danger" : ""}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick();
            }}
          >
            <span className="menuLabel">{it.label}</span>
            {it.hint ? <span className="menuHint">{it.hint}</span> : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
