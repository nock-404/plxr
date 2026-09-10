"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Toggle from "@/components/ui/Toggle";
import { api } from "@/lib/api";
import { errText, tr } from "@/lib/i18n";
import type { RemoteCode, RemoteState } from "@/lib/types";

/* Reaching this plxr from another machine.
 *
 * The daemon listens on this machine only, which is the right default: anything
 * that can talk to it can start processes here, read what it can read, and
 * answer an agent's questions. Switched on it listens on the network too, and
 * the token is what stands between the two.
 *
 * Nobody types a 24-byte token into a browser in another room, so there is a
 * code instead: eight characters, good for ten minutes, used up the moment a
 * browser trades it for the token. What that browser keeps is a cookie.
 */
export default function Remote() {
  const [state, setState] = useState<RemoteState | null>(null);
  const [code, setCode] = useState<RemoteCode | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.remote().then(setState).catch((e) => setProblem(errText(e)));
  }, []);

  useEffect(load, [load]);

  async function set(on: boolean) {
    setBusy(true);
    setProblem("");
    try {
      setState(await api.setRemote(on));
      setCode(null);
    } catch (e) {
      setProblem(errText(e));
    }
    setBusy(false);
  }

  async function make() {
    setBusy(true);
    setProblem("");
    try {
      setCode(await api.remoteCode());
    } catch (e) {
      setProblem(errText(e));
    }
    setBusy(false);
  }

  const where = state?.addresses?.[0] ?? "";
  // What has to be typed on the other machine: an address, a port and a code.
  const join = where && code ? `${where}:${code.port}/join/${code.code}` : "";

  return (
    <div className="field">
      <span className="fieldName">{tr("remote.title", "from another machine")}</span>

      <span className="rowInline">
        <Toggle on={Boolean(state?.on)} onChange={(on) => void set(on)}>
          {state?.on ? tr("common.on", "ON") : tr("common.off", "OFF")}
        </Toggle>
        <span className="notice">
          {tr(
            "remote.what",
            "Lets a browser on your network open this plxr. Anything that gets in can start programs on this machine, so it is off unless you say otherwise.",
          )}
        </span>
      </span>

      {problem ? <span className="notice warn">{problem}</span> : null}

      {/* What was asked for and what is actually running are two different
          things: the listener is bound once, when the daemon starts. */}
      {state?.on && !state.live ? (
        <span className="notice warn">
          {state.trouble
            ? tr("remote.notOpened", "It could not be opened to the network: {detail}", { detail: state.trouble })
            : tr("remote.noAddress", "This machine has no address on a network right now, so there is nothing to reach it at.")}
        </span>
      ) : null}

      {state?.live ? (
        <>
          <span className="notice">
            {tr("remote.reachable", "Reachable at {where}", {
              where: state.addresses.map((a) => `${a}:${state.port}`).join(", ") || "—",
            })}
          </span>
          <span className="rowInline">
            <Button onClick={() => void make()} disabled={busy}>
              {busy ? tr("common.working", "…") : tr("remote.code", "PAIRING CODE")}
            </Button>
            <span className="notice">
              {tr("remote.codeWhy", "Type the line below into the other machine's browser. It works once, for ten minutes.")}
            </span>
          </span>
          {code ? <span className="joinline">{join}</span> : null}
        </>
      ) : null}
    </div>
  );
}
