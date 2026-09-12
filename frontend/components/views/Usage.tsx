"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import TopStrip from "@/components/ui/TopStrip";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { shortNumber as short } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { api } from "@/lib/api";
import { setPaceLimit } from "@/lib/prefs";
import { usePace } from "@/lib/usePace";
import type { Pace, Usage as UsageData, UsageBucket, Waiting } from "@/lib/types";

function Block({ head, rows }: { head: string; rows: UsageBucket[] }) {
  const max = Math.max(1, ...rows.map((r) => r.output + r.input));
  return (
    <div className="ublock">
      <span className="uhead">{head}</span>
      {rows.map((r) => {
        const total = r.output + r.input;
        return (
          <div key={r.key} className="urow">
            <span className="ukey">{r.key}</span>
            <span className="ubar">
              <i className="ufill" style={{ width: `${(total / max) * 100}%` }} />
            </span>
            <span className="uval">{short(total)}</span>
          </div>
        );
      })}
    </div>
  );
}

function trendWord(t: Pace["trend"]): string {
  if (t === "rising") return tr("pace.rising", "rising");
  if (t === "falling") return tr("pace.falling", "falling");
  return tr("pace.flat", "flat");
}

/* Right now: the same numbers the status row shows, with room to read them,
   and the one knob that goes with them — the ceiling.

   The ceiling is the user's own target. plxr reads the transcripts and can
   count what was spent; it cannot see the plan's real window or how much of
   it is left. So the note beside the field says exactly that, and crossing
   the line does exactly two things: the readout turns hot, and the service
   sends one notification. Nothing is stopped. */
