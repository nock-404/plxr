"use client";

import Tooltip from "@/components/ui/Tooltip";
import { tr } from "@/lib/i18n";
import { level, share, tipOf, windowLine, worse } from "@/lib/usageWords";
import { useAccountLimits } from "@/lib/useLimits";
import type { AccountUsage, UsageWindow } from "@/lib/types";

/* Whose account this terminal is spending, and how much of it is gone.
 *
 * The figures were on the status row at the bottom, one chip per account for
 * the whole window — which answers "is anything nearly out" and not "what is
 * this session costing me". Over a terminal it answers the second: the name
 * the account was given, the five-hour window that is running, and the week,
 * each as a share used with a bar beside it. Whoever wants the details — when
 * a window comes back, how old the reading is — hovers the line.
 *
 * Only for a session that runs under an account plxr knows. A plain shell has
 * nobody's limits to spend, and says nothing.
 */
function Window({ what, w, at }: { what: string; w: UsageWindow; at: number }) {
  const pct = w.known ? Math.max(0, Math.min(100, w.percent)) : 0;
  return (
    <Tooltip text={`${what}: ${windowLine(w)}`}>
      <span className="paneWindow">
        <span className="ubar">
          <i className="ufill" style={{ width: `${pct}%` }} />
        </span>
        <span className="limitPct" data-level={level(w, at)}>
          {share(w)}
        </span>
      </span>
    </Tooltip>
  );
}

export default function PaneUsage({ account }: { account: string }) {
  const { accounts, at } = useAccountLimits();
  const a: AccountUsage | undefined = account ? accounts.get(account) : undefined;
  if (!a) return null;
  return (
    <span className="paneacct" data-level={worse(level(a.session, at), level(a.week, at))} data-account={a.name}>
      <Tooltip text={tipOf(a)}>
        <span className="limitName">{a.label || tr("limits.short", "#{n}", { n: a.number })}</span>
      </Tooltip>
      <Window what={tr("limits.session", "session")} w={a.session} at={at} />
      <Window what={tr("limits.week", "week")} w={a.week} at={at} />
    </span>
  );
}
