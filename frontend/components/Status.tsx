"use client";

import { useCallback, useEffect, useState } from "react";
import Remote from "@/components/Remote";
import Button from "@/components/ui/Button";
import Toggle from "@/components/ui/Toggle";
import { api } from "@/lib/api";
import { errText, tr } from "@/lib/i18n";
import type { HookState, VersionInfo } from "@/lib/types";

// What is actually running, and whether the hook that makes status detection
// reliable is in place. Without it every session reads "unknown". The
// accounts have a tab of their own now — see Accounts.
export default function Status() {
  const [hook, setHook] = useState<HookState | null>(null);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [meter, setMeter] = useState(false);

  useEffect(() => {
    void api.prefs().then((p) => setMeter(Boolean(p.meter))).catch(() => undefined);
    // The header menu throws the same switch; the tab follows it.
    const onMeter = (e: Event) => setMeter(Boolean((e as CustomEvent).detail));
    window.addEventListener("METER_CHANGED", onMeter);
    return () => window.removeEventListener("METER_CHANGED", onMeter);
  }, []);

  const load = useCallback(() => {
    api.hook().then(setHook).catch(() => setHook(null));
    api.version().then(setVersion).catch(() => setVersion(null));
  }, []);

  useEffect(load, [load]);

  /* On and off, and it says when it could not.
   *
   * This was one function that called hookInstall and threw the answer away —
   * and hookInstall, through a query flag the window never sent, was in fact
   * the removal. So the button labelled INSTALL took the hook out, and the only
   * sign of it was the panel afterwards saying it was not installed. */
  async function setHookTo(on: boolean) {
    setBusy(true);
    setProblem("");
    try {
      setHook(on ? await api.hookInstall() : await api.hookRemove());
    } catch (e) {
      setProblem(errText(e));
    }
    load();
    setBusy(false);
  }

  return (
    <div className="tabbody">
      <div className="field">
        <span className="fieldName">{tr("running.title", "what is running")}</span>
        <p className="notice">
          {version
            ? tr("version.line", "window {current} · newest {latest}", {
                current: version.current,
                latest: version.latest,
              })
            : tr("version.unknown", "version unknown")}
        </p>
      </div>

      <div className="field">
        <span className="fieldName">{tr("settings.claudeCode", "claude code")}</span>
        <span className="rowInline">
          <span className="notice">
            {hook === null
              ? tr("hook.unknown", "state unknown")
              : hook.installed
                ? tr("hook.installed", "The hook reports state from {n} accounts.", { n: hook.accounts })
                : tr("hook.missing", "No hook — every session reads as unknown until it is installed.")}
          </span>
          {hook ? (
            <Button onClick={() => void setHookTo(!hook.installed)} disabled={busy}>
              {busy
                ? tr("common.working", "…")
                : hook.installed
                  ? tr("hook.remove", "REMOVE")
                  : tr("hook.install", "INSTALL")}
            </Button>
          ) : null}
        </span>
        {problem ? <span className="notice warn">{problem}</span> : null}
      </div>

      <Remote />

      <div className="field">
        <span className="fieldName">{tr("meter.show", "frame-rate readout")}</span>
        <span className="rowInline">
          <Toggle
            on={meter}
            onChange={(on) => {
              setMeter(on);
              void api.setPrefs({ meter: on });
              window.dispatchEvent(new CustomEvent("METER_CHANGED", { detail: on }));
            }}
          >
            {meter ? tr("common.on", "ON") : tr("common.off", "OFF")}
          </Toggle>
          <span className="notice">
            {tr("meter.hint", "Frames per second in the corner, with the two settings that cost the compositor most. Turn one off and watch the number.")}
          </span>
        </span>
      </div>
    </div>
  );
}
