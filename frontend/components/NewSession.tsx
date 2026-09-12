"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import FolderPick from "@/components/ui/FolderPick";
import PathField from "@/components/ui/PathField";
import Tooltip from "@/components/ui/Tooltip";
import { shortPath } from "@/lib/format";
import { tr, errText } from "@/lib/i18n";
import { api } from "@/lib/api";
import type { Account, Agent, Tile } from "@/lib/types";

// Start a session: where, what to start, under which account.
export default function NewSession({
  here,
  running,
  onClose,
  onCreated,
}: {
  /* The folder the window is about, from the path field at the top. A new
     session starts there — nobody should have to find the same folder twice. */
  here?: string;
  running: Tile[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [cwd, setCwd] = useState(here ?? "");
  const [browsing, setBrowsing] = useState(false);
  const [pick, setPick] = useState("shell");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  /* Unattended: the CLI is started with its permission prompts turned off.
     That is the person's decision, made here and nowhere else; the tile is
     marked for as long as the session runs, because nothing will stop it to
     ask. Only Claude Code knows the flag, so it is only offered for it. */
  const [unattended, setUnattended] = useState(false);
  const unattendable = pick === "claude";

  /* Two agents in one folder edit the same files without knowing about each
     other, and the damage shows up much later as a conflict nobody can explain.
     Saying so beforehand costs one line; not saying it costs an evening. */
  const clash = running.find(
    (t) => t.alive && cwd.trim() !== "" && t.cwd.replace(/\/+$/, "") === cwd.trim().replace(/\/+$/, ""),
  );

  useEffect(() => {
    api.agents().then((a) => setAgents(a ?? [])).catch(() => setAgents([]));
    // Where sessions ran last — one click instead of typing the same path
    // for the fifth time today.
    api.recent().then((r) => setRecent(r ?? [])).catch(() => setRecent([]));
    /* Start where the last session was.
     *
     * That is what this said, and what it did was ask the completion for the
     * empty string and take the first answer — which is the alphabetically
     * first folder in the home directory. Every new session therefore offered
     * ~/3d, and the folder browser opened there too. The sessions know where
     * they ran; the newest of them is the answer. With none, the home
     * directory, which is what "~" resolves to. */
    // With a place chosen at the top, that is where it starts; the guesswork
    // below is for a window that has no place yet.
    if (here) return;
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
      const cmd = pick === "shell" ? [] : unattended && unattendable ? [pick, "--dangerously-skip-permissions"] : [pick];
      const s = await api.create(cwd, cmd, "", account);
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
                onSubmit={() => {
                  if (!busy && !(clash && !confirmed)) void start();
                }}
                placeholder={tr("new.directoryPlaceholder", "Type a few letters and pick")}
              />
              {/* For finding a folder rather than recalling it. The field only
                  completes what you already know the name of. */}
              <Button onClick={() => setBrowsing(true)}>{tr("folder.browse", "BROWSE")}</Button>
            </span>
            {recent.length ? (
              <div className="choice">
                {recent.map((dir) => (
                  <Tooltip key={dir} text={dir}>
                    <Button
                      bare
                      className="choiceButton"
                      data-picked={cwd.trim().replace(/\/+$/, "") === dir ? "yes" : undefined}
                      onClick={() => setCwd(dir)}
                    >
                      {shortPath(dir, 28)}
                    </Button>
                  </Tooltip>
                ))}
              </div>
            ) : null}
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
                .map((a) =>
                  a.found ? (
                    <Button
                      bare
                      key={a.name}
                      className="choiceButton"
                      data-picked={pick === a.name ? "yes" : undefined}
                      onClick={() => setPick(a.name)}
                    >
                      {a.label}
                    </Button>
                  ) : (
                    /* Not on the PATH the sessions get: said before the click,
                       not by the shell after it. */
                    <Tooltip
                      key={a.name}
                      text={tr("new.notFoundTip", "{name} is not on the PATH your login shell has, so it cannot be started here.", { name: a.name })}
                    >
                      <Button bare className="choiceButton" disabled>
                        {a.label} · {tr("new.notFound", "not found")}
                      </Button>
                    </Tooltip>
                  ),
                )}
            </div>
          </div>

          {unattendable ? (
            <div className="field">
              <span className="fieldName">{tr("new.permissions", "permissions")}</span>
              <div className="choice">
                <Button
                  bare
                  className="choiceButton"
                  data-picked={!unattended ? "yes" : undefined}
                  onClick={() => setUnattended(false)}
                >
                  {tr("new.ask", "ask before acting")}
                </Button>
                <Tooltip text={tr("new.unattendedTip", "Starts with --dangerously-skip-permissions: nothing stops it to ask. The tile carries a mark for as long as it runs.")}>
                  <Button
                    bare
                    className="choiceButton"
                    data-picked={unattended ? "yes" : undefined}
                    onClick={() => setUnattended(true)}
                  >
                    {tr("new.unattended", "unattended")}
                  </Button>
                </Tooltip>
              </div>
            </div>
          ) : null}

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
