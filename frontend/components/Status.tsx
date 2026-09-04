"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Toggle from "@/components/ui/Toggle";
import Ask from "@/components/ui/Ask";
import { api } from "@/lib/api";
import { errText, tr } from "@/lib/i18n";
import type { Account, HookState, VersionInfo } from "@/lib/types";

// What is actually running, and whether the hook that makes status detection
// reliable is in place. Without it every session reads "unknown".
export default function Status() {
  const [hook, setHook] = useState<HookState | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<
    { kind: "add" } | { kind: "rename" | "remove"; account: Account } | null
  >(null);
  const [problem, setProblem] = useState("");
  const [meter, setMeter] = useState(false);

  useEffect(() => {
    void api.prefs().then((p) => setMeter(Boolean(p.meter))).catch(() => undefined);
  }, []);

  // Every change hands back the whole list, so there is nothing to reload and
  // no moment where the screen and the daemon disagree.
  async function act(what: () => Promise<Account[]>) {
    setProblem("");
    try {
      setAccounts(await what());
    } catch (e) {
      setProblem(errText(e));
    }
  }

  const load = useCallback(() => {
    api.hook().then(setHook).catch(() => setHook(null));
    api.accounts().then((a) => setAccounts(a ?? [])).catch(() => setAccounts([]));
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
      </div>

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

      <div className="field">
        <span className="fieldName">{tr("settings.accounts", "accounts")}</span>
        <div className="splitList">
          {accounts.map((a) => (
            <div key={a.name} className="accountRow">
              {/* The name keeps its width and the path is the one that gives
                  way. Sharing the space evenly squeezed "account 1" down to
                  "acc…" while the directory beside it had room to spare. */}
              <span className="accountName">
                {a.label || tr("accounts.numbered", `account ${a.number}`, { n: a.number })}
              </span>
              <span className="accountDir" title={a.dir}>{a.short || a.dir}</span>
              <span className="accountCount">
                {a.sessions} {tr("accounts.sessions", "sessions")}
              </span>
              <Button
                tiny
                data-do="rename-account"
                title={tr("accounts.renameTip", "Call it something else. What sessions were recorded under does not change.")}
                onClick={() => setAsking({ kind: "rename", account: a })}
              >
                {tr("files.rename", "RENAME")}
              </Button>
              <Button
                tiny
                data-do="remove-account"
                disabled={accounts.length < 2}
                title={
                  accounts.length < 2
                    ? tr("accounts.lastOne", "The only account left")
                    : tr("accounts.removeTip", "Take it out of this list. The directory and everything in it stays.")
                }
                onClick={() => setAsking({ kind: "remove", account: a })}
              >
                {tr("common.remove", "REMOVE")}
              </Button>
            </div>
          ))}
        </div>
        <span className="rowInline">
          <Button data-do="add-account" onClick={() => setAsking({ kind: "add" })}>
            {tr("accounts.add", "+ ACCOUNT")}
          </Button>
          <span className="notice">
            {tr("accounts.addHint", "A second Claude Code configuration directory. It is made if it is not there yet.")}
          </span>
        </span>
        {problem ? <span className="notice warn">{problem}</span> : null}
      </div>

      {asking?.kind === "add" ? (
        <Ask
          title={tr("accounts.add", "+ ACCOUNT")}
          detail={tr("accounts.addWhere", "Where its configuration lives — ~/.claude4, for instance.")}
          field={tr("accounts.dir", "directory")}
          path
          confirmLabel={tr("common.create", "CREATE")}
          onCancel={() => setAsking(null)}
          onConfirm={(dir) => {
            setAsking(null);
            if (dir.trim()) void act(() => api.accountAdd(dir.trim(), ""));
          }}
        />
      ) : null}

      {asking?.kind === "rename" ? (
        <Ask
          title={tr("files.rename", "RENAME")}
          detail={asking.account.dir}
          field={tr("accounts.label", "name")}
          value={asking.account.label || ""}
          confirmLabel={tr("files.rename", "RENAME")}
          onCancel={() => setAsking(null)}
          onConfirm={(label) => {
            const which = asking.account;
            setAsking(null);
            void act(() => api.accountRename(which.name, label));
          }}
        />
      ) : null}

      {asking?.kind === "remove" ? (
        <Ask
          title={tr("accounts.removeHead", "take it out of the list?")}
          detail={`${asking.account.dir} — ${tr("accounts.removeKeeps", "the directory stays, with everything in it")}`}
          confirmLabel={tr("common.remove", "REMOVE")}
          danger
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const which = asking.account;
            setAsking(null);
            void act(() => api.accountRemove(which.name));
          }}
        />
      ) : null}

    </div>
  );
}
