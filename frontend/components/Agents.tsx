"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import TextArea from "@/components/ui/TextArea";
import { api } from "@/lib/api";
import { tr, errText } from "@/lib/i18n";
import type { Agent, AgentProfile } from "@/lib/types";

// Which line of a profile catches a given line of terminal output. Without this
// the fields below are just regular expressions somebody has to guess at.
function probe(profile: AgentProfile, line: string): string | null {
  if (!line.trim()) return null;
  const firstHit = (list: string[]) =>
    list.find((p) => {
      try {
        return new RegExp(p, "i").test(line);
      } catch {
        return line.toLowerCase().includes(p.toLowerCase());
      }
    });
  const blocked = firstHit(profile.blocked);
  if (blocked) return tr("agents.tryBlocked", 'Counts as "waiting for you" — because of: {rule}', { rule: blocked });
  const working = firstHit(profile.working);
  if (working) return tr("agents.tryWorking", 'Counts as "working" — because of: {rule}', { rule: working });
  const match = firstHit(profile.match);
  if (match) return tr("agents.tryMatch", "Recognised as this CLI — because of: {rule}", { rule: match });
  return tr("agents.tryNothing", "No rule matches. After the quiet time the setting above decides.");
}

const lines = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean);

export default function Agents() {
  const [list, setList] = useState<Agent[]>([]);
  const [name, setName] = useState<string | null>(null);
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [text, setText] = useState({ match: "", blocked: "", working: "" });
  const [tryLine, setTryLine] = useState("");
  const [note, setNote] = useState("");

  const reload = useCallback(() => {
    api.agents().then((a) => setList(a ?? [])).catch(() => setList([]));
  }, []);

  useEffect(reload, [reload]);

  async function open(agentName: string) {
    setNote("");
    const p = await api.agentRead(agentName).catch(() => null);
    if (!p) return;
    setName(agentName);
    setProfile(p);
    setText({
      match: (p.match ?? []).join("\n"),
      blocked: (p.blocked ?? []).join("\n"),
      working: (p.working ?? []).join("\n"),
    });
  }

  async function save() {
    if (!profile || !name) return;
    const next: AgentProfile = {
      ...profile,
      match: lines(text.match),
      blocked: lines(text.blocked),
      working: lines(text.working),
    };
    try {
      await api.agentWrite(name, next);
      setProfile(next);
      setNote(tr("agents.saved", "{name} saved", { name }));
      reload();
    } catch (e) {
      setNote(errText(e));
    }
  }

  if (!profile || !name) {
    return (
      <div className="tabbody">
        <div className="field">
          <span className="fieldName">{tr("settings.agentProfiles", "agent profiles")}</span>
          <p className="notice">
            {tr("agents.explain", "A profile teaches plxr to recognise a CLI: which command it is, and what its screen says while it works or waits.")}
          </p>
          <div className="splitList">
            {list.map((a) => (
              <Button bare key={a.name} className="splitRow" onClick={() => open(a.name)}>
                <span className="hitTitle">{a.label}</span>
                <span className="meta">{a.match.join(", ")}</span>
                <span className="spacer" />
                {a.own ? <span className="hitSmall">{tr("agents.own", "own")}</span> : null}
              </Button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const verdict = probe(
    { ...profile, match: lines(text.match), blocked: lines(text.blocked), working: lines(text.working) },
    tryLine,
  );

  return (
    <div className="tabbody">
      <span className="rowInline">
        <b className="fieldName">{profile.label}</b>
        <span className="spacer" />
        <Button onClick={() => { setName(null); setProfile(null); setNote(""); }}>
          {tr("common.back", "BACK")}
        </Button>
      </span>

      <div className="field">
        <span className="fieldName">{tr("agents.fieldLabel", "name shown")}</span>
        <Input value={profile.label} onChange={(e) => setProfile({ ...profile, label: e.target.value })} />
      </div>

      <div className="field">
        <span className="fieldName">{tr("agents.fieldMatch", "recognised by the command")}</span>
        <TextArea
          className="agentLines"
          value={text.match}
          onChange={(e) => setText({ ...text, match: e.target.value })}
        />
        <span className="notice">{tr("agents.fieldMatchHint", "One line per command.")}</span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("agents.fieldBlocked", "waiting for you when the screen says")}</span>
        <TextArea
          className="agentLines"
          value={text.blocked}
          onChange={(e) => setText({ ...text, blocked: e.target.value })}
        />
        <span className="notice">{tr("agents.fieldBlockedHint", "One line per phrase. Questions the CLI asks.")}</span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("agents.fieldWorking", "working when the screen says")}</span>
        <TextArea
          className="agentLines"
          value={text.working}
          onChange={(e) => setText({ ...text, working: e.target.value })}
        />
        <span className="notice">{tr("agents.fieldWorkingHint", "One line per phrase. Anything that shows it is running.")}</span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("agents.fieldQuiet", "when nothing happens")}</span>
        <span className="rowInline">
          <Input
            type="number"
            min={0}
            max={600}
            step={0.5}
            value={profile.idle_seconds}
            onChange={(e) => setProfile({ ...profile, idle_seconds: Number(e.target.value) })}
          />
          <Select
            value={profile.idle_status}
            onChange={(idle_status) => setProfile({ ...profile, idle_status })}
            options={[
              { value: "waiting", label: tr("agents.idle.waiting", "waiting for you") },
              { value: "working", label: tr("agents.idle.working", "working") },
              { value: "unknown", label: tr("agents.idle.unknown", "unknown") },
            ]}
          />
        </span>
        <span className="notice">{tr("agents.fieldQuietHint", "After this many seconds without new output.")}</span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("agents.tryTitle", "try a line")}</span>
        <Input
          value={tryLine}
          placeholder={tr("agents.tryPlaceholder", "Paste a line from the terminal here")}
          onChange={(e) => setTryLine(e.target.value)}
        />
        {verdict ? <span className="notice">{verdict}</span> : null}
      </div>

      <span className="rowInline">
        <span className="notice">{note}</span>
        <span className="spacer" />
        <Button primary onClick={save}>{tr("common.save", "SAVE")}</Button>
      </span>
    </div>
  );
}
