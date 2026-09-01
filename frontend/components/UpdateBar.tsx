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
  const [percent, setPercent] = useState(0);

  /* Starting an update is not finishing one.
   *
   * The daemon takes the request, begins the work and answers immediately — its
   * own comment says the interface is expected to ask how far along it is. The
   * window instead treated that first answer as "done": the moment INSTALL was
   * pressed the button turned into RESTART, and pressing that said "nothing was
   * swapped in", because nothing had been. No progress was ever shown either.
   *
   * So it asks, until the daemon says it has finished or failed.
   */
  async function install() {
    setProblem("");
    setState("working");
    setPercent(0);
    try {
      await api.updateApply();
    } catch (e) {
      setProblem(errText(e));
      setState("failed");
      return;
    }
    while (true) {
      await new Promise((r) => setTimeout(r, 700));
      let progress;
      try {
        progress = await api.updateProgress();
      } catch (e) {
        setProblem(errText(e));
        setState("failed");
        return;
      }
      setPercent(progress.percent);
      if (progress.error) {
        setProblem(progress.error);
        setState("failed");
        return;
      }
      if (progress.done) {
        setState("done");
        return;
      }
    }
  }

  useEffect(() => watchVersion(setInfo), []);

  /* Two different things can be true, and only one used to be shown.
   *
   * A newer version exists — install it. Or: a newer version is already on
   * disk and this process is still the old one — restart. The second is the
   * state an update leaves behind, and it was invisible: the band simply
   * vanished, because the daemon had been told to call itself the new version.
   * Then nothing explained why the interface was still the old one. */
  const needsRestart = Boolean(info && info.installed && info.installed !== info.current);
  if (!info || (!info.available && !needsRestart) || hidden) return null;

  return (
    <div className="updatebar">
      <span>
        {needsRestart
          ? tr("update.restartToUse", "plxr {installed} is installed — this window is still running {current}.", {
              installed: info.installed,
              current: info.current,
            })
          : tr("update.available", "plxr {latest} is out — you are on {current}.", {
              latest: info.latest,
              current: info.current,
            })}
      </span>
      {problem ? <span className="notice warn">{problem}</span> : null}
      <span className="spacer" />
      {state === "done" || needsRestart ? (
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
        <Button primary busy={state === "working"} onClick={install}>
          {state === "working"
            ? `${tr("update.installing", "INSTALLING")} ${percent}%`
            : state === "failed"
              ? tr("update.retry", "TRY AGAIN")
              : tr("update.install", "INSTALL")}
        </Button>
      )}
      <Button onClick={() => setHidden(true)}>{tr("update.later", "LATER")}</Button>
    </div>
  );
}
