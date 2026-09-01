"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import type { VersionInfo } from "@/lib/types";

// Window and daemon are two programs. When a newer build exists, say so here
// rather than leaving it to be discovered.
export default function UpdateBar() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [hidden, setHidden] = useState(false);
  const [state, setState] = useState<"idle" | "working" | "done" | "failed">("idle");

  // Window and daemon are two programs: after the swap both have to come back,
  // or the interface shows one version and runs another.
  async function install() {
    setState("working");
    try {
      await api.updateApply();
      setState("done");
    } catch {
      setState("failed");
    }
  }

  useEffect(() => {
    api.version().then(setInfo).catch(() => setInfo(null));
  }, []);

  if (!info || !info.available || hidden) return null;

  return (
    <div className="updatebar">
      <span>
        {tr("update.available", "plxr {latest} is out — you are on {current}.", {
          latest: info.latest,
          current: info.current,
        })}
      </span>
      <span className="spacer" />
      {state === "done" ? (
        <Button primary onClick={() => api.restart().catch(() => undefined)}>
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
