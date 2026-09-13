"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Toggle from "@/components/ui/Toggle";
import Tooltip from "@/components/ui/Tooltip";
import Ask from "@/components/ui/Ask";
import { api } from "@/lib/api";
import { accountName, ago } from "@/lib/format";
import { errText, tr } from "@/lib/i18n";
import { adoptAccounts, useAccounts, watchSignIn } from "@/lib/useAccounts";
import type { Account } from "@/lib/types";

/* The Claude accounts plxr starts sessions under.
 *
 * A tab of its own. They sat at the bottom of the status tab, under the hook
 * and the frame-rate switch — which is where nobody looking for "which
 * account" would look. Which account a session runs under is a choice made
 * often; the version line is read once.
 *
 * Adding a fourth account used to end at an empty directory and a session
 * somewhere behind the settings, and nothing on this page said whether it had
 * worked. Each row now says what the disk says: signed in or not, the hook in
 * its settings or not, the shared history or its own, and how old its usage
 * reading is. */

/* The history a new account would join: the transcript directory most
   accounts read, and whether more than one of them does. The service works
   this out for itself when the account is made (internal/accounts Store);
   here it only decides what the switch starts at and what its hint names. */
function storeOf(list: Account[], skip = ""): { dir: string; shared: boolean } {
  const readers = new Map<string, number>();
  for (const a of list) {
    const dir = a.state?.projects ?? "";
    if (a.name === skip || !dir) continue;
    readers.set(dir, (readers.get(dir) ?? 0) + 1);
  }
  let dir = "";
  let most = 0;
  // A Map keeps the order accounts were listed in, so a tie goes to the first.
  for (const [d, n] of readers) {
    if (n > most) {
      dir = d;
      most = n;
    }
  }
  return { dir, shared: most > 1 };
}

/* The four facts about one account, in one line. Only a missing sign-in and a
   missing hook are marked: a history of its own can be exactly what somebody
   wants, and no usage reading only means Claude Code has not run there yet. */
function Facts({ a, list }: { a: Account; list: Account[] }) {
  const st = a.state;
  if (!st) return null;
  const others = st.sharedWith
    .map((n) => {
      const other = list.find((x) => x.name === n);
      return other ? accountName(other) : n;
    })
    .join(", ");
  return (
    <span className="accountStates">
      <Tooltip
        text={
          st.signedIn
            ? tr("accounts.signedInTip", "Claude Code has a signed-in account recorded in {file}.", { file: st.file })
            : tr("accounts.signedOutTip", "No sign-in recorded in {file}. Start claude under this account to sign in.", { file: st.file })
        }
      >
        <span className="accountState" data-fact="signin" data-good={st.signedIn ? "yes" : "no"}>
          {st.signedIn ? tr("accounts.signedIn", "signed in") : tr("accounts.signedOut", "not signed in")}
        </span>
      </Tooltip>
      <Tooltip
        text={
          st.hook
            ? tr("accounts.hookOnTip", "Sessions under this account report their state to plxr.")
            : tr("accounts.hookOffTip", "Sessions under this account report nothing to plxr. Settings › status › INSTALL puts the hook into every account.")
        }
      >
        <span className="accountState" data-fact="hook" data-good={st.hook ? "yes" : "no"}>
          {st.hook ? tr("accounts.hookOn", "hook") : tr("accounts.hookOff", "no hook")}
        </span>
      </Tooltip>
      <Tooltip
        text={
          st.sharedWith.length
            ? tr("accounts.sharedTip", "Reads the same conversations as {names}, in {dir}.", { names: others, dir: st.projects })
            : tr("accounts.ownTip", "Keeps its conversations to itself, in {dir}.", { dir: st.projects })
        }
      >
        <span className="accountState" data-fact="history" data-shared={st.sharedWith.length ? "yes" : "no"}>
          {st.sharedWith.length ? tr("accounts.sharedHistory", "shared history") : tr("accounts.ownHistory", "own history")}
        </span>
      </Tooltip>
      <Tooltip text={tr("accounts.usageTip", "When Claude Code last fetched this account's usage. It does that while it runs under the account.")}>
        <span className="accountState" data-fact="usage" data-at={st.usageAt || undefined}>
          {st.usageAt
            ? tr("accounts.usageAge", "usage read {age} ago", { age: ago(st.usageAt) || "0s" })
            : tr("accounts.usageNone", "no usage reading")}
        </span>
      </Tooltip>
    </span>
  );
}

