"use client";

import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, placeholder as cmPlaceholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, search } from "@codemirror/search";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, HighlightStyle, LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";
import { THEME_CHANGED } from "@/lib/theme";

/* A real editor, wrapped so the rest of the app never sees the library.
 *
 * It replaces a plain text box, which could not colour a line, could not fold a
 * block and could not find anything — and which was a raw browser control in an
 * interface whose whole point is that nothing is.
 *
 * Like the terminal, it draws through its own DOM and is not reached by a
 * stylesheet, so it is handed the palette here and told again whenever the
 * palette changes.
 */

const token = (name: string, fallback: string) => {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return v || fallback;
};

// The look, built from the same tokens as everything else, so the editor
// belongs to whichever skin is on rather than bringing its own.
function look() {
  const fg = token("term-fg", "#ddd");
  const bg = token("term-bg", "transparent");
  const dim = token("dim", "#888");
  const accent = token("accent", "#8cf");
  const line = token("line", "#333");
  const blocked = token("blocked", "#f66");
  const working = token("working", "#6c6");
  return [
    EditorView.theme(
      {
        "&": { color: fg, backgroundColor: "transparent", height: "100%" },
        ".cm-content": { caretColor: accent, fontFamily: token("term-font", "monospace") },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: accent },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
          backgroundColor: `color-mix(in srgb, ${accent} 28%, transparent)`,
        },
        ".cm-gutters": { backgroundColor: "transparent", color: dim, border: "none" },
        ".cm-activeLine": { backgroundColor: `color-mix(in srgb, ${accent} 8%, transparent)` },
        ".cm-activeLineGutter": { backgroundColor: "transparent", color: accent },
        ".cm-selectionMatch": { backgroundColor: `color-mix(in srgb, ${working} 22%, transparent)` },
        ".cm-panels": { backgroundColor: bg, color: fg, borderTop: `1px solid ${line}` },
        ".cm-searchMatch": { backgroundColor: `color-mix(in srgb, ${accent} 25%, transparent)` },
        ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: `color-mix(in srgb, ${accent} 45%, transparent)` },
        ".cm-foldPlaceholder": { backgroundColor: "transparent", color: dim, border: `1px solid ${line}` },
      },
      { dark: true },
    ),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: tags.keyword, color: accent },
        { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: fg },
        { tag: [tags.function(tags.variableName), tags.labelName], color: working },
        { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: accent },
        { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.self, tags.namespace], color: working },
        { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link], color: dim },
        { tag: [tags.meta, tags.comment], color: dim, fontStyle: "italic" },
        { tag: tags.strong, fontWeight: "bold" },
        { tag: tags.emphasis, fontStyle: "italic" },
        { tag: tags.strikethrough, textDecoration: "line-through" },
        { tag: tags.heading, fontWeight: "bold", color: accent },
        { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: working },
        { tag: [tags.processingInstruction, tags.string, tags.inserted], color: working },
        { tag: tags.invalid, color: blocked },
      ]),
    ),
  ];
}

export default function Editor({
  value,
  filename,
  placeholder,
  readOnly = false,
  onChange,
  onSave,
}: {
  value: string;
  filename: string;
  /* What an empty editor shows instead of a blank field: an example is worth
     more than a hint, in a box where somebody has to know the syntax. */
  placeholder?: string;
  readOnly?: boolean;
  onChange: (text: string) => void;
  onSave?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const theming = useRef(new Compartment());
  const language = useRef(new Compartment());
  // Held in a ref so changing the handler does not rebuild the editor and throw
  // away the undo history with it.
  const save = useRef(onSave);
  save.current = onSave;
  const changed = useRef(onChange);
  changed.current = onChange;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        foldGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              save.current?.();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        ...(placeholder ? [cmPlaceholder(placeholder)] : []),
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        theming.current.of(look()),
        language.current.of([]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) changed.current(u.state.doc.toString());
        }),
      ],
    });
    view.current = new EditorView({ state, parent: el });
    return () => {
      view.current?.destroy();
      view.current = null;
    };
    // Built once per file: a new document belongs to a new editor, and nothing
    // else here is worth throwing the undo history away for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename]);

  // The document, when it arrives or is replaced from outside.
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  /* The language, worked out from the name and loaded only when it is needed.
     Twenty grammars in the bundle would be paid for by everybody who never
     opens a file. */
  useEffect(() => {
    const found = LanguageDescription.matchFilename(languages, filename);
    if (!found) {
      view.current?.dispatch({ effects: language.current.reconfigure([]) });
      return;
    }
    let dropped = false;
    void found.load().then((support) => {
      if (!dropped) view.current?.dispatch({ effects: language.current.reconfigure(support) });
    });
    return () => {
      dropped = true;
    };
  }, [filename]);

  // The palette is handed over, and handed over again when it changes.
  useEffect(() => {
    const follow = () =>
      view.current?.dispatch({ effects: theming.current.reconfigure(look()) });
    window.addEventListener(THEME_CHANGED, follow);
    return () => window.removeEventListener(THEME_CHANGED, follow);
  }, []);

  return <div className="editor" ref={host} />;
}
