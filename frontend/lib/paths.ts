"use client";

/* Reading a path the way the system that sent it writes one.
 *
 * The daemon hands back native paths, so the window has to read both
 * separators: plxr runs on Windows too. Written for the slash alone,
 * parent("C:\\Users\\max\\projekt") found no "/" at all and answered "/" — one
 * click on "up one" left the whole drive behind and landed at a root that does
 * not exist there.
 *
 * This lived inside the folder picker. The file tree needed the same two
 * functions the day it learned to walk upwards, and a second copy of "where
 * does a path end" is a second copy to get wrong — the drive letter was got
 * wrong once already.
 */
const SEP = /[\\/]/;

export function separatorOf(path: string): string {
  return path.includes("\\") && !path.startsWith("/") ? "\\" : "/";
}

// The folder above this one. A path already at the top answers itself, which is
// how a caller can tell it has arrived: parent(p) === p.
export function parent(path: string): string {
  const sep = separatorOf(path);
  const trimmed = path.replace(/[\\/]+$/, "");
  // Already at the top: "/" trims to nothing, "C:\\" trims to the bare drive.
  if (trimmed === "") return "/";
  if (/^[A-Za-z]:$/.test(trimmed)) return trimmed + sep;
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (cut < 0) return trimmed;
  // "C:" is as far up as Windows goes, and "" is the unix root.
  const up = trimmed.slice(0, cut);
  if (up === "") return "/";
  if (/^[A-Za-z]:$/.test(up)) return up + sep;
  return up;
}

// Every step of a path, each with the whole path up to it — what a breadcrumb
// is made of.
export function segments(path: string): { name: string; path: string }[] {
  const sep = separatorOf(path);
  const parts = path.split(SEP).filter(Boolean);
  const out: { name: string; path: string }[] = [];
  // On Windows the first part is the drive and is already a whole path;
  // on unix every part hangs off the root.
  let here = "";
  for (const [i, part] of parts.entries()) {
    here = i === 0 && /^[A-Za-z]:$/.test(part) ? part + sep : here + (here.endsWith(sep) ? "" : sep) + part;
    out.push({ name: part, path: here });
  }
  return out;
}

// Whether a path is the top of its filesystem: the unix root, or a bare drive.
// That is exactly the case parent() answers with the path it was given.
export function atTop(path: string): boolean {
  return !path || parent(path) === path;
}
