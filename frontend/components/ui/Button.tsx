"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

// The one button. Feature code never reaches for a raw <button>.
export default function Button({
  primary = false,
  tiny = false,
  icon = false,
  on = false,
  danger = false,
  bare = false,
  busy = false,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean;
  tiny?: boolean;
  icon?: boolean;
  on?: boolean;
  /* Marks the one action in a dialog that cannot be taken back, so it does not
     look like the other buttons beside it. */
  danger?: boolean;
  /* Working on it. Not the same as unavailable, though both refuse a click: a
     button that cannot be used may fade into the background, and one that is
     busy is often the only thing reporting what is happening — this one has the
     percentage written on it. Fading that out to four tenths made the progress
     unreadable, which is the one thing it was there for. */
  busy?: boolean;
  /* A row, a tab or a list item that happens to be clickable. It still has to
     be a button — for the keyboard, and for anything reading the screen out
     loud — but it carries none of a button's dressing, because it is dressed as
     whatever it is. Before this existed, seven views reached for a raw <button>
     to get it. */
  bare?: boolean;
  children: ReactNode;
}) {
  const cls = [!bare && "btn", primary && "primary", tiny && "tiny", icon && "icon", on && "on", danger && "danger", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={cls} data-busy={busy ? "yes" : undefined} disabled={busy || rest.disabled} {...rest}>
      {children}
    </button>
  );
}
