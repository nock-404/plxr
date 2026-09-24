"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { wsUrl } from "./token";
import type { AccountUsage, AccountUsageReport, UsageWindow } from "./types";

/* What is left, per account, for the whole window at once.
 *
 * The usage icon marks an account that is close to its window's end, the account
 * picker on a session does the same, the strip over each terminal shows that
 * session's account, and the usage view shows the figures in full. Four
 * readers, one subscription — the way the pace is shared in usePace.ts.
 *
 * It is pushed, not polled. The figures come off a file Claude Code rewrites
 * when it runs, so they move at no pace of their own, and asking on a timer
 * meant a window that had just reset stayed on screen as full for the better
 * part of a minute. The service watches the file and writes when the answer
 * changes; here that lands within the second.
 *
 * The poll stays underneath as the fallback for a socket that will not open —
 * an old service that has no /ws/limits, or a link that keeps dropping. It
 * runs only while nothing is connected, so the two never ask together.
 *
 * `report` is null until the first answer, so a readout can tell "not asked
 * yet" from a real zero.
 */
const EVERY = 20000;

/* How full a window has to be before the usage icon marks it, when the service has
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
let socket: WebSocket | null = null;
let retry: number | null = null;
let live = false;

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
  tell();
}

function tell(): void {
  for (const r of readers) r(latest);
}

/* The timer is the fallback and nothing more: it runs while the socket is
   down and stops the moment one is up, so the service is never asked by two
   routes at once. */
function poll(on: boolean): void {
  if (on && timer === null) timer = window.setInterval(() => void ask(), EVERY);
  if (!on && timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

function connect(): void {
  if (socket || readers.size === 0) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl("/ws/limits"));
  } catch {
    poll(true);
    return;
  }
  socket = ws;
  ws.onopen = () => {
    live = true;
    poll(false);
  };
  ws.onmessage = (e) => {
    try {
      latest = JSON.parse(e.data as string) as AccountUsageReport;
    } catch {
      return; /* a malformed frame; the next one corrects it */
    }
    tell();
  };
  ws.onerror = () => ws.close();
  ws.onclose = () => {
    socket = null;
    live = false;
    if (readers.size === 0) return;
    /* Asking again keeps the figures moving while the socket is away, and the
       last reading stands in the meantime rather than blanking the screen. */
    poll(true);
    retry = window.setTimeout(connect, 1000);
  };
}

function subscribe(r: (v: AccountUsageReport | null) => void): () => void {
  readers.add(r);
  if (readers.size === 1) {
    void ask();
    connect();
    if (!live) poll(true);
  }
  return () => {
    readers.delete(r);
    if (readers.size > 0) return;
    poll(false);
    if (retry !== null) {
      window.clearTimeout(retry);
      retry = null;
    }
    socket?.close();
    socket = null;
    live = false;
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
