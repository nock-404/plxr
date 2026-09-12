"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { errText, tr } from "@/lib/i18n";
import { bindingOf, caption } from "@/lib/keymap";
import { terminalPrefs } from "@/lib/prefs";
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

// How long to wait before trying the socket again, per attempt. Starts at a
// second — a dropped link on wifi is usually back by then — and doubles up to a
// ceiling, so a machine that is really gone is not hammered.
function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 10000);
}

export default function Terminal({
  id,
  label,
  onClose,
  onSearch,
  onFind,
  active = true,
  onFocus,
  ended = false,
  orphaned = false,
  exitCode = 0,
  onRestart,
}: {
  id: string;
  label: string;
  onClose?: () => void;
  onSearch?: (addon: SearchAddon | null) => void;
  /* Opens the find box over this terminal — the same one ⌘F opens. Offered
     in the right-click menu, so finding is not keyboard-only. */
  onFind?: () => void;
  active?: boolean;
  onFocus?: () => void;
  /* The session's process is gone — known from the tiles, not from the socket.
     A socket that closes is a dropped link until the tiles say otherwise. */
  ended?: boolean;
  orphaned?: boolean;
  exitCode?: number;
  /* Starts the session again, in place. Only offered while it has ended. */
  onRestart?: () => Promise<unknown>;
}) {
  const host = useRef<HTMLDivElement>(null);
  // Held so a theme change can reach the canvas, which CSS never touches.
  const canvas = useRef<{ term: Xterm; fit: FitAddon; webgl?: WebglAddon } | null>(null);
  const report = useRef(onSearch);
  report.current = onSearch;
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState("");
  /* What the clipboard refused, said in the pane. The native window is a
     WKWebView, whose clipboard reads are not Chrome's: a paste may be
     declined outright, and a decline nobody can see is a paste that
     "did nothing". */
  const [clipNote, setClipNote] = useState("");
  const ctx = useContextMenu();

  useEffect(() => {
    const el = host.current;
    if (!el || ended) return;

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
      cursorBlink: terminalPrefs().cursorBlink,
      cursorStyle: terminalPrefs().cursorStyle,
      scrollback: terminalPrefs().scrollback,
      theme: colours(),
    });
    const fit = new FitAddon();
    canvas.current = { term, fit };
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    report.current?.(search);
    term.open(el);
    /* The host knows its terminal, the way a CodeMirror element knows its
       view: it is how the window checks — surfaces.mjs reads the live
       options — that a setting reached the running xterm, rather than taking
       this file's word for it. */
    (el as HTMLDivElement & { xterm?: Xterm }).xterm = term;

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

    /* The socket, and the socket again.
     *
     * A closed socket used to be read as "the session is not running", and a
     * line saying so was printed into the terminal — for a laptop lid closing,
     * a wifi stall, a sleep. The session was fine; the window had given up on
     * it. Now a drop is a drop: say so once, try again with a growing pause,
     * and when the link is back, take the whole screen afresh — the service
     * hands over its scrollback on every attach, so the terminal is reset first
     * or the output would be there twice. Whether the session has really ended
     * is the tiles' word, and that arrives as the `ended` prop. */
    let ws: WebSocket | null = null;
    let timer: number | null = null;
    let attempt = 0;
    let lost = false;

    const sendSize = () => {
      fit.fit();
      if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "resize", rows: term.rows, cols: term.cols }));
    };

    const open = () => {
      if (!live) return;
      const sock = new WebSocket(wsUrl(`/ws/session/${encodeURIComponent(id)}`));
      ws = sock;
      sock.binaryType = "arraybuffer";
      sock.onopen = () => {
        if (lost) {
          term.reset();
          lost = false;
        }
        attempt = 0;
        sendSize();
      };
      sock.onmessage = (e) => {
        show(e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : String(e.data));
      };
      sock.onerror = () => sock.close();
      sock.onclose = () => {
        if (!live || ws !== sock) return;
        if (!lost) {
          lost = true;
          show(`\r\n[plxr] ${tr("pane.lostLine", "connection lost — reconnecting …")}\r\n`);
        }
        timer = window.setTimeout(open, backoff(attempt++));
      };
    };
    open();

    const off = term.onData((d) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "in", data: d }));
    });
    const ro = new ResizeObserver(sendSize);
    ro.observe(el);

    return () => {
      live = false;
      if (timer) window.clearTimeout(timer);
      report.current?.(null);
      ro.disconnect();
      off.dispose();
      webgl?.dispose();
      ws?.close();
      term.dispose();
      delete (el as HTMLDivElement & { xterm?: Xterm }).xterm;
      canvas.current = null;
    };
  }, [id, ended]);

  const restart = () => {
    if (!onRestart || restarting) return;
    setRestarting(true);
    setRestartError("");
    onRestart()
      .catch((e) => setRestartError(tr("session.restartFailed", "Restart failed: {detail}", { detail: errText(e) })))
      .finally(() => setRestarting(false));
  };

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
      const family = style.getPropertyValue("--term-font").trim() || "ui-monospace, Menlo, monospace";
      held.term.options.fontFamily = family;
      held.term.options.fontSize = Math.round(
        parseFloat(style.getPropertyValue("--term-size") || "0.8125") * rootSize,
      );
      held.term.options.theme = colours();
      // The terminal's own settings ride the same wire as the palette.
      const prefs = terminalPrefs();
      held.term.options.scrollback = prefs.scrollback;
      held.term.options.cursorStyle = prefs.cursorStyle;
      held.term.options.cursorBlink = prefs.cursorBlink;
      /* A brought-in font is not on the machine until it has loaded, and xterm
         measures the cell the moment it is told the family — so a fit done now
         uses the fallback's width and every column is off until the next
         change. So when the font is not ready yet, the fit is done again once
         it is. */
      if (typeof document !== "undefined" && document.fonts) {
        const px = held.term.options.fontSize || 13;
        document.fonts.load(`${px}px ${family}`).then(() => {
          const still = canvas.current;
          if (!still) return;
          still.webgl?.clearTextureAtlas();
          still.fit.fit();
          still.term.refresh(0, still.term.rows - 1);
        }).catch(() => undefined);
      }
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

  // A note that goes away on its own: it reports one refusal, not a state.
  const say = (text: string) => {
    setClipNote(text);
    window.setTimeout(() => setClipNote((now) => (now === text ? "" : now)), 4000);
  };

  /* The terminal's own menu, built at the moment of the right-click from the
     live xterm: whether there is a selection decides whether Copy is offered,
     and Paste goes in through the same path the keyboard uses — term.paste
     fires onData, which sends it to the session over the socket. Never the
     browser's menu, which knows nothing about a terminal. */
  const termMenu = (): MenuItem[] => {
    const held = canvas.current;
    if (!held) return [];
    const term = held.term;
    return [
      {
        label: tr("term.copy", "Copy"),
        hint: caption("Mod+C"),
        disabled: !term.hasSelection(),
        onClick: () => {
          const text = term.getSelection();
          const clip = navigator.clipboard;
          if (!clip?.writeText) {
            say(tr("term.clipboardNone", "This window has no clipboard access"));
            return;
          }
          clip.writeText(text).catch(() => say(tr("term.copyRefused", "Copy was refused by the browser")));
        },
      },
      {
        label: tr("term.paste", "Paste"),
        hint: caption("Mod+V"),
        onClick: () => {
          const clip = navigator.clipboard;
          if (!clip?.readText) {
            say(tr("term.clipboardNone", "This window has no clipboard access"));
            return;
          }
          clip
            .readText()
            .then((text) => {
              if (text) term.paste(text);
            })
            .catch(() => say(tr("term.pasteRefused", "Paste was refused by the browser — use the keyboard shortcut")));
        },
      },
      { label: tr("term.selectAll", "Select all"), onClick: () => term.selectAll() },
      { separator: true },
      { label: tr("term.clear", "Clear"), onClick: () => term.clear() },
      ...(onFind ? [{ label: tr("term.find", "Find…"), hint: caption(bindingOf("find")), onClick: onFind }] : []),
    ];
  };

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
      {ended ? (
        /* The process is gone. The panel says so in the terminal's own frame,
           fills it, and offers the one thing that helps: starting again, in
           this same place, under the same id. */
        <div className="pterm paneEnded">
          <div className="endedNote">
            <b className="endedTitle">{tr("session.endedTitle", "this session has ended")}</b>
            <span className="endedMeta">
              {orphaned
                ? tr("session.endedOrphan", "plxr was restarted since, and the process went with it.")
                : tr("session.endedCode", "exit code {code}", { code: exitCode })}
            </span>
            {onRestart ? (
              <>
                <span className="endedHint">
                  {tr(
                    "session.endedRestartHint",
                    "RESTART brings it back in this panel — the recording, marks and timeline carry on. A Claude session picks its conversation up again.",
                  )}
                </span>
                <span className="rowInline">
                  <Tooltip text={tr("session.restartTip", "Start this session again, right here, under the same id")}>
                    <Button primary busy={restarting} onClick={restart}>
                      {tr("session.restart", "RESTART")}
                    </Button>
                  </Tooltip>
                </span>
                {restartError ? <span className="notice warn">{restartError}</span> : null}
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="pterm">
          <div
            className="ptermbox"
            ref={host}
            onContextMenu={(e) => {
              const items = termMenu();
              if (items.length === 0) return;
              ctx(items)(e);
            }}
          />
          {clipNote ? <span className="notice warn ptermNote">{clipNote}</span> : null}
        </div>
      )}
    </div>
  );
}
