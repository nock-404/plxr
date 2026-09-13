"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Tooltip from "@/components/ui/Tooltip";
import TopStrip from "@/components/ui/TopStrip";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { accountName, ago, moment, shortNumber as short, until } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { api } from "@/lib/api";
import { setPaceLimit } from "@/lib/prefs";
import { usePace } from "@/lib/usePace";
import { refreshLimits, useLimits, worst } from "@/lib/useLimits";
import type { AccountUsage, Pace, Usage as UsageData, UsageBucket, UsageWindow, Waiting } from "@/lib/types";

/* What is left, per account, before what anything cost.
 *
 * The view used to lead with a single number: what all three accounts spent
 * over thirty days, added together. Nobody asked that. The question in front
 * of somebody about to start a long run is how much of the current window is
 * gone, on which account, and when it comes back — and it went unanswered
 * until an account hit its weekly limit mid-run and took hours of work with
 * it.
 *
 * Two sources, kept apart on screen the way they are kept apart in the
 * service:
 *
 *   the percentages and reset times are Claude Code's own reading, which it
 *   leaves beside its configuration for each account. They are per account
 *   and exact, and they are a cache — so the foot of the view says how old
 *   they are rather than pretending they are live;
 *
 *   the tokens are counted here out of the transcripts, from the moment the
 *   window actually opened. Where several accounts read one directory of
 *   transcripts — which is how this machine is set up — the tokens are the
 *   pool's and cannot be split, and the section says so instead of dividing
 *   by three.
 *
 * Where there is no reading at all the view says that in one line and shows
 * what it does know: so much spent since the window opened, and the window's
 * start and end. Never a bar at zero, which reads as "plenty left".
 */

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

/* The spend by model, the way the reference screen breaks it down: what went
   in, what came out, and what the cache did on both sides. */
function ByModel({ head, rows }: { head: string; rows: UsageBucket[] }) {
  if (!rows.length) return null;
  return (
    <div className="umodels">
      <span className="uhead">{head}</span>
      <div className="umodelRow umodelHead">
        <span className="umodelName">{tr("usage.model", "model")}</span>
        <span className="umodelCell">{tr("usage.input", "input")}</span>
        <span className="umodelCell">{tr("usage.output", "output")}</span>
        <span className="umodelCell">{tr("usage.cacheRead", "cache read")}</span>
        <span className="umodelCell">{tr("usage.cacheWrite", "cache written")}</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} className="umodelRow">
          <span className="umodelName">{r.key}</span>
          <span className="umodelCell">{short(r.input)}</span>
          <span className="umodelCell">{short(r.output)}</span>
          <span className="umodelCell">{short(r.cacheRead)}</span>
          <span className="umodelCell">{short(r.cacheWrite)}</span>
        </div>
      ))}
    </div>
  );
}

function windowHead(w: UsageWindow): string {
  if (w.kind === "session") return tr("usage.session", "session window");
  if (w.kind === "week") return tr("usage.week", "this week, all models");
  return tr("usage.weekModel", "this week, {model}", { model: w.model || "—" });
}

/* When the window comes back, in the reader's own timezone — the only one
   they can act on. Without a reset time there is nothing to say but that. */
function backWhen(w: UsageWindow): string {
  if (!w.resetsAt) return tr("usage.backUnknown", "when it comes back is not on this machine");
  const left = until(w.resetsAt);
  return left
    ? tr("usage.backAtIn", "back {when} · in {left}", { when: moment(w.resetsAt), left })
    : tr("usage.backAt", "back {when}", { when: moment(w.resetsAt) });
}

/* What the transcripts say about this window, said differently depending on
   what is actually known about the window itself. */
function spendLine(w: UsageWindow): string {
  const tokens = short(w.spend.input + w.spend.output + w.spend.cacheRead + w.spend.cacheWrite);
  if (w.measured) {
    return tr("usage.sinceOpen", "{tokens} tokens since it opened, {when}", { tokens, when: moment(w.startsAt) });
  }
  return w.kind === "session"
    ? tr("usage.lastFive", "{tokens} tokens in the last five hours — this window's own start is not on this machine", { tokens })
    : tr("usage.lastWeek", "{tokens} tokens in the last seven days — this window's own start is not on this machine", { tokens });
}

function WindowRow({ w, hotAt }: { w: UsageWindow; hotAt: number }) {
  const hot = w.known && w.percent >= hotAt;
  const width = Math.max(0, Math.min(100, w.percent));
  return (
    <div className={`uwin ${hot ? "uhot" : ""}`.trim()}>
      <span className="uwinHead">{windowHead(w)}</span>
      {w.known ? (
        <>
          <span className="uwinPct">{tr("usage.percentUsed", "{n}% used", { n: w.percent })}</span>
          <span className="uwinBar">
            <i className="uwinFill" style={{ width: `${width}%` }} />
          </span>
          <span className="uwinWhen">{backWhen(w)}</span>
        </>
      ) : (
        <span className="uwinNote">{tr("usage.noReading", "No reading for this window on this machine — the limit itself is not knowable here.")}</span>
      )}
      {w.kind === "weekModel" ? null : <span className="uwinSpend">{spendLine(w)}</span>}
    </div>
  );
}

