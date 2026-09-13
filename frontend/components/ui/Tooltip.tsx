"use client";

import { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, MouseEvent, ReactElement } from "react";
import { createPortal } from "react-dom";

/* The one tooltip.
 *
 * Every hint in the window used to be a native title= — drawn by the system
 * after its own delay, in its own typeface, on its own grey, and in the
 * native window not drawn at all until the pointer had sat still for a second.
 * Sixty-three of them, wearing none of the skin. This one is drawn by plxr:
 * it sits on the opaque --surface like the menu, so terminal text never bleeds
 * through it, and it belongs to whichever skin is on.
 *
 * Wrapped around the thing it explains, and it stays that thing: the child is
 * rendered as it is, only its hover and focus handlers are added to, so the
 * layout does not change and nothing extra has to be dressed. Hover shows it
 * after a short pause; keyboard focus shows it at once; a click, a key, a
 * leave or a blur hides it.
 */
type Box = { x: number; y: number; w: number; h: number };

type Handlers = {
  onMouseEnter?: (e: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (e: MouseEvent<HTMLElement>) => void;
  onMouseDown?: (e: MouseEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
};

/* Where the hint stands against the thing it explains. Under it, unless
   something beside it would be covered: the icons of a stripe stand one under
   the other, so their hints go to the side, towards the work. A hint that does
   not fit on the side it was asked for goes to the other one, and it never
   leaves the window. */
export type TipPlace = "below" | "above" | "right" | "left";

export default function Tooltip({ text, place = "below", children }: { text?: string; place?: TipPlace; children: ReactElement<Handlers> }) {
  const [box, setBox] = useState<Box | null>(null);
  const timer = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const hide = useCallback(() => {
    cancel();
    setBox(null);
  }, [cancel]);
  const showFrom = useCallback((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setBox({ x: r.left, y: r.top, w: r.width, h: r.height });
  }, []);

  useEffect(() => cancel, [cancel]);

  if (!text) return children;

  const given = children.props;
  const trigger = cloneElement(children, {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      given.onMouseEnter?.(e);
      const el = e.currentTarget;
      cancel();
      timer.current = window.setTimeout(() => showFrom(el), 350);
    },
    onMouseLeave: (e: MouseEvent<HTMLElement>) => {
      given.onMouseLeave?.(e);
      hide();
    },
    onMouseDown: (e: MouseEvent<HTMLElement>) => {
      given.onMouseDown?.(e);
      hide();
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      given.onFocus?.(e);
      // Keyboard focus only: a click focuses the button too, and the hint
      // popping up under every click would be noise.
      try {
        if (e.currentTarget.matches(":focus-visible")) showFrom(e.currentTarget);
      } catch {
        /* an old engine without :focus-visible — hover still works */
      }
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      given.onBlur?.(e);
      hide();
    },
  });

  return (
    <>
      {trigger}
      {box ? <TipSurface text={text} at={box} place={place} onClose={hide} /> : null}
    </>
  );
}

function TipSurface({ text, at, place, onClose }: { text: string; at: Box; place: TipPlace; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Centred on the thing, on the side asked for; on the other side when there
  // is no room there, and never past any edge of the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 6;
    const gap = 6;
    const clampX = (v: number) => Math.min(Math.max(pad, v), Math.max(pad, window.innerWidth - r.width - pad));
    const clampY = (v: number) => Math.min(Math.max(pad, v), Math.max(pad, window.innerHeight - r.height - pad));
    let left: number;
    let top: number;
    if (place === "right" || place === "left") {
      const right = at.x + at.w + gap;
      const leftOf = at.x - r.width - gap;
      const fitsRight = right + r.width <= window.innerWidth - pad;
      const fitsLeft = leftOf >= pad;
      left = clampX(place === "right" ? (fitsRight || !fitsLeft ? right : leftOf) : fitsLeft || !fitsRight ? leftOf : right);
      top = clampY(at.y + at.h / 2 - r.height / 2);
    } else {
      const below = at.y + at.h + gap;
      const above = at.y - r.height - gap;
      const fitsBelow = below + r.height <= window.innerHeight - pad;
      const fitsAbove = above >= pad;
      left = clampX(at.x + at.w / 2 - r.width / 2);
      top = clampY(place === "above" ? (fitsAbove || !fitsBelow ? above : below) : fitsBelow || !fitsAbove ? below : above);
    }
    setPos({ left: Math.round(left), top: Math.round(top) });
  }, [at, text, place]);

  useEffect(() => {
    const shut = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", shut, true);
    window.addEventListener("contextmenu", shut, true);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", shut, true);
      window.removeEventListener("contextmenu", shut, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="tooltip"
      role="tooltip"
      ref={ref}
      data-placed={pos ? "yes" : "no"}
      style={pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : undefined}
    >
      {text}
    </div>,
    document.body,
  );
}
