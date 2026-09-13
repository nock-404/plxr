"use client";

import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import { ACTIVITIES, type Activity, type Preset } from "@/components/Dock";
import { tr } from "@/lib/i18n";

/* What the shell knows about the arrangements, handed in so this page can act
   on them: the saved presets and which one is in use, and the verbs. The
   questions a verb asks — a name to save under, whether to delete — are the
   shell's own dialogs, which stand above this window. */
export type LayoutControls = {
  presets: Preset[];
  current: string;
  activityLabel: (a: Activity) => string;
  arrange: (a: Activity) => void;
  apply: (p: Preset) => void;
  saveAs: () => void;
  rename: () => void;
  remove: () => void;
  reset: () => void;
  resetTools: () => void;
};

/* The named arrangements, on a page of their own: the same entries the
   LAYOUTS button offers, laid out so the whole list is seen at once and the
   one in use is marked. */
export default function LayoutSettings({ layouts }: { layouts: LayoutControls }) {
  return (
    <div className="tabbody">
      <div className="field">
        <span className="fieldName">{tr("layouts.activities", "arrange for an activity")}</span>
        <span className="rowInline">
          {ACTIVITIES.map((a) => (
            <Button key={a} data-do="arrange" onClick={() => layouts.arrange(a)}>
              {layouts.activityLabel(a)}
            </Button>
          ))}
        </span>
        <span className="notice">{tr("layouts.activitiesHint", "A fresh arrangement for that kind of work: the board in main and the tool it needs beside it, on whichever edge that tool stands; what is open stays open in the service.")}</span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("layouts.saved", "saved layouts")}</span>
        {layouts.presets.length === 0 ? (
          <span className="notice">{tr("layouts.none", "no saved layouts yet")}</span>
        ) : (
          <div className="splitList">
            {layouts.presets.map((p) => (
              <div key={p.name} className="presetRow" data-current={p.name === layouts.current ? "yes" : "no"}>
                <span className="presetName">{p.name}</span>
                {p.name === layouts.current ? <span className="presetCurrent">{tr("layouts.inUse", "in use")}</span> : null}
                <span className="spacer" />
                <Button tiny data-do="apply-layout" onClick={() => layouts.apply(p)}>
                  {tr("layouts.applyShort", "APPLY")}
                </Button>
              </div>
            ))}
          </div>
        )}
        <span className="rowInline">
          <Tooltip text={tr("layouts.saveDetail", "The panels as they stand now, with the tool windows, their sizes and where each tool stands, under a name of your own. Saving under a name already in the list replaces it.")}>
            <Button data-do="save-layout" onClick={layouts.saveAs}>
              {tr("layouts.saveAs", "Save current as…")}
            </Button>
          </Tooltip>
          <Button data-do="rename-layout" disabled={!layouts.current} onClick={layouts.rename}>
            {layouts.current ? tr("layouts.rename", "Rename {name}…", { name: layouts.current }) : tr("layouts.renameNone", "Rename…")}
          </Button>
          <Button data-do="delete-layout" danger disabled={!layouts.current} onClick={layouts.remove}>
            {layouts.current ? tr("layouts.delete", "Delete {name}…", { name: layouts.current }) : tr("layouts.deleteNone", "Delete…")}
          </Button>
        </span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("layouts.resetHead", "start over")}</span>
        <span className="rowInline">
          <Button data-do="reset-layout" onClick={layouts.reset}>
            {tr("palette.resetLayout", "Reset the panel layout")}
          </Button>
          <span className="notice">{tr("header.resetLayout", "Reset the panel layout to the default")}</span>
        </span>
        {/* Applying a saved layout moves tools too; this is the way back to
            where every tool started, and it leaves the panels alone. */}
        <span className="rowInline">
          <Button data-do="reset-tools" onClick={layouts.resetTools}>
            {tr("tool.reset", "Reset tool positions")}
          </Button>
        </span>
      </div>
    </div>
  );
}
