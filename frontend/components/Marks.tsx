"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { api } from "@/lib/api";
import { tr, errText } from "@/lib/i18n";
import type { Mark } from "@/lib/types";

// A git tree captured before each instruction, so a change can be walked back.
export default function Marks({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    api.marks(sessionId).then((m) => setMarks(m ?? [])).catch(() => setMarks([]));
  }, [sessionId]);

  useEffect(load, [load]);

  async function restore(tree: string) {
    setNote("");
    try {
      await api.markRestore(sessionId, tree);
      setNote(tr("marks.restored", "restored"));
      load();
    } catch (e) {
      setNote(errText(e));
    }
  }

  return (
    <div className="overlay">
      <div className="overlayBar">
        <span className="overlayName">{tr("marks.title", "Marks")}</span>
        <span className="meta">{note || marks.length}</span>
        <span className="spacer" />
        <Button onClick={onClose}>{tr("common.back", "BACK")}</Button>
      </div>
      <div className="ruleslist">
        {marks.length === 0 ? (
          <div className="emptyNote">
            <b>{tr("marks.emptyHead", "no marks yet")}</b>
            {tr("marks.empty", "A mark is taken before every instruction, once this session is in a git repository.")}
          </div>
        ) : (
          marks.map((m) => (
            <div key={m.tree} className="rrow">
              <span className="rart">{new Date(m.at).toLocaleTimeString(undefined, { hour12: false })}</span>
              <span className="rmain">
                <span className="rtitle">{m.instruction || m.tree.slice(0, 10)}</span>
                <span className="rdesc">
                  {m.files} {tr("marks.files", "files")}
                </span>
              </span>
              <Button tiny onClick={() => restore(m.tree)}>
                {tr("marks.restore", "RESTORE")}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
