"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
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
// On macOS the showing is the plxr window's alone: it asks the system for the
// permission and posts with plxr's icon, one window for each notification.
// The service shows nothing itself there — what it used instead wore another
// application's name. So this panel says how the permission stands right now
// in the window's process, offers the way to get it (ALLOW puts the system's
// question, once), and when it stands refused says in plain words where it is
// switched back on, with a button that opens exactly that place.
const EVENTS: { key: keyof NotifySettings["when"]; text: string; english: string }[] = [
  { key: "needsYou", text: "notify.needsYou", english: "an agent asks a question" },
  { key: "waiting", text: "notify.waiting", english: "an agent falls idle" },
  { key: "ended", text: "notify.ended", english: "a session ends" },
  { key: "crashed", text: "notify.crashed", english: "a session is lost to a crash" },
  { key: "limit", text: "notify.limit", english: "an account is running out of its window" },
];

// The permission is asked of the service every few seconds while the panel
// is open, and each ask makes the window read it again: it changes when the
// system's question is answered, and when it is switched in System Settings,
// and both happen while this is on screen.
const ASK_EVERY = 2000;

/* How full a window has to be before plxr says so, when nothing is set. The
   same number as internal/notify.DefaultLimit — far enough from the wall that
   a long run can still be finished or moved. */
const DEFAULT_LIMIT = 80;

function permissionText(p: NotifyPermission, windows: number): string {
  if (windows === 0) {
    return tr("notify.permNoWindow", "no plxr window is open — nothing can be shown until one is");
  }
  if (p === "granted") return tr("notify.permGranted", "allowed — the plxr window shows them, with plxr's icon");
  if (p === "denied") {
    return tr(
      "notify.permDenied",
      "turned off in System Settings. To turn them back on: System Settings › Notifications › plxr › Allow notifications.",
    );
  }
  if (p === "asking") {
    return tr(
      "notify.permAsking",
      "macOS is asking now — answer its notification in the top right corner, and keep plxr open until you have",
    );
  }
  if (p === "notAsked") return tr("notify.permNotAsked", "not asked yet — press ALLOW NOTIFICATIONS, and macOS asks once");
  return tr("notify.permUnknown", "the plxr window has not reported yet");
}

function viaText(via: NotifyVia): string {
  if (via === "window") return tr("notify.viaWindow", "handed to the plxr window, which shows it");
  if (via === "local") return tr("notify.viaLocal", "shown by the service");
  if (via === "notAllowed") {
    return tr("notify.viaNotAllowed", "plxr is not allowed to show notifications yet — nothing was shown");
  }
  return tr("notify.viaNone", "no plxr window is open — nothing was shown");
}

export default function Notifications() {
  const [settings, setSettings] = useState<NotifySettings | null>(null);
  const [sounds, setSounds] = useState<string[]>([]);
  const [permission, setPermission] = useState<NotifyPermission>("unknown");
  const [windows, setWindows] = useState(0);
  const [serviceShows, setServiceShows] = useState(false);
  const [dnd, setDnd] = useState(false);
  const [note, setNote] = useState("");
  const [tested, setTested] = useState("");
  /* What is being typed in the threshold field, held apart from what is
     saved: the field commits on blur or Enter, and the poll above must not
     overwrite a half-typed number. A ref rather than state, because the poll
     reads it from inside an effect that was set up once. */
  const [threshold, setThreshold] = useState("");
  const typingRef = useRef(false);

  useEffect(() => {
    let live = true;
    const take = (n: NotifyInfo) => {
      if (!live) return;
      setSettings(n.settings);
      setSounds(n.sounds ?? []);
      setPermission(n.permission ?? "unknown");
      setWindows(n.windows ?? 0);
      setServiceShows(Boolean(n.serviceShows));
      if (!typingRef.current) setThreshold(String(n.settings.limit || DEFAULT_LIMIT));
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

  /* The threshold, saved on leaving the field. Out of 1–100 is refused in
     words rather than silently corrected: a number that cannot be crossed
     would switch the warning off while its toggle still said on. */
  async function keepThreshold(value: string) {
    typingRef.current = false;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      setNote(tr("notify.limitRange", "Between 1 and 100 percent. Left as it was."));
      setThreshold(String(settings?.limit || DEFAULT_LIMIT));
      return;
    }
    setThreshold(String(n));
    if (settings) await keep({ ...settings, limit: n });
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

  // The window puts the system's question; the answer arrives with the next
  // poll and the line above the button changes with it.
  async function allow() {
    setNote("");
    try {
      const { asked } = await api.notifyAuthorize();
      if (!asked) setNote(tr("notify.permNoWindow", "no plxr window is open — nothing can be shown until one is"));
    } catch (e) {
      setNote(errText(e));
    }
  }

  async function openSystemSettings() {
    setNote("");
    try {
      await api.openNotifySettings();
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

          {settings.when.limit ? (
            <div className="field">
              <span className="fieldName">{tr("notify.limitAt", "say so at")}</span>
              <span className="rowInline">
                <Input
                  className="short"
                  type="number"
                  min={1}
                  max={100}
                  step={5}
                  value={threshold}
                  onFocus={() => {
                    typingRef.current = true;
                  }}
                  onChange={(e) => setThreshold(e.target.value)}
                  onBlur={(e) => void keepThreshold(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
                <span className="notice">
                  {tr(
                    "notify.limitNote",
                    "Percent of a window used. Said once per window, per account, with the time it comes back — the percentages are Claude Code's own reading from this machine. Nothing is stopped.",
                  )}
                </span>
              </span>
            </div>
          ) : null}

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
              <span className="notice">
                {serviceShows
                  ? tr("notify.permService", "on this system the service shows them itself — there is no permission to hold")
                  : permissionText(permission, windows)}
              </span>
              {!serviceShows && windows > 0 && permission === "notAsked" ? (
                <Tooltip
                  text={tr("notify.allowTip", "macOS asks once whether plxr may show notifications. Keep plxr open until you have answered.")}
                >
                  <Button primary onClick={() => void allow()}>
                    {tr("notify.allow", "ALLOW NOTIFICATIONS")}
                  </Button>
                </Tooltip>
              ) : null}
              {!serviceShows && permission === "denied" ? (
                <Tooltip
                  text={tr("notify.openSettingsTip", "Opens System Settings on plxr's notifications, where Allow notifications is switched back on")}
                >
                  <Button primary onClick={() => void openSystemSettings()}>
                    {tr("notify.openSettings", "OPEN SYSTEM SETTINGS")}
                  </Button>
                </Tooltip>
              ) : null}
              <Tooltip text={tr("notify.testTip", "Shows one now and says what became of it")}>
                <Button onClick={() => void test()}>{tr("notify.test", "TEST")}</Button>
              </Tooltip>
            </span>
            {!serviceShows && permission === "denied" ? (
              <p className="notice">
                {tr(
                  "notify.permDeniedWhy",
                  "macOS asks only once. If that question was not answered — or plxr was closed while it was on screen — it counts as a no, and only System Settings can change it.",
                )}
              </p>
            ) : null}
            {tested ? <p className="notice">{tested}</p> : null}
          </div>
        </>
      ) : null}

      <p className="notice">{note}</p>
    </div>
  );
}
