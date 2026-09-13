/* The project the window is about.
 *
 * Changes, Review and Search each followed "the session focused last", and the
 * path field at the top was only their fallback — so a folder chosen there was
 * ignored by the very tools it named as soon as any session had ever been in
 * front. There is one project now, owned by the shell, and two things set it;
 * the later one wins:
 *
 *   - a folder picked in the project switcher: {path, sessionId: ""}
 *   - a session coming to the front: {path: its folder, sessionId: its id}
 *
 * A session is followed by its id, because the service knows the folder from
 * the id and a session can move. A folder picked on its own is followed by its
 * path, as a "dir:" id — the prefix the service reads in internal/core/core.go.
 */
export type Project = { path: string; sessionId: string };

export const NO_PROJECT: Project = { path: "", sessionId: "" };

// The id the service answers to for this project, or "" for none.
export const rootIdOf = (p: Project): string => p.sessionId || (p.path ? `dir:${p.path}` : "");

// What the switch at the top calls it: the folder's own name.
export const projectLabel = (p: Project): string => p.path.split("/").filter(Boolean).pop() ?? "";

// One folder written two ways — with and without the trailing slash — is one folder.
export const samePath = (a: string, b: string): boolean => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
