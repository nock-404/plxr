"use client";

import Tooltip from "@/components/ui/Tooltip";

// A switch. Two states, one word, and it says which one it is in — never a
// checkbox, which in a skinned interface would be whatever the system draws.
export default function Toggle({
  on,
  onChange,
  children,
  tip,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  children: React.ReactNode;
  /* A hint shown on hover — through the one tooltip, never a native title. */
  tip?: string;
}) {
  return (
    <Tooltip text={tip}>
      <button
        type="button"
        className="styleToggle"
        role="switch"
        aria-checked={on}
        data-on={on ? "yes" : "no"}
        onClick={() => onChange(!on)}
      >
        {children}
      </button>
    </Tooltip>
  );
}
