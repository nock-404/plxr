"use client";

import { useEffect, useState } from "react";
import { watchFrames, type Frames } from "@/lib/frames";
import { tr } from "@/lib/i18n";
import { load } from "@/lib/theme";

/* A readout, so nobody has to take my word for how fast the window is.
 *
 * It shows the two numbers that matter — frames per second, and the longest a
 * single frame took — next to the two settings that cost the compositor most:
 * a see-through window and whatever is drawn behind it. Turn one off and watch
 * the number: that is a measurement anybody can make, and it beats a guess
 * about what is slow.
 */
/* Spelled out rather than assembled. A key built while it runs is a key nothing
   can check — which is how four tabs in the settings came to show their own
   identifier instead of a word. */
function backdropName(which: string): string {
  if (which === "clear") return tr("meter.backdrop.clear", "clear");
  if (which === "glass") return tr("meter.backdrop.glass", "glass");
  return tr("meter.backdrop.frosted", "frosted");
}

export default function Meter() {
  const [frames, setFrames] = useState<Frames>({ fps: 0, worstMs: 0 });
  const [look, setLook] = useState(() => load());

  useEffect(() => watchFrames(setFrames), []);

  // The settings beside the numbers have to be the ones in force now, not the
  // ones that were in force when this appeared.
  useEffect(() => {
    const onTheme = () => setLook(load());
    window.addEventListener("THEME_CHANGED", onTheme);
    return () => window.removeEventListener("THEME_CHANGED", onTheme);
  }, []);

  const slow = frames.fps > 0 && frames.fps < 50;
  const stutter = frames.worstMs > 50;

  return (
    <div className="meter" data-slow={slow ? "yes" : "no"} aria-live="off">
      <span className="meterBig">{frames.fps}</span>
      <span className="meterUnit">{tr("meter.fps", "fps")}</span>
      <span className="meterGap" data-bad={stutter ? "yes" : "no"}>
        {tr("meter.worst", "worst {ms} ms", { ms: frames.worstMs })}
      </span>
      <span className="meterCost">
        {look.seethrough ? tr("meter.seethrough", "see-through") : tr("meter.solid", "solid")}
        {" · "}
        {backdropName(look.backdrop)}
      </span>
    </div>
  );
}
