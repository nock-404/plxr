"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal as Xterm, type ILink, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { api } from "@/lib/api";
import { ringBell } from "@/lib/bell";
import { copyText } from "@/lib/browser";
import { clock } from "@/lib/format";
import { errText, tr } from "@/lib/i18n";
import { bindingOf, caption, isMac } from "@/lib/keymap";
import { terminalPrefs, type TerminalPrefs } from "@/lib/prefs";
import { wsUrl } from "@/lib/token";
import { THEME_CHANGED } from "@/lib/theme";

/* The sixteen ANSI colours, by the names xterm's theme uses. A skin sets
   them as --term-<name>; what a skin leaves out falls back to the VGA set,
   so an incomplete skin is a dull terminal and not a broken one. */
const ANSI = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;
const VGA: Record<(typeof ANSI)[number], string> = {
  black: "#000000", red: "#aa0000", green: "#00aa00", yellow: "#aa5500",
  blue: "#0000aa", magenta: "#aa00aa", cyan: "#00aaaa", white: "#aaaaaa",
  brightBlack: "#555555", brightRed: "#ff5555", brightGreen: "#55ff55", brightYellow: "#ffff55",
  brightBlue: "#5555ff", brightMagenta: "#ff55ff", brightCyan: "#55ffff", brightWhite: "#ffffff",
};

// The real terminal: xterm bound to /ws/session/{id}. Colours come from the
// skin's terminal tokens, so it belongs to the theme instead of sitting in it
// as a foreign dark block — the sixteen ANSI colours included, so `ls` in the
// tube skin glows and in the Win95 skin looks like the VGA it is.
function colours(): ITheme {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string, f: string) => s.getPropertyValue(n).trim() || f;
  const fg = v("--term-fg", "#37ff86");
  const theme: ITheme = {
    background: "rgba(0,0,0,0)",
    foreground: fg,
    cursor: v("--accent", fg),
    cursorAccent: v("--term-bg", "#04120b"),
    selectionBackground: v("--dim", "#1f9d5f"),
  };
  for (const name of ANSI) theme[name] = v(`--term-${name}`, VGA[name]);
  return theme;
}

// The root's font size in pixels: what a rem is worth right now.
function rootPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize || "16");
}

/* The options that follow the settings and the skin. Read in one place, so
   the terminal is built with exactly what a later change would push into it. */
function optionsFrom(prefs: TerminalPrefs) {
  const style = getComputedStyle(document.documentElement);
  const px = rootPx();
  return {
    fontFamily: style.getPropertyValue("--term-font").trim() || "ui-monospace, Menlo, monospace",
    // Follows the setting, in the same unit as everything else: a rem value
    // resolved against the root, so one number drives both skins and sizes.
    fontSize: Math.round(parseFloat(style.getPropertyValue("--term-size") || "0.8125") * px),
    lineHeight: prefs.lineHeight,
    // xterm wants pixels here; the setting is kept in rem like every size.
    letterSpacing: Math.round(prefs.letterSpacing * px * 100) / 100,
    fontWeight: prefs.fontWeight,
    fontWeightBold: prefs.fontWeightBold,
    cursorBlink: prefs.cursorBlink,
    cursorStyle: prefs.cursorStyle,
    cursorInactiveStyle: prefs.cursorInactive,
    minimumContrastRatio: prefs.minContrast,
    drawBoldTextInBrightColors: prefs.boldBright,
    scrollback: prefs.scrollback,
    theme: colours(),
  };
}

// How long to wait before trying the socket again, per attempt. Starts at a
// second — a dropped link on wifi is usually back by then — and doubles up to a
// ceiling, so a machine that is really gone is not hammered.
function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 10000);
}

// A link opens on ⌘-click on a Mac and Ctrl-click elsewhere; a plain click
// is a click in the terminal, which may be placing a selection.
function withModifier(e: MouseEvent): boolean {
  return isMac() ? e.metaKey : e.ctrlKey;
}

