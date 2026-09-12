"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import Select from "@/components/ui/Select";
import Toggle from "@/components/ui/Toggle";
import { api } from "@/lib/api";
import { errText, tr } from "@/lib/i18n";
import type { NotifyInfo, NotifyPermission, NotifySettings, NotifyVia } from "@/lib/types";

// Whether to be told, about what, and with which sound.
//
// The service keeps these, not this window: it is the service that notices a
// session getting stuck, and it has to know the answer at a moment when no
// window may be open at all.
//
// The showing is the plxr window's job: it holds the system permission and
// posts with the icon, and the service hands it what to say. So this panel
// also says how that permission stands and where a test notification came
// from — the two things that explain a notification that did not arrive.
const EVENTS: { key: keyof NotifySettings["when"]; text: string; english: string }[] = [
  { key: "needsYou", text: "notify.needsYou", english: "an agent asks a question" },
  { key: "waiting", text: "notify.waiting", english: "an agent falls idle" },
  { key: "ended", text: "notify.ended", english: "a session ends" },
  { key: "crashed", text: "notify.crashed", english: "a session is lost to a crash" },
];

// The permission is asked of the service every few seconds while the panel
// is open: it changes when the window answers the system's question, and
// that happens while this is on screen.
const ASK_EVERY = 2000;

function permissionText(p: NotifyPermission, windows: number): string {
  if (windows === 0) {
    return tr("notify.permNoWindow", "no plxr window open — the service shows plain notifications, without the icon");
  }
  if (p === "granted") return tr("notify.permGranted", "granted — the plxr window shows them, with the icon");
  if (p === "denied") {
    return tr("notify.permDenied", "refused — allow plxr under System Settings › Notifications; until then nothing is shown");
  }
  if (p === "notAsked") return tr("notify.permNotAsked", "not asked yet — the window asks the system when it opens");
  return tr("notify.permUnknown", "the plxr window has not reported yet");
}

function viaText(via: NotifyVia): string {
  return via === "window"
    ? tr("notify.viaWindow", "posted by the plxr window")
    : tr("notify.viaLocal", "no window open — plain notification from the service");
}

export default function Notifications() {
  const [settings, setSettings] = useState<NotifySettings | null>(null);
  const [sounds, setSounds] = useState<string[]>([]);
  const [permission, setPermission] = useState<NotifyPermission>("unknown");
  const [windows, setWindows] = useState(0);
  const [dnd, setDnd] = useState(false);
  const [note, setNote] = useState("");
  const [tested, setTested] = useState("");

  useEffect(() => {
    let live = true;
    const take = (n: NotifyInfo) => {
      if (!live) return;
      setSettings(n.settings);
      setSounds(n.sounds ?? []);
      setPermission(n.permission ?? "unknown");
      setWindows(n.windows ?? 0);
    };
    api.notify().then(take).catch((e) => setNote(errText(e)));
    api
      .prefs()
      .then((p) => {
        if (live) setDnd(Boolean(p.dnd));
      })
      .catch(() => undefined);
    const timer = window.setInterval(() => void api.notify().then(take).catch(() => undefined), ASK_EVERY);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
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

  // Do not disturb rides the shared settings, where the service reads it.
  async function quiet(on: boolean) {
    setDnd(on);
    setNote("");
    try {
      await api.setPrefs({ dnd: on });
      setNote(tr("common.saved", "saved"));
    } catch (e) {
      setNote(errText(e));
    }
  }

  async function test() {
    setTested("");
    try {
      const { via } = await api.trySound(settings?.sound ?? "");
      setTested(viaText(via));
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
            <span className="fieldName">{tr("notify.dnd", "do not disturb")}</span>
            <div className="choice">
              <Toggle
                on={dnd}
                onChange={(on) => void quiet(on)}
                tip={tr("notify.dndTip", "Nothing is said while this is on. The status row shows it.")}
              >
                {dnd ? tr("notify.on", "on") : tr("notify.off", "off")}
              </Toggle>
            </div>
          </div>

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
              <Tooltip text={tr("notify.tryTip", "Hearing it is the only way to choose it")}>
                <Button disabled={!settings.sound} onClick={() => void test()}>
                  {tr("notify.try", "TRY IT")}
                </Button>
              </Tooltip>
            </span>
          </div>

          <div className="field">
            <span className="fieldName">{tr("notify.permission", "system permission")}</span>
            <span className="rowInline">
              <span className="notice">{permissionText(permission, windows)}</span>
              <Tooltip text={tr("notify.testTip", "Shows one now and says who showed it")}>
                <Button onClick={() => void test()}>{tr("notify.test", "TEST")}</Button>
              </Tooltip>
            </span>
            {tested ? <p className="notice">{tested}</p> : null}
          </div>
        </>
      ) : null}

      <p className="notice">{note}</p>
    </div>
  );
}
