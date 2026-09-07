"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { api } from "@/lib/api";
import { errText, tr, trN } from "@/lib/i18n";
import type { GitDiff } from "@/lib/types";

/* One file's difference, drawn from git's own unified diff.
 *
 * Not a merge view: that is a dependency with a stylesheet of its own, and it
 * would fight four skins for the colours. This way there is one parser — git's
 * output, read once in Go — and every colour comes from the palette like
 * everything else in the window.
 *
 * It sits in the wide area rather than in the column beside the list, because a
 * line of code is wider than a file name and wrapping every one of them makes a
 * hunk unreadable.
 */
/* git's own letters turned into words the stylesheet can be held to.
 *
 * The attribute used to carry the letter straight from the data — data-kind="+"
 * — and attributes.py could not see it: a value that only exists at runtime is
 * a value no check can match against a rule. So the four kinds are spelled out
 * here, and the skin styles those. */
function kindOf(kind: string): string {
  if (kind === "+") return "add";
  if (kind === "-") return "del";
  if (kind === "\\") return "note";
  return "keep";
}

export default function Difference({
  rootId,
  path,
  staged,
  onClose,
}: {
  rootId: string;
  path: string;
  staged: boolean;
  onClose: () => void;
}) {
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let dropped = false;
    setDiff(null);
    setProblem("");
    api
      .diff(rootId, path, staged)
      .then((d) => !dropped && setDiff(d))
      .catch((e) => !dropped && setProblem(errText(e)));
    return () => {
      dropped = true;
    };
  }, [rootId, path, staged]);

  const name = path.split("/").pop() ?? path;

  return (
    <div className="overlay viewer">
      <div className="overlayBar">
        <span className="overlayName">{name}</span>
        <span className="meta">
          {staged ? tr("git.staged", "staged") : tr("git.unstaged", "not staged")}
          {diff && !diff.binary && !diff.empty
            ? ` · ${trN("git.hunks", diff.hunks.length, "{n} place", "{n} places")}`
            : ""}
        </span>
        <span className="spacer" />
        <Button onClick={onClose}>{tr("common.back", "BACK")}</Button>
      </div>
      <div className="viewerwrap diffwrap">
        {problem ? (
          <span className="notice warn">{problem}</span>
        ) : !diff ? (
          <span className="notice">{tr("common.working", "…")}</span>
        ) : diff.binary ? (
          <div className="emptyNote">
            <b>{tr("git.binary", "binary")}</b>
            {tr("git.binaryDiff", "A binary file — there is nothing to read here.")}
          </div>
        ) : diff.empty ? (
          <div className="emptyNote">
            <b>{tr("git.sameHead", "no difference")}</b>
            {tr("git.same", "This file matches what it is compared against.")}
          </div>
        ) : (
          diff.hunks.map((h, i) => (
            <div key={i} className="hunk">
              <span className="hunkhead">{h.header}</span>
              {h.lines.map((l, j) => (
                <span key={j} className="diffline" data-kind={kindOf(l.kind)}>
                  <span className="diffno">{l.old || ""}</span>
                  <span className="diffno">{l.new || ""}</span>
                  <span className="diffmark">{l.kind === " " ? "" : l.kind}</span>
                  <span className="difftext">{l.text}</span>
                </span>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
