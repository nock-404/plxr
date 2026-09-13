// Small shared formatters. Never duplicated in a view.

export function clock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour12: false });
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
