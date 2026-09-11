"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import { api } from "@/lib/api";
import { errText, tr, trN } from "@/lib/i18n";
import type { FindReport } from "@/lib/types";

/* Searching every file of a folder.
 *
 * The other search in plxr goes through Claude transcripts; this one goes
 * through the project. Measured on the trees this is for it answers in about a
 * tenth of a second, so it is one request and one answer — no socket, no job to
 * poll, nothing to cancel.
 *
 * What it will not do is pretend. Every bound the daemon hit comes back named,
 * and is said out loud here, because a short list that looks complete is worse
 * than a short list that admits it.
 */
const CAPPED: Record<string, [string, string]> = {
  hits: ["find.cappedHits", "the first {n} lines only"],
  files: ["find.cappedFiles", "the first {n} files only"],
  size: ["find.cappedSize", "very large files were left out"],
  line: ["find.cappedLine", "long lines were cut"],
  time: ["find.cappedTime", "it ran out of time"],
  ignore: ["find.cappedIgnore", "the project's ignore rules were not applied — git did not answer"],
};

export default function FileSearch({
  rootId,
  onOpen,
}: {
  rootId: string;
  onOpen: (path: string, line: number) => void;
}) {
  const [text, setText] = useState("");
  const [glob, setGlob] = useState("");
  const [regex, setRegex] = useState(false);
  const [word, setWord] = useState(false);
  const [caseOn, setCaseOn] = useState(false);
  const [report, setReport] = useState<FindReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function run() {
    if (!text.trim()) return;
    setBusy(true);
    setProblem("");
    try {
      setReport(await api.find(rootId, { text, glob, regex, word, case: caseOn }));
    } catch (e) {
      setProblem(errText(e));
      setReport(null);
    }
    setBusy(false);
  }

  // Grouped by file, because that is how somebody reads a result: which files,
  // then where in them.
  const byFile = new Map<string, FindReport["hits"]>();
  for (const hit of report?.hits ?? []) {
    if (!byFile.has(hit.path)) byFile.set(hit.path, []);
    byFile.get(hit.path)!.push(hit);
  }

  return (
    <div className="filesearch">
      <div className="field">
        <span className="rowInline">
          <Input
            value={text}
            placeholder={tr("find.what", "What to look for")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run();
            }}
          />
          <Button onClick={() => void run()} disabled={busy || !text.trim()}>
            {busy ? tr("common.working", "…") : tr("find.go", "FIND")}
          </Button>
        </span>
        <span className="rowInline">
          <Toggle on={caseOn} onChange={setCaseOn}>
            {tr("find.case", "Aa")}
          </Toggle>
          <Toggle on={word} onChange={setWord}>
            {tr("find.word", "WORD")}
          </Toggle>
          <Toggle on={regex} onChange={setRegex}>
            {tr("find.regex", ".*")}
          </Toggle>
          <Input
            value={glob}
            placeholder={tr("find.glob", "*.go")}
            onChange={(e) => setGlob(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run();
            }}
          />
        </span>
      </div>

      {problem ? <span className="notice warn">{problem}</span> : null}

      {report ? (
        <div className="findresult">
          {/* One line in one file, not "1 lines in 1 files". */}
          <span className="hitSmall">
            {trN("find.lines", report.hits.length, "{n} line", "{n} lines")}
            {" "}
            {trN("find.files", report.files, "in {n} file", "in {n} files")}
            {` · ${report.took_ms} ms`}
          </span>
          {report.capped.length ? (
            <span className="notice warn">
              {report.capped
                .map((c) => {
                  const [key, fallback] = CAPPED[c] ?? ["find.cappedOther", c];
                  return tr(key, fallback, { n: c === "hits" ? 500 : 20000 });
                })
                .join(" · ")}
            </span>
          ) : null}
          {report.hits.length === 0 ? (
            <span className="notice">{tr("find.nothing", "Nothing in this folder contains that.")}</span>
          ) : null}
          {[...byFile.entries()].map(([path, hits]) => (
            <div key={path} className="findfile">
              <span className="findpath">{path}</span>
              {hits.map((h) => (
                <Button
                  bare
                  key={`${h.line}`}
                  className="findline"
                  onClick={() => onOpen(h.path, h.line)}
                  title={tr("find.openAt", "Open at line {n}", { n: h.line })}
                >
                  <span className="findno">{h.line}</span>
                  <span className="findtext">{h.text}</span>
                </Button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
