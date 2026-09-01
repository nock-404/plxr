"use client";

import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

// The one text field.
//
// It names itself. Without a class of its own it was only ever dressed by
// whatever surrounded it — a field in the header looked right, the same field
// in an inbox row fell back to whatever the browser draws, which in a skinned
// interface is the one thing that can never fit.
const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...rest }, ref) {
    return <input ref={ref} className={`input ${className}`.trim()} spellCheck={false} {...rest} />;
  },
);

export default Input;
