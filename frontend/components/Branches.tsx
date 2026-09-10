"use client";

import { ago } from "@/lib/format";
import { useCallback, useEffect, useState } from "react";
import Ask from "@/components/ui/Ask";
import Button from "@/components/ui/Button";
import { api } from "@/lib/api";
import { errCode, errText, tr, trN } from "@/lib/i18n";
import type { GitBranch } from "@/lib/types";

/* The branches of a folder, and moving between them.
 *
 * Switching is not made stricter than git: git carries uncommitted work across
 * whenever it can, and refusing a dirty tree would refuse the ordinary way of
 * working. What it does refuse is a switch while an agent is at work in this
 * folder — the files under a running instruction changing shape is how an
 * afternoon disappears — and that refusal can be overruled, because sometimes
 * that is exactly what somebody means to do.
 */
export default function Branches({ rootId }: { rootId: string }) {
  const [list, setList] = useState<GitBranch[] | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<{ kind: "new" } | { kind: "drop" | "insist"; name: string } | null>(null);

  const load = useCallback(() => {
    setProblem("");
    api
      .branches(rootId)
      .then(setList)
      .catch((e) => {
        setProblem(errText(e));
        setList([]);
      });
  }, [rootId]);

  useEffect(load, [load]);

  async function go(name: string, create = false, anyway = false) {
    setBusy(true);
    setProblem("");
    try {
      setList(await api.switchBranch(rootId, name, create, anyway));
    } catch (e) {
      setProblem(errText(e));
      /* A refusal because something is working here is the one worth offering a
         way past — the others are answers, not obstacles. Decided on the code,
         never on the sentence: the sentence is translated, and a check against
         it works in one language and quietly stops working in the other. */
      if (errCode(e) === "err.branch.busy") {
        setAsking({ kind: "insist", name });
      }
    }
    setBusy(false);
  }

  async function drop(name: string) {
    setBusy(true);
    setProblem("");
    try {
      setList(await api.deleteBranch(rootId, name));
    } catch (e) {
      setProblem(errText(e));
    }
    setBusy(false);
  }

  return (
    <div className="changes">
      <div className="rowInline">
        <Button onClick={load} disabled={busy}>{tr("git.again", "AGAIN")}</Button>
        <Button onClick={() => setAsking({ kind: "new" })} disabled={busy}>
          {tr("branch.new", "+ BRANCH")}
        </Button>
      </div>

      {problem ? <span className="notice warn">{problem}</span> : null}

      {list && list.length === 0 && !problem ? (
        <span className="notice">{tr("branch.none", "No branches here yet.")}</span>
      ) : null}

      {(list ?? []).map((b) => (
        <div key={b.name} className="branchrow">
          <span className="branchname" data-on={b.current ? "yes" : undefined}>
            {b.name}
          </span>
          {b.ahead || b.behind ? (
            <span className="branchdist">
              {b.ahead ? `+${b.ahead}` : ""}
              {b.behind ? ` −${b.behind}` : ""}
            </span>
          ) : null}
          {b.current ? (
            <span className="branchword">{tr("branch.here", "you are here")}</span>
          ) : (
            <>
              <Button tiny disabled={busy} onClick={() => void go(b.name)}>
                {tr("branch.switch", "GO")}
              </Button>
              <Button
                tiny
                disabled={busy}
                onClick={() => setAsking({ kind: "drop", name: b.name })}
                title={tr("branch.dropTip", "Remove it. Never one that holds commits nowhere else.")}
              >
                {tr("branch.drop", "DROP")}
              </Button>
            </>
          )}
          <span className="branchsubject" title={b.subject}>
            {b.subject}
          </span>
          <span className="logwhen">{ago(b.when)}</span>
        </div>
      ))}

      {asking?.kind === "new" ? (
        <Ask
          title={tr("branch.new", "+ BRANCH")}
          detail={tr("branch.newFrom", "It starts where you are standing now.")}
          field={tr("branch.name", "name")}
          confirmLabel={tr("common.create", "CREATE")}
          onCancel={() => setAsking(null)}
          onConfirm={(name) => {
            setAsking(null);
            if (name.trim()) void go(name.trim(), true);
          }}
        />
      ) : null}

      {asking?.kind === "drop" ? (
        <Ask
          title={tr("branch.dropHead", "remove this branch?")}
          detail={asking.name}
          confirmLabel={tr("branch.drop", "DROP")}
          danger
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const name = asking.name;
            setAsking(null);
            void drop(name);
          }}
        />
      ) : null}

      {asking?.kind === "insist" ? (
        <Ask
          title={tr("branch.busyHead", "switch anyway?")}
          detail={problem}
          confirmLabel={tr("branch.anyway", "SWITCH ANYWAY")}
          danger
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const name = asking.name;
            setAsking(null);
            void go(name, false, true);
          }}
        />
      ) : null}

      {list ? (
        <span className="hitSmall">{trN("branch.count", list.length, "{n} branch", "{n} branches")}</span>
      ) : null}
    </div>
  );
}
