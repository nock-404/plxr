"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import type { AccountUsage, AccountUsageReport, UsageWindow } from "./types";

/* What is left, per account, polled once for the whole window.
 *
 * The rail marks an account that is close to its window's end, the account
 * picker on a session does the same, and the usage view shows the figures in
 * full. Three readers, one poll — the way the pace is shared in usePace.ts.
 *
 * `report` is null until the first answer, so a readout can tell "not asked
 * yet" from a real zero. The service works it out at most once every fifteen
 * seconds and hands the same answer to everyone in between; the reading
 * underneath is a cache Claude Code refreshes when it runs, so nothing here
 * gains anything by asking faster.
 */
const EVERY = 20000;

/* How full a window has to be before the rail marks it, when the service has
   not said. The service sends its own threshold with the figures — the one
   the user set for the notification — and that is what is used; this is only
   the value before the first answer, and it is the same default so that a
   colour never disagrees with a notification. */
export const HOT_AT = 80;

/* The percentage to mark at: the service's, when it has said. */
export function hotAt(report: AccountUsageReport | null): number {
  const at = report?.threshold ?? 0;
  return at > 0 && at <= 100 ? at : HOT_AT;
}

let latest: AccountUsageReport | null = null;
const readers = new Set<(r: AccountUsageReport | null) => void>();
let timer: number | null = null;
let asking = false;

async function ask(): Promise<void> {
  if (asking) return;
  asking = true;
  try {
    latest = await api.usageAccounts();
  } catch {
    /* the service will be back; the last reading stands until then */
  } finally {
    asking = false;
  }
  for (const r of readers) r(latest);
}

function subscribe(r: (v: AccountUsageReport | null) => void): () => void {
  readers.add(r);
  if (timer === null) {
    void ask();
    timer = window.setInterval(() => void ask(), EVERY);
  }
  return () => {
    readers.delete(r);
    if (readers.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

/* The window furthest along, of the ones this machine has a reading for.
   A window nobody measured is never the answer: an unknown must not be what
   colours a row red, and it must not be what keeps one calm either — it is
   simply not a reading. */
export function worst(a: AccountUsage): UsageWindow | null {
  const known = [a.session, a.week, a.weekModel].filter((w) => w.known);
  if (!known.length) return null;
  return known.reduce((most, w) => (w.percent > most.percent ? w : most));
}

export function isHot(a: AccountUsage, at = HOT_AT): boolean {
  const w = worst(a);
  return Boolean(w && w.percent >= at);
}

export function useLimits(): { report: AccountUsageReport | null; at: number } {
  const [report, setReport] = useState<AccountUsageReport | null>(latest);
  useEffect(() => subscribe(setReport), []);
  return { report, at: hotAt(report) };
}

/* The accounts by name, for a picker that wants to mark the one that is
   nearly out, and the percentage to mark at. Empty until the first answer. */
export function useAccountLimits(): { accounts: Map<string, AccountUsage>; at: number } {
  const { report, at } = useLimits();
  const accounts = new Map<string, AccountUsage>();
  for (const a of report?.accounts ?? []) accounts.set(a.name, a);
  return { accounts, at };
}

/* Ask again now — after something that changes the picture, rather than at
   the next tick. */
export function refreshLimits(): void {
  void ask();
}
