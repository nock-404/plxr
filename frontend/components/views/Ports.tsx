"use client";

import { useCallback, useEffect, useState } from "react";
import TopStrip from "@/components/ui/TopStrip";
import Button from "@/components/ui/Button";
import { tr, errText } from "@/lib/i18n";
import { api } from "@/lib/api";
import type { Port } from "@/lib/types";

// Which process holds which port, and a way to end it.
export default function Ports() {
  const [ports, setPorts] = useState<Port[]>([]);
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

  return (
    <section className="list">
      <TopStrip>
        <div className="listbar">
          <span className="prompt">{tr("ports.prompt", "ports>")}</span>
          <span className="meta">{error || `${ports.length} ${tr("ports.open", "listening")}`}</span>
          <span className="spacer" />
          <Button onClick={load}>{tr("common.reload", "RELOAD")}</Button>
        </div>
      </TopStrip>
      <div className="listbody">
        {ports.length === 0 ? (
          <div className="emptyNote">
            <b>{tr("ports.emptyHead", "nothing listening")}</b>
            {tr("ports.empty", "No local process holds a port right now.")}
          </div>
        ) : (
          ports.map((p) => (
            <div key={`${p.pid}-${p.port}`} className="row">
              <span className="hitDate">{p.port}</span>
              <span className="hitTitle">{p.command}</span>
              <span className="hitProject">{p.addr}</span>
              <span className="hitSmall">pid {p.pid}</span>
              <span className="hitAction">
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
