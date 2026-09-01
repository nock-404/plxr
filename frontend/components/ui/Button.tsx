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
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}
