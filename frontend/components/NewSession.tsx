"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import FolderPick from "@/components/ui/FolderPick";
import PathField from "@/components/ui/PathField";
import { tr, errText } from "@/lib/i18n";
import { api } from "@/lib/api";
import type { Account, Agent, Tile } from "@/lib/types";

// Start a session: where, what to start, under which account.
export default function NewSession({
  running,
  onClose,
  onCreated,
}: {
  running: Tile[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [cwd, setCwd] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [pick, setPick] = useState("shell");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  /* Two agents in one folder edit the same files without knowing about each
     other, and the damage shows up much later as a conflict nobody can explain.
     Saying so beforehand costs one line; not saying it costs an evening. */
  const clash = running.find(
    (t) => t.alive && cwd.trim() !== "" && t.cwd.replace(/\/+$/, "") === cwd.trim().replace(/\/+$/, ""),
  );

  useEffect(() => {
    api.agents().then((a) => setAgents(a ?? [])).catch(() => setAgents([]));
    /* Start where the last session was.
     *
     * That is what this said, and what it did was ask the completion for the
     * empty string and take the first answer — which is the alphabetically
     * first folder in the home directory. Every new session therefore offered
     * ~/3d, and the folder browser opened there too. The sessions know where
     * they ran; the newest of them is the answer. With none, the home
     * directory, which is what "~" resolves to. */
    api
      .sessions()
      .then((list) => {
        const newest = (list ?? [])
          .slice()
          .sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0))[0];
        if (newest?.cwd) return setCwd(newest.cwd);
        return api.paths("~").then((p) => p?.[0] && setCwd(p[0]));
      })
      .catch(() => undefined);
    api.accounts().then((a) => {
      setAccounts(a ?? []);
      if (a?.[0]) setAccount(a[0].name);
    }).catch(() => undefined);
  }, []);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const s = await api.create(cwd, pick === "shell" ? [] : [pick], "", account);
      onCreated(s.id);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="backdrop" onClick={onClose}>
        <div className="card" onClick={(e) => e.stopPropagation()}>
          <b className="cardTitle">{tr("new.title", "new session")}</b>

          <div className="field">
            <span className="fieldName">{tr("new.directory", "directory")}</span>
            <span className="rowInline">
              <PathField
                value={cwd}
                onChange={setCwd}
                placeholder={tr("new.directoryPlaceholder", "Type a few letters and pick")}
              />
              {/* For finding a folder rather than recalling it. The field only
                  completes what you already know the name of. */}
              <Button onClick={() => setBrowsing(true)}>{tr("folder.browse", "BROWSE")}</Button>
            </span>
          </div>

          <div className="field">
            <span className="fieldName">{tr("new.whatToStart", "what to start")}</span>
            <div className="choice">
              <Button
                bare
                className="choiceButton"
                data-picked={pick === "shell" ? "yes" : undefined}
                onClick={() => setPick("shell")}
              >
                {tr("new.shell", "shell")}
              </Button>
              {agents
                .filter((a) => a.name !== "generic")
                .map((a) => (
                  <Button
                    bare
                    key={a.name}
                    className="choiceButton"
                    data-picked={pick === a.name ? "yes" : undefined}
                    onClick={() => setPick(a.name)}
                  >
                    {a.label}
                  </Button>
                ))}
            </div>
          </div>

          {accounts.length ? (
            <div className="field">
              <span className="fieldName">{tr("new.account", "account")}</span>
              <div className="choice">
                {accounts.map((a) => (
                  <Button
                    bare
                    key={a.name}
                    className="choiceButton"
                    data-picked={account === a.name ? "yes" : undefined}
                    onClick={() => setAccount(a.name)}
                  >
                    {tr("accounts.numbered", `account ${a.number}`, { n: a.number })}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {clash && !confirmed ? (
            <p className="notice warn">
              {tr(
                "new.collision",
                "{name} already runs here. Two agents in one folder edit the same files without knowing about each other.",
                { name: clash.name },
              )}
            </p>
          ) : null}

          {error ? <p className="notice">{error}</p> : null}

          <div className="cardButtons">
            <Button onClick={onClose}>{tr("common.cancel", "CANCEL")}</Button>
            <Button
              primary
              disabled={busy}
              onClick={() => (clash && !confirmed ? setConfirmed(true) : start())}
            >
              {busy
                ? tr("common.starting", "STARTING…")
                : clash && !confirmed
                  ? tr("new.collisionStart", "START ANYWAY")
                  : tr("common.start", "START")}
            </Button>
          </div>
        </div>
      </div>

      {browsing ? (
          <FolderPick
            start={cwd}
            onCancel={() => setBrowsing(false)}
            onChoose={(path) => {
              setCwd(path);
              setBrowsing(false);
            }}
          />
        ) : null}
    </>
  );
}
