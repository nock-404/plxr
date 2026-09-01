"use client";

// A switch. Two states, one word, and it says which one it is in — never a
// checkbox, which in a skinned interface would be whatever the system draws.
export default function Toggle({
  on,
  onChange,
  children,
  title,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="styleToggle"
      role="switch"
      aria-checked={on}
      data-on={on ? "yes" : "no"}
      title={title}
      onClick={() => onChange(!on)}
    >
      {children}
    </button>
  );
}
