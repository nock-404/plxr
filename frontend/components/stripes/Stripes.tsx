"use client";

import Stripe, { type StripeMarks } from "@/components/stripes/Stripe";
import { tr } from "@/lib/i18n";
import { accountName } from "@/lib/format";
import { isHot, useLimits, worst } from "@/lib/useLimits";
import { EDGES, type Edge, type ToolId, type ToolLayout } from "@/lib/tools";

/* The three stripes around the dock: left, right and the bottom one under all
 * of it.
 *
 * They replace a wide column of words that stood beside the work: the views,
 * a command, and every session, all in one list. The sessions
 * are in the session switch at the top now, the documents in the MENU and the
 * switches, and what is left are the tools — one icon each, on the edge his
 * layout puts it on. The stripes are plain controls outside the dock, so they
 * never move and never change thickness whatever the dock does inside.
 */
export default function Stripes({
  layout,
  shown,
  counts,
  flash,
  onToggle,
  onReveal,
  onHide,
  onResetLayout,
}: {
  layout: ToolLayout;
  shown: Record<Edge, ToolId | null>;
  counts: { inbox: number; ports: number; archive: number };
  // The edge that was asked to show and has nothing on it, for a moment.
  flash: Edge | null;
  onToggle: (id: ToolId) => void;
  onReveal: (id: ToolId) => void;
  onHide: (edge: Edge) => void;
  onResetLayout?: () => void;
}) {
  /* Which accounts are close to the end of a window, so the usage says so
     before somebody starts a long run on one of them. Nothing is marked before
     the first answer: quiet because it has not asked looks exactly like quiet
     because it found nothing. */
  const { report, at } = useLimits();
  const nearlyOut = (report?.accounts ?? []).filter((a) => isHot(a, at));
  const usageHot = nearlyOut.length
    ? tr("tool.usageHot", "{names} nearly out: {pct}% of one window used", {
        names: nearlyOut.map((a) => accountName(a)).join(", "),
        pct: Math.max(...nearlyOut.map((a) => worst(a)?.percent ?? 0)),
      })
    : "";
  const count = (n: number) => (n > 0 ? String(n) : "");
  const marks: StripeMarks = {
    badge: {
      inbox: count(counts.inbox),
      ports: count(counts.ports),
      archive: count(counts.archive),
      usage: usageHot ? tr("tool.nearlyOut", "!") : "",
    },
    hot: { usage: usageHot },
  };

  return (
    <>
      {EDGES.map((edge) => (
        <Stripe
          key={edge}
          edge={edge}
          ids={layout.order[edge]}
          shown={shown[edge]}
          flash={flash === edge}
          marks={marks}
          onToggle={onToggle}
          onReveal={onReveal}
          onHide={onHide}
          onResetLayout={onResetLayout}
        />
      ))}
    </>
  );
}
