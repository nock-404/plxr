"use client";

import Tooltip from "@/components/ui/Tooltip";
import { shortNumber } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { usePace } from "@/lib/usePace";
import type { Pace as PaceData } from "@/lib/types";

/* The spend, always in view.
 *
 * One line on the status row: what the last five hours cost, which way the
 * rate is going, how many sessions are doing the spending. It wears
 * `pace--hot` once the five-hour spend is past the ceiling the user set for
 * themselves — a colour, never a brake; the service says the one word when
 * the line is crossed, and this only shows which side of it we are on.
 *
 * Nothing is drawn until the first answer: a zero that has not been measured
 * would be a lie in the one place that is supposed to be trustworthy.
 */
const GLYPH: Record<PaceData["trend"], string> = { rising: "↑", falling: "↓", flat: "→" };

function trendWord(t: PaceData["trend"]): string {
  if (t === "rising") return tr("pace.rising", "rising");
  if (t === "falling") return tr("pace.falling", "falling");
  return tr("pace.flat", "flat");
}

export default function Pace() {
  const { pace, limit, hot } = usePace();
  if (!pace) return null;

  const tip = limit > 0
    ? tr("pace.tip", "Spent in the last five hours, {trend} — {rate} per hour. Your own ceiling: {limit} (not the plan's cap).", {
        trend: trendWord(pace.trend),
        rate: shortNumber(pace.perHour),
        limit: shortNumber(limit),
      })
    : tr("pace.tipNoLimit", "Spent in the last five hours, {trend} — {rate} per hour. No ceiling set: choose one in Usage.", {
        trend: trendWord(pace.trend),
        rate: shortNumber(pace.perHour),
      });

  return (
    <Tooltip text={tip}>
      <span className={`pace ${hot ? "pace--hot" : ""}`.trim()}>
        <span className="paceNum">{shortNumber(pace.window5h)}</span>
        <span className="paceTrend">{GLYPH[pace.trend]}</span>
        <span className="paceActive">{tr("pace.active", "{n} active", { n: pace.active })}</span>
      </span>
    </Tooltip>
  );
}
