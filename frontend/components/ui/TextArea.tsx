"use client";

import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";

// Several lines of text. The one place a multi-line box is built, so a skin has
// one thing to dress rather than each view carrying its own bare control.
const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className = "", ...rest }, ref) {
    return <textarea ref={ref} className={`input lines ${className}`.trim()} spellCheck={false} {...rest} />;
  },
);

export default TextArea;
