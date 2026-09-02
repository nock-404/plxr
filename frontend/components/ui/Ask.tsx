"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import FolderPick from "@/components/ui/FolderPick";
import PathField from "@/components/ui/PathField";
import { tr } from "@/lib/i18n";

/* Asking before doing something that cannot be taken back.
 *
 * Never the browser's own confirm() or prompt(): those are drawn by the system,
 * wear none of the skin, and stop the whole page while they stand — in a window
 * that has no address bar they look like something has gone wrong.
 *
 * One component for both jobs. With `field` it asks for a word; without, it
 * asks a yes-or-no question. With `path` on top, the word is a directory and
 * the field completes it — nobody types a path out by hand.
 */
export default function Ask({
  title,
  detail,
  field,
  path = false,
  value = "",
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  detail?: string;
  field?: string;
  path?: boolean;
  value?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (answer: string) => void;
  onCancel: () => void;
}) {
  const box = useRef<HTMLInputElement>(null);
  // Only the completing field needs state: the plain one is read off the DOM
  // when the answer is given, which keeps every keystroke out of React.
  const [typed, setTyped] = useState(value);
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    box.current?.focus();
    box.current?.select();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const answer = () => {
    if (!field) return onConfirm("");
    onConfirm(path ? typed : (box.current?.value ?? ""));
  };

  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="card ask" onClick={(e) => e.stopPropagation()}>
        <b className="cardTitle">{title}</b>
        {detail ? <p className="notice">{detail}</p> : null}
        {field ? (
          <label className="field">
            <span className="fieldName">{field}</span>
            {path ? (
              <span className="rowInline">
                <PathField value={typed} onChange={setTyped} />
                <Button onClick={() => setBrowsing(true)}>{tr("folder.browse", "BROWSE")}</Button>
              </span>
            ) : (
              <Input
                ref={box}
                defaultValue={value}
                onKeyDown={(e) => {
                  if (e.key === "Enter") answer();
                }}
              />
            )}
          </label>
        ) : null}
        <div className="cardButtons">
          <span className="spacer" />
          <Button onClick={onCancel}>{tr("common.cancel", "CANCEL")}</Button>
          <Button primary danger={danger} onClick={answer}>
            {confirmLabel}
          </Button>
        </div>
      </div>

      {browsing ? (
        <FolderPick
          start={typed}
          onCancel={() => setBrowsing(false)}
          onChoose={(picked) => {
            setTyped(picked);
            setBrowsing(false);
          }}
        />
      ) : null}
    </div>
  );
}
