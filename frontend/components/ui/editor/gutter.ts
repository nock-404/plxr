import { RangeSet, RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import { lineDiff, marksOf, type Mark } from "./lineDiff";

/* The change gutter: what differs between the buffer and HEAD, beside each
 * line, live as the operator types.
 *
 * Honest about what it measures. It is HEAD against the buffer — this
 * editor's buffer, not the file on disk — so it follows every keystroke and
 * it does not follow an agent writing the same file while the buffer holds
 * unsaved edits; that case is said in the editor's bar instead, as a
 * "changed on disk" offer, and never painted over the operator's work.
 *
 * The baseline arrives as a StateEffect: the editor is built before the
 * file's HEAD text is known, and it must not be rebuilt for it — a rebuild
 * drops the undo history. The field recomputes on that effect and on every
 * change to the document, and the gutter reads the field.
 */

// The baseline to measure against; null switches the marks off — a binary
// or a truncated file, or no repository.
export const setBaseline = StateEffect.define<string | null>();

// Past this many lines on either side the diff is not attempted: it would
// cost more per keystroke than it tells.
const TOO_MANY_LINES = 20000;

class ChangeMarker extends GutterMarker {
  // The gutter cell itself wears the kind, so the theme can colour it.
  elementClass: string;
  constructor(readonly kind: Mark) {
    super();
    this.elementClass = `cm-changeLine-${kind}`;
  }
  eq(other: ChangeMarker) {
    return other.kind === this.kind;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-changeMark cm-changeMark-${this.kind}`;
    return el;
  }
}

/* The cell the gutter measures its width by. It is never seen, and it must
   not wear a kind: a spacer marked "add" is one more added line to anything
   that counts the marks — a check, or a reader of the DOM. */
class Spacer extends GutterMarker {
  toDOM() {
    return document.createElement("span");
  }
}

const markers: Record<Mark, ChangeMarker> = {
  add: new ChangeMarker("add"),
  mod: new ChangeMarker("mod"),
  del: new ChangeMarker("del"),
};
const spacer = new Spacer();

function linesOf(doc: Text): string[] {
  const out: string[] = [];
  for (const line of doc.iterLines()) out.push(line);
  return out;
}

type Gutter = { baseline: string[] | null; marks: RangeSet<GutterMarker> };

function compute(baseline: string[] | null, doc: Text): RangeSet<GutterMarker> {
  if (baseline === null) return RangeSet.empty;
  if (baseline.length > TOO_MANY_LINES || doc.lines > TOO_MANY_LINES) return RangeSet.empty;
  const current = linesOf(doc);
  const marks = marksOf(lineDiff(baseline, current), current.length);
  const builder = new RangeSetBuilder<GutterMarker>();
  // In document order, which is what a RangeSet is built in.
  const at = [...marks.keys()].sort((x, y) => x - y);
  for (const i of at) {
    const line = doc.line(i + 1);
    builder.add(line.from, line.from, markers[marks.get(i) as Mark]);
  }
  return builder.finish();
}

const changeField = StateField.define<Gutter>({
  create: () => ({ baseline: null, marks: RangeSet.empty }),
  update(value, tr) {
    let baseline = value.baseline;
    let moved = false;
    for (const e of tr.effects) {
      if (e.is(setBaseline)) {
        baseline = e.value === null ? null : e.value.split("\n");
        moved = true;
      }
    }
    if (!moved && !tr.docChanged) return value;
    return { baseline, marks: compute(baseline, tr.state.doc) };
  },
});

/* The gutter, with its look. Colours come through the same token bridge the
   rest of the editor uses — the palette, not a stylesheet of its own — and
   they are read when the extension is built, so a palette change rebuilds it
   the way it rebuilds the theme. */
export function changeGutter(token: (name: string, fallback: string) => string): Extension {
  const working = token("working", "#6c6");
  const accent = token("accent", "#8cf");
  const blocked = token("blocked", "#f66");
  return [
    changeField,
    gutter({
      class: "cm-gutter-changes",
      markers: (view) => view.state.field(changeField).marks,
      initialSpacer: () => spacer,
    }),
    EditorView.theme({
      ".cm-gutter-changes .cm-gutterElement": { width: "0.3rem", padding: "0" },
      ".cm-changeMark": { display: "block", width: "0.3rem", height: "100%" },
      ".cm-changeLine-add .cm-changeMark": { backgroundColor: working },
      ".cm-changeLine-mod .cm-changeMark": { backgroundColor: accent },
      ".cm-changeLine-del .cm-changeMark": {
        height: "0",
        borderBottom: `0.2rem solid ${blocked}`,
      },
    }),
  ];
}

/* Whether the field is in this state at all — the compartment may hold
   nothing, and an effect dispatched then is simply dropped. */
export function hasChangeGutter(state: EditorState): boolean {
  return state.field(changeField, false) !== undefined;
}
