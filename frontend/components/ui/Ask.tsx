"use client";

import { useEffect, useRef } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { tr } from "@/lib/i18n";

/* Asking before doing something that cannot be taken back.
 *
 * Never the browser's own confirm() or prompt(): those are drawn by the system,
 * wear none of the skin, and stop the whole page while they stand — in a window
 * that has no address bar they look like something has gone wrong.
 *
 * One component for both jobs. With `field` it asks for a word; without, it
 * asks a yes-or-no question.
 */
export default function Ask({
  title,
  detail,
  field,
  value = "",
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  detail?: string;
  field?: string;
  value?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (answer: string) => void;
  onCancel: () => void;
}) {
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    box.current?.focus();
    box.current?.select();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const answer = () => onConfirm(field ? (box.current?.value ?? "") : "");

  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="card ask" onClick={(e) => e.stopPropagation()}>
        <b className="cardTitle">{title}</b>
        {detail ? <p className="notice">{detail}</p> : null}
        {field ? (
          <label className="field">
            <span className="fieldName">{field}</span>
            <Input
              ref={box}
              defaultValue={value}
              onKeyDown={(e) => {
                if (e.key === "Enter") answer();
              }}
            />
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
    </div>
  );
}
