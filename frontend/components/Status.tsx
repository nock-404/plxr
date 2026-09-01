"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import type { Account, HookState, VersionInfo } from "@/lib/types";

// What is actually running, and whether the hook that makes status detection
// reliable is in place. Without it every session reads "unknown".
export default function Status() {
  const [hook, setHook] = useState<HookState | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.hook().then(setHook).catch(() => setHook(null));
    api.accounts().then((a) => setAccounts(a ?? [])).catch(() => setAccounts([]));
    api.version().then(setVersion).catch(() => setVersion(null));
  }, []);

  useEffect(load, [load]);

  async function install() {
    setBusy(true);
    await api.hookInstall().catch(() => undefined);
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
          {hook && !hook.installed ? (
            <Button onClick={install} disabled={busy}>
              {busy ? tr("common.working", "…") : tr("hook.install", "INSTALL")}
            </Button>
          ) : null}
        </span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("settings.accounts", "accounts")}</span>
        <div className="splitList">
          {accounts.map((a) => (
            <div key={a.name} className="splitRow">
              <span className="hitTitle">
                {tr("accounts.numbered", `account ${a.number}`, { n: a.number })}
              </span>
              <span className="meta">{a.dir}</span>
              <span className="spacer" />
              <span className="hitSmall">
                {a.sessions} {tr("accounts.sessions", "sessions")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
