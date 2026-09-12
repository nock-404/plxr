"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import Ask from "@/components/ui/Ask";
import { api } from "@/lib/api";
import { errText, tr } from "@/lib/i18n";
import type { Account } from "@/lib/types";

/* The Claude accounts plxr starts sessions under.
 *
 * A tab of its own. They sat at the bottom of the status tab, under the hook
 * and the frame-rate switch — which is where nobody looking for "which
 * account" would look. Which account a session runs under is a choice made
 * often; the version line is read once. */
export default function Accounts() {
  // null until the answer is in, so the tab does not open on an empty list.
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [asking, setAsking] = useState<{ kind: "add" } | { kind: "rename" | "remove"; account: Account } | null>(null);
  const [problem, setProblem] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    api.accounts().then((a) => setAccounts(a ?? [])).catch(() => setAccounts([]));
  }, []);

  // Every change hands back the whole list, so there is nothing to reload and
  // no moment where the screen and the service disagree.
  async function act(what: () => Promise<Account[]>) {
    setProblem("");
    try {
      setAccounts(await what());
    } catch (e) {
      setProblem(errText(e));
    }
  }

  // A fresh account, and a session started in it so its first claude run asks
  // you to sign in. The directory is empty, which is exactly what makes claude
  // prompt for a login.
  async function signInNew() {
    setProblem("");
    setSigningIn(true);
    try {
      const { account, accounts: list } = await api.accountCreate("");
      setAccounts(list);
      await api
        .create("", ["claude"], tr("accounts.loginName", "sign in: {name}", { name: account.name }), account.name)
        .catch(() => undefined);
      setProblem(
        tr("accounts.added", "{name} added — a session was started in it. Close settings to sign in there.", {
          name: account.name,
        }),
      );
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setSigningIn(false);
    }
  }

  const list = accounts ?? [];

  return (
    <div className="tabbody">
      <div className="field">
        <span className="fieldName">{tr("settings.accounts", "accounts")}</span>
        <div className="splitList">
          {list.map((a) => (
            <div key={a.name} className="accountRow">
              <span className="accountName">
                {a.label || tr("accounts.numbered", `account ${a.number}`, { n: a.number })}
              </span>
              <span className="accountCount">
                {a.sessions} {tr("accounts.sessions", "sessions")}
              </span>
              <Tooltip text={a.dir}>
                <span className="accountDir">{a.short || a.dir}</span>
              </Tooltip>
              <span className="accountActions">
                {a.default ? (
                  <span className="accountDefault">{tr("accounts.isDefault", "default")}</span>
                ) : (
                  <Tooltip text={tr("accounts.makeDefaultTip", "New sessions start under this account unless another is chosen.")}>
                    <Button tiny data-do="default-account" onClick={() => void act(() => api.accountSetDefault(a.name))}>
                      {tr("accounts.makeDefault", "MAKE DEFAULT")}
                    </Button>
                  </Tooltip>
                )}
                <Tooltip text={tr("accounts.renameTip", "Call it something else. What sessions were recorded under does not change.")}>
                  <Button tiny data-do="rename-account" onClick={() => setAsking({ kind: "rename", account: a })}>
                    {tr("files.rename", "RENAME")}
                  </Button>
                </Tooltip>
                <Tooltip
                  text={
                    list.length < 2
                      ? tr("accounts.lastOne", "The only account left")
                      : tr("accounts.removeTip", "Take it out of this list. The directory and everything in it stays.")
                  }
                >
                  <Button tiny data-do="remove-account" disabled={list.length < 2} onClick={() => setAsking({ kind: "remove", account: a })}>
                    {tr("common.remove", "REMOVE")}
                  </Button>
                </Tooltip>
              </span>
            </div>
          ))}
        </div>
        <span className="rowInline">
          <Button data-do="signin-account" busy={signingIn} onClick={signInNew}>
            {tr("accounts.signIn", "+ SIGN IN NEW")}
          </Button>
          <Button data-do="add-account" onClick={() => setAsking({ kind: "add" })}>
            {tr("accounts.add", "+ EXISTING")}
          </Button>
          <span className="notice">
            {tr(
              "accounts.addHint2",
              "Sign in new makes a fresh account and starts a session in it to log in. Existing takes a config directory you already have.",
            )}
          </span>
        </span>
        {problem ? <span className="notice warn">{problem}</span> : null}
      </div>

      {asking?.kind === "add" ? (
        <Ask
          heading={tr("accounts.add", "+ ACCOUNT")}
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
          heading={tr("files.rename", "RENAME")}
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
          heading={tr("accounts.removeHead", "take it out of the list?")}
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
