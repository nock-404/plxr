"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { api } from "@/lib/api";
import { tr, errText } from "@/lib/i18n";
import type { Mark, MarkChange } from "@/lib/types";

// A git tree captured before each instruction, so a change can be walked back.
export default function Marks({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [note, setNote] = useState("");
  /* Which mark is unfolded, and what it covers.
     The panel showed a count of files and no way to see which — the route that
     lists them was there from the start and nothing called it. */
  const [openTree, setOpenTree] = useState("");
  const [changes, setChanges] = useState<MarkChange[]>([]);

  const load = useCallback(() => {
    api.marks(sessionId).then((m) => setMarks(m ?? [])).catch(() => setMarks([]));
  }, [sessionId]);

  useEffect(load, [load]);

  async function unfold(tree: string) {
    if (openTree === tree) {
      setOpenTree("");
      return;
    }
    setOpenTree(tree);
    setChanges([]);
    setNote("");
    try {
      setChanges(await api.markChanges(sessionId, tree));
    } catch (e) {
      setNote(errText(e));
    }
  }

  /* No path means all of them. That is what the button always meant, and what
     it never did: the path travelled as a query parameter the window never
     sent, so git was asked for "tree:" — the tree itself — and the answer was
     written over the directory. It failed every single time. */
  async function restore(tree: string, path = "") {
    setNote("");
    try {
      const { restored } = await api.markRestore(sessionId, tree, path);
      setNote(tr("marks.restored", "{n} put back", { n: restored }));
      if (openTree === tree) void unfold(tree), setOpenTree(tree);
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
              <Button tiny onClick={() => void unfold(m.tree)}>
                {openTree === m.tree
                  ? tr("marks.hide", "HIDE")
                  : tr("marks.show", "WHICH FILES")}
              </Button>
              <Button tiny onClick={() => void restore(m.tree)}>
                {tr("marks.restore", "RESTORE")}
              </Button>
              {openTree === m.tree ? (
                <div className="markfiles">
                  {changes.length === 0 ? (
                    <span className="notice">{tr("marks.noChanges", "Nothing differs from this mark.")}</span>
                  ) : (
                    changes.map((c) => (
                      <span key={c.path} className="markfile">
                        <span className="markstate" data-state={c.status}>{c.status}</span>
                        <span className="markpath">{c.path}</span>
                        <Button
                          tiny
                          disabled={c.status === "A"}
                          title={
                            c.status === "A"
                              ? tr("marks.wasAdded", "Made since the mark — there is nothing to put back.")
                              : tr("marks.restoreOne", "Put this one file back")
                          }
                          onClick={() => void restore(m.tree, c.path)}
                        >
                          {tr("marks.restore", "RESTORE")}
                        </Button>
                      </span>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
