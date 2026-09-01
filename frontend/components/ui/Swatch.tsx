"use client";

import { useEffect, useRef, useState } from "react";

// One colour of a palette: the patch shows it, the field holds the value.
//
// Deliberately not `<input type="color">` — that opens the operating system's
// picker, which is the one thing in a fully skinned interface that cannot be
// skinned. A hex field is typed, pasted and read out loud; the patch beside it
// is what the eye checks.
export default function Swatch({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (hex: string) => void;
  children: React.ReactNode;
}) {
  const [text, setText] = useState(value);
  const typing = useRef(false);

  useEffect(() => {
    if (!typing.current) setText(value);
  }, [value]);

  function accept(next: string) {
    setText(next);
    // Only a complete colour is applied: while somebody types "#1f9" the
    // interface should not flash through three wrong shades.
    if (/^#[0-9a-fA-F]{6}$/.test(next.trim())) onChange(next.trim().toLowerCase());
  }

  return (
    <div className="styleRow">
      <span className="styleName">{children}</span>
      <span className="swatch" style={{ background: value }} aria-hidden="true" />
      <input
        className="swatchHex"
        spellCheck={false}
        value={text}
        aria-label={typeof children === "string" ? children : undefined}
        onFocus={() => (typing.current = true)}
        onBlur={() => {
          typing.current = false;
          setText(value);
        }}
        onChange={(e) => accept(e.target.value)}
      />
    </div>
  );
}
