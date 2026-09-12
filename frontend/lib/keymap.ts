"use client";

/* The keyboard shortcuts, as one table the whole window reads.
 *
 * Every shortcut used to be a literal in whichever component happened to
 * handle it — ⌘K in the dock, ⌘N and F12 in the shell, ⌘F in the session —
 * and the list under "?" was a second copy written by hand, which is how it
 * came to name ⌘1…5 for a handler that never existed. Now there is one table:
 * the handlers ask it whether a keydown means an action, the list under "?"
 * prints it, and the settings let each row be bound to another key. A change
 * is kept under prefs.keymap, so every window has the same keys.
 *
 * A chord is written "Mod+Shift+K": Mod is ⌘ on a Mac and Ctrl elsewhere,
 * Option is ⌥ (the PC keyboard's third modifier), the key is a capital
 * letter, a digit, an F-key or the character itself for punctuation. "?" needs Shift to type, so for punctuation Shift is not part
 * of the chord — the character already says it.
 */
export type Action =
  | "palette"
  | "newSession"
  | "settings"
  | "find"
  | "workbench"
  | "workshop"
  | "help"
  | "view1"
  | "view2"
  | "view3"
  | "view4"
  | "view5"
  | "view6"
  | "view7"
  | "view8"
  | "view9"
  | "newShell";

export const KEYMAP_CHANGED = "plxr:keymap";

// Each action, its shipped chord, and the text the list under "?" shows.
export const ACTIONS: { id: Action; chord: string; key: string; fallback: string }[] = [
  { id: "palette", chord: "Mod+K", key: "keys.palette", fallback: "Search commands — the command palette" },
  { id: "newSession", chord: "Mod+N", key: "keys.new", fallback: "New session" },
  { id: "settings", chord: "Mod+,", key: "keys.settings", fallback: "Settings" },
  { id: "find", chord: "Mod+F", key: "keys.find", fallback: "Find in the terminal" },
  { id: "view1", chord: "Mod+1", key: "keys.view1", fallback: "Overview" },
  { id: "view2", chord: "Mod+2", key: "keys.view2", fallback: "Inbox" },
  { id: "view3", chord: "Mod+3", key: "keys.view3", fallback: "Folders" },
  { id: "view4", chord: "Mod+4", key: "keys.view4", fallback: "Changes" },
  { id: "view5", chord: "Mod+5", key: "keys.view5", fallback: "Ports" },
  { id: "view6", chord: "Mod+6", key: "keys.view6", fallback: "Usage" },
  { id: "view7", chord: "Mod+7", key: "keys.view7", fallback: "Archive" },
  { id: "view8", chord: "Mod+8", key: "keys.view8", fallback: "Search" },
  { id: "view9", chord: "Mod+9", key: "keys.view9", fallback: "Notes" },
  { id: "newShell", chord: "Mod+Shift+N", key: "keys.newShell", fallback: "New shell in the folder of the session you are working in" },
  { id: "workbench", chord: "F12", key: "keys.workbench", fallback: "Workbench — the console inside the window" },
  { id: "workshop", chord: "Shift+F12", key: "keys.workshop", fallback: "Workshop — write CSS against the running window" },
  { id: "help", chord: "?", key: "keys.help", fallback: "This list" },
];

// The rail views, in the order ⌘1…9 reaches them. Search came last, so the
// seven keys people already know keep their views; the notes came after that.
export const VIEW_ORDER = ["overview", "inbox", "folders", "changes", "ports", "usage", "archive", "search", "notes"] as const;

const shipped: Record<string, string> = Object.fromEntries(ACTIONS.map((a) => [a.id, a.chord]));

// What was rebound, by action: only the rows that differ from the shipped
// chord. An empty string is a row deliberately left without a key.
let overrides: Record<string, string> = {};

export function bindingOf(action: Action): string {
  return overrides[action] ?? shipped[action];
}

export function keymapOverrides(): Record<string, string> {
  return { ...overrides };
}

/* setKeymap takes the rebound rows as they sit in prefs — a row bound to its
   shipped chord is not an override and is dropped; "" keeps a row unbound.
   Announced, so an open list of shortcuts prints the new keys. */
export function setKeymap(next: Record<string, unknown> | undefined): void {
  const clean: Record<string, string> = {};
  for (const [action, chord] of Object.entries(next ?? {})) {
    if (typeof chord === "string" && action in shipped && chord !== shipped[action]) clean[action] = chord;
  }
  overrides = clean;
  try {
    window.dispatchEvent(new CustomEvent(KEYMAP_CHANGED));
  } catch {
    /* no window yet — nobody is showing the keys */
  }
}

// The names a bare modifier press arrives under, which never make a chord.
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn", "Hyper", "Super", "OS"]); // german-ok: the key's DOM name

/* chordOf writes a keydown the way the table does, or null for a bare
   modifier. The one place a key event is read, so the handlers and the
   rebinding dialog cannot disagree about what a key is called. */
export function chordOf(e: KeyboardEvent | { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): string | null {
  const key = e.key;
  if (!key || MODIFIERS.has(key)) return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("Mod");
  let name: string;
  if (key.length === 1) {
    if (/[a-z]/i.test(key)) {
      name = key.toUpperCase();
      if (e.shiftKey) parts.push("Shift");
    } else if (/[0-9]/.test(key)) {
      name = key;
      if (e.shiftKey) parts.push("Shift");
    } else if (key === " ") {
      name = "Space";
      if (e.shiftKey) parts.push("Shift");
    } else {
      // Punctuation carries its own shift: "?" is "?", not "Shift+/".
      name = key;
    }
  } else {
    name = key;
    if (e.shiftKey) parts.push("Shift");
  }
  if (e.altKey) parts.push("Option");
  parts.push(name);
  return parts.join("+");
}

// matches says whether this keydown is the action's chord as bound now.
export function matches(e: KeyboardEvent, action: Action): boolean {
  const chord = chordOf(e);
  return chord !== null && chord === bindingOf(action);
}

// hasModifier: a chord that needs Mod, the option key or an F-key is safe to
// fire from a text box; a bare letter or "?" is not — that is what somebody is
// typing.
export function hasModifier(chord: string): boolean {
  return /(^|\+)(Mod|Option)\+/.test(chord) || /^F\d{1,2}$/.test(chord.split("+").pop() ?? "");
}

const isMac = () => typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

/* caption prints a chord the way the platform writes it: ⌘⇧K on a Mac,
   Ctrl+Shift+K elsewhere. */
export function caption(chord: string): string {
  if (!chord) return "—";
  const parts = chord.split("+");
  const key = parts.pop() ?? "";
  if (isMac()) {
    const glyphs = parts.map((p) => (p === "Mod" ? "⌘" : p === "Shift" ? "⇧" : p === "Option" ? "⌥" : p)).join("");
    return `${glyphs}${key}`;
  }
  return [...parts.map((p) => (p === "Mod" ? "Ctrl" : p === "Option" ? "Alt" : p)), key].join("+"); // german-ok: the key's name on a PC keyboard
}

// The action, if any, already bound to this chord — so a rebinding can say
// what it is taking the key away from.
export function boundTo(chord: string): Action | null {
  if (!chord) return null;
  for (const a of ACTIONS) if (bindingOf(a.id) === chord) return a.id;
  return null;
}
