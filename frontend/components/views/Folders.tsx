"use client";

import { useCallback, useEffect, useState } from "react";
import Files from "@/components/Files";
import Viewer from "@/components/Viewer";
import Button from "@/components/ui/Button";
import FolderPick from "@/components/ui/FolderPick";
import TopStrip from "@/components/ui/TopStrip";
import { api } from "@/lib/api";
import { errText, tr } from "@/lib/i18n";
import type { Workspace } from "@/lib/types";

/* Folders plxr holds open, and what is in them.
 *
 * Everything to do with files used to hang off a session, so opening a file
 * meant starting an agent first, and closing the agent took the file with it —
 * a session is cleared away shortly after it ends. A folder here has nothing to
 * do with what is running: it is open because somebody opened it.
 */
export default function Folders() {
  const [folders, setFolders] = useState<Workspace[]>([]);
  const [here, setHere] = useState<Workspace | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState("");

  const load = useCallback(() => {
    api
      .workspaces()
      .then((list) => {
        setFolders(list);
        // The one used last, so coming back lands where you left off.
        setHere((was) => (was ? list.find((w) => w.id === was.id) ?? null : list[0] ?? null));
      })
      .catch((e) => setProblem(errText(e)));
  }, []);

  useEffect(load, [load]);

  async function open(path: string) {
    setProblem("");
    try {
      const made = await api.openWorkspace(path);
      setFolders(await api.workspaces());
      setHere(made);
      setFile(null);
    } catch (e) {
      setProblem(errText(e));
    }
  }

  async function close(id: string) {
    setProblem("");
    try {
      await api.closeWorkspace(id);
      if (here?.id === id) {
        setHere(null);
        setFile(null);
      }
      load();
    } catch (e) {
      setProblem(errText(e));
    }
  }

  return (
    <section className="list">
      <TopStrip>
        <div className="listbar">
          <span className="prompt">{tr("folders.prompt", "folders>")}</span>
          <span className="folderTabs">
            {folders.map((w) => (
              <Button
                bare
                key={w.id}
                className={`folderTab${here?.id === w.id ? " on" : ""}`}
                data-missing={w.missing ? "yes" : undefined}
                title={w.missing ? tr("folders.missing", "Not reachable right now — {path}", { path: w.path }) : w.path}
                onClick={() => {
                  setHere(w);
                  setFile(null);
                }}
              >
                {w.path.split(/[\\/]/).filter(Boolean).pop() ?? w.path}
              </Button>
            ))}
          </span>
          <span className="spacer" />
          {here ? (
            <Button
              onClick={() => void close(here.id)}
              title={tr("folders.closeTip", "Take it off the list. Nothing on disk is touched.")}
            >
              {tr("folders.close", "CLOSE")}
            </Button>
          ) : null}
          <Button onClick={() => setPicking(true)}>{tr("folders.open", "+ FOLDER")}</Button>
        </div>
      </TopStrip>

      {problem ? <div className="emptyNote">{problem}</div> : null}

      {!here ? (
        <div className="empty">
          <div className="emptybox">
            <p className="emptyhead">{tr("folders.emptyHead", "no folder open")}</p>
            <p>
              {tr(
                "folders.empty",
                "Open a folder to read and change its files. It stays open on its own — nothing has to be running in it.",
              )}
            </p>
          </div>
        </div>
      ) : here.missing ? (
        <div className="empty">
          <div className="emptybox">
            <p className="emptyhead">{tr("folders.goneHead", "not reachable")}</p>
            <p>{tr("folders.gone", "{path} is not there right now. It stays on the list and comes back with the disk.", { path: here.path })}</p>
          </div>
        </div>
      ) : (
        <div className="foldersbody">
          <Files rootId={here.id} root={here.path} onPick={setFile} />
          {file ? (
            <Viewer sessionId={here.id} path={file} onClose={() => setFile(null)} />
          ) : (
            <div className="empty">
              <div className="emptybox">
                <p className="emptyhead">{tr("folders.pickHead", "pick a file")}</p>
                <p>{tr("folders.pick", "Choose one on the left to read or change it.")}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {picking ? (
        <FolderPick
          start={here?.path ?? ""}
          onCancel={() => setPicking(false)}
          onChoose={(path) => {
            setPicking(false);
            void open(path);
          }}
        />
      ) : null}
    </section>
  );
}
