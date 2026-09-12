import { Compartment, type Extension } from "@codemirror/state";
import { changeGutter } from "./gutter";

/* The editor's plugins, named in one place.
 *
 * Everything the editor is besides a text box goes through here: one
 * Compartment per plugin, reconfigured on a live view — never a rebuild,
 * which would drop the undo history — and built from a context the editor
 * hands over rather than from the library directly, so a plugin knows the
 * palette without knowing where it comes from.
 *
 * Member #1 is the change gutter. Lint, format and LSP are declared with it
 * and not built: they are the next cycle, and a name in a list is a promise
 * that can be held to, where an absent name is one that gets forgotten. An
 * entry with no build contributes nothing to the editor and says so.
 */

export type PluginContext = {
  /* A palette token by name, with a fallback — the one bridge to the skin. */
  token: (name: string, fallback: string) => string;
  filename: string;
};

export type EditorPlugin = {
  id: string;
  compartment: Compartment;
  /* The extension for the compartment. Absent for a declared, unbuilt entry. */
  build?: (ctx: PluginContext) => Extension;
  /* Something to do on Mod-S before the file is written — a formatter's
     place. None of the built plugins has one yet. */
  save?: (ctx: PluginContext) => void;
};

export const EDITOR_PLUGINS: EditorPlugin[] = [
  {
    id: "changes",
    compartment: new Compartment(),
    build: (ctx) => changeGutter(ctx.token),
  },
  // Declared, unbuilt — next cycle. Each is an empty compartment until then.
  { id: "lint", compartment: new Compartment() },
  { id: "format", compartment: new Compartment() },
  { id: "lsp", compartment: new Compartment() },
];

/* Every plugin's extension for a fresh state: what it builds, or nothing. */
export function pluginExtensions(ctx: PluginContext): Extension[] {
  return EDITOR_PLUGINS.map((p) => p.compartment.of(p.build ? p.build(ctx) : []));
}

/* The reconfigure effects that bring every plugin up to date with a new
   context — the palette changed, say. */
export function pluginReconfigure(ctx: PluginContext) {
  return EDITOR_PLUGINS.map((p) => p.compartment.reconfigure(p.build ? p.build(ctx) : []));
}
