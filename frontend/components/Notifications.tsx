"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Toggle from "@/components/ui/Toggle";
import { api } from "@/lib/api";
import { errText, tr } from "@/lib/i18n";
import type { NotifySettings } from "@/lib/types";

// Whether to be told, about what, and with which sound.
//
// The daemon keeps these, not this window: it is the daemon that notices a
// session getting stuck, and it has to know the answer at a moment when no
// window may be open at all.
const EVENTS: { key: keyof NotifySettings["when"]; text: string; english: string }[] = [
  { key: "needsYou", text: "notify.needsYou", english: "an agent asks a question" },
  { key: "waiting", text: "notify.waiting", english: "an agent falls idle" },
  { key: "ended", text: "notify.ended", english: "a session ends" },
  { key: "crashed", text: "notify.crashed", english: "a session is lost to a crash" },
];

export default function Notifications() {
  const [settings, setSettings] = useState<NotifySettings | null>(null);
  const [sounds, setSounds] = useState<string[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    api
      .notify()
      .then((n) => {
        setSettings(n.settings);
        setSounds(n.sounds ?? []);
      })
      .catch((e) => setNote(errText(e)));
  }, []);

  if (!settings) {
    return (
      <div className="tabbody">
        <p className="notice">{note || tr("common.loading", "reading…")}</p>
      </div>
    );
  }

  // Saved on every change and said out loud, because a setting that only
  // appears to have been kept is worse than one that refuses.
  async function keep(next: NotifySettings) {
    setSettings(next);
    setNote("");
    try {
      await api.setNotify(next);
      setNote(tr("common.saved", "saved"));
    } catch (e) {
      setNote(errText(e));
    }
  }

  return (
    <div className="tabbody">
      <div className="field">
        <span className="fieldName">{tr("notify.title", "notifications")}</span>
        <div className="choice">
          <Toggle on={settings.on} onChange={(on) => keep({ ...settings, on })}>
            {settings.on ? tr("notify.on", "on") : tr("notify.off", "off")}
          </Toggle>
        </div>
      </div>

      {settings.on ? (
        <>
          <div className="field">
            <span className="fieldName">{tr("notify.about", "tell me when")}</span>
            <div className="choice">
              {EVENTS.map((e) => (
                <Toggle
                  key={e.key}
                  on={settings.when[e.key]}
                  onChange={(v) => keep({ ...settings, when: { ...settings.when, [e.key]: v } })}
                >
                  {tr(e.text, e.english)}
                </Toggle>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="fieldName">{tr("notify.sound", "sound")}</span>
            <span className="rowInline">
              <Select
                value={settings.sound}
                onChange={(sound) => keep({ ...settings, sound })}
                options={[
                  { value: "", label: tr("notify.silent", "silent") },
                  ...sounds.map((s) => ({ value: s, label: s })),
                ]}
              />
              <Button
                disabled={!settings.sound}
                title={tr("notify.tryTip", "Hearing it is the only way to choose it")}
                onClick={() => api.trySound(settings.sound).catch((e) => setNote(errText(e)))}
              >
                {tr("notify.try", "TRY IT")}
              </Button>
            </span>
          </div>
        </>
      ) : null}

      <p className="notice">{note}</p>
    </div>
  );
}
