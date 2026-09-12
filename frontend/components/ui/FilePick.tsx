"use client";

import { useRef } from "react";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";

/* Choosing a file from the machine.
 *
 * The picker itself is the system's — there is no way to open it that is not,
 * and a page cannot read a file the person did not point at. What can be ours
 * is everything around it: the button that opens it wears the skin, and the
 * bare control is hidden here rather than sitting in a view.
 */
export default function FilePick({
  accept,
  label,
  tip,
  onPick,
}: {
  accept?: string;
  label: string;
  /* A hint shown on hover — through the one tooltip, never a native title. */
  tip?: string;
  onPick: (file: File) => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  return (
    <>
      <Tooltip text={tip}>
        <Button onClick={() => field.current?.click()}>{label}</Button>
      </Tooltip>
      <input
        ref={field}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          // Cleared, so picking the same file twice in a row still counts.
          e.target.value = "";
        }}
      />
    </>
  );
}
