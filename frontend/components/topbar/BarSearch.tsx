"use client";

import { useRef } from "react";
import Icon from "@/components/ui/Icon";
import Input from "@/components/ui/Input";
import Tooltip from "@/components/ui/Tooltip";
import { tr } from "@/lib/i18n";
import { bindingOf, caption, matches } from "@/lib/keymap";

/* The search field in the middle of the top bar.
 *
 * The ⌘K palette was reachable by its key and by a row of the MENU, and by
 * nothing a person could see and type into. This is the field every editor
 * has there, with the chord written in it: whatever is typed opens the palette
 * on it, and the typing carries on in the palette. Enter, ↓ or the palette's
 * own chord open it with nothing typed. It never holds text of its own — the
 * palette is where the text lives.
 */
export default function BarSearch({ onOpen }: { onOpen: (text: string) => void }) {
  const field = useRef<HTMLInputElement>(null);
  const chord = bindingOf("palette");
  const key = chord ? caption(chord) : "";
  const label = tr("header.search", "Search commands, sessions, files");
  const tip = tr("header.searchTip", "Search everything — commands, sessions and files");
  return (
    <Tooltip text={key ? `${tip} ${key}` : tip}>
      <div
        className="barSearch"
        data-do="search"
        // A press on the mark or the chord puts the cursor in the field.
        onMouseDown={(e) => {
          if (e.target === field.current) return;
          e.preventDefault();
          field.current?.focus();
        }}
      >
        <span className="barSearchIcon">
          <Icon name="search" />
        </span>
        <Input
          ref={field}
          className="barSearchInput"
          value=""
          placeholder={label}
          aria-label={label}
          onChange={(e) => {
            const text = e.target.value;
            if (text) onOpen(text);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "ArrowDown" || matches(e.nativeEvent, "palette")) {
              e.preventDefault();
              onOpen("");
            }
          }}
        />
        {key ? <span className="barSearchKey">{key}</span> : null}
      </div>
    </Tooltip>
  );
}
