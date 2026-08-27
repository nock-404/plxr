/* Werkbank — the console that lives inside the window.
 *
 * Why this exists: plxr is an app, not a web page. There are no developer
 * tools in the window, so a JavaScript error during startup shows up as
 * nothing at all — the page simply stands there unstyled and nobody can say
 * why. That happened twice: once because the daemon answered no CORS
 * preflight, once because a stylesheet never arrived. Both times the cause was
 * one line in a console nobody could read.
 *
 * Three rules follow from that, and they are the reason this file looks the
 * way it does:
 *
 *   1. It is loaded FIRST, before ui.js and app.js. Whatever those two throw
 *      while loading has to land in the log — a recorder that starts after the
 *      crash records nothing.
 *   2. It depends on nothing. No tr(), no $(), no CSS variable, no skin. All
 *      of those are things that can be broken, and it has to work precisely
 *      then. Its labels are therefore English literals and not translated.
 *   3. It never throws itself. Every hook wraps the original and passes the
 *      call through, whatever happens in between.
 *
 * F12 opens and closes it. window.plxrDebug.dump() returns everything as text.
 */
(() => {
  'use strict';

  const MAX = 500;
  const entries = [];
  let errors = 0;
  let panel = null, body = null, badge = null, flag = null;
  let tab = 'console';
  let selbstGezeigt = false;

  const now = () => {
    const d = new Date();
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  };

  /* Anything may end up in here: strings, Errors, DOM nodes, circular objects.
     Rendering must not be able to fail, so every step has its own fallback. */
  const asText = (v) => {
    if (typeof v === 'string') return v;
    if (!v || typeof v !== 'object') return String(v);
    /* Absichtlich nach Merkmalen statt mit instanceof: die Werkbank laeuft im
       Fenster, im Browser und im Test, und Error und Element sind nicht
       ueberall dieselbe Klasse. Ein Rekorder, der beim Aufschreiben des
       Fehlers selbst wirft, ist wertlos. */
    if (typeof v.message === 'string' && typeof v.name === 'string')
      return `${v.name}: ${v.message}` + (v.stack ? `\n${v.stack}` : '');
    if (typeof v.tagName === 'string')
      return `<${v.tagName.toLowerCase()}${v.id ? '#' + v.id : ''}>`;
    try { return JSON.stringify(v); } catch { return String(v); }
  };

  function add(kind, where, text) {
    entries.push({ kind, when: now(), where, text });
    if (entries.length > MAX) entries.shift();
    if (kind === 'error' || kind === 'bad') {
      errors++;
      if (badge) { badge.textContent = String(errors); badge.hidden = false; }
      flagUp();
      /* Der erste Fehler holt die Leiste selbst nach vorn. Das ist der ganze
         Zweck: wer eine nackte Oberflaeche vor sich hat, weiss nicht, dass es
         hier etwas zu druecken gibt — und auf dem Mac kommt F12 ohne fn gar
         nicht erst an. Nur beim ersten, danach nie wieder ungefragt. */
      if (errors === 1 && !selbstGezeigt) { selbstGezeigt = true; setTimeout(() => toggle(true), 0); }
    }
    if (panel && !panel.hidden) render();
  }

  /* ---------- Recording. Installed before anything else runs. ---------- */

  const original = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    original[level] = console[level] ? console[level].bind(console) : () => {};
    console[level] = (...args) => {
      try { add(level === 'debug' ? 'log' : level, 'console', args.map(asText).join(' ')); } catch {}
      original[level](...args);
    };
  }

  /* Capture phase, because failed <link> and <script> loads do not bubble.
     That is the case that matters most here: a stylesheet that does not
     arrive leaves no trace anywhere else. */
  window.addEventListener('error', (e) => {
    try {
      const el = e.target;
      if (el && el !== window && (el.tagName === 'LINK' || el.tagName === 'SCRIPT' || el.tagName === 'IMG')) {
        add('bad', 'load', `${el.tagName.toLowerCase()} failed: ${el.href || el.src}`);
        return;
      }
      add('error', 'window', `${e.message}\n  ${e.filename}:${e.lineno}:${e.colno}`);
    } catch {}
  }, true);

  window.addEventListener('unhandledrejection', (e) => {
    try { add('error', 'promise', asText(e.reason)); } catch {}
  });

  /* Every request, with status and duration. A 404 on a language file is
     invisible otherwise — fetch does not throw on it. */
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const method = (init && init.method) || (input && input.method) || 'GET';
    const started = performance.now();
    try {
      const r = await realFetch(input, init);
      const ms = Math.round(performance.now() - started);
      add(r.ok ? 'net' : 'bad', 'fetch', `${method} ${url} → ${r.status} (${ms} ms)`);
      return r;
    } catch (err) {
      const ms = Math.round(performance.now() - started);
      add('bad', 'fetch', `${method} ${url} → ${asText(err)} (${ms} ms)`);
      throw err;
    }
  };

  /* ---------- What the state tab shows ---------- */

  function state() {
    const root = document.documentElement;
    const skinLink = document.getElementById('skinCss');
    const sheets = [...document.styleSheets].map((s) => {
      let rules = '?';
      try { rules = s.cssRules ? s.cssRules.length : 0; } catch { rules = 'blocked'; }
      return `${s.href || '(inline)'} — ${rules} rules`;
    });
    return [
      ['location', location.href],
      ['wails bindings', String(!!(window.go || window.runtime))],
      ['skin (data-skin)', root.dataset.skin || '(none)'],
      ['skin stylesheet', (skinLink && skinLink.getAttribute('href')) || '(empty)'],
      ['platform', root.dataset.platform || '(unset)'],
      ['language', document.documentElement.lang || '(unset)'],
      ['stylesheets', sheets.length ? '\n  ' + sheets.join('\n  ') : '(none)'],
      ['errors recorded', String(errors)],
      ['user agent', navigator.userAgent],
    ];
  }

  /* ---------- The panel itself ---------- */

  function build() {
    if (panel) return;
    /* Ohne Dokument gibt es nichts zu bauen — im Test, in einem Arbeiter, in
       jeder Umgebung ohne DOM. Aufzeichnen tut sie dort trotzdem, und das ist
       der Teil, auf den es ankommt. */
    if (!document || typeof document.createElement !== 'function' || !document.body) return;
    panel = document.createElement('aside');
    panel.className = 'devPanel';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="devHead">' +
      '<span class="devTitle">werkbank</span>' +
      '<button type="button" class="devTab" data-tab="console">console<span class="devBadge" hidden></span></button>' +
      '<button type="button" class="devTab" data-tab="network">network</button>' +
      '<button type="button" class="devTab" data-tab="state">state</button>' +
      '</div>' +
      '<div class="devBody"></div>' +
      '<div class="devFoot">' +
      '<button type="button" class="devBtn" data-do="copy">copy</button>' +
      '<button type="button" class="devBtn" data-do="clear">clear</button>' +
      '<button type="button" class="devBtn" data-do="close">close</button>' +
      '<span class="devHint">F12</span>' +
      '</div>';

    body = panel.querySelector('.devBody');
    badge = panel.querySelector('.devBadge');
    if (errors) { badge.textContent = String(errors); badge.hidden = false; }

    panel.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) { tab = t.dataset.tab; render(); return; }
      const b = e.target.closest('[data-do]');
      if (!b) return;
      if (b.dataset.do === 'close') toggle(false);
      if (b.dataset.do === 'clear') { entries.length = 0; errors = 0; badge.hidden = true; render(); }
      if (b.dataset.do === 'copy') copy();
    });

    document.body.appendChild(panel);
  }

  function render() {
    if (!body) return;
    for (const t of panel.querySelectorAll('[data-tab]')) {
      if (t.dataset.tab === tab) t.dataset.on = 'yes';
      else delete t.dataset.on;
    }

    const rows = tab === 'state'
      ? state().map(([k, v]) => ({ kind: 'info', when: k, text: v }))
      : entries.filter((e) => (tab === 'network' ? e.where === 'fetch' : e.where !== 'fetch'));

    if (!rows.length) {
      body.innerHTML = '<div class="devEmpty">nothing recorded</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const e of rows) {
      const row = document.createElement('div');
      row.className = 'devRow';
      row.dataset.kind = e.kind;
      const when = document.createElement('span');
      when.className = 'devWhen';
      when.textContent = e.when;
      const text = document.createElement('span');
      text.className = 'devText';
      text.textContent = e.text;
      row.append(when, text);
      frag.appendChild(row);
    }
    body.innerHTML = '';
    body.appendChild(frag);
    if (tab !== 'state') body.scrollTop = body.scrollHeight;
  }

  function dump() {
    const head = state().map(([k, v]) => `${k}: ${v}`).join('\n');
    const log = entries.map((e) => `${e.when} [${e.where}/${e.kind}] ${e.text}`).join('\n');
    return `── state ──\n${head}\n\n── log (${entries.length}) ──\n${log}\n`;
  }

  function copy() {
    const text = dump();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => add('info', 'werkbank', 'log copied to the clipboard'))
        .catch(() => add('warn', 'werkbank', 'clipboard refused — use plxrDebug.dump() instead'));
      return;
    }
    add('warn', 'werkbank', 'no clipboard available — use plxrDebug.dump() instead');
  }

  /* Wenn die Leiste zu ist und trotzdem etwas schiefgeht, muss es sichtbar
     werden, ohne dass jemand eine Taste kennt. */
  function flagUp() {
    if (!document || !document.body || typeof document.createElement !== 'function') return;
    if (panel && !panel.hidden) return;
    if (!flag) {
      flag = document.createElement('button');
      flag.type = 'button';
      flag.className = 'devFlag';
      flag.addEventListener('click', () => toggle(true));
      document.body.appendChild(flag);
    }
    flag.textContent = errors === 1 ? '1 error' : `${errors} errors`;
    flag.hidden = false;
  }

  function toggle(on) {
    build();
    if (!panel) return;
    panel.hidden = on === undefined ? !panel.hidden : !on;
    if (flag) flag.hidden = !panel.hidden ? true : errors === 0;
    if (!panel.hidden) render();
  }

  /* Capture phase again: the terminal swallows most keys, and F12 has to work
     even while a session has the focus. */
  document.addEventListener('keydown', (e) => {
    /* Drei Wege hinein, weil einer nicht reicht: F12 ist auf dem Mac
       werkseitig eine Systemtaste und erreicht die Anwendung ohne fn nie.
       Cmd+Alt+I ist der Griff, den jeder aus dem Browser kennt, und
       Ctrl+Shift+D bleibt fuer Windows und Linux. */
    const f12 = e.key === 'F12' || e.code === 'F12';
    const mac = (e.metaKey || e.ctrlKey) && e.altKey && (e.key === 'i' || e.key === 'I' || e.code === 'KeyI');
    const alt = e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd' || e.code === 'KeyD');
    if (f12 || mac || alt) { e.preventDefault(); e.stopPropagation(); toggle(); }
  }, true);

  window.plxrDebug = { open: () => toggle(true), close: () => toggle(false), toggle, dump, entries };

  add('info', 'werkbank', 'recording — F12 opens this panel');

  /* The panel needs a body to hang in. Building early is not worth an error,
     so it waits — the log is already running by then. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build, { once: true });
  } else {
    build();
  }
})();
