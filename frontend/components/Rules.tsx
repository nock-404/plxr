"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import type { Rule } from "@/lib/types";

// Which instructions actually reach the agent in this folder, and from where.
export default function Rules({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [rules, setRules] = useState<Rule[]>([]);

  useEffect(() => {
    api.rules(sessionId).then((r) => setRules(r ?? [])).catch(() => setRules([]));
  }, [sessionId]);

  return (
    <div className="overlay">
      <div className="overlayBar">
        <span className="overlayName">{tr("rules.title", "Rules")}</span>
        <span className="meta">{rules.length}</span>
        <span className="spacer" />
        <Button onClick={onClose}>{tr("common.back", "BACK")}</Button>
      </div>
      <div className="ruleslist">
        {rules.length === 0 ? (
          <div className="emptyNote">
            <b>{tr("rules.emptyHead", "no rules")}</b>
            {tr("rules.empty", "Nothing in this folder or above it adds instructions for the agent.")}
          </div>
        ) : (
          rules.map((r) => (
            <div key={r.path} className="rrow" data-kind={r.kind}>
              <span className="rart">{r.kind}</span>
              <span className="rmain">
                <span className="rtitle">{r.name}</span>
                <span className="rdesc">{r.description}</span>
              </span>
              <span className="rpath">{r.path}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
