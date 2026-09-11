"use client";

import { useEffect, useState } from "react";
import Changes from "@/components/Changes";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";

/* Git source control as a panel of its own — the changes in the folder you are
 * in, dockable beside a terminal the way an editor puts its source-control view
 * beside the code. Clicking a file opens its diff as another panel.
 *
 * The folder is the one the path field points at; the panel turns that path
 * into a workspace the daemon knows, which is the id the git calls need.
 */
export default function ChangesPanel({
  here,
  onDiff,
}: {
  here: string;
  onDiff: (rootId: string, path: string, staged: boolean, title: string) => void;
}) {
  const [rootId, setRootId] = useState<string | null>(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    setProblem("");
    setRootId(null);
    if (!here) return;
    let gone = false;
    api
      .openWorkspace(here)
      .then((w) => !gone && setRootId(w.id))
      .catch(() => !gone && setProblem(tr("changesPanel.noFolder", "This is not a folder git knows.")));
    return () => {
      gone = true;
    };
  }, [here]);

  if (!here) {
    return (
      <div className="emptyNote">
        <b>{tr("changesPanel.emptyHead", "no folder")}</b>
        {tr("changesPanel.empty", "Choose a folder in the path field, then this shows what changed in it.")}
      </div>
    );
  }
  if (problem) return <div className="emptyNote">{problem}</div>;
  if (!rootId) return <div className="emptyNote">{tr("changesPanel.loading", "reading…")}</div>;

  return (
    <div className="changesPanel">
      <Changes
        rootId={rootId}
        shown={null}
        onShow={(what) => {
          if (what) onDiff(rootId, what.path, what.staged, what.path.split("/").pop() ?? what.path);
        }}
      />
    </div>
  );
}
