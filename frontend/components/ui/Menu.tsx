"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/ui/Icon";
import PathField from "@/components/ui/PathField";
import type { IconName } from "@/lib/icons";

/* One context menu for the whole window.
 *
 * Right-click anything that offers actions — a file in the tree, a session, a
 * tab — and the same menu appears at the pointer. Never the browser's own menu
 * (it knows nothing about plxr) and never a menu per component: there is one,
 * provided at the root, and anything reaches it through useMenu().
 *
 * The two switches at the top open it too, under themselves, as their list:
 * the projects and the sessions. That is why a row can carry a mark, a second
 * line and a menu of its own, and why the menu can hold a field.
 */
export type MenuItem =
  | { separator: true; header?: false; field?: false }
  /* A section's name, not something to click: it groups the rows under it
     the way the header MENU is read — Actions, Tools, Views. */
  | { header: true; separator?: false; field?: false; label: string }
  /* A folder typed into the menu, completed while it is typed, and taken
     with Enter. The label is what the empty field says. */
  | { field: true; separator?: false; header?: false; label: string; onSubmit: (value: string) => void }
  | {
      separator?: false;
      header?: false;
      field?: false;
      label: string;
      onClick: () => void;
      danger?: boolean;
      disabled?: boolean;
      hint?: string; // a keyboard shortcut, shown greyed on the right
      /* A row that is a switch says which way it stands: a tick in front of
         it when on, an empty cell when off, so the rows stay lined up. */
      checked?: boolean;
      /* The mark in front of the label, from the icon vocabulary. */
      icon?: IconName;
      /* A second, quieter line under the label: a session's state, a
         folder's path. */
      sub?: string;
      /* A session's state. It colours the mark the way it colours the dot
         on the tile and the rail, so a row that needs somebody says so. */
      status?: string;
      /* What the row itself offers under the right button, or on the
         context-menu key: opened in place of this menu. */
      context?: () => MenuItem[];
    };

/* Who a menu was opened for. A control that opens its own menu passes itself
   as the anchor, so pressing it again closes the menu rather than closing it
   on the way down and opening it again on the way up; and a name, so it can
   show itself pressed while its menu is up. */
export type MenuOptions = { owner?: string; anchor?: Element | null };

type Opened = {
  x: number;
  y: number;
  items: MenuItem[];
  owner: string | null;
  anchor: Element | null;
  seq: number;
  /* Where the keyboard was before the menu took it, to hand it back. */
  back: HTMLElement | null;
};
type MenuApi = {
  open: (x: number, y: number, items: MenuItem[], options?: MenuOptions) => void;
  close: () => void;
  /* New rows for a menu that is still up, if it is this owner's: a session
     changes its state while its list is being read, and the list follows. */
  refresh: (owner: string, items: MenuItem[]) => void;
  /* The owner of the menu that is up, or null. */
  owner: string | null;
};

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
  // Each opening is a menu of its own, drawn fresh: the keyboard lands on
  // its first row again, not wherever the one before it was left.
  const seq = useRef(0);
  const api: MenuApi = {
    open: (x, y, items, options = {}) => {
      seq.current += 1;
      const n = seq.current;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // A menu opened from a row of another keeps the place the first one
      // was opened from: that is where Escape should lead back to.
      const fromMenu = Boolean(active?.closest(".menu"));
      setOpened((was) => ({
        x,
        y,
        items,
        owner: options.owner ?? null,
        anchor: options.anchor ?? null,
        seq: n,
        back: fromMenu && was ? was.back : active,
      }));
    },
    close: () => setOpened(null),
    refresh: (owner, items) => setOpened((was) => (was && was.owner === owner ? { ...was, items } : was)),
    owner: opened?.owner ?? null,
  };
  return (
    <Ctx.Provider value={api}>
      {children}
      {opened ? <MenuSurface key={opened.seq} {...opened} onReopen={api.open} onClose={() => setOpened(null)} /> : null}
    </Ctx.Provider>
  );
}

/* Every place in the menu the keyboard can stand on: the rows that can be
   taken, and a field. */
function stopsIn(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(".menuItem:not(:disabled), .menuField input")];
}

