"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";

/* A link that looks like a button.
 *
 * A plain onClick cannot do what this does: the window sandbox blocks a
 * script-driven window.open of a foreign origin, so a real anchor with
 * target="_blank" is the only way to send a page to the actual browser. The one
 * place feature code is allowed a native <a> is here, the way Button wraps the
 * one native <button>.
 */
export default function LinkButton({
  tiny = false,
  className = "",
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { tiny?: boolean; children: ReactNode }) {
  const cls = ["btn", tiny && "tiny", className].filter(Boolean).join(" ");
  return (
    <a className={cls} {...rest}>
      {children}
    </a>
  );
}
