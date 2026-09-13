"use client";

import { useEffect, useRef } from "react";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Tooltip from "@/components/ui/Tooltip";
import { useContextMenu, useMenu, type MenuItem } from "@/components/ui/Menu";
import { tr, trN } from "@/lib/i18n";
import { bindingOf, caption } from "@/lib/keymap";
import { projectLabel, samePath, type Project } from "@/lib/project";
import { sessionMenu } from "@/lib/sessionMenu";
import { railLine, stateOf, titleOf } from "@/lib/state";
import type { Tile } from "@/lib/types";

// The name the window menu knows this switch's list by.
const OWNER = "session-switch";

/* Which session is in front, and every other one a click or ⌘E away.
 *
 * The rail listed the sessions in a wide column of words beside the work, and
 * it was the only way to reach one without the board. This is the same list,
 * folded into one control at the top: the session in front with its state's
 * dot, how many are waiting for an answer, and under it every session grouped
 * by project, the current project first, each with its state. A pick brings
 * the session's panel to the front; the right button offers what the tile
 * offers.
 */
export default function SessionSwitch({
  tiles,
  project,
  front,
  waiting,
  asked,
  onOpen,
  onBoard,
  onNew,
  onNewShell,
}: {
  tiles: Tile[];
  project: Project;
  /* The session that came to the front last. */
  front: string;
  /* How many sessions cannot go on without an answer. */
  waiting: number;
  /* Counts up each time the keyboard or the palette asks for the list. */
  asked: number;
  onOpen: (id: string) => void;
  onBoard: () => void;
  onNew: () => void;
  onNewShell: () => void;
}) {
  const menu = useMenu();
  const ctx = useContextMenu();
  const button = useRef<HTMLButtonElement>(null);
  const shown = tiles.find((t) => t.id === front) ?? null;
  const open = menu.owner === OWNER;

  const items = (): MenuItem[] => {
    // Grouped the way the rail grouped them: by the project the service
    // names, or the folder's own name when it names none.
    const groups = new Map<string, Tile[]>();
    for (const t of tiles) {
      const name = t.project || projectLabel({ path: t.cwd, sessionId: "" }) || t.name;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name)!.push(t);
    }
    const current = (list: Tile[]) =>
      list.some((t) => t.id === project.sessionId || (project.path !== "" && samePath(t.cwd, project.path)));
    // A stable sort: the current project moves up, the rest keep their order.
    const ordered = [...groups].sort(([, a], [, b]) => Number(current(b)) - Number(current(a)));
    const rows: MenuItem[] = [];
    for (const [name, list] of ordered) {
      rows.push({ header: true, label: name });
      for (const t of list) {
        rows.push({
          label: titleOf(t),
          icon: "terminal",
          sub: railLine(t),
          status: stateOf(t),
          onClick: () => onOpen(t.id),
          context: () => sessionMenu(t, onOpen),
        });
      }
    }
    return [
      ...rows,
      ...(rows.length ? [{ separator: true as const }] : []),
      { label: tr("switch.board", "All sessions (board)"), hint: caption(bindingOf("view1")), onClick: onBoard },
      { label: tr("switch.newSession", "New session…"), hint: caption(bindingOf("newSession")), onClick: onNew },
      { label: tr("palette.newShell", "New shell here"), hint: caption(bindingOf("newShell")), onClick: onNewShell },
    ];
  };

  const toggle = () => {
    if (menu.owner === OWNER) {
      menu.close();
      return;
    }
    const el = button.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    menu.open(Math.round(r.left), Math.round(r.bottom + 4), items(), { owner: OWNER, anchor: el });
  };

  // ⌘E and the palette ask by counting up; the first render is not a request.
  const seen = useRef(asked);
  useEffect(() => {
    if (asked === seen.current) return;
    seen.current = asked;
    toggle();
    // Only a new request is a reason to act.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  // A session changes its state while the list is being read: the list follows.
  useEffect(() => {
    if (open) menu.refresh(OWNER, items());
    // The menu itself is left out: refreshing it is what changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, project, front]);

  const label = shown ? titleOf(shown) : tr("switch.sessions", "Sessions");
  const waitingText = trN("switch.waiting", waiting, "{n} waiting for an answer", "{n} waiting for an answer");
  return (
    <Tooltip text={tr("switch.sessionTip", "Every session, by project — {key}", { key: caption(bindingOf("sessionSwitch")) })}>
      <Button
        bare
        ref={button}
        className="switch"
        data-switch="session"
        data-open={open ? "yes" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={waiting > 0 ? `${label} · ${waitingText}` : label}
        onClick={toggle}
        onContextMenu={shown ? ctx(sessionMenu(shown, onOpen)) : undefined}
      >
        {shown ? <span className={`dot ${stateOf(shown)}`}>●</span> : null}
        <span className="switchLabel">{label}</span>
        {waiting > 0 ? (
          <span className="switchBadge" data-waiting="yes">
            {waiting}
          </span>
        ) : null}
        <span className="switchChevron">
          <Icon name="chevron-down" />
        </span>
      </Button>
    </Tooltip>
  );
}