function MenuSurface({ x, y, items, anchor, back, onReopen, onClose }: Opened & { onReopen: MenuApi["open"]; onClose: () => void }) {
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

  /* The keyboard goes into the menu with it.
     A menu opened by a key that left the keyboard where it was could only be
     used with the pointer: the arrows went to the terminal behind it. It lands
     on the row that is ticked — the project in use — or on the first one. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ticked = el.querySelector<HTMLElement>('.menuItem[aria-checked="true"]:not(:disabled)');
    (ticked ?? stopsIn(el)[0])?.focus();
  }, []);

  /* And back where it came from when the menu goes — however it goes: a row
     taken, Escape, ⌘E pressed again, another menu opened from a row. Only
     when the keyboard is still in the menu, though: a click somewhere else
     has already put it where it belongs, and taking it back from there would
     be theft. A layout effect, because its cleanup runs while the rows are
     still in the document; after that the keyboard has fallen to the body and
     nothing can tell where it was. */
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (back?.isConnected && el?.contains(document.activeElement)) back.focus();
    };
  }, [back]);

  useEffect(() => {
    const shut = (e: MouseEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      // A field's completion list hangs in the body, over the menu, and is
      // part of it; the control the menu belongs to closes it by itself.
      if (t && (ref.current?.contains(t) || t.closest(".selectList") || anchor?.contains(t))) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      const el = ref.current;
      if (!el) return;
      if (e.key === "Escape") {
        // A completion list open over the field is closed first, by its own
        // Escape; the next one closes the menu.
        if (document.querySelector(".pathList")) return;
        onClose();
        return;
      }
      // Keys pressed elsewhere are not the menu's, and a field that used the
      // arrow for its own list has already said so.
      if (e.defaultPrevented || !el.contains(document.activeElement)) return;
      const stops = stopsIn(el);
      if (stops.length === 0) return;
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const inField = document.activeElement?.tagName === "INPUT";
      let next: number;
      if (e.key === "ArrowDown") next = (at + 1) % stops.length;
      else if (e.key === "ArrowUp") next = at <= 0 ? stops.length - 1 : at - 1;
      else if (e.key === "Home" && !inField) next = 0;
      else if (e.key === "End" && !inField) next = stops.length - 1;
      else return;
      e.preventDefault();
      stops[next].focus();
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
  }, [onClose, anchor]);

  return createPortal(
    <div className="menu" role="menu" ref={ref} style={{ left: `${pos.left}px`, top: `${pos.top}px` }}>
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menuSep" />
        ) : it.header ? (
          <div key={i} className="menuHeader" role="presentation">
            {it.label}
          </div>
        ) : it.field ? (
          // Keyed by what it is, not where: a row added above it while
          // somebody types must not throw away what was typed.
          <MenuField
            key={`field:${it.label}`}
            label={it.label}
            onSubmit={(value) => {
              onClose();
              it.onSubmit(value);
            }}
          />
        ) : (
          <button
            key={i}
            type="button"
            role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={it.checked === undefined ? undefined : it.checked}
            className={`menuItem${it.danger ? " danger" : ""}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick();
            }}
            onContextMenu={
              it.context
                ? (e: ReactMouseEvent<HTMLButtonElement>) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // The context-menu key has no pointer: under the row, then.
                    const r = e.currentTarget.getBoundingClientRect();
                    const keyed = e.clientX === 0 && e.clientY === 0;
                    onReopen(keyed ? Math.round(r.left) : e.clientX, keyed ? Math.round(r.bottom) : e.clientY, it.context!());
                  }
                : undefined
            }
          >
            {it.checked === undefined ? null : (
              <span className="menuCheck" aria-hidden="true">
                {it.checked ? "✓" : ""}
              </span>
            )}
            {it.icon ? (
              <span className={`menuIcon${it.status ? ` dot ${it.status}` : ""}`} aria-hidden="true">
                <Icon name={it.icon} />
              </span>
            ) : null}
            <span className="menuLabel">
              {it.label}
              {it.sub ? <span className="menuSub">{it.sub}</span> : null}
            </span>
            {it.hint ? <span className="menuHint">{it.hint}</span> : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

// The field row: its own text, so the menu's rows can be redrawn around it.
function MenuField({ label, onSubmit }: { label: string; onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="menuField">
      <PathField
        value={value}
        onChange={setValue}
        placeholder={label}
        onSubmit={() => {
          if (value.trim()) onSubmit(value);
        }}
      />
    </div>
  );
}
