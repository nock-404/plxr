"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { tr } from "@/lib/i18n";

/* Reach everything from the keyboard.
 *
 * ⌘K (Ctrl+K) opens a search over every command there is — open a view or a
 * session, pause or end one, start a new one, the settings, the layout. Type to
 * narrow, arrow to choose, Enter to run. It is the one place that knows all of
 * plxr's actions at once, so nothing is more than a few keystrokes away.
 */
export type Command = {
  id: string;
  label: string;
  group?: string;
  hint?: string;
  run: () => void;
};

// A loose match: the letters of the query appear in order in the text. So "ovw"
// finds "Overview" and "pausone" finds "Pause: one".
function score(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct; // a straight substring wins, earlier is better
  let qi = 0;
  let gaps = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
    else gaps++;
  }
  return qi === q.length ? 100 - Math.min(gaps, 99) : -1;
}

export default function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const matches = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, s: score(q, `${c.group ? c.group + " " : ""}${c.label}`) }))
      .filter((x) => x.s > -1);
    scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.c).slice(0, 50);
  }, [commands, q]);

  useEffect(() => setActive(0), [q]);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function run(c: Command | undefined) {
    if (!c) return;
    onClose();
    c.run();
  }

  return (
    <div className="paletteScrim" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <Input
          autoFocus
          value={q}
          placeholder={tr("palette.placeholder", "Type a command…")}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(matches.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(matches[active]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="paletteList" ref={listRef} role="listbox">
          {matches.length === 0 ? (
            <div className="paletteEmpty">{tr("palette.none", "no command matches")}</div>
          ) : (
            matches.map((c, i) => (
              <Button
                bare
                key={c.id}
                role="option"
                aria-selected={i === active}
                data-i={i}
                className={`paletteRow${i === active ? " on" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(c)}
              >
                {c.group ? <span className="paletteGroup">{c.group}</span> : null}
                <span className="paletteLabel">{c.label}</span>
                {c.hint ? <span className="paletteHint">{c.hint}</span> : null}
              </Button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
