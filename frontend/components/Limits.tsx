"use client";

import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import { accountName, moment, until } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useLimits } from "@/lib/useLimits";
import type { AccountUsage, UsageWindow } from "@/lib/types";

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

type Level = "ok" | "hot" | "full" | "unknown";

function share(w: UsageWindow): string {
  return w.known ? `${Math.round(w.percent)}%` : "—";
}

function level(w: UsageWindow, at: number): Level {
  if (!w.known) return "unknown";
  if (w.percent >= 100) return "full";
  if (w.percent >= at) return "hot";
  return "ok";
}

function worse(a: Level, b: Level): Level {
  const rank: Record<Level, number> = { unknown: 0, ok: 1, hot: 2, full: 3 };
  return rank[a] >= rank[b] ? a : b;
}

function windowLine(w: UsageWindow): string {
  if (!w.known) return tr("limits.noReading", "no reading");
  if (!w.resetsAt) return tr("limits.used", "{pct} used", { pct: share(w) });
  const left = until(w.resetsAt);
  return tr("limits.windowTip", "{pct} used, back {when}{left}", {
    pct: share(w),
    when: moment(w.resetsAt),
    left: left ? ` · ${tr("limits.in", "in {left}", { left })}` : "",
  });
}

function tipOf(a: AccountUsage): string {
  return [
    accountName(a),
    `${tr("limits.session", "session")}: ${windowLine(a.session)}`,
    `${tr("limits.week", "week")}: ${windowLine(a.week)}`,
    a.weekModel.known ? `${tr("limits.weekModel", "week, {model}", { model: a.weekModel.model || "—" })}: ${windowLine(a.weekModel)}` : "",
    a.known && a.fetchedAt
      ? tr("limits.age", "reading from {when}", { when: moment(a.fetchedAt) })
      : tr("limits.noReadingLong", "Claude Code has left no reading for this account yet"),
  ]
    .filter(Boolean)
    .join(" · ");
}

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
