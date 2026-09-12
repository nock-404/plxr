"use client";

import { useCallback, useEffect, useState } from "react";
import TopStrip from "@/components/ui/TopStrip";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { tr, errText } from "@/lib/i18n";
import { api } from "@/lib/api";
import { copyText, openInBrowser } from "@/lib/browser";
import type { Port } from "@/lib/types";

// Which process holds which port, and a way to end it.
export default function Ports({ onPreview }: { onPreview?: (url: string, title: string) => void }) {
  /* null until the answer is in.
   *
   * An empty list from the start means the view says "nothing listening"
   * while it is still asking — and asking the system who holds which port is
   * not instant. That is a lie in the one place the window is meant to be
   * trusted; emptylies.py holds every list to it. */
  const [ports, setPorts] = useState<Port[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api
      .ports()
      .then((p) => setPorts(p ?? []))
      .catch((e) => setError(errText(e)));
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 4000);
    return () => window.clearInterval(t);
  }, [load]);

  const ctx = useContextMenu();
  /* What a port offers under the right button: see it, in a panel or in the
     browser; take its address or its pid along; end the process behind it —
     politely, or, when that did nothing, for certain. */
  const rowMenu = (p: Port): MenuItem[] => {
    const url = `http://localhost:${p.port}`;
    return [
      ...(onPreview ? [{ label: tr("ports.menuPreview", "Preview beside"), onClick: () => onPreview(url, `:${p.port}`) }] : []),
      { label: tr("ports.menuBrowser", "Open in browser"), onClick: () => openInBrowser(url) },
      { label: tr("ports.menuCopyUrl", "Copy URL"), onClick: () => copyText(url) },
      { label: tr("ports.menuCopyPid", "Copy PID"), onClick: () => copyText(String(p.pid)) },
      { separator: true },
      { label: tr("ports.menuStop", "Stop"), onClick: () => void api.portKill(p.pid).then(load).catch((e) => setError(errText(e))) },
      {
        label: tr("ports.menuForceStop", "Force stop"),
        danger: true,
        onClick: () => void api.portKill(p.pid, true).then(load).catch((e) => setError(errText(e))),
      },
    ];
  };

  return (
    <section className="list">
      <TopStrip>
        <div className="listbar">
          <span className="prompt">{tr("ports.prompt", "ports>")}</span>
          <span className="meta">{error || `${ports?.length ?? 0} ${tr("ports.open", "listening")}`}</span>
          <span className="spacer" />
          <Button onClick={load}>{tr("common.reload", "RELOAD")}</Button>
        </div>
      </TopStrip>
      <div className="listbody">
        {ports === null ? null : ports.length === 0 ? (
          <div className="emptyNote">
            <b>{tr("ports.emptyHead", "nothing listening")}</b>
            {tr("ports.empty", "No local process holds a port right now.")}
          </div>
        ) : (
          ports.map((p) => (
            <div key={`${p.pid}-${p.port}`} className="row" onContextMenu={ctx(rowMenu(p))}>
              <span className="hitDate">{p.port}</span>
              <span className="hitTitle">{p.command}</span>
              <span className="hitProject">{p.addr}</span>
              <span className="hitSmall">pid {p.pid}</span>
              <span className="hitAction">
                {onPreview ? (
                  <Tooltip text={tr("ports.viewTip", "Show what this port serves, in a panel")}>
                    <Button tiny onClick={() => onPreview(`http://localhost:${p.port}`, `:${p.port}`)}>
                      {tr("ports.view", "VIEW")}
                    </Button>
                  </Tooltip>
                ) : null}
                <Button tiny onClick={() => api.portKill(p.pid).then(load)}>
                  {tr("ports.kill", "KILL")}
                </Button>
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
