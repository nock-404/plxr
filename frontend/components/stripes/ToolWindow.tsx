"use client";

import { useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Tooltip from "@/components/ui/Tooltip";
import { useMenu, type MenuItem } from "@/components/ui/Menu";
import { tr } from "@/lib/i18n";
import { bindingOf, caption, type Action } from "@/lib/keymap";
import { TOOLS, type Edge, type ToolId } from "@/lib/tools";
import { ToolActionSlot, ToolShown } from "@/lib/toolShown";

/* A tool window: a header, and the tool under it.
 *
 * A tool used to wear a document's tab — a name with an × on it, tabbed beside
 * the file it was about — and closing it lost it. A tool window has a header
 * instead, the way every editor draws one: its mark and its name, the tool's
 * own actions (ToolActions), and on the right a menu and a — that puts it
 * away. There is no ×, because a tool is never closed; it is hidden, and it
 * comes back from its edge.
 *
 * The body of a hidden tool is not rendered. The dock keeps the panel alive
 * behind a hidden edge, so a tool that polls — what has changed, the ports, the
 * usage — would go on asking the service every second for a window nobody can
 * see. Only the tree and the notes stay: a tree's open folders and unsaved text
 * are what a person expects to find again. They are told they are put away
 * (lib/toolShown), and the tree stops asking git until it is shown again. */

const EDGE_CHORD: Record<Edge, Action> = { left: "toggleLeft", right: "toggleRight", bottom: "toggleBottom", bottomRight: "toggleBottom" };

export default function ToolWindow({
  id,
  edge,
  lit,
  onHide,
  moreRows,
  children,
}: {
  id: ToolId;
  // The edge it stands on, for the chord its hide answers to.
  edge: Edge | null;
  // Whether it is the window showing at its edge.
  lit: boolean;
  onHide: () => void;
  /* The ⋮ menu's rows around its Hide — where the tool can be moved to, and
     every tool back where it started — from the dock, which knows both.
     Without it the menu offers Hide alone. */
  moreRows?: (hide: MenuItem) => MenuItem[];
  children: ReactNode;
}) {
  const def = TOOLS.find((t) => t.id === id) ?? TOOLS[0];
  const menu = useMenu();
  const [focused, setFocused] = useState(false);
  // The header's slot for the tool's own actions (ToolActions draws into it).
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);
  const chord = edge ? caption(bindingOf(EDGE_CHORD[edge])) : "";
  const title = tr(def.key, def.fallback);
  const hideText = tr("tool.hide", "Hide");

  const items = (): MenuItem[] => {
    const hide: MenuItem = { label: hideText, hint: chord || undefined, onClick: onHide };
    return moreRows ? moreRows(hide) : [hide];
  };

  return (
    <div
      className="toolWindow"
      data-tool={id}
      data-focus={focused ? "yes" : "no"}
      tabIndex={-1}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className="toolHead">
        <span className="toolIcon" aria-hidden="true">
          <Icon name={def.icon} />
        </span>
        <span className="toolTitle">{title}</span>
        <span className="toolActions" ref={setActionSlot} />
        <Tooltip text={tr("tool.more", "More")}>
          <Button
            icon
            data-do="tool-more"
            aria-label={tr("tool.more", "More")}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              menu.open(Math.round(r.left), Math.round(r.bottom + 4), items());
            }}
          >
            <Icon name="more" />
          </Button>
        </Tooltip>
        <Tooltip text={chord ? `${hideText} ${chord}` : hideText}>
          <Button icon data-do="tool-hide" aria-label={hideText} onClick={onHide}>
            <Icon name="hide" />
          </Button>
        </Tooltip>
      </div>
      <div className="toolBody">
        <ToolShown.Provider value={lit}>
          <ToolActionSlot.Provider value={actionSlot}>{lit || def.keepMounted ? children : null}</ToolActionSlot.Provider>
        </ToolShown.Provider>
      </div>
    </div>
  );
}
