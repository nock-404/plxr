"use client";

import Tooltip from "@/components/ui/Tooltip";
import { moment, until } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { level, share, tipOf, worse } from "@/lib/usageWords";
import { useAccountLimits } from "@/lib/useLimits";
import type { AccountUsage, UsageWindow } from "@/lib/types";

/* What this session is spending, over the terminal that is spending it.
 *
 * The first attempt was a strip at the right-hand end of the pane's label row:
 * a name, two hairline bars and two figures, at seven tenths of the type size.
 * With a reading it was cramped; without one it was two empty bars and two
 * dashes — chrome that takes room and says nothing ("that mini rubbish up
 * there that has been annoying me the whole time").
 *
 * So it is what the CLI itself shows when asked: one row per window, each with
 * what it is, a bar the width of the pane, the share used in words, and when
 * it comes back. And when there is no reading for this account it is one quiet
 * line saying so, rather than a frame around nothing.
 */
function Row({ what, w, at }: { what: string; w: UsageWindow; at: number }) {
  const pct = w.known ? Math.max(0, Math.min(100, w.percent)) : 0;
  const back = w.resetsAt ? until(w.resetsAt) : "";
  return (
    <span className="paneUsageRow">
      <span className="paneUsageWhat">{what}</span>
      <span className="ubar">
        <i className="ufill" style={{ width: `${pct}%` }} />
      </span>
      <span className="limitPct" data-level={level(w, at)}>
        {w.known ? tr("paneUsage.used", "{pct} used", { pct: share(w) }) : tr("paneUsage.noReading", "no reading")}
      </span>
      {w.resetsAt ? (
        <span className="meta">
          {back
            ? tr("paneUsage.backIn", "back {when} · in {left}", { when: moment(w.resetsAt), left: back })
            : tr("paneUsage.back", "back {when}", { when: moment(w.resetsAt) })}
        </span>
      ) : null}
    </span>
  );
}

export default function PaneUsage({ account }: { account: string }) {
  const { accounts, at } = useAccountLimits();
  const a: AccountUsage | undefined = account ? accounts.get(account) : undefined;
  if (!a) return null;
  const name = a.label || tr("limits.short", "#{n}", { n: a.number });
  /* Nothing measured for this account: one line, and no bars around emptiness.
     Claude Code leaves the reading in the account's own configuration, so an
     account it has not run in lately has none — which is worth saying, because
     the alternative is somebody looking at a blank strip and wondering. */
  if (!a.session.known && !a.week.known) {
    return (
      <span className="paneacct" data-account={a.name} data-empty="yes">
        <Tooltip text={tipOf(a)}>
          <span className="paneUsageRow">
            <span className="limitName">{name}</span>
            <span className="meta">{tr("paneUsage.none", "no reading for this account yet")}</span>
          </span>
        </Tooltip>
      </span>
    );
  }
  return (
    <span className="paneacct" data-level={worse(level(a.session, at), level(a.week, at))} data-account={a.name}>
      <Tooltip text={tipOf(a)}>
        <span className="limitName">{name}</span>
      </Tooltip>
      <Row what={tr("paneUsage.session", "session")} w={a.session} at={at} />
      <Row what={tr("paneUsage.week", "week")} w={a.week} at={at} />
    </span>
  );
}
