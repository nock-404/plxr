// Small shared formatters. Never duplicated in a view.

import { tr } from "./i18n";

export function clock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour12: false });
}

/* What an account is called on screen.
 *
 * The settings let somebody name an account, and an account nobody named is
 * "account 2". That rule lived in the accounts panel alone, so the session
 * bar, the new-session dialog and the usage view each said something else
 * about the same account. It lives here now and they all ask.
 */
export function accountName(a: { label?: string; number: number }): string {
  return a.label || tr("accounts.numbered", `account ${a.number}`, { n: a.number });
}

/* A moment in the reader's own timezone — the only one they can act on.
 *
 * Weekday and time for anything inside the next week, which is every window a
 * plan has; a date as well once it is further off than that. 0 means nobody
 * knows, and the caller says so in words instead of printing 1970. */
export function moment(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const week = 7 * 24 * 60 * 60 * 1000;
  const near = Math.abs(ms - Date.now()) < week;
  return d.toLocaleString(undefined, {
    weekday: "short",
    ...(near ? {} : { day: "2-digit", month: "2-digit" }),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/* How long until a moment, in the shortest useful words: 3h 20m, 2d 4h. Past
   or unknown comes back empty, and the caller says what that means. */
export function until(ms: number): string {
  if (!ms) return "";
  const s = Math.floor((ms - Date.now()) / 1000);
  if (s <= 0) return "";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/* A big number, short enough for a tile. */
export function shortNumber(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export function shortPath(p: string, keep = 34): string {
  if (p.length <= keep) return p;
  return `…${p.slice(-(keep - 1))}`;
}

/* A size on disk. Powers of 1024 with the units written the way a file manager
   writes them, because that is what the number will be held against. */
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/* The whole date and time, as the machine writes them.
   Beside the relative age, never instead of it: "3d" answers "is this fresh",
   and only the stamp answers "which afternoon was that". */
export function stamp(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

export function ago(ms?: number): string {
  if (!ms) return "";
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
