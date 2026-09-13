"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { refreshLimits } from "./useLimits";
import type { Account } from "./types";

/* The accounts, asked for once for the whole window.
 *
 * The Accounts page, the new-session dialog and the account switch on a
 * session each asked when they opened and kept what they got. An account
 * added on the page stayed missing from a picker that was already open, and
 * an account somebody had just signed in to went on saying it was not until
 * the settings were closed and opened again.
 *
 * One list now, handed to every reader whenever it changes. A change made on
 * the page is handed round at once. What changes on the disk — a sign-in
 * finishing in a session — is asked about every few seconds for a while after
 * a sign-in was started here, and at a slow pace otherwise.
 *
 * null until the first answer, so nothing says "no accounts" while it asks.
 */
const RESTING = 30000;
const WATCHING = 3000;
/* How long after a sign-in was started the list is watched closely. Signing
   in is a trip to the browser and a code brought back; ten minutes covers a
   slow one. */
const SIGN_IN_WINDOW = 10 * 60 * 1000;

let latest: Account[] | null = null;
const readers = new Set<(list: Account[] | null) => void>();
let timer: number | null = null;
let asking = false;
let watchUntil = 0;

/* What makes the usage readout worth asking for again: an account came or
   went, or one of them was signed in to. */
function fingerprint(list: Account[] | null): string {
  return (list ?? []).map((a) => `${a.name}:${a.state?.signedIn ? 1 : 0}`).join(",");
}

function publish(next: Account[]): void {
  const changed = latest !== null && fingerprint(next) !== fingerprint(latest);
  latest = next;
  for (const r of readers) r(latest);
  if (changed) refreshLimits();
}

function schedule(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  if (readers.size === 0) return;
  timer = window.setTimeout(() => void ask(), Date.now() < watchUntil ? WATCHING : RESTING);
}

async function ask(): Promise<void> {
  if (asking) return;
  asking = true;
  try {
    publish((await api.accounts()) ?? []);
  } catch {
    /* the service will be back; the last list stands until then */
  } finally {
    asking = false;
    schedule();
  }
}

export function useAccounts(): Account[] | null {
  const [list, setList] = useState<Account[] | null>(latest);
  useEffect(() => {
    readers.add(setList);
    setList(latest);
    // The first reader after none asks: what was kept may be old by now.
    if (readers.size === 1 || latest === null) void ask();
    return () => {
      readers.delete(setList);
      if (readers.size === 0 && timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
  }, []);
  return list;
}

/* The list the service handed back after a change made here, shown
   everywhere at once. */
export function adoptAccounts(list: Account[]): void {
  publish(list);
  schedule();
}

/* A sign-in was started: watch closely for a while, so the page and the
   pickers turn the moment it finishes rather than half a minute later. */
export function watchSignIn(): void {
  watchUntil = Date.now() + SIGN_IN_WINDOW;
  schedule();
}
