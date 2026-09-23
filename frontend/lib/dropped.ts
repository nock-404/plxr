"use client";

/* The paths in a drop, in the order they were dragged.
 *
 * A window is not a file manager: what a browser hands over for a file dragged
 * in from a folder is its address (text/uri-list), not the file. That address
 * is exactly what a terminal wants — the path. Anything that is not a file
 * address is passed through as the plain text it is, which is what dragging a
 * selection into a terminal has always done. */
export function droppedPaths(data: DataTransfer): string[] {
  const list = data.getData("text/uri-list") || data.getData("text/plain") || "";
  return list
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      if (!line.startsWith("file://")) return line;
      try {
        return decodeURIComponent(new URL(line).pathname);
      } catch {
        return line;
      }
    });
}

/* A path as a shell reads it back: quoted only where it has to be, because a
   quoted path where none is needed is noise in the line somebody then edits. */
export function quotePath(path: string): string {
  if (/^[A-Za-z0-9_@%+=:,./~-]+$/.test(path)) return path;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}
