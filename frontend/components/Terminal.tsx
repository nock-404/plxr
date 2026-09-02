"use client";

import { useEffect, useRef } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import Button from "@/components/ui/Button";
import { tr } from "@/lib/i18n";
import { wsUrl } from "@/lib/token";
import { THEME_CHANGED } from "@/lib/theme";

// The real terminal: xterm bound to /ws/session/{id}. Colours come from the
// skin's terminal tokens, so it belongs to the theme instead of sitting in it
// as a foreign dark block.
function colours() {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string, f: string) => s.getPropertyValue(n).trim() || f;
  const fg = v("--term-fg", "#37ff86");
  return {
    background: "rgba(0,0,0,0)",
    foreground: fg,
    cursor: v("--accent", fg),
    cursorAccent: v("--term-bg", "#04120b"),
    selectionBackground: v("--dim", "#1f9d5f"),
  };
}

export default function Terminal({
  id,
  label,
  onClose,
  onSearch,
  active = true,
  onFocus,
}: {
  id: string;
  label: string;
  onClose?: () => void;
  onSearch?: (addon: SearchAddon | null) => void;
  active?: boolean;
  onFocus?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  // Held so a theme change can reach the canvas, which CSS never touches.
  const canvas = useRef<{ term: Xterm; fit: FitAddon; webgl?: WebglAddon } | null>(null);
  const report = useRef(onSearch);
  report.current = onSearch;

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const style = getComputedStyle(document.documentElement);
    const term = new Xterm({
      allowTransparency: true,
      fontFamily: style.getPropertyValue("--term-font").trim() || "ui-monospace, Menlo, monospace",
      // Follows the setting, in the same unit as everything else: a rem value
      // resolved against the root, so one number drives both skins and sizes.
      fontSize: Math.round(
        parseFloat(style.getPropertyValue("--term-size") || "0.8125") *
          parseFloat(getComputedStyle(document.documentElement).fontSize || "16"),
      ),
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 10000,
      theme: colours(),
    });
    const fit = new FitAddon();
    canvas.current = { term, fit };
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    report.current?.(search);
    term.open(el);

    // The DOM renderer measured here fills its buffer but does not paint the
    // first screen; the GPU renderer does, and it is the faster path anyway.
    // If the context cannot be created, the DOM renderer stays in place.
    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl?.dispose());
      term.loadAddon(webgl);
      canvas.current = { term, fit, webgl };
    } catch {
      webgl = null;
    }

    // Nothing is written before the element has been through a real layout pass:
    // measured, output that arrived first went into the buffer and never showed.
    // So frames wait here until the fonts are loaded and one frame has passed.
    let live = true;
    let painted = false;
    const pending: (Uint8Array | string)[] = [];

    const show = (data: Uint8Array | string) => {
      if (!painted) {
        pending.push(data);
        return;
      }
      term.write(data as Uint8Array);
    };

    const settle = async () => {
      try {
        await document.fonts.ready;
      } catch {
        /* fonts API unavailable — the frame below is enough */
      }
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (!live) return;
      fit.fit();
      painted = true;
      for (const chunk of pending.splice(0)) term.write(chunk as Uint8Array);
    };
    void settle();

    const ws = new WebSocket(wsUrl(`/ws/session/${encodeURIComponent(id)}`));
    ws.binaryType = "arraybuffer";
    ws.onmessage = (e) => {
      show(e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : String(e.data));
    };
    const sendSize = () => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "resize", rows: term.rows, cols: term.cols }));
    };
    ws.onopen = sendSize;

    // A session that is gone has no socket to speak through. Saying so beats an
    // empty black rectangle, which reads as a bug.
    ws.onclose = () => {
      if (!live) return;
      show(`\r\n[plxr] ${tr("session.notRunning", "this session is not running")}\r\n`);
    };

    const off = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "in", data: d }));
    });
    const ro = new ResizeObserver(sendSize);
    ro.observe(el);

    return () => {
      live = false;
      report.current?.(null);
      ro.disconnect();
      off.dispose();
      webgl?.dispose();
      ws.close();
      term.dispose();
      canvas.current = null;
    };
  }, [id]);

  /* The canvas is not reached by a stylesheet.
   *
   * xterm is handed its colours, its typeface and its size once, when it is
   * built. Changing the palette, the skin or the terminal size therefore
   * redressed the whole window except the terminal — which is most of what is
   * on screen — until the session was closed and opened again. Three settings
   * that looked broken, and were.
   */
  useEffect(() => {
    const follow = () => {
      const held = canvas.current;
      if (!held) return;
      const style = getComputedStyle(document.documentElement);
      const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize || "16");
      held.term.options.fontFamily =
        style.getPropertyValue("--term-font").trim() || "ui-monospace, Menlo, monospace";
      held.term.options.fontSize = Math.round(
        parseFloat(style.getPropertyValue("--term-size") || "0.8125") * rootSize,
      );
      held.term.options.theme = colours();
      // A different size means a different number of rows and columns.
      /* The GPU renderer keeps the glyphs it has already drawn in a texture,
         and it keeps them at the size and colour they were drawn at. Setting a
         new size on the terminal changes nothing anybody can see until that
         store is thrown away — measured: the option was set to 18 and the
         screen stayed exactly as it was, twice. */
      held.webgl?.clearTextureAtlas();
      held.fit.fit();
      /* And then paint it again, whether or not anything arrived.
       *
       * xterm draws when there is something to draw. A session sitting quietly
       * has nothing, so the new size and the new colours were held but never
       * shown: the glyphs already on the canvas stayed exactly as they were,
       * and the setting looked dead until the next line of output happened to
       * come in. Measured that way twice before this line existed. */
      held.term.refresh(0, held.term.rows - 1);
    };
    window.addEventListener(THEME_CHANGED, follow);
    return () => window.removeEventListener(THEME_CHANGED, follow);
  }, []);

  return (
    <div className="pane" data-active={active ? "yes" : "no"} onPointerDown={onFocus}>
      <span className="panelabel">{label}</span>
      {onClose ? (
        <Button bare className="paneclose" onClick={onClose} aria-label="Close pane">
          ✕
        </Button>
      ) : null}
      {/* Two boxes, and the inner one is bare on purpose.
          xterm's fit addon works out how many rows fit by reading the computed
          height of the element it was opened into. Under box-sizing: border-box
          that value is the border-box height — so the padding above (which
          clears the label straddling the border) and the border itself were
          counted as room for text. It came to 22px, one whole row: the terminal
          drew 608px of rows into a 587px box and the bottom line was cut
          through the middle, with three pixels over the right edge as well.
          The padding and border stay outside; what xterm measures is exactly
          what xterm gets. */}
      <div className="pterm">
        <div className="ptermbox" ref={host} />
      </div>
    </div>
  );
}
