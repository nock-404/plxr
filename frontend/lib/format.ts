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