export default function Accounts({ openSession }: { openSession?: (id: string) => void }) {
  // null until the answer is in, so the tab does not open on an empty list.
  const accounts = useAccounts();
  const [asking, setAsking] = useState<{ kind: "add" } | { kind: "rename" | "remove"; account: Account } | null>(null);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  /* Whether a new account shares the conversation history. Untouched, it
     follows the accounts already there: on when they share one, off when
     they do not. */
  const [share, setShare] = useState<boolean | null>(null);

  const list = accounts ?? [];
  const store = storeOf(list);
  // With no account at all there is nothing to share with, and asking for it
  // would only be refused.
  const sharing = Boolean(store.dir) && (share ?? store.shared);

  // Every change hands back the whole list, and it is handed to every reader
  // in the window — the pickers included — so nothing has to be reloaded.
  async function act(what: () => Promise<Account[]>) {
    setProblem("");
    setNote("");
    try {
      adoptAccounts(await what());
    } catch (e) {
      setProblem(errText(e));
    }
  }

  /* A fresh account, and a session started in it so its first claude run asks
     to sign in. The session opens in front, in the work: that is where the
     signing in happens, and "close the settings to find it" was a step nobody
     should have to take. The list is watched closely from here on, so this
     page turns to "signed in" once it is done. */
  async function signInNew() {
    setProblem("");
    setNote("");
    setSigningIn(true);
    try {
      const { account, accounts: fresh } = await api.accountCreate("", sharing);
      adoptAccounts(fresh);
      watchSignIn();
      const session = await api
        .create("", ["claude"], tr("accounts.loginName", "sign in: {name}", { name: account.name }), account.name)
        .catch(() => null);
      if (session) {
        openSession?.(session.id);
        setNote(tr("accounts.added", "{name} added — sign in to it in the session that just opened.", { name: account.name }));
      } else {
        setNote(tr("accounts.addedNoSession", "{name} added. Start claude under it to sign in.", { name: account.name }));
      }
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setSigningIn(false);
    }
  }

  const shareSwitch = store.dir ? (
    <span className="rowInline">
      <Toggle
        on={sharing}
        onChange={setShare}
        tip={tr(
          "accounts.shareTip",
          "The new account's projects folder becomes a link to {dir}, so every account reads the same conversations and a session can move between them. Only while that folder is empty — nothing is moved or deleted.",
          { dir: store.dir },
        )}
      >
        {tr("accounts.share", "share the conversation history with the other accounts")}
      </Toggle>
    </span>
  ) : null;

  return (
    <div className="tabbody">
      <div className="field">
        <span className="fieldName">{tr("settings.accounts", "accounts")}</span>
        <div className="splitList">
          {list.map((a) => {
            // Joining later is offered to an account reading its own history
            // while there is another history to join.
            const joins = a.state && a.state.sharedWith.length === 0 ? storeOf(list, a.name).dir : "";
            return (
              <div key={a.name} className="accountRow" data-account={a.name}>
                <span className="accountName">{accountName(a)}</span>
                <span className="accountCount">
                  {a.sessions} {tr("accounts.sessions", "sessions")}
                </span>
                <Tooltip text={a.dir}>
                  <span className="accountDir">{a.short || a.dir}</span>
                </Tooltip>
                <Facts a={a} list={list} />
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
                  {joins ? (
                    <Tooltip
                      text={tr(
                        "accounts.joinSharedTip",
                        "Link its projects folder to {dir}, the history the other accounts read. Only while that folder is empty — nothing is moved or deleted.",
                        { dir: joins },
                      )}
                    >
                      <Button tiny data-do="share-account" onClick={() => void act(() => api.accountShare(a.name))}>
                        {tr("accounts.joinShared", "SHARE HISTORY")}
                      </Button>
                    </Tooltip>
                  ) : null}
                </span>
              </div>
            );
          })}
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
        {shareSwitch}
        {note ? <span className="notice">{note}</span> : null}
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
            if (dir.trim()) void act(() => api.accountAdd(dir.trim(), "", sharing));
          }}
        >
          {shareSwitch}
        </Ask>
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
