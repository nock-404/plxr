"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchAddon } from "@xterm/addon-search";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { tr } from "@/lib/i18n";

// Find in the scrollback of the pane that has focus.
export default function Find({ addon, onClose }: { addon: SearchAddon | null; onClose: () => void }) {
  const [q, setQ] = useState("");
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  function step(back: boolean) {
    if (!addon || !q) return;
    if (back) addon.findPrevious(q);
    else addon.findNext(q);
  }

  return (
    <div className="find">
      <span className="prompt">{tr("find.prompt", "find>")}</span>
      <Input
        ref={field}
        value={q}
        placeholder={tr("find.terminalPlaceholder", "Search the scrollback…")}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey);
          }
          if (e.key === "Escape") onClose();
        }}
      />
      <Button tiny onClick={() => step(true)}>↑</Button>
      <Button tiny onClick={() => step(false)}>↓</Button>
      <Button tiny onClick={onClose}>✕</Button>
    </div>
  );
}
