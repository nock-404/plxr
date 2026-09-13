"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { FILES_CHANGED, type FilesChanged } from "@/lib/useChanges";

/* The branch a session or a folder is on.
 *
 * A session whose hook reports one brings its own; for a plain shell or a
 * folder picked on its own git is asked when it becomes the one shown, and
 * again when the live feed says HEAD moved under it. "" when it is no
 * repository, or HEAD is detached. The project switch and the status bar read
 * it the same way. */
export function useBranch(rootId: string, reported: string): string {
  const [asked, setAsked] = useState<{ root: string; branch: string } | null>(null);
  useEffect(() => {
    if (!rootId || reported) return;
    let dropped = false;
    const ask = () =>
      api
        .position(rootId)
        .then((w) => !dropped && setAsked({ root: rootId, branch: w.detached ? "" : w.branch }))
        // Not a repository is an ordinary answer: no branch to show.
        .catch(() => !dropped && setAsked({ root: rootId, branch: "" }));
    void ask();
    const moved = (e: Event) => {
      const detail = (e as CustomEvent<FilesChanged>).detail;
      if (detail?.rootId === rootId && detail.head) void ask();
    };
    window.addEventListener(FILES_CHANGED, moved);
    return () => {
      dropped = true;
      window.removeEventListener(FILES_CHANGED, moved);
    };
  }, [rootId, reported]);
  return reported || (asked && asked.root === rootId ? asked.branch : "");
}