function RightNow({ field }: { field: RefObject<HTMLInputElement | null> }) {
  const { pace, limit, hot } = usePace();
  // What is being typed, held apart from what is set: the field commits on
  // blur or Enter, and a ceiling moved in another window lands here only
  // while nobody is typing.
  const [draft, setDraft] = useState<string>(limit ? String(limit) : "");
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!typing) setDraft(limit ? String(limit) : "");
  }, [limit, typing]);

  // Committed from the field itself, not from the draft: a keystroke and the
  // blur that follows it can land before the draft has been rendered back.
  const commit = (value: string) => {
    setTyping(false);
    const n = setPaceLimit(Number(value));
    setDraft(n ? String(n) : "");
  };

  return (
    <div className={`pacenow ${hot ? "pace--hot" : ""}`.trim()}>
      <span className="uhead">{tr("pace.now", "right now")}</span>
      {pace ? (
        <div className="usum">
          <span className="ubox">
            <b className="ubig">{short(pace.window5h)}</b>
            <span>{tr("pace.window5h", "last five hours")}</span>
          </span>
          <span className="ubox">
            <b className="ubig">{short(pace.perHour)}</b>
            <span>{tr("pace.perHour", "per hour")}</span>
          </span>
          <span className="ubox">
            <b className="ubig">{pace.active}</b>
            <span>{tr("pace.activeSessions", "sessions spending")}</span>
          </span>
          <span className="ubox">
            <b className="ubig">{trendWord(pace.trend)}</b>
            <span>{tr("pace.trend", "against the hour before")}</span>
          </span>
        </div>
      ) : (
        <span className="paceNote">{tr("pace.measuring", "measuring …")}</span>
      )}
      <div className="paceLimit">
        <span className="paceLimitLabel">{tr("pace.limitLabel", "your five-hour ceiling")}</span>
        <Input
          ref={field}
          className="short"
          type="number"
          min={0}
          step={100000}
          placeholder={tr("pace.limitNone", "none")}
          value={draft}
          onFocus={() => setTyping(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <span className="paceNote">
          {hot
            ? tr("pace.over", "Past your ceiling — a colour and one notification, nothing is stopped.")
            : tr("pace.limitNote", "Tokens in five hours. Your own target, not the plan's real cap — plxr cannot see the plan window. Crossing it colours the readout and sends one notification; nothing is stopped.")}
        </span>
      </div>
    </div>
  );
}

// What the agents actually cost, over a chosen window.
export default function Usage() {
  const [days, setDays] = useState<"7" | "30" | "0">("30");
  const [data, setData] = useState<UsageData | null>(null);
  const [wait, setWait] = useState<Waiting | null>(null);
  // Counts up on the menu's Reload, so the same window is asked for again.
  const [again, setAgain] = useState(0);
  const { limit } = usePace();
  // The ceiling field, so the menu's "Set ceiling…" can put the cursor in it.
  const ceiling = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.usage(Number(days)).then(setData).catch(() => setData(null));
    api.waiting(Number(days) || 3650).then(setWait).catch(() => setWait(null));
  }, [days, again]);

  const ctx = useContextMenu();
  // The view under the right button: the figures again, and the one knob.
  const viewMenu = (): MenuItem[] => [
    { label: tr("usage.menuReload", "Reload"), onClick: () => setAgain((n) => n + 1) },
    { separator: true },
    {
      label: tr("usage.menuSetCeiling", "Set ceiling…"),
      onClick: () => {
        ceiling.current?.focus();
        ceiling.current?.select();
      },
    },
    { label: tr("usage.menuClearCeiling", "Clear ceiling"), disabled: !limit, onClick: () => void setPaceLimit(0) },
  ];

  // A single wait is capped, so one forgotten window does not swamp the day.
  const minutes = (ms: number) => Math.round(ms / 60000);

  return (
    <section className="list" onContextMenu={ctx(viewMenu())}>
      <TopStrip>
        <div className="listbar">
          <span className="prompt">{tr("usage.prompt", "usage>")}</span>
          <span className="meta">
            {data ? `${short(data.sum.messages)} ${tr("usage.messages", "messages")}` : ""}
          </span>
          <span className="spacer" />
          <Select
            value={days}
            onChange={setDays}
            options={[
              { value: "7", label: tr("usage.last7", "last 7 days") },
              { value: "30", label: tr("usage.last30", "last 30 days") },
              { value: "0", label: tr("usage.all", "everything") },
            ]}
          />
        </div>
      </TopStrip>
      <div className="listbody">
        <RightNow field={ceiling} />
        {!data ? (
          <div className="emptyNote">
            <b>{tr("usage.emptyHead", "nothing recorded")}</b>
            {tr("usage.empty", "No usage was found for this window.")}
          </div>
        ) : (
          <>
            {wait && (wait.worked > 0 || wait.waited > 0) ? (
              <div className="usum">
                <span className="ubox">
                  <b className="ubig">{minutes(wait.worked)}m</b>
                  <span>{tr("waiting.worked", "worked")}</span>
                </span>
                <span className="ubox">
                  <b className="ubig">{minutes(wait.waited)}m</b>
                  <span>{tr("waiting.waited", "waited on you")}</span>
                </span>
                {wait.cut > 0 ? (
                  <span className="ubox">
                    <b className="ubig">{wait.cut}</b>
                    <span>{tr("waiting.cut", "waits capped")}</span>
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="usum">
              <span className="ubox">
                <b className="ubig">{short(data.sum.output)}</b>
                <span>{tr("usage.output", "output")}</span>
              </span>
              <span className="ubox">
                <b className="ubig">{short(data.sum.input)}</b>
                <span>{tr("usage.input", "input")}</span>
              </span>
              <span className="ubox">
                <b className="ubig">{short(data.sum.cacheRead)}</b>
                <span>{tr("usage.cacheRead", "cache read")}</span>
              </span>
              <span className="ubox">
                <b className="ubig">{short(data.sum.messages)}</b>
                <span>{tr("usage.messages", "messages")}</span>
              </span>
            </div>
            {data.byDay?.length ? <Block head={tr("usage.byDay", "by day")} rows={data.byDay} /> : null}
            {data.byProject?.length ? <Block head={tr("usage.byProject", "by project")} rows={data.byProject} /> : null}
            {data.byModel?.length ? <Block head={tr("usage.byModel", "by model")} rows={data.byModel} /> : null}
          </>
        )}
      </div>
    </section>
  );
}