/* A path as a program prints one: src/x.ts, ./lib/a.go:12, /abs/path:3:4,
   with the line and column a compiler or grep appends. A bare word is not a
   path; it needs a slash or a file extension to be looked at at all, and it
   only becomes a link once the file API says it exists under this session. */
const PATH_RE = /(?:^|[\s"'`(\[<{=])((?:\.{1,2}\/|\/)?[\w.@+~-]+(?:\/[\w.@+~-]+)*)(?::(\d+))?(?::(\d+))?/g;
type PathHit = { path: string; line?: number; col?: number; start: number; end: number };

function pathsIn(text: string): PathHit[] {
  const out: PathHit[] = [];
  PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_RE.exec(text))) {
    let raw = m[1];
    // A path at the end of a sentence carries the sentence's full stop.
    while (/[.,;:)\]'"`]$/.test(raw)) raw = raw.slice(0, -1);
    if (!raw) continue;
    const start = m.index + m[0].indexOf(m[1]);
    // The suffix — :line:col — follows the name as printed; the name itself
    // may have lost a full stop above.
    const suffix = m[0].length - m[0].indexOf(m[1]) - m[1].length;
    const end = start + raw.length + suffix;
    const looksLikeFile = raw.includes("/") || /\.[a-z][a-z0-9]{0,7}$/i.test(raw);
    if (!looksLikeFile || /^https?:/i.test(raw) || raw.startsWith("~")) continue;
    if (/^\d+(\.\d+)*$/.test(raw)) continue;
    const path = raw.replace(/^\.\//, "");
    out.push({ path, line: m[2] ? parseInt(m[2], 10) : undefined, col: m[3] ? parseInt(m[3], 10) : undefined, start, end });
  }
  return out;
}

/* Whether a path exists under a session's folder, by listing its directory
   once and remembering the answer briefly. A hover asks for every path on a
   line; a listing per hover would be the file tree read again and again. */
const listings = new Map<string, Promise<Set<string>>>();
function namesIn(id: string, dir: string): Promise<Set<string>> {
  const key = `${id}\u0000${dir}`;
  const held = listings.get(key);
  if (held) return held;
  const p = api
    .listDir(id, dir)
    .then((entries) => new Set(entries.map((e) => e.name)))
    .catch(() => new Set<string>());
  listings.set(key, p);
  window.setTimeout(() => listings.delete(key), 10000);
  return p;
}

async function exists(id: string, path: string): Promise<boolean> {
  const cut = path.lastIndexOf("/");
  const dir = cut < 0 ? "" : cut === 0 ? "/" : path.slice(0, cut);
  const name = path.slice(cut + 1);
  if (!name) return false;
  return (await namesIn(id, dir)).has(name);
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
  endedAt,
  onRestart,
  onOpenPath,
  cwd,
  onSplit,
  splitOn = false,
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
  /* When the process ended, in ms since the epoch, if the tiles know. */
  endedAt?: number;
  /* Starts the session again, in place. Only offered while it has ended. */
  onRestart?: () => Promise<unknown>;
  /* A path clicked in the output, with the line it named: opens the editor
     beside this terminal. Without it, paths are plain text. */
  onOpenPath?: (path: string, line?: number) => void;
  /* The session's folder, for the menu's copy — the terminal itself does not
     know where it is. */
  cwd?: string;
  /* Puts a second session alongside, or takes it away again; `splitOn` says
     which way it stands. */
  onSplit?: () => void;
  splitOn?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  // Held so a theme change can reach the canvas, which CSS never touches.
  const canvas = useRef<{ term: Xterm; fit: FitAddon; webgl?: WebglAddon } | null>(null);
  const report = useRef(onSearch);
  report.current = onSearch;
  const openPath = useRef(onOpenPath);
  openPath.current = onOpenPath;
  /* The socket in use, read by the terminal's own handlers — keystrokes and
     sizes — which are wired once and outlive any one socket. */
  const socket = useRef<WebSocket | null>(null);
  /* Whether this terminal has been shown anything for this id. A socket that
     opens afterwards brings the whole screen again, so the terminal is reset
     first; the very first one paints onto a blank screen and need not be. */
  const fed = useRef(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState("");
  /* What the clipboard refused, said in the pane. The native window is a
     WKWebView, whose clipboard reads are not Chrome's: a paste may be
     declined outright, and a decline nobody can see is a paste that
     "did nothing". */
  const [clipNote, setClipNote] = useState("");
  // The frame lights up for a moment when the program rings its bell.
  const [bell, setBell] = useState(false);
  const ctx = useContextMenu();

  /* The terminal itself: built once per session id and kept for as long as
   * the panel is open — through a dropped socket, and through the end of the
   * process. It used to be torn down the moment the tiles said "ended", and
   * with it went the last screen: the stack trace, the exit line, the one
   * thing worth reading at that moment. Now the screen stays under the note.
   */
  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const term = new Xterm({ allowTransparency: true, ...optionsFrom(terminalPrefs()) });
    const fit = new FitAddon();
    canvas.current = { term, fit };
    fed.current = false;
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

    /* Links. A URL opens in the browser; a path that exists under this
       session's folder opens in the editor, at the line it named. Both on
       ⌘-click (Ctrl-click elsewhere): a plain click in a terminal is a
       click in the terminal. The addon is loaded AFTER the path provider is
       registered, so a URL with a path in it is a URL first. */
    const paths = term.registerLinkProvider({
      provideLinks(y, cb) {
        const line = term.buffer.active.getLine(y - 1);
        if (!line || !openPath.current) {
          cb(undefined);
          return;
        }
        const hits = pathsIn(line.translateToString(true));
        if (hits.length === 0) {
          cb(undefined);
          return;
        }
        void Promise.all(hits.map((h) => exists(id, h.path))).then((found) => {
          const links: ILink[] = hits
            .filter((_, i) => found[i])
            .map((h) => ({
              text: line.translateToString(true).slice(h.start, h.end),
              range: { start: { x: h.start + 1, y }, end: { x: h.end, y } },
              activate: (e: MouseEvent) => {
                if (!withModifier(e)) return;
                openPath.current?.(h.path, h.line);
              },
            }));
          cb(links.length ? links : undefined);
        });
      },
    });
    const web = new WebLinksAddon((e, uri) => {
      if (!withModifier(e)) return;
      window.open(uri, "_blank", "noopener,noreferrer");
    });
    term.loadAddon(web);

    /* The bell. A program asking for attention gets three things: the frame
       flashes, the panel's tab is marked until it is looked at, and — when a
       sound is chosen — the service plays it, the same one the notifications
       use. The sound is held to one a second: a build that rings ten times
       is one build. */
    let lastRing = 0;
    const rang = term.onBell(() => {
      setBell(true);
      window.setTimeout(() => setBell(false), 400);
      ringBell(id);
      const sound = terminalPrefs().bellSound;
      const now = Date.now();
      if (sound && now - lastRing > 1000) {
        lastRing = now;
        api.trySound(sound).catch(() => undefined);
      }
    });

    /* The size, sent when it changes and no more often than once a frame.
     *
     * The ResizeObserver used to send a resize per tick, every tick, and each
     * one is a SIGWINCH to the program — a drag of the splitter was dozens of
     * them, most repeating the last. Now the fit is done once per animation
     * frame, and the size goes out only when the number of rows or columns
     * actually moved. A panel that is hidden — tabbed away, so its box has no
     * offsetParent — is not fitted at all: measured at zero it would come out
     * as a two-column terminal and reflow the shell for nothing. A socket that
     * has just opened is told the size whether or not it changed: the service
     * knows nothing yet. */
    let frame = 0;
    let forced = false;
    const sendSize = (force = false) => {
      forced = forced || force;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const must = forced;
        forced = false;
        if (el.offsetParent === null) return;
        const before = `${term.rows}x${term.cols}`;
        fit.fit();
        const after = `${term.rows}x${term.cols}`;
        if (!must && before === after) return;
        const ws = socket.current;
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", rows: term.rows, cols: term.cols }));
      });
    };
    (el as HTMLDivElement & { sendSize?: (force?: boolean) => void }).sendSize = sendSize;

    const off = term.onData((d) => {
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "in", data: d }));
    });
    const ro = new ResizeObserver(() => sendSize());
    ro.observe(el);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      report.current?.(null);
      ro.disconnect();
      off.dispose();
      rang.dispose();
      paths.dispose();
      web.dispose();
      webgl?.dispose();
      term.dispose();
      delete (el as HTMLDivElement & { xterm?: Xterm }).xterm;
      delete (el as HTMLDivElement & { sendSize?: unknown }).sendSize;
      canvas.current = null;
    };
  }, [id]);

  /* The socket, and the socket again.
   *
   * A closed socket used to be read as "the session is not running", and a
   * line saying so was printed into the terminal — for a laptop lid closing,
   * a wifi stall, a sleep. The session was fine; the window had given up on
   * it. Now a drop is a drop: try again with a growing pause, say so once
   * when the first retry goes out, and when the link is back, take the whole
   * screen afresh — the service hands over its scrollback on every attach, so
   * the terminal is reset first or the output would be there twice. Whether
   * the session has really ended is the tiles' word, and that arrives as the
   * `ended` prop: from then on there is no retrying, and the screen that was
   * there stays there. A terminal opened on a session that had already ended
   * attaches once, for the last screen the service still holds, and no more.
   */
  useEffect(() => {
    const el = host.current;
    const held = canvas.current;
    if (!el || !held) return;
    const term = held.term;
    const fit = held.fit;
    if (ended && fed.current) return;

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
      if (el.offsetParent !== null) fit.fit();
      painted = true;
      for (const chunk of pending.splice(0)) term.write(chunk as Uint8Array);
    };
    void settle();

    let ws: WebSocket | null = null;
    let timer: number | null = null;
    let attempt = 0;
    let lost = false;
    const size = (el as HTMLDivElement & { sendSize?: (force?: boolean) => void }).sendSize;

    const open = (again: boolean) => {
      if (!live) return;
      if (again && !lost) {
        lost = true;
        show(`\r\n[plxr] ${tr("pane.lostLine", "connection lost — reconnecting …")}\r\n`);
      }
      const sock = new WebSocket(wsUrl(`/ws/session/${encodeURIComponent(id)}`));
      ws = sock;
      socket.current = sock;
      sock.binaryType = "arraybuffer";
      sock.onopen = () => {
        if (fed.current) term.reset();
        lost = false;
        attempt = 0;
        size?.(true);
      };
      sock.onmessage = (e) => {
        fed.current = true;
        show(e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : String(e.data));
      };
      sock.onerror = () => sock.close();
      sock.onclose = () => {
        if (!live || ws !== sock) return;
        if (socket.current === sock) socket.current = null;
        if (ended) return;
        timer = window.setTimeout(() => open(true), backoff(attempt++));
      };
    };
    open(false);

    return () => {
      live = false;
      if (timer) window.clearTimeout(timer);
      if (socket.current === ws) socket.current = null;
      ws?.close();
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
    /* A new size or typeface means a new number of rows and columns — and
       the program in the session has to hear of it, or it keeps drawing for
       the old width. The box did not move, so no observer fires: the size is
       pushed from here when the fit changed it. */
    const refit = (held: { term: Xterm; fit: FitAddon }) => {
      const el = host.current as (HTMLDivElement & { sendSize?: (force?: boolean) => void }) | null;
      if (!el || el.offsetParent === null) return;
      const before = `${held.term.rows}x${held.term.cols}`;
      held.fit.fit();
      if (`${held.term.rows}x${held.term.cols}` !== before) el.sendSize?.(true);
    };
    const follow = () => {
      const held = canvas.current;
      if (!held) return;
      // The terminal's own settings ride the same wire as the palette.
      const next = optionsFrom(terminalPrefs());
      for (const [key, value] of Object.entries(next)) {
        (held.term.options as unknown as Record<string, unknown>)[key] = value;
      }
      /* A brought-in font is not on the machine until it has loaded, and xterm
         measures the cell the moment it is told the family — so a fit done now
         uses the fallback's width and every column is off until the next
         change. So when the font is not ready yet, the fit is done again once
         it is. */
      if (typeof document !== "undefined" && document.fonts) {
        document.fonts.load(`${next.fontSize}px ${next.fontFamily}`).then(() => {
          const still = canvas.current;
          if (!still) return;
          still.webgl?.clearTextureAtlas();
          refit(still);
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
      refit(held);
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
        disabled: ended,
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
      // The panel around the terminal: split it, take its folder along, close it.
      ...paneItems(),
    ];
  };

  /* What the panel offers whether or not a terminal is running in it — the
     tail of the live menu, and with Restart in front the whole menu of a
     panel whose session has ended. */
  const paneItems = (): MenuItem[] => [
    ...(onSplit || cwd || onClose ? [{ separator: true as const }] : []),
    ...(onSplit ? [{ label: tr("term.menuSplit", "Split"), checked: Boolean(splitOn), onClick: onSplit }] : []),
    ...(cwd ? [{ label: tr("files.copy", "COPY PATH"), onClick: () => copyText(cwd) }] : []),
    ...(onClose ? [{ label: tr("term.menuClose", "Close panel"), onClick: onClose }] : []),
  ];
  const endedMenu = (): MenuItem[] => [
    ...(onRestart ? [{ label: tr("term.menuRestart", "Restart"), disabled: restarting, onClick: restart }] : []),
    ...paneItems(),
  ];

  return (
    <div className="pane" data-active={active ? "yes" : "no"} data-bell={bell ? "yes" : "no"} onPointerDown={onFocus}>
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
      <div className="pterm" data-ended={ended ? "yes" : "no"}>
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
        {ended ? (
          /* The process is gone. The note lies over the terminal's last
             screen — through it, not instead of it — and offers the two
             things that help: starting again in this same place, under the
             same id, or closing the pane. */
          <div className="endedOverlay" onContextMenu={ctx(endedMenu())}>
            <div className="endedNote">
              <b className="endedTitle">{tr("session.endedTitle", "this session has ended")}</b>
              <span className="endedMeta">
                {orphaned
                  ? tr("session.endedOrphan", "plxr was restarted since, and the process went with it.")
                  : tr("session.endedCode", "exit code {code}", { code: exitCode })}
                {endedAt ? ` · ${tr("session.endedAt", "ended at {time}", { time: clock(new Date(endedAt)) })}` : ""}
              </span>
              {onRestart ? (
                <span className="endedHint">
                  {tr(
                    "session.endedRestartHint",
                    "RESTART brings it back in this panel — the recording, marks and timeline carry on. A Claude session picks its conversation up again.",
                  )}
                </span>
              ) : null}
              <span className="rowInline">
                {onRestart ? (
                  <Tooltip text={tr("session.restartTip", "Start this session again, right here, under the same id")}>
                    <Button primary busy={restarting} onClick={restart}>
                      {tr("session.restart", "RESTART")}
                    </Button>
                  </Tooltip>
                ) : null}
                {onClose ? <Button onClick={onClose}>{tr("common.close", "CLOSE")}</Button> : null}
              </span>
              {restartError ? <span className="notice warn">{restartError}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
