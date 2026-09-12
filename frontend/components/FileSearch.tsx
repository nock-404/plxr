"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { api } from "@/lib/api";
import { copyText } from "@/lib/browser";
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

/* The matched stretches of a line, lit.
 *
 * The service counts in bytes — the offsets are into UTF-8 — and the window
 * counts in characters. For an ASCII line they agree; for "été" they do not,
 * and a highlight one byte to the right of the word is a highlight on the
 * wrong letters. So the bytes are walked once, character by character. */
function lit(text: string, ranges: [number, number][]): React.ReactNode[] {
  if (!ranges.length) return [text];
  const encoder = new TextEncoder();
  // The character index at which each byte offset starts.
  const charAt: number[] = [];
  let bytes = 0;
  for (const [i, ch] of [...text].entries()) {
    const n = encoder.encode(ch).length;
    for (let b = 0; b < n; b++) charAt[bytes + b] = i;
    bytes += n;
  }
  charAt[bytes] = [...text].length;
  const chars = [...text];
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const [from, to] of ranges) {
    const a = charAt[from] ?? chars.length;
    const b = charAt[to] ?? chars.length;
    if (a < at || b <= a) continue;
    if (a > at) out.push(chars.slice(at, a).join(""));
    out.push(
      <mark key={from} className="findmark">
        {chars.slice(a, b).join("")}
      </mark>,
    );
    at = b;
  }
  if (at < chars.length) out.push(chars.slice(at).join(""));
  return out;
}

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

  const ctx = useContextMenu();
  /* A hit under the right button: the editor at that line, the path to the
     clipboard, the file where the system shows files. The file's own line
     above its hits offers the same, without a line to land on. */
  const reveal = (path: string) => void api.revealFile(rootId, path).catch((e) => setProblem(errText(e)));
  const hitMenu = (path: string, line: number): MenuItem[] => [
    { label: tr("find.openAt", "Open at line {n}", { n: line }), onClick: () => onOpen(path, line) },
    { separator: true },
    { label: tr("files.copy", "COPY PATH"), onClick: () => copyText(path) },
    { label: tr("files.reveal", "SHOW"), onClick: () => reveal(path) },
  ];
  const fileMenu = (path: string, first: number): MenuItem[] => [
    { label: tr("files.menuOpen", "Open"), onClick: () => onOpen(path, first) },
    { separator: true },
    { label: tr("files.copy", "COPY PATH"), onClick: () => copyText(path) },
    { label: tr("files.reveal", "SHOW"), onClick: () => reveal(path) },
  ];

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
            data-do="find-what"
            placeholder={tr("find.what", "What to look for")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run();
            }}
          />
          <Button data-do="find-go" onClick={() => void run()} disabled={busy || !text.trim()}>
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
            <div key={path} className="findfile" data-path={path}>
              <span className="findpath" onContextMenu={ctx(fileMenu(path, hits[0]?.line ?? 1))}>{path}</span>
              {hits.map((h) => (
                <Button
                  bare
                  key={`${h.line}`}
                  className="findline"
                  data-line={h.line}
                  onClick={() => onOpen(h.path, h.line)}
                  onContextMenu={ctx(hitMenu(h.path, h.line))}
                  aria-label={tr("find.openAt", "Open at line {n}", { n: h.line })}
                >
                  <span className="findno">{h.line}</span>
                  <span className="findtext">{lit(h.text, h.ranges)}</span>
                </Button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