function AccountCard({ a, poolLead, hotAt }: { a: AccountUsage; poolLead: boolean; hotAt: number }) {
  const top = worst(a);
  const hot = Boolean(top && top.percent >= hotAt);
  return (
    <div className={`uacct ${hot ? "uhot" : ""}`.trim()}>
      <div className="uacctHead">
        <span className="uacctName">{accountName(a)}</span>
        {a.isDefault ? <span className="uacctBadge">{tr("accounts.isDefault", "default")}</span> : null}
        {hot && top ? (
          <Tooltip text={tr("usage.hotTip", "This account is close to the end of one of its windows. Start long work somewhere else, or wait for it to come back.")}>
            <span className="uacctHot">{tr("usage.hot", "nearly out")}</span>
          </Tooltip>
        ) : null}
        <span className="spacer" />
        <Tooltip text={a.transcripts || a.short}>
          <span className="uacctDir">{a.short}</span>
        </Tooltip>
      </div>

      {a.known ? null : (
        <span className="uwinNote">
          {tr("usage.noLimits", "Claude Code has left no reading for this account on this machine, so its limits are not knowable here. What follows was counted from the transcripts.")}
        </span>
      )}

      <WindowRow w={a.session} hotAt={hotAt} />
      <WindowRow w={a.week} hotAt={hotAt} />
      {a.weekModel.known ? <WindowRow w={a.weekModel} hotAt={hotAt} /> : null}

      {a.sharedWith.length ? (
        <span className="uwinNote">
          {tr(
            "usage.shared",
            "These transcripts are read by {others} as well, so the tokens above are the pool's and not this account's share — nothing on disk says which account paid for a line. The limits above are this account's own.",
            { others: a.sharedWith.join(", ") },
          )}
        </span>
      ) : null}

      {poolLead && a.week.byModel.length ? (
        <ByModel head={tr("usage.byModelWindow", "by model, since the weekly window opened")} rows={a.week.byModel} />
      ) : null}
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

   The ceiling is the user's own target on the tokens, kept apart from the
   plan's windows above it, which are real and come from Claude Code. Crossing
   it does exactly two things: the readout turns hot, and the service sends one
   notification. Nothing is stopped. */
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
            : tr("pace.limitNote", "Tokens in five hours. Your own target on top of the plan's windows above. Crossing it colours the readout and sends one notification; nothing is stopped.")}
        </span>
      </div>
    </div>
  );
}

// What is left right now, and then what the agents actually cost.
export default function Usage() {
  const [days, setDays] = useState<"7" | "30" | "0">("30");
  const [data, setData] = useState<UsageData | null>(null);
  const [wait, setWait] = useState<Waiting | null>(null);
  // Counts up on the menu's Reload, so the same window is asked for again.
  const [again, setAgain] = useState(0);
  const { report, at } = useLimits();
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
    {
      label: tr("usage.menuReload", "Reload"),
      onClick: () => {
        refreshLimits();
        setAgain((n) => n + 1);
      },
    },
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

  // Only the first account of a pool carries the model breakdown: the other
  // two would repeat the same table under a note saying it is the same table.
  const seen = new Set<string>();
  const lead = (a: AccountUsage) => {
    if (seen.has(a.transcripts)) return false;
    seen.add(a.transcripts);
    return true;
  };

  // The foot: where the numbers come from and how fresh they are.
  const source = report?.accounts.find((a) => a.source)?.source ?? "";
  const fetched = report?.accounts.reduce((n, a) => Math.max(n, a.fetchedAt), 0) ?? 0;
  const foot = !report
    ? ""
    : source
      ? tr(
          "usage.foot",
          "Percentages and reset times: Claude Code's own reading, from {source}, last refreshed {age} ago. Tokens: counted here from {files} transcripts on this machine, in {duration}. Approximate, and local sessions only.",
          { source, age: ago(fetched) || "0s", files: report.files, duration: report.duration },
        )
      : tr(
          "usage.footNoReading",
          "Claude Code has left no reading on this machine, so no limit percentage is knowable here. Tokens: counted from {files} transcripts on this machine, in {duration}. Approximate, and local sessions only.",
          { files: report.files, duration: report.duration },
        );

  return (
    <section className="list" onContextMenu={ctx(viewMenu())}>
      <TopStrip>
        <div className="listbar">
          <span className="prompt">{tr("usage.prompt", "usage>")}</span>
          <span className="meta">
            {report ? tr("usage.accountCount", "{n} accounts", { n: report.accounts.length }) : ""}
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
        <div className="ublock">
          <span className="uhead">{tr("usage.leftHead", "what is left right now")}</span>
        </div>
        {!report ? (
          <span className="uwinNote">{tr("common.loading", "reading…")}</span>
        ) : report.accounts.length === 0 ? (
          <div className="emptyNote">
            <b>{tr("usage.noAccountsHead", "no accounts")}</b>
            {tr("usage.noAccounts", "No Claude account is set up here. Settings › Accounts is where one is added.")}
          </div>
        ) : (
          report.accounts.map((a) => <AccountCard key={a.name} a={a} poolLead={lead(a)} hotAt={at} />)
        )}

        {report && report.accounts.length > 1 ? (
          <div className="usum">
            <span className="ubox">
              <b className="ubig">{short(report.total.session.input + report.total.session.output + report.total.session.cacheRead + report.total.session.cacheWrite)}</b>
              <span>{tr("usage.totalFive", "all accounts, last five hours")}</span>
            </span>
            <span className="ubox">
              <b className="ubig">{short(report.total.week.input + report.total.week.output + report.total.week.cacheRead + report.total.week.cacheWrite)}</b>
              <span>{tr("usage.totalWeek", "all accounts, last seven days")}</span>
            </span>
            <span className="ubox">
              <b className="ubig">{report.total.accounts}</b>
              <span>{tr("usage.totalAccounts", "accounts counted")}</span>
            </span>
          </div>
        ) : null}

        {report ? <ByModel head={tr("usage.byModelWeek", "by model, all accounts, last seven days")} rows={report.total.byModel} /> : null}

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

        {foot ? <span className="ufoot">{foot}</span> : null}
      </div>
    </section>
  );
}
