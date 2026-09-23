"use client";

import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import { tr } from "@/lib/i18n";
import { useLimits } from "@/lib/useLimits";
import { level, share, tipOf, worse } from "@/lib/usageWords";

/* Every account's limits at a glance, on the status row.
 *
 * What is left was only in the usage panel, one account under the other, so
 * seeing whether any Claude could still take a long run meant opening a panel
 * and scrolling. One chip per account now sits beside the spend: its name, the
 * session window and the week, each as the share used, coloured once it
 * passes the threshold set for the warning and red when it is spent. The
 * details — when each window comes back, and how old the reading is — are on
 * the chip's tooltip, and a click opens the usage panel.
 *
 * Nothing is drawn until the first answer, the way the spend beside it waits:
 * a 0% that nobody measured would be the one lie this row must not tell. */

export default function Limits({ onOpen }: { onOpen: () => void }) {
  const { report, at } = useLimits();
  if (!report || !report.accounts?.length) return null;
  const accounts = [...report.accounts].sort((a, b) => a.number - b.number);
  return (
    <span className="limits">
      {accounts.map((a) => {
        const session = level(a.session, at);
        const week = level(a.week, at);
        return (
          <Tooltip key={a.name} text={tipOf(a)}>
            <Button bare className="limit" data-level={worse(session, week)} data-account={a.name} onClick={onOpen}>
              <span className="limitName">{a.label || tr("limits.short", "#{n}", { n: a.number })}</span>
              <span className="limitPct" data-level={session}>{share(a.session)}</span>
              <span className="limitSep">·</span>
              <span className="limitPct" data-level={week}>{share(a.week)}</span>
            </Button>
          </Tooltip>
        );
      })}
    </span>
  );
}
