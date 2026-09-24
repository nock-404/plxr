/* What a folder has to show about the sessions in it.
 *
 * Two lists arrive: what is running, from the service, and what is over, from
 * the archive. They overlap — the archive keeps a row for a conversation while
 * it is still being written — so the same name stood in the list two and three
 * times over. What runs wins; the archive fills in the rest, newest first, and
 * only as far as a page can carry before it buries everything else.
 *
 * Its own file so the arithmetic can be checked without a window.
 */
export interface LiveSession {
  id: string;
  claude_session_id?: string;
}

export interface EndedSession {
  id: string;
  mod: number;
}

export function sessionsHere<L extends LiveSession, E extends EndedSession>(
  live: L[],
  archive: E[],
  shown: number,
): { running: L[]; over: E[]; more: number } {
  const running = live ?? [];
  const seen = new Set(running.map((t) => t.claude_session_id).filter(Boolean) as string[]);
  const over = (archive ?? [])
    .filter((a) => !seen.has(a.id))
    .slice()
    .sort((a, b) => b.mod - a.mod);
  return { running, over: over.slice(0, shown), more: Math.max(0, over.length - shown) };
}
