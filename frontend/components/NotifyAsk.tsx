"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { api } from "@/lib/api";
import { errText, tr } from "@/lib/i18n";
import type { NotifyInfo } from "@/lib/types";

/* The first question, with its reason.
 *
 * macOS asks an application once whether it may show notifications, and its
 * question gives no reason. It is also taken off the screen the moment the
 * process that asked goes away, and an unanswered question stands as a "no"
 * from then on — measured; see internal/notify/notify_darwin.go. So plxr does
 * not ask by itself at start. This band says why it wants to, and the question
 * is put when somebody presses ALLOW, by the plxr window, which is open while
 * they answer.
 *
 * It shows only where there is something to ask: notifications switched on, a
 * plxr window connected, and that window reporting "not asked" — or "asking",
 * while the answer is awaited. Once the answer is in, it stops looking.
 */
const LOOK_EVERY = 4000;

export default function NotifyAsk() {
  const [info, setInfo] = useState<NotifyInfo | null>(null);
  const [later, setLater] = useState(true);
  const [problem, setProblem] = useState("");
  const settled = useRef(false);

  useEffect(() => {
    let live = true;
    api
      .prefs()
      .then((p) => {
        if (live) setLater(Boolean((p as { notifyAskLater?: unknown }).notifyAskLater));
      })
      .catch(() => undefined);
    const look = () => {
      if (settled.current) return;
      api
        .notify()
        .then((n) => {
          if (!live) return;
          setInfo(n);
          settled.current = Boolean(n.serviceShows) || n.permission === "granted" || n.permission === "denied";
        })
        .catch(() => undefined);
    };
    look();
    const timer = window.setInterval(look, LOOK_EVERY);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!info || later || info.serviceShows || !info.settings.on || info.windows === 0) return null;
  if (info.permission !== "notAsked" && info.permission !== "asking") return null;

  async function allow() {
    setProblem("");
    try {
      const { asked } = await api.notifyAuthorize();
      if (!asked) setProblem(tr("notify.permNoWindow", "no plxr window is open — nothing can be shown until one is"));
    } catch (e) {
      setProblem(errText(e));
    }
  }

  async function notNow() {
    setLater(true);
    await api.setPrefs({ notifyAskLater: true }).catch(() => undefined);
  }

  return (
    <div className="updatebar">
      <span>
        {info.permission === "asking"
          ? tr(
              "notify.permAsking",
              "macOS is asking now — answer its notification in the top right corner, and keep plxr open until you have",
            )
          : tr(
              "notify.askReason",
              "plxr can tell you when a session needs you while you work in another app. For that, macOS has to allow plxr to show notifications — it asks once.",
            )}
        {problem ? ` ${problem}` : ""}
      </span>
      {info.permission === "notAsked" ? (
        <>
          <Button primary onClick={() => void allow()}>
            {tr("notify.allow", "ALLOW NOTIFICATIONS")}
          </Button>
          <Button onClick={() => void notNow()}>{tr("notify.askLater", "NOT NOW")}</Button>
        </>
      ) : null}
    </div>
  );
}
