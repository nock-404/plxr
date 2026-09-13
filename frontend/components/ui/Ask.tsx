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
  heading,
  detail,
  field,
  path = false,
  value = "",
  confirmLabel,
  danger = false,
  third,
  onConfirm,
  onCancel,
  children,
}: {
  /* What the dialog asks, as its heading. Named so, and not "title", because a
     title on an element is the system's own tooltip — see ui/Tooltip. */
  heading: string;
  detail?: string;
  field?: string;
  path?: boolean;
  value?: string;
  confirmLabel: string;
  danger?: boolean;
  /* A third way out, beside yes and no — "terminate" next to "keep running".
     The question is closed either way; which of the two was chosen is the
     caller's to hear. */
  third?: { label: string; danger?: boolean; onClick: () => void };
  onConfirm: (answer: string) => void;
  onCancel: () => void;
  /* A choice that belongs to the question, under the field — "share the
     history" beside the directory an account is taken from. */
  children?: React.ReactNode;
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
        <b className="cardTitle">{heading}</b>
        {detail ? <p className="notice">{detail}</p> : null}
        {field ? (
          <label className="field">
            <span className="fieldName">{field}</span>
            {path ? (
              <span className="rowInline">
                <PathField value={typed} onChange={setTyped} onSubmit={answer} />
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
        {children}
        <div className="cardButtons">
          <span className="spacer" />
          <Button onClick={onCancel}>{tr("common.cancel", "CANCEL")}</Button>
          {third ? (
            <Button danger={third.danger} onClick={third.onClick}>
              {third.label}
            </Button>
          ) : null}
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
