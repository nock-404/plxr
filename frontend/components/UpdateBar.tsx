"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { api } from "@/lib/api";
import { watchVersion } from "@/lib/version";
import { errText, tr } from "@/lib/i18n";
import type { VersionInfo } from "@/lib/types";

// Window and daemon are two programs. When a newer build exists, say so here
// rather than leaving it to be discovered.
export default function UpdateBar() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [hidden, setHidden] = useState(false);
  const [state, setState] = useState<"idle" | "working" | "done" | "failed" | "restarting">("idle");
  const [problem, setProblem] = useState("");

  // Window and daemon are two programs: after the swap both have to come back,
  // or the interface shows one version and runs another.
  async function install() {
    setState("working");
    try {
      await api.updateApply();
      setState("done");
    } catch (e) {
      setProblem(errText(e));
      setState("failed");
    }
  }

  useEffect(() => watchVersion(setInfo), []);

  if (!info || !info.available || hidden) return null;

  return (
    <div className="updatebar">
      <span>
        {tr("update.available", "plxr {latest} is out — you are on {current}.", {
          latest: info.latest,
          current: info.current,
        })}
      </span>
      {problem ? <span className="notice warn">{problem}</span> : null}
      <span className="spacer" />
      {state === "done" ? (
        <Button
          primary
          onClick={async () => {
            setState("restarting");
            try {
              await api.restart();
            } catch (e) {
              /* A refusal used to be thrown away here, so a button that could
                 not do its job did nothing and said nothing. */
              setProblem(errText(e));
              setState("done");
            }
          }}
        >
          {tr("version.splitGo", "RESTART")}
        </Button>
      ) : (
        <Button
          primary
          disabled={state === "working"}
          onClick={install}
        >
          {state === "working"
            ? tr("update.installing", "INSTALLING…")
            : state === "failed"
              ? tr("update.retry", "TRY AGAIN")
              : tr("update.install", "INSTALL")}
        </Button>
      )}
      <Button onClick={() => setHidden(true)}>{tr("update.later", "LATER")}</Button>
    </div>
  );
}
