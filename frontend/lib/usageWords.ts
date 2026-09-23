"use client";

/* What a usage window says, in words and in a level.
 *
 * Two places show the same figures now — the chip on the status row and the
 * line over a terminal — and a second reading of "80% used" that coloured
 * differently from the first would be worse than no reading at all. So the
 * arithmetic and the wording live here, once.
 */
import { accountName, moment, until } from "@/lib/format";
import { tr } from "@/lib/i18n";
import type { AccountUsage, UsageWindow } from "@/lib/types";

export type Level = "ok" | "hot" | "full" | "unknown";

export function share(w: UsageWindow): string {
  return w.known ? `${Math.round(w.percent)}%` : "—";
}

export function level(w: UsageWindow, at: number): Level {
  if (!w.known) return "unknown";
  if (w.percent >= 100) return "full";
  if (w.percent >= at) return "hot";
  return "ok";
}

export function worse(a: Level, b: Level): Level {
  const rank: Record<Level, number> = { unknown: 0, ok: 1, hot: 2, full: 3 };
  return rank[a] >= rank[b] ? a : b;
}

export function windowLine(w: UsageWindow): string {
  if (!w.known) return tr("limits.noReading", "no reading");
  if (!w.resetsAt) return tr("limits.used", "{pct} used", { pct: share(w) });
  const left = until(w.resetsAt);
  return tr("limits.windowTip", "{pct} used, back {when}{left}", {
    pct: share(w),
    when: moment(w.resetsAt),
    left: left ? ` · ${tr("limits.in", "in {left}", { left })}` : "",
  });
}

export function tipOf(a: AccountUsage): string {
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
