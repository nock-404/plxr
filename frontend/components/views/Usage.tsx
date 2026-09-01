"use client";

import { useEffect, useState } from "react";
import Select from "@/components/ui/Select";
import { tr } from "@/lib/i18n";
import { api } from "@/lib/api";
import type { Usage as UsageData, UsageBucket, Waiting } from "@/lib/types";

function short(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

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

// What the agents actually cost, over a chosen window.
export default function Usage() {
  const [days, setDays] = useState<"7" | "30" | "0">("30");
  const [data, setData] = useState<UsageData | null>(null);
  const [wait, setWait] = useState<Waiting | null>(null);

  useEffect(() => {
    api.usage(Number(days)).then(setData).catch(() => setData(null));
    api.waiting(Number(days) || 3650).then(setWait).catch(() => setWait(null));
  }, [days]);

  // A single wait is capped, so one forgotten window does not swamp the day.
  const minutes = (ms: number) => Math.round(ms / 60000);

  return (
    <section className="list">
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
      <div className="listbody">
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
