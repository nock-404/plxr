/* The way into the window, for every browser gate.
 *
 * Each gate used to find the rail on its own: its ready check counted rail
 * rows, and every step that opened a view or a session clicked a rail row it
 * had found by a class name or a word. Thirteen gates held thirteen copies of
 * that, so a change to the frame would have meant rewriting all of them at
 * once, and a gate that was only half rewritten reports on a window that no
 * longer exists.
 *
 * So the way in lives here, once. A gate says what it wants — the window up,
 * a tool open, a session in front, a document open, a project picked — and
 * what that takes is written in this file. Today it drives the rail. When the
 * rail becomes the tool stripes and the switchers in the top bar, what is
 * inside these functions changes and the gates stay as they are.
 *
 * GATEKIT is page-side source, spliced into the strings a gate hands to
 * Runtime.evaluate. Everything in it is a function declaration: a gate may
 * splice it twice into one body, and a function may be declared twice where
 * a const may not. No gate may declare one of these names in its own helpers.
 */
export const GATEKIT = `
  /* Nonzero once the window has rendered its frame: the number of tool icons
     it shows. */
  function appUp() { return stripeIcons().length; }

  /* Every icon on the frame that opens a view, in the order the frame shows
     them. On the rail the documents stand among the tools. */
  function stripeIcons() { return [...document.querySelectorAll('.railhome[data-view]')]; }

  /* The icon that opens one tool, by the tool's id — never by its word, which
     changes with the language, or its glyph, which changes with the pack. */
  function stripeIcon(id) { return stripeIcons().find((e) => e.dataset.view === id) || null; }

  /* Whether the tool's icon says the tool is the one in front. */
  function toolLit(id) { const icon = stripeIcon(id); return Boolean(icon && icon.classList.contains('active')); }

  /* Opens a tool or brings it forward, and never puts it away: the same click
     on a tool that is already in front hides it, so a lit tool is not clicked.
     False when the frame has no icon for it. */
  function openTool(id) {
    const icon = stripeIcon(id);
    if (!icon) return false;
    if (!toolLit(id)) icon.click();
    return true;
  }

  /* The rows that open a session, one per session. */
  function sessionRows() { return [...document.querySelectorAll('.railitem[data-status]')]; }

  /* Brings a session to the front: a string is its exact title, a RegExp is
     held against everything its row says. The row clicked, or null. */
  function openSession(match) {
    const titleOf = (row) => ((row.querySelector('.rname') || { textContent: '' }).textContent || '').trim();
    const row = sessionRows().find((r) => (typeof match === 'string' ? titleOf(r) === match : match.test(r.textContent || '')));
    if (row) row.click();
    return row || null;
  }

  /* Opens a document of main, or brings it forward: "overview", "folders" or
     "settings". A document is never put away by opening it again. False when
     there is nothing to open it with. */
  function openDoc(id) {
    const opener = id === 'settings'
      ? document.querySelector('.bar [data-do="settings"]')
      : document.querySelector('.railhome[data-view="' + id + '"]');
    if (!opener) return false;
    opener.click();
    return true;
  }

  /* Picks the project the window works in, by its folder, the way a person
     does: typed into the field and taken with Enter. False when there is no
     field to type into. */
  async function pickProject(path) {
    const field = document.querySelector('.filter input');
    if (!field) return false;
    field.focus();
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set.call(field, path);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  }
`;
