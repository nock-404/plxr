"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import Button from "@/components/ui/Button";
import Slider from "@/components/ui/Slider";
import { api } from "@/lib/api";
import { tr, errText } from "@/lib/i18n";
import type { TimelineMark } from "@/lib/types";

// Watch a session back. Its own terminal, with no input: this is a recording,
// and a cursor you could type into would say otherwise.
export default function Player({ id, onClose }: { id: string; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Xterm | null>(null);
  const [marks, setMarks] = useState<TimelineMark[]>([]);
  const [at, setAt] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const style = getComputedStyle(document.documentElement);
    const t = new Xterm({
      allowTransparency: true,
      fontFamily: style.getPropertyValue("--term-font").trim() || "ui-monospace, Menlo, monospace",
      // Follows the setting, in the same unit as everything else: a rem value
      // resolved against the root, so one number drives both skins and sizes.
      fontSize: Math.round(
        parseFloat(style.getPropertyValue("--term-size") || "0.8125") *
          parseFloat(getComputedStyle(document.documentElement).fontSize || "16"),
      ),
      lineHeight: 1.15,
      disableStdin: true,
      cursorBlink: false,
      scrollback: 20000,
      theme: {
        background: "rgba(0,0,0,0)",
        foreground: style.getPropertyValue("--term-fg").trim() || "#37ff86",
      },
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(el);
    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
      t.loadAddon(webgl);
    } catch {
      webgl = null;
    }
    fit.fit();
    term.current = t;

    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(el);
    return () => {
      ro.disconnect();
      webgl?.dispose();
      t.dispose();
      term.current = null;
    };
  }, []);

  useEffect(() => {
    api
      .timeline(id)
      .then((m) => setMarks(m ?? []))
      .catch((e) => setError(errText(e)));
  }, [id]);

  const showFrom = useCallback(
    async (offset: number) => {
      const t = term.current;
      if (!t) return;
      try {
        const text = await api.playback(id, offset);
        t.reset();
        t.write(text);
      } catch (e) {
        setError(errText(e));
      }
    },
    [id],
  );

  useEffect(() => {
    showFrom(0);
  }, [showFrom]);

  const last = marks.length ? marks[marks.length - 1].offset : 0;

  return (
    <div className="overlay">
      <div className="overlayBar">
        <span className="overlayName">{tr("player.title", "Playback")}</span>
        <span className="meta">
          {error ||
            (marks.length
              ? tr("player.marks", "{n} points", { n: marks.length })
              : tr("player.none", "no recording"))}
        </span>
        <span className="spacer" />
        <Button onClick={onClose}>{tr("common.back", "BACK")}</Button>
      </div>
      <div className="playterm" ref={host} />
      <div className="playbar">
        <Button tiny onClick={() => showFrom(0)} title={tr("player.startTip", "Back to the beginning")}>
          ⏮
        </Button>
        <Slider
          value={at}
          min={0}
          max={Math.max(1, last)}
          step={1}
          onChange={(v) => {
            setAt(v);
            showFrom(Math.round(v));
          }}
        />
        <span className="meta">
          {marks.length
            ? new Date(marks[0].at + 0).toLocaleTimeString(undefined, { hour12: false })
            : "0:00"}
        </span>
      </div>
    </div>
  );
}
