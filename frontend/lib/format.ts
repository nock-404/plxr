// Small shared formatters. Never duplicated in a view.

export function clock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour12: false });
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
