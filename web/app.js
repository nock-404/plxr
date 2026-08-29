/* plxr — the user interface.

   Runs in two environments: the Wails window and the browser
   (`plxr --browser`). The difference lives entirely in `connect()` and the two
   calls into the Wails bindings; everything above that knows nothing of it.

   It always talks to the daemon over HTTP and WebSocket. The daemon is a
   process of its own: sessions survive closing the window, and several clients
   may watch at the same time.
*/

const $ = (s) => document.querySelector(s);

/* ═════════════════════════ Language ═════════════════════════

   English is the source language: this is a public repository, and a tool
   nobody outside German-speaking countries can read is a tool nobody outside
   them uses. German is a translation like any other.

   Everything the user reads goes through t(). Everything else — class names,
   ids, log lines — stays as it is; those are not text, they are structure.

   The table is loaded before the first paint. A missing key falls back to
   English and, failing that, to the key itself: a screen showing "inbox.empty"
   is ugly, but it is honest and it is findable. Silently empty would not be. */

const LANGUAGES = ['en', 'de'];
let language = 'en';

/* null until asked once. Deliberately up here and not beside the hook code:
   let is not hoisted, and the empty overview reads it — a declaration further
   down works only as long as nothing runs earlier. That is not a property to
   rely on. */
let hookInstalled = null;
let texts = {};
let textsEn = {};

function pickLanguage() {
  try {
    const eigen = localStorage.getItem('plxr.lang');
    if (eigen && LANGUAGES.includes(eigen)) return eigen;
  } catch {}
  // The system language is the best guess available without asking.
  const raw = (navigator.language || 'en').toLowerCase().split('-')[0];
  return LANGUAGES.includes(raw) ? raw : 'en';
}

async function loadLanguage(welche) {
  language = welche || pickLanguage();
  const fetchOne = async (l) => {
    const r = await fetch(`/i18n/${l}.json`);
    if (!r.ok) throw new Error(`Sprachdatei ${l} fehlt`);
    return r.json();
  };
  // Always load English too: it is the fallback for every missing key.
  textsEn = await fetchOne('en');
  texts = language === 'en' ? textsEn : await fetchOne(language).catch(() => ({}));
}

/* tr returns the text for a key.

   Placeholders appear as {name} in the text and are filled from the second
   argument. Deliberately no plural rules: the languages this deals with get by
   with one branch in the caller, and half a pluralisation library would be
   more work than it is worth. */
function tr(keyName, values) {
  let s = texts[keyName] ?? textsEn[keyName] ?? keyName;
  if (values) {
    for (const [k, v] of Object.entries(values)) s = s.replaceAll(`{${k}}`, v);
  }
  return s;
}

/* Turn an error from the daemon into a sentence.

   Go does not send prose but a code, "err.session.unknown", and an
   untranslatable detail behind a bar — a path, a name, the message of an
   underlying error. See internal/uierr for the why.

   Anything not recognised is shown as it stands. That matters: an error must
   never be swallowed, and a daemon that is newer than this window may well
   send a code this table does not know yet. Then the code itself is on screen,
   which is ugly but honest — and traceable. */
function errText(e) {
  const raw = (e && e.message) || String(e ?? '');
  const [code, detail] = raw.split('|');
  if (!/^err\.[\w.]+$/.test(code)) return raw;
  if (!(code in texts) && !(code in textsEn)) return raw;
  return tr(code, detail === undefined ? undefined : { detail });
}

/* Translate everything in the markup that carries a key. Called at startup and
   after every language change — so a change needs no reload. */
function translateMarkup(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = tr(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-tip]')) {
    el.dataset.tip = tr(el.dataset.i18nTip);
  }
  for (const el of root.querySelectorAll('[data-i18n-ph]')) {
    el.placeholder = tr(el.dataset.i18nPh);
  }
  document.documentElement.lang = language;
}

const state = {
  tiles: [],        // letzter bekannter Gesamtzustand
  filter: '',       // Pfadfilter
  panes: [],        // session ids of the open terminal panes
  active: null,      // which of them the header acts on
  themes: [],
};

/* ═════════════════════════ Transport ═════════════════════════ */

const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const WAILS = !!(window.go && window.go.main && window.go.main.App);
const Native = WAILS ? window.go.main.App : null;

/* In the window, but without bound methods: then the UI cannot find the daemon
   and would stay silently blank. Better to be loud — this happens when someone
   builds without bindings. */
if (window.runtime && !WAILS) {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML =
      '<pre style="padding:40px;font:14px ui-monospace;color:#ff6b3d;background:#0b0906;height:100%">' +
      'plxr: Wails-Laufzeit da, aber window.go.main.App fehlt.\n\n' +
      'Die App wurde ohne Bindungen gebaut — mit "wails build" ohne\n' +
      '-skipbindings neu bauen.</pre>';
  });
}

let BASE = '';
let TOKEN = '';

async function connect() {
  if (WAILS) {
    // Asks Go afresh every time — a daemon is started there if needed.
    const d = await Native.Daemon();
    BASE = d.url;
    TOKEN = d.token;
    return;
  }
  BASE = location.origin;
  // The token arrives once through the address. After that it lives in
  // sessionStorage, so a reload does not lose the connection, and it
  // disappears from the address bar so it does not end up in the history.
  const ausURL = new URLSearchParams(location.search).get('token');
  if (ausURL) {
    TOKEN = ausURL;
    try { sessionStorage.setItem('plxr.token', ausURL); } catch {}
    history.replaceState(null, '', location.pathname);
  } else {
    try { TOKEN = sessionStorage.getItem('plxr.token') || ''; } catch {}
  }
  if (!TOKEN) throw new Error(tr('err.noToken'));
}

const wsURL = (p) =>
  BASE.replace(/^http/, 'ws') + p + (p.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN);

async function req(path, opts = {}) {
  // text: the answer is not JSON but a stylesheet. Taken out of the options
  // before they go to fetch — an unknown key there is silently ignored, and
  // silently ignored is exactly how a wrong call survives.
  const { text: asText, ...rest } = opts;
  let r;
  try {
    r = await fetch(BASE + path, { ...rest, headers: { 'X-Plxr-Token': TOKEN, ...(rest.headers || {}) } });
  } catch (e) {
    // A network error means: the daemon is gone. Do not push that onto the
    // caller, start the reconnect instead.
    //
    // And do not pass the webview's own wording through: depending on the
    // system it says "Load failed" or "Failed to fetch". That then stood in the
    // dialog without any context and explained nothing.
    reconnect();
    throw new Error(tr('err.daemonGone'));
  }
  if (r.status === 403) { reconnect(); throw new Error(tr('err.tokenExpired')); }
  if (!r.ok) throw new Error((await r.text()).trim() || r.statusText);
  if (r.status === 204) return null;
  return asText ? r.text() : r.json();
}

const b64 = (s) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/* Who is attached to which session. Needed to rebuild the same connections
   after a daemon restart. */
const attachments = new Map();

const api = {
  inWindow: WAILS,

  env: () => (WAILS ? Native.Env() : Promise.resolve({ platform: 'web', titlebarInset: false })),
  pickDirectory: () => (WAILS ? Native.PickDirectory() : Promise.resolve('')),

  themes: () => req('/api/themes'),
  themeImport: (text) => req('/api/themes', { method: 'POST', body: text }),
  themeDelete: (name) => req(`/api/themes/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  /* The stream comes as bytes, not JSON — base64 would treble its size. Hence
     around req, which expects JSON. */
  playback: async (id, from = 0) => {
    const r = await fetch(`${BASE}/api/playback/${encodeURIComponent(id)}?from=${from}`,
      { headers: { 'X-Plxr-Token': TOKEN } });
    if (!r.ok) throw new Error((await r.text()).trim() || r.statusText);
    return {
      // "resize" used to stand here for the size — a leftover of the blanket
      // regex that turned groesse into resize. There is no resizing involved,
      // it is the length of the recording.
      data: new Uint8Array(await r.arrayBuffer()),
      size: Number(r.headers.get('X-Plxr-Size') || 0),
      truncated: r.headers.get('X-Plxr-Cut') === 'true',
    };
  },
  timeline: (id) => req(`/api/playback/${encodeURIComponent(id)}/timeline`),
  skinRead: (name) => req(`/api/skins/${encodeURIComponent(name)}`, { text: true }),
  skinWrite: (name, css) =>
    req(`/api/skins/${encodeURIComponent(name)}`, { method: 'PUT', body: css }),
  freeze: (id) => req(`/api/sessions/${id}/freeze`, { method: 'POST' }),
  unfreeze: (id) => req(`/api/sessions/${id}/unfreeze`, { method: 'POST' }),
  emergencyBrake: () => req('/api/freeze', { method: 'POST' }),
  unfreeze: () => req('/api/unfreeze', { method: 'POST' }),
  accounts: () => req('/api/accounts'),
  templates: () => req('/api/templates'),
  templateStart: (name) => req(`/api/templates/${encodeURIComponent(name)}/start`, { method: 'POST' }),
  templateSave: (name, label) =>
    req('/api/templates', { method: 'POST', body: JSON.stringify({ Name: name, Label: label }) }),
  templateDelete: (name) => req(`/api/templates/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  rules: (session) => req('/api/rules?session=' + encodeURIComponent(session || '')),
  ports: () => req('/api/ports'),
  portKill: (pid, hard) => req(`/api/ports/${pid}${hard ? '?hard=1' : ''}`, { method: 'DELETE' }),
  usage: (days) => req('/api/usage?days=' + days),
  waiting: (days) => req('/api/waiting?days=' + days),
  replies: (q) => req('/api/replies?q=' + encodeURIComponent(q)),
  agents: () => req('/api/agents'),
  agentRead: (name) => req(`/api/agents/${encodeURIComponent(name)}`, { text: true }),
  agentStarter: (name) => req(`/api/agents/${encodeURIComponent(name)}/starter`, { text: true }),
  agentWrite: (name, text) => req(`/api/agents/${encodeURIComponent(name)}`, { method: 'PUT', body: text }),
  agentDelete: (name) => req(`/api/agents/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  marks: (id) => req(`/api/marks/${encodeURIComponent(id)}`),
  markChanges: (id, tree) => req(`/api/marks/${encodeURIComponent(id)}/${tree}`),
  markRestore: (id, tree, path) =>
    req(`/api/marks/${encodeURIComponent(id)}/${tree}/restore?path=${encodeURIComponent(path)}`, { method: 'POST' }),
  pace: () => req('/api/tempo'),
  version: () => req('/api/version'),
  updateStatus: () => req('/api/update'),
  restart: () => req('/api/restart', { method: 'POST' }),
  hookStatus: () => req('/api/hook'),
  setHook: (an) => req('/api/hook?an=' + (an ? '1' : '0'), { method: 'POST' }),
  update: () => req('/api/update', { method: 'POST' }),

  folder: (id, dir) => req(`/api/files/${id}?dir=${encodeURIComponent(dir || '')}`).catch(() => []),
  paths: (q) => req('/api/paths?q=' + encodeURIComponent(q)).catch(() => []),
  shell: () => req('/api/shell'),
  file: (id, file) => req(`/api/file/${id}?path=${encodeURIComponent(file)}`),
  fileWrite: (id, file, text, mod) =>
    req(`/api/file/${id}`, { method: 'PUT', body: JSON.stringify({ path: file, text, mod }) }),

  archive: (file) => req('/api/archive' + (file ? '?path=' + encodeURIComponent(file) : '')),
  archiveDelete: (id, account) => req(`/api/archive/${id}?account=${encodeURIComponent(account || '')}`, { method: 'DELETE' }),
  archiveResume: (id, account, target) =>
    req(`/api/archive/${id}/resume?account=${encodeURIComponent(account || '')}&target=${encodeURIComponent(target || '')}`,
        { method: 'POST' }),
  search: (q) => req('/api/search?q=' + encodeURIComponent(q)),
  searchTerminals: (q) => req('/api/search/terminals?q=' + encodeURIComponent(q)),

  start: (cwd, cmd, account) =>
    req('/api/sessions', { method: 'POST', body: JSON.stringify({ cwd, cmd, account: account }) }),
  kill: (id) => req('/api/sessions/' + id, { method: 'DELETE' }),
  switchAccount: (id, target) => req(`/api/sessions/${id}/account?target=${encodeURIComponent(target)}`, { method: 'POST' }),
  resume: (id) => req(`/api/sessions/${id}/resume`, { method: 'POST' }),
  sendReply: (id, text, raw) =>
    req(`/api/sessions/${id}/reply${raw ? '?raw=1' : ''}`, { method: 'POST', body: text }),

  // --- Gesamtzustand ---
  _tiles: null,
  _cb: null,
  aufZustand(cb) { this._cb = cb; this._openTiles(); },
  _openTiles() {
    const q = state.filter ? '/ws/tiles?path=' + encodeURIComponent(state.filter) : '/ws/tiles';
    if (this._tiles) { this._tiles.onclose = null; this._tiles.close(); }
    const ws = new WebSocket(wsURL(q));
    ws.onopen = () => showConnection(true);
    ws.onmessage = (e) => this._cb(JSON.parse(e.data));
    ws.onclose = () => reconnect();
    ws.onerror = () => { try { ws.close(); } catch {} };
    this._tiles = ws;
  },
  setFilter() { this._openTiles(); },

  // --- Terminals ---
  // One connection per session, in a Map rather than a single variable:
  // otherwise two sessions could never be shown at once.
  _verb: new Map(),
  attach(id, aufDaten, aufEnde) {
    this.detach(id);
    const ws = new WebSocket(wsURL(`/ws/session/${id}`));
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (e) => aufDaten(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
    // The reason for the distinction: a closed socket does not mean the process
    // ended. If the daemon dies we only lose the line — "process finished"
    // would simply be a lie.
    ws.onclose = () => {
      this._verb.delete(id);
      aufEnde(connectionOk ? 'prozess' : 'leitung');
    };
    this._verb.set(id, ws);
  },

  // After a daemon restart every open pane hangs on a dead socket.
  // Without pulling them along you get a UI that only looks alive.
  reattach() {
    for (const [id, entry] of attachments) {
      this.attach(id, entry.aufDaten, entry.aufEnde);
      entry.beiNeu?.();
    }
  },
  detach(id) {
    if (id === undefined) { for (const k of [...this._verb.keys()]) this.detach(k); return; }
    const ws = this._verb.get(id);
    if (!ws) return;
    ws.onclose = null;
    ws.close();
    this._verb.delete(id);
  },
  _send(id, obj) {
    const ws = this._verb.get(id);
    if (ws?.readyState === 1) ws.send(JSON.stringify(obj));
  },
  tippen(id, daten) { this._send(id, { type: 'in', data: daten }); },
  resize(id, rows, cols) { this._send(id, { type: 'resize', rows, cols }); },
};

/* ── Reconnecting ──
   A dropped connection is not an error state but an intermediate one: the
   daemon may have been restarted and changed port and token along the way. So
   ask again rather than throwing the UI away. */

let connectionOk = true;
function showConnection(ok) {
  if (ok === connectionOk) return;
  connectionOk = ok;
  document.documentElement.dataset.offline = ok ? '' : 'yes';
  if (!ok) {
    $('#counts').textContent = tr('conn.lost');
    return;
  }
  /* Once the connection is back the sentence has to go immediately. Leaving it
     until the next state update meant: with nothing running that triggers a
     message, "connection lost" sticks in the header forever even though
     everything works again. */
  renderAll(state.tiles);
  refreshView();
}

/* Reload whatever is open. A view that showed "not reachable" during the
   outage does not otherwise heal by itself — the user would have to reopen it
   by hand, and has no way of knowing that. */
function refreshView() {
  const dest = [
    ['#viewPorts', () => loadView('#portsList', '#portsInfo', loadPorts)],
    ['#viewUsage', () => loadView('#usageBody', '#usageInfo', loadUsage)],
    ['#viewArchive', () => loadView('#archList', '#archInfo', loadArchive)],
  ];
  for (const [sel, load] of dest) {
    if (!$(sel)?.hidden) load();
  }
  if (!$('#settings').hidden) {
    loadThemes($('#themeSel').value).catch(() => {});
    showHookStatus();
  }
}

let neuTimer = null;
function reconnect() {
  if (neuTimer) return;
  showConnection(false);
  let idleFor = 500;
  const attempt = async () => {
    try {
      await connect();
      await loadThemes($('#themeSel').value);
      api.aufZustand(renderAll);
      showConnection(true);
      // The terminals only now: before this the address would still be the old one.
      api.reattach();
      neuTimer = null;
    } catch {
      idleFor = Math.min(idleFor * 1.6, 5000);
      neuTimer = setTimeout(attempt, idleFor);
    }
  };
  neuTimer = setTimeout(attempt, idleFor);
}

/* ═════════════════════════ Themes and skins ═════════════════════════ */

const PALETTE = ['bg','fg','dim','accent','panel','line','working','waiting','blocked','dead'];

/* A skin change is double buffered: load the new sheet alongside, wait for
   onload, only then remove the old one. Redirecting href instead leaves a few
   hundred milliseconds with no stylesheet at all — and a naked page. */
let skinLoading = null;

function setSkin(name) {
  const href = `/skins/${name}/skin.css`;
  const prev = $('#skinCss');
  if (prev && prev.getAttribute('href') === href) return Promise.resolve();
  if (skinLoading === href) return Promise.resolve();
  skinLoading = href;

  return new Promise((done) => {
    const fresh = document.createElement('link');
    fresh.rel = 'stylesheet';
    fresh.href = href;
    const adopt = () => {
      if (prev && prev !== fresh) prev.remove();
      fresh.id = 'skinCss';
      skinLoading = null;
      // A different skin brings different crest glyphs.
      crestGlyphs = null;
      done();
    };
    fresh.addEventListener('load', adopt, { once: true });
    // A broken sheet: better to keep the old one than have none.
    fresh.addEventListener('error', () => { fresh.remove(); skinLoading = null; done(); }, { once: true });
    document.head.appendChild(fresh);
  });
}

function applyTheme(t) {
  if (!t || !t.skin) return;
  const root = document.documentElement;
  root.dataset.skin = t.skin;
  root.dataset.scan = t.scanlines === false ? 'off' : 'on';
  root.dataset.glow = t.glow === false ? 'off' : 'on';

  setSkin(t.skin).then(() => {
    // Set the palette only once the skin is in place: otherwise its :root block
    // overrides our values, because it is parsed later.
    for (const k of PALETTE) root.style.removeProperty('--' + k);
    for (const [k, v] of Object.entries(t.palette || {})) {
      if (PALETTE.includes(k)) root.style.setProperty('--' + k, v);
    }
    for (const p of paneList()) p.term.options.theme = xtermTheme();

    /* A different theme brings a different palette — own colour changes no longer
       apply. Leaving them would mean: the style editor shows the old theme's
       colours, and saving would write them into the new one. */
    styleState.changes = {};
    if (!$('#settings').hidden) buildStyleEditor();
  });

  try {
    localStorage.setItem('plxr.theme', t.name);
    // Write the whole theme along: on the next start the look is there
    // immediately, without waiting for the daemon.
    localStorage.setItem('plxr.themeCache', JSON.stringify(t));
  } catch {}
  showDeleteButton(t);
}

const cssVar = (n, ersatz) =>
  getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim() || ersatz;

function xtermTheme() {
  // Own variables falling back to the UI palette: a light skin wants a dark
  // terminal, otherwise amber sits on paper.
  const bg = cssVar('term-bg', cssVar('bg', '#000'));
  const fg = cssVar('term-fg', cssVar('fg', '#ccc'));
  const akz = cssVar('accent', fg), dim = cssVar('dim', fg);
  const red = cssVar('blocked', '#f55'), green = cssVar('working', '#5f5');
  const tot = cssVar('dead', dim);
  return {
    background: bg, foreground: fg, cursor: akz, selectionBackground: dim,
    black: bg, red: red, green: green, yellow: akz,
    blue: dim, magenta: akz, cyan: fg, white: fg,
    brightBlack: tot, brightRed: red, brightGreen: green,
    brightYellow: akz, brightBlue: dim, brightMagenta: akz,
    brightCyan: fg, brightWhite: fg,
  };
}

/* If the theme is not in the loaded list — because the daemon was away, say —
   the skin is derived from the name rather than doing nothing at all. A change
   must never pass silently. */
/* Deleting exists only for own themes: the built-in ones live inside the
   application and would be back after the next update anyway. */
function showDeleteButton(t) {
  $('#themeDelete').hidden = !(t || currentTheme())?.own;
}

function currentTheme() {
  const name = $('#themeSel').value;
  if (!name) return null;
  return state.themes.find((t) => t.name === name) || { name: name, skin: name.split('-')[0], palette: {} };
}

async function loadThemes(preselect) {
  const list = await api.themes();
  if (!list.length) return;
  state.themes = list;

  const sel = $('#themeSel');
  sel.innerHTML = '';
  let group = null, letzterSkin = null;
  for (const t of list) {
    if (t.skin !== letzterSkin) {
      group = document.createElement('optgroup');
      group.label = t.skin;
      sel.appendChild(group);
      letzterSkin = t.skin;
    }
    const o = document.createElement('option');
    o.value = t.name;
    o.textContent = t.label;
    group.appendChild(o);
  }
  const wanted = preselect || localStorage.getItem('plxr.theme') || 'crt-amber';
  sel.value = list.some((t) => t.name === wanted) ? wanted : list[0].name;
  plxrUI.replaceSelects();
  applyTheme(currentTheme());
}

$('#themeSel').addEventListener('change', () => {
  applyTheme(currentTheme());
});

$('#themeDelete').addEventListener('click', async () => {
  const t = currentTheme();
  if (!t?.own) return;
  if (!(await plxrUI.confirm(t.label, tr('theme.deleteAsk')))) return;
  try {
    await api.themeDelete(t.name);
    await loadThemes();
  } catch (e) {
    plxrUI.notice(errText(e), tr('theme.notDeleted'));
  }
});

/* ═════════════════════════ Einstellungen ═════════════════════════ */

/* Appearance and setup do not belong in the header: you set that once and
   never look at it again. */

async function openSettings() {
  $('#settings').hidden = false;
  plxrUI.replaceSelects();
  $('#themeHint').textContent =
    tr('settings.themeHint');
  pickTab('look');
  buildStyleEditor();
  renderAgents();
  showDeleteButton();
  fillLanguages();
  try {
    const v = await api.version();
    $('#settingsVersion').textContent =
      `plxr ${v.current}` + ` · ${v.available ? tr('version.available', { v: v.latest }) : tr('version.current')}`;
  } catch {
    $('#settingsVersion').textContent = '';
  }
  showHookStatus();
}
$('#settingsBtn').addEventListener('click', openSettings);

/* Room state — the whole room says what is going on.

   A coloured dot per tile only works if you look at it. Anyone reading a file
   or working in another window does not see it. So the interface itself
   carries the overall state, and the skins hang their means off it — crt lets
   the border breathe, sketch the paper, win95 colours the desktop. What the
   JavaScript supplies is only the fact.

   Deliberately just THREE states. Five fine gradations can no longer be told
   apart out of the corner of your eye, and a room constantly whispering
   something different turns into noise:

     working   somebody is working
     waiting   somebody needs you — the only one that presses
     idle      all done, it is quiet

   Plus the raw number, so a skin can tie the intensity to it: three running
   agents may cause more unrest than one. */
function roomState({ running, blocked, orphaned, total }) {
  const w = document.documentElement;
  const mode = blocked || orphaned ? 'waiting' : (running ? 'working' : 'idle');
  if (w.dataset.room !== mode) w.dataset.room = mode;

  // As a CSS variable, so a skin can compute with it instead of guessing.
  const setVar = (k, v) => {
    if (w.style.getPropertyValue(k) !== String(v)) w.style.setProperty(k, String(v));
  };
  setVar('--busy', running);
  setVar('--waiting-count', blocked + orphaned);
  setVar('--session-count', total);
}

/* Tabs in the settings window.

   The style editor alone is twelve colour fields and two sliders. Underneath
   it everything else had slipped below the fold — the Claude Code hook simply
   could not be seen any more.

   Deliberately no state that gets stored anywhere: whoever opens the settings
   almost always wants the same thing, and a window that remembers the last tab
   shows the wrong one next time. */
function pickTab(welcher) {
  for (const b of document.querySelectorAll('#settings .tab')) {
    b.classList.toggle('on', b.dataset.tab === welcher);
    b.setAttribute('aria-selected', b.dataset.tab === welcher ? 'true' : 'false');
  }
  for (const k of document.querySelectorAll('#settings .tabbody')) {
    k.hidden = k.dataset.tab !== welcher;
  }
}

for (const b of document.querySelectorAll('#settings .tab')) {
  b.addEventListener('click', () => pickTab(b.dataset.tab));
}

/* The language picker.

   The names stand in their own language — "Deutsch", not "German". Anyone
   looking for their language recognises it that way even when the interface is
   currently in one they cannot read. That is exactly the situation the picker
   exists for.

   Switching needs no reload: the table is fetched and the markup translated
   again. Anything already rendered from JavaScript is redrawn by the next
   state update, which arrives once a second. */
async function fillLanguages() {
  const sel = $('#langSel');
  if (!sel.options.length) {
    for (const l of LANGUAGES) {
      const o = document.createElement('option');
      o.value = l;
      // The name is written in the language itself — hence out of its table.
      o.textContent = l === language ? tr('_meta.name') : NAMES[l] || l;
      sel.appendChild(o);
    }
  }
  sel.value = language;
  plxrUI.replaceSelects();
}

// Short enough to keep here: a second request per language just for the
// display name would be effort without return.
const NAMES = { en: 'English', de: 'Deutsch' };

$('#langSel').addEventListener('change', async (e) => {
  const gewuenscht = e.target.value;
  try { localStorage.setItem('plxr.lang', gewuenscht); } catch {}
  await loadLanguage(gewuenscht);
  translateMarkup();
  // Whatever came out of JavaScript is redrawn by the next state update; the
  // views that load on demand are nudged here.
  refreshView();
  showHookStatus();
});

/* ═════════════════════════ Adjusting the style ═════════════════════════

   Picking a theme is not enough — you want to nudge the colour until it is
   right. Changes take effect at once so you can see what you are doing; saving
   happens on request, as an own theme alongside the shipped ones. */

const STYLE_COLORS = [
  ['bg', 'Hintergrund'], ['fg', 'Text'], ['dim', tr('style.dim')],
  ['accent', 'Hervorhebung'], ['panel', tr('style.panel')], ['line', 'Linien'],
  ['working', 'arbeitet'], ['waiting', 'waiting'],
  ['blocked', tr('state.needsYou')], ['dead', 'beendet'],
  ['term-bg', 'Terminal Hintergrund'], ['term-fg', 'Terminal Text'],
];

const styleState = { changes: {}, pickers: {}, fontSize: 0, termSize: 0 };

function buildStyleEditor() {
  const box = $('#styleEditor');
  // Already built: only refresh the values. Otherwise the swatches keep showing
  // the old colours after a theme change.
  if (box.children.length) {
    for (const [key] of STYLE_COLORS) styleState.pickers[key]?.set(currentColor(key));
    return;
  }

  for (const [key, name] of STYLE_COLORS) {
    const row = document.createElement('div');
    row.className = 'styleRow';
    row.innerHTML = '<span class="styleName"></span><input class="farbwert" hidden>';
    row.querySelector('.styleName').textContent = name;
    const field = row.querySelector('.farbwert');
    field.value = currentColor(key);
    box.appendChild(row);
    styleState.pickers[key] = plxrUI.colorPicker(field, (color) => {
      styleState.changes[key] = color;
      document.documentElement.style.setProperty('--' + key, color);
      if (key.startsWith('term-')) forEachPane((p) => { p.term.options.theme = xtermTheme(); });
    });
  }

  box.appendChild(numberRow(tr('style.fontUi'), 'fontSize', 11, 28, () => {
    document.documentElement.style.setProperty('--size', styleState.fontSize + 'px');
  }));
  box.appendChild(numberRow(tr('style.fontTerm'), 'termSize', 9, 24, () => {
    forEachPane((p) => { p.term.options.fontSize = styleState.termSize; paneRefit(p); });
  }));
  box.appendChild(toggleRow('Zeilenraster', 'scan'));
  box.appendChild(toggleRow('Schimmer', 'glow'));
}

// The current value of a colour: our own change first, then whatever applies.
function currentColor(key) {
  if (styleState.changes[key]) return styleState.changes[key];
  const value = cssVar(key, '');
  return /^#[0-9a-f]{6}$/i.test(value) ? value : rgbToHex(value) || '#888888';
}

function rgbToHex(value) {
  const m = /rgba?\(([^)]+)\)/.exec(value);
  if (!m) return null;
  const [r, g, b] = m[1].split(',').map((x) => parseInt(x.trim(), 10));
  return '#' + [r, g, b].map((n) => (n || 0).toString(16).padStart(2, '0')).join('');
}

function numberRow(name, field, min, max, anwenden) {
  const row = document.createElement('div');
  row.className = 'styleRow';
  row.innerHTML = '<span class="styleName"></span>' +
    '<span class="styleNumber"><button type="button" data-r="-">−</button><span></span>' +
    '<button type="button" data-r="+">+</button></span>';
  row.querySelector('.styleName').textContent = name;
  const readout = row.querySelector('.styleNumber span');

  const now = () => styleState[field] || (field === 'fontSize'
    ? parseFloat(getComputedStyle(document.body).fontSize)
    : (paneList()[0]?.term.options.fontSize || 13));

  const show = () => { readout.textContent = Math.round(now()); };
  for (const b of row.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      const fresh = Math.min(max, Math.max(min, Math.round(now()) + (b.dataset.r === '+' ? 1 : -1)));
      styleState[field] = fresh;
      anwenden();
      show();
    });
  }
  show();
  return row;
}

function toggleRow(name, welcher) {
  const row = document.createElement('div');
  row.className = 'styleRow';
  row.innerHTML = '<span class="styleName"></span><button type="button" class="styleToggle"></button>';
  row.querySelector('.styleName').textContent = name;
  const button = row.querySelector('.styleToggle');
  const lesen = () => document.documentElement.dataset[welcher] !== 'off';
  const show = () => {
    button.dataset.on = lesen() ? 'yes' : 'no';
    button.textContent = lesen() ? tr('common.on') : tr('common.off');
  };
  button.addEventListener('click', () => {
    document.documentElement.dataset[welcher] = lesen() ? 'off' : 'on';
    show();
  });
  show();
  return row;
}

const forEachPane = (fn) => { for (const p of paneList()) { try { fn(p); } catch {} } };

$('#styleReset').addEventListener('click', () => {
  styleState.changes = {};
  styleState.fontSize = 0;
  styleState.termSize = 0;
  document.documentElement.style.cssText = '';
  applyTheme(currentTheme());
  $('#styleEditor').innerHTML = '';
  setTimeout(buildStyleEditor, 300);
});

$('#styleSave').addEventListener('click', async () => {
  const base = currentTheme();
  const name = await plxrUI.prompt(
    tr('theme.nameAsk'),
    tr('theme.saveOwnTitle'), (base?.name || tr('theme.ownBase')) + tr('theme.ownSuffix'));
  if (!name) return;

  const clean = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const palette = { ...(base?.palette || {}) };
  for (const [k, v] of Object.entries(styleState.changes)) {
    if (!k.startsWith('_')) palette[k] = v;
  }

  const theme = {
    name: clean,
    label: name,
    skin: base?.skin || 'crt',
    palette,
    scanlines: document.documentElement.dataset.scan !== 'off',
    glow: document.documentElement.dataset.glow !== 'off',
  };
  if (styleState.fontSize) theme.fontSize = styleState.fontSize;
  if (styleState.termSize) theme.termSize = styleState.termSize;

  try {
    await api.themeImport(JSON.stringify(theme));
    await loadThemes(clean);
    styleState.changes = {};
    plxrUI.notice(tr('theme.saved', { name }), tr('theme.savedTitle'));
  } catch (e) {
    plxrUI.notice(errText(e), tr('common.notSaved'));
  }
});
$('#settingsClose').addEventListener('click', () => { $('#settings').hidden = true; });

async function showHookStatus() {
  try {
    const st = await api.hookStatus();
    hookInstalled = !!st.installed;
    const several = (st.accounts || 1) > 1 ? tr('hook.accountCount', { n: st.accounts }) : '';
    $('#hookHint').textContent = st.installed
      ? tr('hook.connectedHint', { accounts: several })
      : st.missing?.length
        ? tr('hook.missingHint', { missing: st.missing.join(', ') })
        : tr('hook.notConnected');
    $('#hookBtn').textContent = st.installed ? tr('hook.detach') : tr('hook.attach');
    $('#hookBtn').dataset.on = st.installed ? 'yes' : 'no';
  } catch {
    $('#hookHint').textContent = tr('hook.unknown');
    $('#hookBtn').textContent = tr('hook.attach');
  }
}

$('#hookBtn').addEventListener('click', async () => {
  const an = $('#hookBtn').dataset.on === 'yes';
  try {
    await api.setHook(!an);
    await showHookStatus();
    plxrUI.notice(
      an ? tr('hook.removed')
         : tr('hook.installed'),
      'Claude Code');
  } catch (e) {
    plxrUI.notice(errText(e), tr('err.notChanged'));
  }
});

$('#themeImportBtn').addEventListener('click', () => $('#themeFile').click());
$('#themeFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const t = await api.themeImport(await f.text());
    await loadThemes(t.name);
  } catch (err) {
    plxrUI.notice(errText(err), tr('theme.rejected'));
  }
  e.target.value = '';
});

/* ═════════════════════════ Ansichten ═════════════════════════ */

/* One place decides what is visible. This used to be scattered across several
   functions and regularly drifted apart. */
const ANSICHTEN = [
  ['#railInbox', '#viewInbox'],
  ['#railPorts', '#viewPorts'],
  ['#railUsage', '#viewUsage'],
  ['#railArchive', '#viewArchive'],
];

const noSpecialView = () => ANSICHTEN.every(([, v]) => $(v).hidden);

function showOnly(welche) {
  for (const [, v] of ANSICHTEN) $(v).hidden = true;
  $('#viewSession').hidden = true;
  $('#viewGrid').hidden = true;
  $('#empty').hidden = true;
  if (welche) $(welche).hidden = false;
}

function showGrid() {
  closeAllPanes();
  showOnly(null);
  $('#viewGrid').hidden = state.tiles.length === 0;
  $('#empty').hidden = state.tiles.length > 0;
  renderRail();
}
$('#railHome').addEventListener('click', showGrid);

/* If the daemon does not answer, the view should say so. An unhandled
   exception instead leaves "reading …" standing — that looks like a hang, and
   you cannot tell whether to keep waiting. */
async function loadView(box, info, load) {
  try {
    await load();
  } catch (e) {
    if (info) $(info).textContent = '';
    showEmpty($(box), tr('view.unreachable'),
      tr('view.unreachableHint'));
  }
}

async function showArchive() {
  closeAllPanes();
  showOnly('#viewArchive');
  renderRail();
  await loadView('#archList', '#archInfo', loadArchive);
}
$('#railArchive').addEventListener('click', showArchive);

/* ═════════════════════════ Inbox ═════════════════════════

   The reason plxr exists: eight agents running, three waiting for an answer,
   and no way to tell which. Here they all stand with their question — answer,
   move to the next, without opening a single session. */

const QUICK_REPLIES = [
  { text: '1', label: '1' },
  { text: '2', label: '2' },
  { text: 'y', label: 'y' },
  { text: 'n', label: 'n' },
  { text: '', label: 'Eingabe' },   // just confirm
  { text: '\u001b', label: 'Esc' },
];

/* The buttons read "1 / 2 / y / n". What was behind the 2 stood three lines
   above — you had to read the question to know what you were pressing. But the
   choice lines are in the detected question text; from there they can be cut
   out and written onto the buttons.

   The shapes matched are the ones the CLIs actually use: "1) red", "2. No",
   "❯ 1. Yes" — with or without a selection marker in front. */
const OPTION_LINE = /^[\s>❯▶*·-]*(\d{1,2})\s*[).:\]]\s+(.{1,60}?)\s*$/;

function optionsFrom(confirm) {
  if (!confirm) return null;
  const out = [];
  const seen = new Set();
  for (const row of String(confirm).split('\n')) {
    const m = OPTION_LINE.exec(row);
    if (!m) continue;
    const [, key, text] = m;
    if (seen.has(key)) continue;           // the same digit only once
    seen.add(key);
    out.push({ text: key, label: `${key} · ${shorten(text)}` });
    if (out.length >= 5) break;            // more does not fit on a card
  }
  // A single digit is not a choice but usually a line number.
  return out.length >= 2 ? out : null;
}

// An option text can be a whole explanation — on the button the start is what counts.
function shorten(t) {
  const clean = t.replace(/\s+/g, ' ').trim();
  return clean.length > 22 ? clean.slice(0, 21) + '…' : clean;
}

/* Yes/no questions carry no numbers but have the same problem: "y" does not
   say to what. */
function yesNoFrom(confirm) {
  if (!/\(y\/n\)|\[y\/N\]|\[Y\/n\]/i.test(confirm || '')) return null;
  return [
    { text: 'y', label: 'y · ja' },
    { text: 'n', label: 'n · nein' },
  ];
}

function quickRepliesFor(confirm) {
  const eigene = optionsFrom(confirm) || yesNoFrom(confirm);
  if (!eigene) return QUICK_REPLIES;
  // Confirm and cancel always belong.
  return [...eigene,
    { text: '', label: 'Eingabe' },
    { text: '\u001b', label: 'Esc' }];
}

async function showInbox() {
  showOnly('#viewInbox');
  renderRail();
  renderInbox();
}
$('#railInbox').addEventListener('click', showInbox);
$('#inboxReload').addEventListener('click', () => renderInbox());

function waitingSessions() {
  return state.tiles.filter((t) => t.alive && t.status === 'permission');
}

/* Group identical questions.

   Eight agents in the same monorepo get the same question — "Do you want to
   proceed?" eight times below one another. You answer it eight times
   identically and read it not once to the end.

   Only WORD-FOR-WORD identical questions are grouped. Measuring similarity
   would be an invitation to an accident: two questions that differ in one file
   name are not the same question, and one bulk answer to the wrong group is
   worse than typing eight times. */
function questionKey(tile) {
  /* tile.question is the pending question as the daemon recognised it. This
     used to read tile.confirm — a field Go never sent: the grouping therefore
     went by the activity text instead of the question, and the card never
     showed the actual question. */
  return (tile.question || tile.activity || '').trim();
}

function inboxGroups(list) {
  const by = new Map();
  for (const tile of list) {
    const q = questionKey(tile);
    // Without a recognised question there is nothing to group — each on its own.
    const key = q ? `q:${q}` : `id:${tile.id}`;
    if (!by.has(key)) by.set(key, { key, question: q, tiles: [] });
    by.get(key).tiles.push(tile);
  }
  return [...by.values()];
}

/* The reply memory.

   Eight agents in the same monorepo ask the same thing all day. You answer it,
   and half an hour later you cannot remember whether you said yes the last two
   times or no. So it stands there before you decide — with a button that sends
   the same thing again.

   Word for word, and only within a day: a decision from last week says nothing
   about today's branch, and an old answer offered with a button would be worse
   than none. */
async function showMemory(box, card, question) {
  let list = [];
  try { list = await api.replies(question); } catch { return; }
  if (!list.length) return;
  // The question may have moved on while this was in flight.
  if (box.dataset.forQuestion !== question) return;

  const seen = new Map();
  for (const r of list) if (!seen.has(r.answer)) seen.set(r.answer, r);

  const head = document.createElement('span');
  head.className = 'memoryHead';
  head.textContent = list.length === 1
    ? tr('memory.once') : tr('memory.times', { n: list.length });
  box.appendChild(head);

  for (const [answer, r] of seen) {
    const b = document.createElement('button');
    b.className = 'btn tiny';
    b.textContent = answer.length > 24 ? answer.slice(0, 23) + '…' : answer;
    b.dataset.tip = tr('memory.againTip', { when: agoText(r.at), what: answer });
    b.addEventListener('click', () => replyAll(card.group.tiles, answer));
    box.appendChild(b);
  }
  box.hidden = false;
}

function renderInbox() {
  const list = waitingSessions();
  const box = $('#inboxBody');
  $('#inboxInfo').textContent =
    list.length ? tr(list.length === 1 ? 'inbox.oneWaiting' : 'inbox.nWaiting', { n: list.length }) : '';

  if (!list.length) {
    showEmpty(box, tr('inbox.nobody'),
      tr('inbox.emptyHint'));
    return;
  }

  // Update existing cards rather than rebuilding them, otherwise the reply
  // field loses focus and what was typed on every tick.
  const seen = new Set();
  for (const group of inboxGroups(list)) {
    seen.add(group.key);
    let card = box.querySelector(`[data-id="${CSS.escape(group.key)}"]`);
    if (!card) {
      card = document.createElement('div');
      card.className = 'inboxCard';
      card.dataset.id = group.key;
      card.innerHTML =
        '<div class="inboxHead"><span class="dot permission">◉</span>' +
        '<b class="inboxName"></b><span class="inboxCount"></span>' +
        '<span class="inboxPath"></span>' +
        `<button class="btn tiny" data-t="oeffnen">${tr('inbox.open')}</button></div>` +
        '<pre class="inboxQuestion"></pre>' +
        '<div class="inboxMemory" hidden></div>' +
        '<div class="inboxReply"><input spellcheck="false"><span class="inboxQuick"></span></div>';

      /* The group is read off the card, never out of this closure: the card
         outlives the tick, the group is rebuilt every second. A click a minute
         from now must reach the sessions waiting then, not the ones that were
         waiting when the card was built. */
      card.querySelector('[data-t="oeffnen"]').addEventListener(
        'click', () => openSession(card.group.tiles[0].id));

      const field = card.querySelector('.inboxReply input');
      field.placeholder = tr('inbox.replyPlaceholder');
      field.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const text = field.value;
        field.value = '';
        await replyAll(card.group.tiles, text);
      });

      box.appendChild(card);
    }
    card.group = group;

    const first = group.tiles[0];
    const many = group.tiles.length > 1;
    card.querySelector('.inboxName').textContent = many
      ? tr('inbox.groupName')
      : (first.title || first.name);
    const count = card.querySelector('.inboxCount');
    count.textContent = many ? tr('inbox.groupCount', { n: group.tiles.length }) : '';
    count.hidden = !many;
    card.querySelector('.inboxPath').textContent = many
      ? group.tiles.map((k) => k.title || k.name).join('  ·  ')
      : [first.project, first.agent_label].filter(Boolean).join('  ·  ');

    const confirm = card.querySelector('.inboxQuestion');
    const fresh = group.question || tr('inbox.noQuestion');
    if (confirm.textContent !== fresh) confirm.textContent = fresh;

    /* Only rebuild when the question changed: the card refreshes every second,
       and anyone aiming at a button should not lose it from under the
       pointer. */
    /* What was answered to exactly this question before.
       Asked only when the question changes: the card refreshes every second,
       and a request per card per tick would be a request per second for
       nothing. */
    const memory = card.querySelector('.inboxMemory');
    if (memory.dataset.forQuestion !== fresh) {
      memory.dataset.forQuestion = fresh;
      memory.hidden = true;
      memory.innerHTML = '';
      if (group.question) showMemory(memory, card, group.question);
    }

    const quick = card.querySelector('.inboxQuick');
    if (quick.dataset.fuer !== fresh) {
      quick.dataset.fuer = fresh;
      quick.innerHTML = '';
      for (const a of quickRepliesFor(group.question)) {
        const b = document.createElement('button');
        b.textContent = a.label;
        b.dataset.tip = a.text === '\u001b'
          ? tr('inbox.sendEscape')
          : tr('inbox.sendTip', { what: a.text || tr('inbox.enterKey') });
        b.addEventListener('click', () => replyAll(card.group.tiles, a.text, a.text === '\u001b'));
        quick.appendChild(b);
      }
    }
  }
  for (const el of [...box.querySelectorAll('.inboxCard')]) {
    if (!seen.has(el.dataset.id)) el.remove();
  }
}

/* One answer to every session in a group.

   One after another rather than all at once: writing to eight terminals in the
   same millisecond is nothing a shell expects, and the gain would be
   unmeasurable. A failure on one does not abort the rest — otherwise half of
   them would keep hanging and you would not know which half. */
async function replyAll(tiles, text, raw) {
  const failed = [];
  for (const tile of tiles) {
    try {
      await api.sendReply(tile.id, text, raw);
    } catch (e) {
      failed.push(`${tile.title || tile.name}: ${errText(e)}`);
    }
  }
  if (failed.length) plxrUI.notice(failed.join('\n'), tr('inbox.notSent'));
  // Wait a moment, then read again: the session needs a beat before it
  // changes its status.
  setTimeout(() => { if (!$('#viewInbox').hidden) renderInbox(); }, 900);
}

async function showPorts() {
  closeAllPanes();
  showOnly('#viewPorts');
  renderRail();
  await loadView('#portsList', '#portsInfo', loadPorts);
}
$('#railPorts').addEventListener('click', showPorts);

async function showUsage() {
  closeAllPanes();
  showOnly('#viewUsage');
  renderRail();
  await loadView('#usageBody', '#usageInfo', loadUsage);
}
$('#railUsage').addEventListener('click', showUsage);

/* ═════════════════════════ Schiene ═════════════════════════ */

const GLYPHS = { working: '●', waiting: '○', permission: '◉', dead: '✕', unknown: '·', frozen: '❙❙' };
const WORD = {
  working: 'arbeitet', waiting: 'waiting', permission: tr('state.needsYou'),
  dead: 'beendet', unknown: tr('state.running'),
};

/* Orphaned is not a status from the daemon but a note: the session was still
   running when the daemon ended. For display it counts as one all the same. */
/* Frozen beats any reported status. A stopped session writes nothing more —
   the hook keeps reporting "working", the quiet heuristic eventually says
   "unknown", and both would be a lie. */
const tileState = (t) =>
  t.frozen ? 'frozen' : (t.orphaned ? 'orphaned' : (t.status || 'unknown'));
const ZEICHEN_VERWAIST = '⚠';

/* Crest — one glyph per working directory.

   Eleven tiles, six worktrees of the same monorepo: the titles all truncate the
   same way, and you read three times before finding the right one. A glyph the
   eye finds without reading.

   Computed, not assigned: the same path always yields the same glyph, on every
   machine, without a mapping having to be maintained anywhere.

   The glyphs come from the skin, not from here. A skin is a whole visual
   language — win95 draws differently from sketch — and a new skin should be
   able to bring its own without JavaScript knowing about it. */
const CREST_FALLBACK = '◆●■▲▼◗◖✦✚✳❖⬢⬣◈☗♦⌘';

let crestGlyphs = null;
function crestGlyphSet() {
  // Re-read after every skin change: setSkin clears this.
  if (crestGlyphs) return crestGlyphs;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--crest').trim();
  // The value arrives as a CSS string, so in quotes.
  const clean = raw.replace(/^["']|["']$/g, '');
  crestGlyphs = [...(clean || CREST_FALLBACK)];
  return crestGlyphs;
}

/* A small, evenly spreading hash (FNV-1a). This is not about security but
   about two neighbouring paths — app/web and app/web2 — not ending up with the
   same glyph. */
function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function crest(path) {
  if (!path) return '';
  const glyph = crestGlyphSet();
  return glyph[hash32(path) % glyph.length];
}

/* The colour comes from the same hash but from a different part of it —
   otherwise identical glyphs would always carry the same colour and the second
   cue would be no cue at all. */
function crestHue(path) {
  if (!path) return '';
  return `hsl(${(hash32(path + '#ton') % 360)} 60% 60%)`;
}

/* The rail is the reason a session is not a full-screen overlay: whoever is
   inside one session should still see when somebody elsewhere is stuck. */
function renderRail() {
  const list = $('#railList');
  const groups = new Map();
  for (const t of state.tiles) {
    const k = t.project || '—';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }

  const erwartet = [...groups.keys()].map((k) => 'g:' + k)
    .concat(state.tiles.map((t) => 's:' + t.id));

  for (const [projekt, entries] of groups) {
    const headerKey = 'g:' + projekt;
    let kopf = list.querySelector(`[data-key="${CSS.escape(headerKey)}"]`);
    if (!kopf) {
      kopf = document.createElement('div');
      kopf.className = 'railgroup';
      kopf.dataset.key = headerKey;
      list.appendChild(kopf);
    }
    kopf.textContent = projekt;

    // Insert backwards so the order within the group comes out right.
    for (const t of [...entries].reverse()) {
      const key = 's:' + t.id;
      let el = list.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (!el) {
        el = document.createElement('button');
        el.className = 'railitem';
        el.dataset.key = key;
        el.dataset.id = t.id;
        el.innerHTML =
          '<span class="rdot dot"></span>' +
          '<span class="crest"></span>' +
          '<span class="rtext"><span class="rname"></span><span class="rsub"></span></span>';
        el.addEventListener('click', (ev) => {
          // With Alt or Meta held the session opens alongside instead of
          // replacing the existing one.
          if (ev.altKey || ev.metaKey) addPane(t.id);
          else openSession(t.id);
        });
      }
      kopf.after(el);

      const st = tileState(t);
      el.dataset.status = st;
      el.classList.toggle('active', state.panes.includes(t.id));
      const punkt = el.querySelector('.rdot');
      punkt.className = 'rdot dot ' + st;
      punkt.textContent = t.orphaned ? ZEICHEN_VERWAIST : (GLYPHS[st] || '·');
      const rw = el.querySelector('.crest');
      rw.textContent = crest(t.cwd);
      rw.style.color = crestHue(t.cwd);
      el.querySelector('.rname').textContent = t.title || t.name || t.id.slice(0, 8);
      el.querySelector('.rsub').textContent = t.orphaned
        ? tr('state.crashed')
        : [t.alive ? WORD[st] : tr('state.ended'), t.agent].filter(Boolean).join(' · ');
      el.dataset.tip = `${t.name} — ${t.cwd}`;
    }
  }

  for (const el of [...list.children]) {
    if (!erwartet.includes(el.dataset.key)) el.remove();
  }

  for (const [button, view] of ANSICHTEN) $(button).classList.toggle('active', !$(view).hidden);
  $('#railHome').classList.toggle('active', !state.panes.length && noSpecialView());
}

/* ═════════════════════════ Kachelraster ═════════════════════════ */

const ctxShort = (n) => (!n ? '' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));

function agoText(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h';
}

/* Is the session running with permission prompts skipped? Then it no longer
   asks before doing something — and that should be visible without reading the
   command line. The start of the flag is matched, so a shorthand or a trailing
   equals sign is caught too. */
function isUntamed(t) {
  return (t.cmd || []).some((a) => /^--dangerously-skip-permissions\b/.test(a));
}

function renderGrid() {
  const raster = $('#viewGrid');
  const seen = new Set();

  for (const t of state.tiles) {
    seen.add(t.id);
    let el = raster.querySelector(`[data-id="${CSS.escape(t.id)}"]`);
    if (!el) {
      el = document.createElement('article');
      el.className = 'tile';
      el.dataset.id = t.id;
      el.innerHTML =
        '<div class="thead"><span class="dot"></span><span class="crest"></span>' +
        '<span class="tname"></span><span class="tproj"></span></div>' +
        '<pre class="tbody"></pre>' +
        '<div class="tfoot"><span class="act"></span><span class="ctx"></span><span class="agent"></span></div>';
      el.addEventListener('click', () => openSession(t.id));
      raster.appendChild(el);
    }
    const st = tileState(t);
    el.dataset.status = st;
    /* Warning coat: a session with permission prompts skipped otherwise looks
       like every other one — four calm borders, one not. */
    el.dataset.untamed = isUntamed(t) ? 'yes' : '';
    const punkt = el.querySelector('.dot');
    punkt.className = 'dot ' + st;
    punkt.textContent = t.orphaned ? ZEICHEN_VERWAIST : (GLYPHS[st] || '·');
    const w = el.querySelector('.crest');
    w.textContent = crest(t.cwd);
    w.style.color = crestHue(t.cwd);
    w.dataset.tip = t.cwd || '';
    el.querySelector('.tname').textContent = t.title || t.name || t.id.slice(0, 8);
    el.querySelector('.tproj').textContent = [t.project, t.branch].filter(Boolean).join(' · ');
    el.querySelector('.tbody').textContent = t.preview || '';
    /* Going in circles beats the activity text. The tile looks healthy in that
       case — green, something scrolling — and that is exactly the state in
       which nobody looks closer. So it has to stand where the activity would
       otherwise be, not somewhere beside it. */
    el.dataset.stuck = t.stuck ? 'yes' : '';
    el.querySelector('.act').textContent = t.orphaned
      ? tr('tile.crashedHint')
      : t.stuck
        ? tr('tile.stuck', { n: t.stuck.runs, files: t.stuck.files.slice(0, 2).join(', ') })
        : (t.alive ? (t.activity || t.last_message || '') : tr('state.ended', { code: t.exit_code }));
    el.querySelector('.agent').textContent = t.agent_label || t.agent || '';
    el.querySelector('.ctx').textContent =
      [t.model?.replace('claude-', ''), t.effort, ctxShort(t.context), agoText(t.since)]
        .filter(Boolean).join(' · ');
  }
  for (const el of [...raster.children]) if (!seen.has(el.dataset.id)) el.remove();

  /* The empty state stands in the markup — .emptybox, right there in
     index.html. I once added a second one here and never saw that it was
     invisible behind the first: the audit only searched the JavaScript.
     What is worth saying is the hook, and that belongs in the box that is
     actually on screen. */
  const hint = $('#emptyHook');
  hint.hidden = hookInstalled !== false || state.tiles.length > 0;
}

// renderAll is the only receiver of the state stream.
function renderAll(tiles) {
  state.tiles = tiles || [];
  const busy = !!state.panes.length || !noSpecialView();

  const running = state.tiles.filter((t) => t.alive).length;
  /* Nothing running, nothing to halt — then the button is not there either.
     Engaged it stays visible, otherwise there would be no way back out. */
  const brake = $('#brake');
  brake.hidden = running === 0 && brake.dataset.on !== 'yes';
  const blocked = state.tiles.filter((t) => t.alive && t.status === 'permission').length;
  const orphaned = state.tiles.filter((t) => t.orphaned).length;
  // A counter on the rail, so that even from inside a session you can see that
  // somebody is waiting.
  const waiting = blocked;
  roomState({ running, blocked, orphaned, total: state.tiles.length });
  $('#inboxCount').textContent = waiting || '';
  $('#railInbox').dataset.status = waiting ? 'permission' : '';
  if (!$('#viewInbox').hidden) renderInbox();
  if (connectionOk) {
    $('#counts').textContent =
      tr(state.tiles.length === 1 ? 'counts.session' : 'counts.sessions', { n: state.tiles.length }) +
      ' · ' + tr(running === 1 ? 'counts.runningOne' : 'counts.running', { n: running }) +
      (blocked ? ` · ${tr('counts.waiting', { n: blocked })}` : '') +
      (orphaned ? ` · ${tr('counts.crashed', { n: orphaned })}` : '');
  }

  renderGrid();
  if (state.active) renderFreezeButton();
  renderRail();
  if (!busy) {
    $('#viewGrid').hidden = state.tiles.length === 0;
    $('#empty').hidden = state.tiles.length > 0;
  }
  // A pane whose session has gone has to go too.
  for (const id of [...state.panes]) {
    if (!state.tiles.some((t) => t.id === id)) closePane(id);
  }
  if (state.panes.length) updateHeader();
}

/* ═════════════════════════ Path completion ═════════════════════════ */

/* Typing a path blind is at the edge of what is reasonable to ask. So every
   path field suggests real subdirectories: arrow keys pick, Tab completes,
   Return accepts. */

function pathComplete(field, onPick) {
  // The list hangs off the body, not the field: otherwise any ancestor with
  // overflow clips it, and the status row lies on top of it.
  const list = document.createElement('div');
  list.className = 'selectList pathList';
  list.hidden = true;
  document.body.appendChild(list);

  const stellen = () => {
    const r = field.getBoundingClientRect();
    list.style.left = r.left + 'px';
    list.style.top = r.bottom + 4 + 'px';
    list.style.minWidth = Math.max(r.width, 380) + 'px';
    // If it no longer fits below, it opens upwards.
    const room = window.innerHeight - r.bottom;
    if (room < 240) {
      list.style.top = 'auto';
      list.style.bottom = window.innerHeight - r.top + 4 + 'px';
    } else {
      list.style.bottom = 'auto';
    }
  };

  let hit = [];
  let picked = -1;
  let timer;

  const shut = () => { list.hidden = true; picked = -1; };

  const render = () => {
    list.innerHTML = '';
    if (!hit.length) { shut(); return; }
    hit.forEach((path, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'selectRow';
      b.textContent = path;
      if (i === picked) b.dataset.picked = 'yes';
      b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(path); });
      list.appendChild(b);
    });
    stellen();
    list.hidden = false;
  };

  const pick = (path) => {
    // Append the separator: the next keystroke then searches inside it.
    field.value = path.endsWith('/') ? path : path + '/';
    shut();
    onPick?.(field.value);
    load();
  };

  const load = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      hit = await api.paths(field.value);
      picked = -1;
      render();
    }, 120);
  };

  field.addEventListener('input', load);
  field.addEventListener('focus', load);
  field.addEventListener('blur', () => setTimeout(shut, 120));

  field.addEventListener('keydown', (e) => {
    if (list.hidden || !hit.length) {
      if (e.key === 'Tab' || e.key === 'ArrowDown') { load(); }
      return;
    }
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      picked = (picked + 1) % hit.length;
      render();
      list.children[picked]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      picked = (picked - 1 + hit.length) % hit.length;
      render();
      list.children[picked]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && picked >= 0) {
      e.preventDefault();
      pick(hit[picked]);
    } else if (e.key === 'Escape') {
      shut();
    }
  });
}

/* The filter only takes effect on confirmation. Filtering while typing means:
   after every character all tiles disappear, because "/Volumes/…/pro" is not a
   directory yet. */
function applyFilter() {
  const filter = $('#pathFilter').value.trim().replace(/\/$/, '');
  if (filter === state.filter) return;
  state.filter = filter;
  localStorage.setItem('plxr.filter', state.filter);
  api.setFilter();
}
$('#pathFilter').addEventListener('change', applyFilter);
$('#pathFilter').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.target.blur(); applyFilter(); }
  if (e.key === 'Escape') { e.target.value = state.filter; e.target.blur(); }
});

/* ═════════════════════════ Terminal panes ═════════════════════════ */

const panes = new Map(); // id -> { term, fit, el, ro }
const paneList = () => [...panes.values()];
const MAX_PANES = 4;

function openSession(id) {
  closeAllPanes();
  addPane(id);
}

function addPane(id) {
  if (panes.has(id)) { paneActivate(id); return; }
  if (state.panes.length >= MAX_PANES) {
    plxrUI.notice(tr('pane.tooMany', { n: MAX_PANES }), tr('pane.tooManyTitle'));
    return;
  }
  const t = state.tiles.find((x) => x.id === id);
  if (!t) return;
  if (t.orphaned) {
    // The daemon ended while the session was running. With Claude Code the
    // conversation lives in the transcript — that is where it carries on.
    plxrUI.confirm(tr('session.resumeAsk', { name: t.name, cwd: t.cwd }), tr('session.resumeTitle'))
      .then(async (ja) => {
        if (!ja) return;
        try {
          const fresh = await api.resume(t.id);
          setTimeout(() => openSession(fresh.id), 700);
        } catch (e) {
          plxrUI.notice(errText(e), tr('archive.notResumed'));
        }
      });
    return;
  }
  if (!t.alive) {
    // A dead PTY has no stream any more — the pane would stay empty.
    plxrUI.notice(
      tr('session.endedHint', { name: t.name, code: t.exit_code }),
      tr('session.inactive'));
    return;
  }

  showOnly(null);
  $('#viewSession').hidden = false;
  $('#rulesPane').hidden = true;
  $('#viewer').hidden = true;

  const el = document.createElement('div');
  el.className = 'pane';
  el.dataset.id = id;
  el.innerHTML = `<span class="panelabel"></span><button class="paneclose" data-tip="${tr('pane.closeTip')}">✕</button><div class="pterm"></div>`;
  el.querySelector('.panelabel').textContent = t.agent_label || t.agent || t.name;
  el.querySelector('.paneclose').addEventListener('click', (ev) => { ev.stopPropagation(); closePane(id); });
  el.addEventListener('mousedown', () => paneActivate(id));
  $('#panes').appendChild(el);

  /* Setting up the terminal. The xterm.js defaults are enough for a toy, not
     for daily work — so every option here is a deliberate one.

     allowProposedApi is required for the Unicode addon; without it emoji and
     CJK characters are half a step too narrow and the cursor drifts out of
     line. macOptionIsMeta turns Alt+key into a meta input, the way shells
     expect. rightClickSelectsWord matches what other terminals do. */
  const term = new Terminal({
    // Theme at construction, not at the next change: otherwise every new
    // session starts in xterm's default colours and only turns amber when the
    // theme happens to be switched. The playback terminal got this right from
    // the start, this one did not.
    theme: xtermTheme(),
    fontFamily: cssVar('term-font', 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'),
    fontSize: styleState.termSize || 13,
    lineHeight: 1.15,
    letterSpacing: 0,
    cursorBlink: true,
    cursorStyle: 'block',
    // Shows which pane has the focus — with four side by side otherwise
    // impossible to tell.
    cursorInactiveStyle: 'outline',
    scrollback: 50000,
    // Required for the Unicode addon and the search decorations.
    allowProposedApi: true,
    macOptionIsMeta: true,
    // Without this nothing can be selected with the mouse in tmux and vim on
    // macOS — the application inside the terminal swallows the mouse events.
    macOptionClickForcesSelection: true,
    rightClickSelectsWord: true,
    scrollSensitivity: 3,
    // Saves the darker skins: foreground colours that are too dark get
    // lightened until they are readable.
    minimumContrastRatio: 4.5,
    // Otherwise xterm draws bold text in the bright colour variant and the
    // skin's palette falls apart.
    drawBoldTextInBrightColors: false,
    theme: xtermTheme(),
  });

  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);

  // Suche im Scrollback.
  const search = new SearchAddon.SearchAddon();
  term.loadAddon(search);

  // Clickable addresses. Without this every URL has to be typed out by hand.
  term.loadAddon(new WebLinksAddon.WebLinksAddon((_, url) => {
    if (api.inWindow) Native.OpenURL?.(url); else window.open(url, '_blank', 'noopener');
  }));

  // Zeichenbreiten nach Unicode 11, inklusive zusammengesetzter Emoji —
  // without it the whole line shifts from the first family emoji onwards.
  try {
    term.loadAddon(new UnicodeGraphemesAddon.UnicodeGraphemesAddon());
    term.unicode.activeVersion = '11';
  } catch {}

  // Serialisation: captures the screen for "copy output" and for restoring
  // it when the panes are rearranged.
  let serial = null;
  try {
    serial = new SerializeAddon.SerializeAddon();
    term.loadAddon(serial);
  } catch {}

  term.open(el.querySelector('.pterm'));

  /* WebGL only after open(). On context loss — when the system switches
     graphics cards, say — the addon has to go, otherwise the pane stays
     black. */
  try {
    const webgl = new WebglAddon.WebglAddon();
    webgl.onContextLoss(() => { try { webgl.dispose(); } catch {} });
    term.loadAddon(webgl);
  } catch {}

  term.onData((d) => api.tippen(id, d));

  /* Keyboard shortcuts inside the terminal.

     The conflict every terminal has to resolve: Ctrl+C is the interrupt
     signal, not "copy". The common answer — iTerm2, Windows Terminal, GNOME —
     is Ctrl+Shift+C for copying, and on macOS Cmd+C, because Cmd is free
     there anyway. Both are bound here.

     Returning false means: xterm.js must NOT send the key to the session. */
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const cmd = e.metaKey && !e.ctrlKey;
    const strgUmschalt = e.ctrlKey && e.shiftKey && !e.metaKey;

    /* Copy and paste.

       On macOS the native Edit menu handles ⌘C and ⌘V — and it does so first,
       because NSMenu takes precedence over everything else. Pasting again
       here would paste twice. So our own handler only takes Ctrl+Shift there,
       and ⌘C/⌘V are left to the system.

       Windows and Linux have no such menu; there Ctrl+Shift is the only
       way. */
    const eigenesKopieren = MAC ? strgUmschalt : (cmd || strgUmschalt);

    if (eigenesKopieren && e.key.toLowerCase() === 'c' && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection()).catch(() => {});
      return false;
    }
    if (eigenesKopieren && e.key.toLowerCase() === 'v') {
      navigator.clipboard.readText().then((t) => t && api.tippen(id, t)).catch(() => {});
      return false;
    }
    if ((cmd || strgUmschalt) && e.key.toLowerCase() === 'a') {
      term.selectAll();
      return false;
    }
    if ((cmd || strgUmschalt) && e.key.toLowerCase() === 'f') { openFind(); return false; }
    if ((cmd || strgUmschalt) && e.key.toLowerCase() === 'k') { term.clear(); return false; }
    return true;
  });

  /* Deliberately NO copy on every selection change.

     X11 has a second buffer for that, the primary selection. macOS and Windows
     do not — there every drag of the mouse would overwrite what the user had
     copied before. ⌘C is enough. */

  const entry = { id, term, fit, search, serial, el };
  panes.set(id, entry);
  state.panes.push(id);

  const refit = () => paneRefit(entry);
  let timer;
  entry.ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(refit, 60); });
  entry.ro.observe(el.querySelector('.pterm'));

  const aufDaten = (daten) => term.write(daten);
  const aufEnde = (reason) => {
    term.write(reason === 'leitung'
      ? `\r\n[plxr] ${tr('pane.lostLine')}\r\n`
      : `\r\n[plxr] ${tr('pane.endedLine')}\r\n`);
  };
  attachments.set(id, { aufDaten, aufEnde, beiNeu: () => term.write('\r\n[plxr] wieder verbunden.\r\n') });
  api.attach(id, aufDaten, aufEnde);
  requestAnimationFrame(() => { refit(); term.focus(); });

  paneActivate(id);
  renderRail();
  loadFileTree(t);
}

/* FitAddon rounds the row count up. If the last row no longer fits the pane it
   sticks out at the bottom and gets clipped — so take one away until it really
   fits. */
function paneRefit(p) {
  try {
    p.fit.fit();
    const kasten = p.el.querySelector('.pterm');
    for (let i = 0; i < 3; i++) {
      const schirm = p.term.element?.querySelector('.xterm-screen');
      if (!schirm || schirm.clientHeight <= kasten.clientHeight) break;
      if (p.term.rows <= 4) break;
      p.term.resize(p.term.cols, p.term.rows - 1);
    }
    api.resize(p.id, p.term.rows, p.term.cols);
  } catch {}
}

function paneActivate(id) {
  // While selecting text mousedown fires constantly — without this guard
  // the file tree rebuilds on every drag.
  if (state.active === id && panes.has(id)) return;
  state.active = id;
  for (const p of paneList()) p.el.dataset.active = p.id === id ? 'yes' : 'no';
  updateHeader();
  const t = state.tiles.find((x) => x.id === id);
  if (t) loadFileTree(t);
}

function closePane(id) {
  const p = panes.get(id);
  if (!p) return;
  api.detach(id);
  attachments.delete(id);
  p.ro?.disconnect();
  p.term.dispose();
  p.el.remove();
  panes.delete(id);
  state.panes = state.panes.filter((x) => x !== id);
  if (state.active === id) state.active = state.panes[0] || null;
  if (!state.panes.length) showGrid();
  else { paneActivate(state.active); for (const q of paneList()) paneRefit(q); }
  renderRail();
}

function closeAllPanes() {
  for (const id of [...state.panes]) {
    const p = panes.get(id);
    if (!p) continue;
    api.detach(id);
    attachments.delete(id);
    p.ro?.disconnect();
    p.term.dispose();
    p.el.remove();
    panes.delete(id);
  }
  state.panes = [];
  state.active = null;
}

function updateHeader() {
  const t = state.tiles.find((x) => x.id === state.active);
  if (!t) return;
  $('#sessTitle').textContent = t.title || t.name;
  $('#sessMeta').textContent = [t.cwd, t.branch].filter(Boolean).join('  ·  ');
  fillAccounts('#sessAccount').then(() => { if (t.account) $('#sessAccount').value = t.account; });
  renderFreezeButton();
}

/* Eine einzelne Session anhalten.

   Der Daemon konnte das von Anfang an — /api/sessions/{id}/freeze steht dort
   seit dem Bau der Notbremse. Nur kam man von der Oberflaeche aus nicht heran:
   verdrahtet war allein die Notbremse fuer alle. Wer einen einzelnen Agenten
   bremsen wollte, musste alle vier anhalten.

   Der Knopf traegt seinen Zustand selbst, weil er zwei Bedeutungen hat und ein
   Knopf, dem man nicht ansieht, was er als naechstes tut, schlimmer ist als
   keiner. */
function frozenNow() {
  const t = state.tiles.find((x) => x.id === state.active);
  return !!t?.frozen;
}

function renderFreezeButton() {
  const b = $('#sessFreeze');
  const t = state.tiles.find((x) => x.id === state.active);
  b.hidden = !t?.alive;
  if (b.hidden) return;
  const on = frozenNow();
  b.textContent = tr(on ? 'session.resume' : 'session.pause');
  b.classList.toggle('on', on);
}

$('#sessFreeze').addEventListener('click', async () => {
  if (!state.active) return;
  try {
    await (frozenNow() ? api.unfreeze(state.active) : api.freeze(state.active));
  } catch (e) {
    plxrUI.notice(errText(e), tr('session.pauseFailed'));
  }
});

$('#sessKill').addEventListener('click', async () => {
  if (!state.active) return;
  const t = state.tiles.find((x) => x.id === state.active);
  if (!(await plxrUI.confirm(t?.name || '', tr('session.killAsk')))) return;
  await api.kill(state.active);
  closePane(state.active);
});

/* ═════════════════════════ Suche im Terminal ═════════════════════════ */

function openFind() {
  if (!state.active) return;
  $('#find').hidden = false;
  $('#findInput').focus();
  $('#findInput').select();
}

function closeFind() {
  $('#find').hidden = true;
  const p = panes.get(state.active);
  try { p?.search.clearDecorations(); } catch {}
  p?.term.focus();
}

/* While typing, search from the start rather than from the last hit.
   Otherwise "err" lands three hits further along than expected. */
function findInTerminal(backwards, vonVorn) {
  const p = panes.get(state.active);
  if (!p) return;
  const q = $('#findInput').value;
  if (!q) { $('#findCount').textContent = ''; try { p.search.clearDecorations(); } catch {} return; }

  // Register the counter the first time this pane needs it.
  if (!p.counterBound) {
    p.counterBound = true;
    try {
      p.search.onDidChangeResults((r) => {
        $('#findCount').textContent = !r || !r.resultCount
          ? tr('find.noHit')
          : tr('find.count', { i: r.resultIndex + 1, n: r.resultCount });
      });
    } catch {}
  }
  /* A new search term starts over: clearDecorations only removes the
     highlights — the starting point for the next hit is the selection in the
     terminal, so that has to go as well. Otherwise a fresh search carries on
     from the middle of the text. */
  if (vonVorn) {
    try { p.search.clearDecorations(); } catch {}
    try { p.term.clearSelection(); } catch {}
  }

  const opt = {
    decorations: {
      // Colours from the skin, so the hits do not sit in the terminal like
      // aussehen.
      matchBackground: cssVar('dim', '#666'),
      activeMatchBackground: cssVar('accent', '#fc0'),
      matchOverviewRuler: cssVar('dim', '#666'),
      activeMatchColorOverviewRuler: cssVar('accent', '#fc0'),
    },
  };
  const gefunden = backwards ? p.search.findPrevious(q, opt) : p.search.findNext(q, opt);
  // The counter arrives through onDidChangeResults; only if that fails to come
  // do we at least say here that there is nothing.
  if (!gefunden) $('#findCount').textContent = tr('find.noHit');
}

$('#findInput').addEventListener('input', () => findInTerminal(false, true));
$('#findInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); findInTerminal(e.shiftKey); }
  if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
$('#findPrev').addEventListener('click', () => findInTerminal(true));
$('#findNext').addEventListener('click', () => findInTerminal(false));
$('#findClose').addEventListener('click', closeFind);

/* ═════════════════════════ Keyboard shortcuts ═════════════════════════

   Deliberately only what has become universal. Cmd+Q, Cmd+M, Cmd+H and moving
   between windows are not intercepted — those belong to the system, and a
   program that swallows them feels wrong. */

/* The KEY, not the text. tr() at this point would run before the language file
   is loaded — the labels would freeze in the English fallback and never follow
   a language change. Nobody noticed, because nothing ever showed them. */
const SHORTCUTS = [
  ['t', () => $('#newBtn').click(),                                  'new.title2'],
  ['w', () => state.active && closePane(state.active),               'pane.closeTip'],
  ['f', () => ($('#viewer').hidden ? openFind() : openFindInFile()), 'key.search'],
  ['.', emergencyBrake,                                              'key.brake'],
  ['d', () => $('#splitAdd').click(),                                'key.split'],
  [',', openSettings,                                                'key.settings'],
  ['0', () => changeFontSize(0),                                     'key.fontReset'],
  ['+', () => changeFontSize(1),                                     'key.fontBigger'],
  ['=', () => changeFontSize(1),                                     'key.fontBigger'],
  ['-', () => changeFontSize(-1),                                    'key.fontSmaller'],
];

/* Show the shortcuts.

   They have had labels from the start and nothing ever showed them — a
   shortcut nobody can find is none. Reachable two ways on purpose: by "?",
   which is what people try, and through a button in the header, because
   whoever does not know the key cannot press it either. */
function showKeys() {
  const box = $('#keysBody');
  box.innerHTML = '';
  const mod = MAC ? '⌘' : 'Strg+Umschalt+';
  const rows = [
    ...SHORTCUTS
      .filter(([k]) => k !== '=')          // same as +, one line is enough
      .map(([k, , key]) => [mod + k, tr(key)]),
    [mod + '1…9', tr('key.session')],
    ['?', tr('key.keys')],
  ];
  for (const [combo, what] of rows) {
    const row = document.createElement('div');
    row.className = 'rrow';
    row.innerHTML = '<span class="rart"></span><span class="rmain"><b class="rtitle"></b></span>';
    row.querySelector('.rart').textContent = combo;
    row.querySelector('.rtitle').textContent = what;
    box.appendChild(row);
  }
  $('#keys').hidden = false;
}

$('#keysBtn').addEventListener('click', showKeys);
$('#keysClose').addEventListener('click', () => { $('#keys').hidden = true; });
// Escape and a click beside it come from DIALOGS — see there.

/* "?" without a modifier — but not while something is being typed into. */
document.addEventListener('keydown', (e) => {
  if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.closest('.xterm'))) return;
  e.preventDefault();
  showKeys();
});

function changeFontSize(dir) {
  const now = styleState.termSize || paneList()[0]?.term.options.fontSize || 13;
  styleState.termSize = dir === 0 ? 13 : Math.min(28, Math.max(8, now + dir));
  forEachPane((p) => { p.term.options.fontSize = styleState.termSize; paneRefit(p); });
}

document.addEventListener('keydown', (e) => {
  const cmd = e.metaKey && !e.ctrlKey && !e.altKey;
  const strgUmschalt = e.ctrlKey && e.shiftKey && !e.metaKey;
  if (!cmd && !strgUmschalt) return;

  // Cmd+1..9 jumps to the session at that position in the rail.
  if (cmd && /^[1-9]$/.test(e.key)) {
    const all = [...$('#railList').querySelectorAll('.railitem[data-id]')];
    const target = all[parseInt(e.key, 10) - 1];
    if (target) { e.preventDefault(); target.click(); }
    return;
  }

  const hit = SHORTCUTS.find(([keyChar]) => keyChar === e.key.toLowerCase());
  if (!hit) return;

  /* Inside an input field the usual editing shortcuts keep working. But note:
     xterm.js keeps the focus on a hidden textarea inside .xterm — without this
     exception EVERY focused terminal counts as an input field, and ⌘T, ⌘W, ⌘D
     and the font size are dead. */
  const el = document.activeElement;
  const imTerminal = !!el?.closest?.('.xterm');
  const inInput = !imTerminal && /^(INPUT|TEXTAREA)$/.test(el?.tagName || '');
  // ⌘F may pass into the editor's text field: there it is the file search.
  const imEditor = el?.id === 'viewerBody';
  if (inInput && e.key !== ',' && !(imEditor && e.key.toLowerCase() === 'f')) return;
  // In the terminal ⌘F is already handled by the xterm handler — otherwise it fires twice.
  if (imTerminal && e.key.toLowerCase() === 'f') return;
  e.preventDefault();
  hit[1]();
});

$('#filesToggle').addEventListener('click', () => {
  const f = $('#files');
  f.hidden = !f.hidden;
  $('#filesToggle').classList.toggle('on', !f.hidden);
  // The viewer needs the width as an attribute, not as a guess.
  $('#files').closest('.sesssplit').dataset.files = f.hidden ? '' : 'open';
  // On opening, the tree has to be loaded: while the panel was closed,
  // loadFileTree did nothing.
  if (!f.hidden) {
    const t = state.tiles.find((x) => x.id === state.active);
    if (t) loadFileTree(t);
  }
  for (const p of paneList()) paneRefit(p);
});

/* Split the pane: put a second session alongside. */
$('#splitAdd').addEventListener('click', () => {
  const frei = state.tiles.filter((t) => !state.panes.includes(t.id));
  if (!frei.length) { plxrUI.notice(tr('split.noOther'), tr('split.nothingToSplit')); return; }
  const box = $('#splitList');
  box.innerHTML = '';
  for (const t of frei) {
    const b = document.createElement('button');
    b.className = 'splitRow';
    b.innerHTML = '<span class="dot"></span><span class="rname"></span>';
    const st = t.status || 'unknown';
    b.querySelector('.dot').className = 'dot ' + st;
    b.querySelector('.dot').textContent = GLYPHS[st] || '·';
    b.querySelector('.rname').textContent = (t.title || t.name) + '  ·  ' + t.project;
    b.addEventListener('click', () => { $('#splitPick').hidden = true; addPane(t.id); });
    box.appendChild(b);
  }
  $('#splitPick').hidden = false;
});
$('#splitCancel').addEventListener('click', () => { $('#splitPick').hidden = true; });

/* Every dialog closes with Escape and with a click beside it. A window that
   only one particular button leads out of is a trap. */
const DIALOGS = ['#settings', '#splitPick', '#templates', '#dialog', '#keys'];
for (const d of DIALOGS) {
  $(d).addEventListener('mousedown', (e) => { if (e.target === $(d)) $(d).hidden = true; });
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const d of DIALOGS) if (!$(d).hidden) { $(d).hidden = true; return; }
  if (!$('#find').hidden) { closeFind(); return; }
  if (!$('#viewer').hidden) { closeViewer(); return; }
  if (!$('#rulesPane').hidden) { rulesShow(false); return; }
  if (state.panes.length) showGrid();
});

window.addEventListener('resize', () => { for (const p of paneList()) paneRefit(p); });

/* A hidden tab receives neither requestAnimationFrame nor callbacks from the
   ResizeObserver — both hang off the rendering step, which Chrome suspends
   there. Opening the UI in a background tab would leave terminals at their
   default size inside a much larger pane. So refit on becoming visible, because
   there is no size change to wake the observer. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  for (const p of paneList()) paneRefit(p);
  // Whoever brings the window forward should see a waiting notice at once.
  checkVersion();
});
window.addEventListener('focus', () => checkVersion());

/* ═════════════════════════ Konten ═════════════════════════ */

let kontenCache = null;

async function fillAccounts(sel) {
  const el = $(sel);
  if (el.options.length) return;
  try {
    kontenCache = kontenCache || await api.accounts();
    for (const k of kontenCache) {
      const o = document.createElement('option');
      o.value = k.name;
      o.textContent = k.label;
      el.appendChild(o);
    }
    plxrUI.replaceSelects();
  } catch {}
}

/* When an allowance has run dry, the same conversation has to carry on under a
   different account. plxr copies the transcript into the target account and
   restarts the session there with --resume. */
$('#sessAccount').addEventListener('change', async (e) => {
  const account = e.target.value;
  const t = state.tiles.find((x) => x.id === state.active);
  if (!t || t.account === account) return;
  const weiter = await plxrUI.confirm(
    tr('session.switchAsk', { account: account }), tr('session.switchTitle'));
  if (!weiter) { e.target.value = t.account || ''; return; }
  try {
    const fresh = await api.switchAccount(state.active, account);
    closePane(state.active);
    setTimeout(() => openSession(fresh.id), 700);
  } catch (err) {
    plxrUI.notice(errText(err), tr('session.switchFailed'));
    e.target.value = t.account || '';
  }
});

/* ═════════════════════════ Dateibaum ═════════════════════════ */

const tree = { showNoise: false };

$('#noiseToggle').addEventListener('click', () => {
  tree.showNoise = !tree.showNoise;
  $('#noiseToggle').classList.toggle('on', tree.showNoise);
  const t = state.tiles.find((x) => x.id === state.active);
  if (t) loadFileTree(t);
});

function fileGlyph(e) {
  if (e.dir) return '';
  const ext = e.name.split('.').pop().toLowerCase();
  if (['go','rs','c','h','cpp','java','rb','py','php'].includes(ext)) return '◈';
  if (['js','ts','tsx','jsx','mjs','vue','svelte'].includes(ext)) return '◆';
  if (['json','yml','yaml','toml','ini','env','conf'].includes(ext)) return '⚙';
  if (['md','txt','rst'].includes(ext)) return '≡';
  if (['css','scss','html'].includes(ext)) return '◐';
  if (['png','jpg','jpeg','gif','svg','webp','ico','woff2'].includes(ext)) return '▨';
  return '·';
}

async function loadFileTree(t) {
  if ($('#files').hidden) return;
  $('#filesRoot').textContent = t.cwd;
  const box = $('#filetree');
  box.innerHTML = '';
  await renderMarkLayer(box, t.cwd, 0, t.id);
}

async function renderMarkLayer(box, dir, tiefe, sid) {
  const entries = await api.folder(sid, dir);
  if (tiefe === 0 && (!entries || !entries.length)) {
    showEmpty(box, tr('file.emptyFolder'), tr('file.nothingHere'));
    return;
  }
  for (const e of entries || []) {
    if (e.noise && !tree.showNoise) continue;

    const row = document.createElement('div');
    row.className = 'frow' + (e.noise ? ' noise' : '');
    row.style.paddingLeft = 8 + tiefe * 13 + 'px';
    row.innerHTML = '<span class="fchev"></span><span class="ficon"></span><span class="fname"></span>';
    row.querySelector('.fchev').textContent = e.dir ? '▸' : '';
    row.querySelector('.ficon').textContent = fileGlyph(e);
    row.querySelector('.fname').textContent = e.name;
    box.appendChild(row);

    if (e.dir) {
      const kinder = document.createElement('div');
      kinder.hidden = true;
      box.appendChild(kinder);
      row.addEventListener('click', async () => {
        if (kinder.hidden && !kinder.dataset.loaded) {
          kinder.dataset.loaded = '1';
          await renderMarkLayer(kinder, e.path, tiefe + 1, sid);
        }
        kinder.hidden = !kinder.hidden;
        row.querySelector('.fchev').textContent = kinder.hidden ? '▸' : '▾';
      });
    } else {
      row.addEventListener('click', () => openFile(e, sid));
    }
  }
}

/* The viewer is an editor too. Saving happens on request only, and the state of
   the file travels along: if somebody else has written in the meantime — an
   agent in this very session, for instance — the daemon refuses rather than
   overwriting the other change. */

const doc = { sid: null, path: null, mod: 0, original: '' };

function setDirty(ja) {
  $('#viewerDirty').hidden = !ja;
  $('#viewerSave').disabled = !ja;
}

async function openFile(e, sid) {
  try {
    const c = await api.file(sid, e.path);
    doc.sid = sid;
    doc.path = c.path;
    doc.mod = c.mod;
    doc.original = c.binary ? '' : c.text;

    $('#viewerName').textContent = e.name;
    $('#viewerMeta').textContent = c.binary
      ? tr('file.binary')
      : tr('file.meta', { lines: c.lines, kb: (c.size / 1024).toFixed(1) }) +
        (c.truncated ? tr('file.truncated') : '');

    const field = $('#viewerBody');
    field.value = doc.original;
    // Truncated means: we do not have the whole file. Saving that would
    // cut off the rest.
    field.readOnly = c.binary || c.truncated;
    $('#viewerSave').hidden = field.readOnly;
    setDirty(false);

    $('#rulesPane').hidden = true;
    $('#viewer').hidden = false;
  } catch (err) {
    plxrUI.notice(errText(err), tr('file.unreadable'));
  }
}

$('#viewerBody').addEventListener('input', () => {
  setDirty($('#viewerBody').value !== doc.original);
});

// Tab belongs in the text, not on the next button.
$('#viewerBody').addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const f = e.target;
  const a = f.selectionStart, b = f.selectionEnd;
  f.value = f.value.slice(0, a) + '\t' + f.value.slice(b);
  f.selectionStart = f.selectionEnd = a + 1;
  setDirty(f.value !== doc.original);
});

async function saveFile() {
  if ($('#viewerSave').hidden || $('#viewerSave').disabled) return;
  const text = $('#viewerBody').value;
  $('#viewerSave').disabled = true;
  try {
    const c = await api.fileWrite(doc.sid, doc.path, text, doc.mod);
    doc.mod = c.mod;
    doc.original = text;
    setDirty(false);
    $('#viewerMeta').textContent = tr('file.metaSaved', { lines: c.lines, kb: (c.size / 1024).toFixed(1) });
  } catch (err) {
    setDirty(true);
    plxrUI.notice(errText(err), tr('common.notSaved'));
  }
}
$('#viewerSave').addEventListener('click', saveFile);

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's' && !$('#viewer').hidden) {
    e.preventDefault();
    saveFile();
  }
});

async function closeViewer() {
  $('#findInFile').hidden = true;
  if (!$('#viewerDirty').hidden) {
    const gone = await plxrUI.confirm(
      tr('file.discardHint', { name: $('#viewerName').textContent }), tr('file.discardAsk'));
    if (!gone) return;
  }
  setDirty(false);
  $('#viewer').hidden = true;
}
$('#viewerClose').addEventListener('click', closeViewer);

/* ── Find inside the file editor ──
   A <textarea> brings no search of its own, and the window has no browser bar
   to step in. So we build one — the same bar as in the terminal, so it looks
   right in every skin without further work. */
const fileFind = { hit: [], index: -1, source: null };

function openFindInFile() {
  const field = $('#findInFileInput');
  const body = $('#viewerBody');
  const markiert = body.value.slice(body.selectionStart, body.selectionEnd);
  if (markiert && !markiert.includes('\n')) field.value = markiert;
  $('#findInFile').hidden = false;
  field.focus();
  field.select();
  editorCollectHits();
}

function closeFindInFile() {
  $('#findInFile').hidden = true;
  $('#viewerMarks').textContent = '';
  fileFind.hit = [];
  fileFind.index = -1;
  fileFind.source = null;
  $('#viewerBody').focus();
}

// All hits at once, otherwise the counter cannot be right.
function editorCollectHits() {
  const text = $('#viewerBody').value;
  const q = $('#findInFileInput').value;
  fileFind.source = text;
  fileFind.hit = [];
  fileFind.index = -1;
  if (q) {
    const heu = text.toLowerCase();
    const nadel = q.toLowerCase();
    for (let i = heu.indexOf(nadel); i !== -1; i = heu.indexOf(nadel, i + nadel.length)) {
      fileFind.hit.push(i);
    }
  }
  editorShowCount();
}

function editorShowCount() {
  const info = $('#findInFileCount');
  if (!$('#findInFileInput').value) { info.textContent = ''; return; }
  if (!fileFind.hit.length) { info.textContent = tr('find.noHit'); return; }
  info.textContent = tr('find.count', { i: Math.max(fileFind.index, 0) + 1, n: fileFind.hit.length });
}

function editorJump(backwards) {
  const body = $('#viewerBody');
  // Typing on with the find field open changes the text under the hits.
  if (body.value !== fileFind.source) editorCollectHits();
  const q = $('#findInFileInput').value;
  if (!q || !fileFind.hit.length) { editorShowCount(); return; }

  if (fileFind.index === -1) {
    // The first jump starts from where the cursor sits.
    const from = body.selectionStart;
    const i = fileFind.hit.findIndex((p) => p >= from);
    fileFind.index = backwards
      ? (i <= 0 ? fileFind.hit.length - 1 : i - 1)
      : (i === -1 ? 0 : i);
  } else {
    const n = fileFind.hit.length;
    fileFind.index = backwards ? (fileFind.index - 1 + n) % n : (fileFind.index + 1) % n;
  }

  const pos = fileFind.hit[fileFind.index];
  body.setSelectionRange(pos, pos + q.length);
  editorScrollTo(pos);
  editorShowCount();
  renderMarks();
}

/* A text field only scrolls to the selection when it has the focus — and the
   find field should keep that. So compute it ourselves: with wrap="off" every
   line of text is exactly one visible line, which works out exactly. */
function editorScrollTo(pos) {
  const body = $('#viewerBody');
  const st = getComputedStyle(body);
  let zh = parseFloat(st.lineHeight);
  if (!Number.isFinite(zh)) zh = parseFloat(st.fontSize) * 1.4;

  const davor = body.value.slice(0, pos);
  const row = davor.length - davor.replaceAll('\n', '').length;
  body.scrollTop = Math.max(0, row * zh - body.clientHeight / 2);

  const col = pos - (davor.lastIndexOf('\n') + 1);
  body.scrollLeft = Math.max(0, col * charWidth(st) - body.clientWidth / 2);
}

let charWidthCache = null;
function charWidth(st) {
  const font = `${st.fontSize} ${st.fontFamily}`;
  if (charWidthCache?.font === font) return charWidthCache.charWidth;
  const c = document.createElement('canvas').getContext('2d');
  c.font = font;
  const charWidth = c.measureText('0').width || parseFloat(st.fontSize) * 0.6;
  charWidthCache = { font, charWidth };
  return charWidth;
}

/* The highlight layer takes font and margins from the text field at runtime:
   every skin sets different values there, and a single pixel of drift shifts
   every highlight against the text below. */
function markLayerGeometry() {
  const st = getComputedStyle($('#viewerBody'));
  const mode = $('#viewerMarks').style;
  for (const eig of ['font', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
                     'letterSpacing', 'wordSpacing', 'tabSize', 'padding', 'margin',
                     'borderWidth', 'textIndent']) {
    mode[eig] = st[eig];
  }
}

const HTML_ZEICHEN = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const htmlSicher = (t) => t.replace(/[&<>]/g, (z) => HTML_ZEICHEN[z]);

// Past a certain size redrawing costs more than the highlight is worth —
// then the counter and the jumping have to do.
const MARK_GRENZE = 2 << 20;

function renderMarks() {
  const body = $('#viewerBody');
  const mode = $('#viewerMarks');
  const q = $('#findInFileInput').value;
  if ($('#findInFile').hidden || !q || !fileFind.hit.length || body.value.length > MARK_GRENZE) {
    mode.textContent = '';
    return;
  }
  markLayerGeometry();
  const text = body.value;
  const parts = [];
  let from = 0;
  fileFind.hit.forEach((p, i) => {
    parts.push(htmlSicher(text.slice(from, p)));
    parts.push(i === fileFind.index ? '<mark class="current">' : '<mark>');
    parts.push(htmlSicher(text.slice(p, p + q.length)), '</mark>');
    from = p + q.length;
  });
  parts.push(htmlSicher(text.slice(from)));
  /* A trailing space: if the file ends with a line break the text field keeps an
     empty line for it, a <div> does not. Without that compensation the two
     layers scroll different distances, and at the end of the file every
     highlight would sit one line too high. */
  parts.push(' ');
  mode.innerHTML = parts.join('');
  markLayerScroll();
}

// Both layers have to show the same section.
function markLayerScroll() {
  const body = $('#viewerBody');
  const mode = $('#viewerMarks');
  mode.scrollTop = body.scrollTop;
  mode.scrollLeft = body.scrollLeft;
}

$('#viewerBody').addEventListener('scroll', markLayerScroll);
$('#viewerBody').addEventListener('input', () => {
  if (!$('#findInFile').hidden) { editorCollectHits(); renderMarks(); }
});
$('#findInFileInput').addEventListener('input', () => { editorCollectHits(); editorJump(false); });
$('#findInFileInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); editorJump(e.shiftKey); }
  else if (e.key === 'Escape') { e.preventDefault(); closeFindInFile(); }
});
$('#findInFilePrev').addEventListener('click', () => editorJump(true));
$('#findInFileNext').addEventListener('click', () => editorJump(false));
$('#findInFileClose').addEventListener('click', closeFindInFile);

/* ═════════════════════════ Playback ═════════════════════════

   Watching a session like a video, including one that no longer exists.

   Nothing is parsed for this: the recording IS the byte stream that went over
   the terminal. A terminal emulator reproduces it exactly, colours and redrawn
   full screens included. The pace comes from the timeline beside it.

   xterm cannot seek backwards — there is no rewind. So the fetched stream stays
   in memory: a jump resets the terminal and writes everything up to the target
   in one go. At the eight megabytes a request delivers at most, that takes a
   fraction of a second. */

const player = {
  term: null,
  fit: null,
  data: null,       // Uint8Array of the stream
  marks: [],        // [{offset, at}]
  pos: 0,           // how much has been written so far
  running: false,
  pace: 1,
  skipIdle: true,
  timer: null,
  id: null,
  truncated: false,
};

const PLAYER_SPEEDS = [1, 2, 4, 8];
// From when on a gap gets skipped. Below this it is barely noticeable, above
// it you watch nothing happen for minutes.
const PLAYER_IDLE_GAP = 1200;
// And what it gets cut down to, so the seam does not feel abrupt.
const PLAYER_IDLE_KEEP = 300;

async function openPlayer(id, name, abOffset) {
  const field = $('#player');
  field.hidden = false;
  $('#playerName').textContent = name || id.slice(0, 8);
  $('#playerMeta').textContent = tr('common.loading');

  if (!player.term) {
    player.term = new Terminal({
      // Without this a keystroke would try to type into a recording.
      disableStdin: true,
      cursorBlink: false,
      fontFamily: cssVar('term-font', 'ui-monospace, monospace'),
      fontSize: styleState.termSize || 13,
      theme: xtermTheme(),
      scrollback: 5000,
    });
    player.fit = new FitAddon.FitAddon();
    player.term.loadAddon(player.fit);
    player.term.open($('#playerTerm'));
  }
  player.term.reset();
  try { player.fit.fit(); } catch {}

  try {
    const [strom, marken] = await Promise.all([
      api.playback(id),
      api.timeline(id),
    ]);
    player.data = strom.data;
    player.truncated = strom.truncated;
    player.marks = marken;
  } catch (e) {
    $('#playerMeta').textContent = '';
    closePlayer();
    plxrUI.notice(errText(e), tr('player.noRecording'));
    return;
  }

  player.pos = 0;
  $('#playerSeek').value = 0;
  playerShowPosition();

  // Coming from a search hit: straight to the spot.
  if (abOffset > 0) playerSeek(Math.min(abOffset, player.data.length));
  playerPlay(true);
}

function closePlayer() {
  playerPause();
  $('#player').hidden = true;
  player.data = null;
  player.marks = [];
}

/* How much time passed between two points in the stream. Without a timeline —
   a recording from before it existed — playback runs at a constant rate. */
function playerGap(vonOffset, bisOffset) {
  if (!player.marks.length) return 16;   // roughly one frame
  let a = null, b = null;
  for (const m of player.marks) {
    if (m.offset <= vonOffset) a = m;
    if (m.offset <= bisOffset) b = m;
  }
  if (!a || !b) return 16;
  return Math.max(0, b.at - a.at);
}

// The next mark past the current position — everything up to there is written
// geschrieben, danach gewartet.
function playerNextMark(pos) {
  for (const m of player.marks) if (m.offset > pos) return m.offset;
  return player.data ? player.data.length : pos;
}

function playerStep() {
  if (!player.running || !player.data) return;
  if (player.pos >= player.data.length) { playerPause(); return; }

  const bis = Math.min(playerNextMark(player.pos), player.data.length);
  player.term.write(player.data.subarray(player.pos, bis));
  const vorher = player.pos;
  player.pos = bis;
  playerShowPosition();

  let warten = playerGap(vorher, bis) / player.pace;
  if (player.skipIdle && warten > PLAYER_IDLE_GAP) warten = PLAYER_IDLE_KEEP;
  player.timer = setTimeout(playerStep, Math.max(0, warten));
}

function playerPlay(an) {
  player.running = an;
  $('#playerPlay').textContent = an ? '❙❙' : '▶';
  clearTimeout(player.timer);
  if (an) playerStep();
}

function playerPause() {
  player.running = false;
  clearTimeout(player.timer);
  $('#playerPlay').textContent = '▶';
}

/* Seeking. xterm cannot rewind, so start over: clear the terminal and write
   everything up to the target in one go. */
function playerSeek(target) {
  if (!player.data) return;
  const lief = player.running;
  playerPause();
  player.term.reset();
  player.pos = Math.max(0, Math.min(target, player.data.length));
  if (player.pos > 0) player.term.write(player.data.subarray(0, player.pos));
  playerShowPosition();
  if (lief) playerPlay(true);
}

function playerShowPosition() {
  if (!player.data) return;
  const anteil = player.data.length ? player.pos / player.data.length : 0;
  const regler = $('#playerSeek');
  // Do not set it while it is being dragged.
  if (document.activeElement !== regler) regler.value = Math.round(anteil * 1000);

  const gesamt = player.marks.length > 1
    ? (player.marks[player.marks.length - 1].at - player.marks[0].at) / 1000
    : 0;
  $('#playerTime').textContent = gesamt
    ? `${playerClock(gesamt * anteil)} / ${playerClock(gesamt)}`
    : `${Math.round(anteil * 100)} %`;
  $('#playerMeta').textContent = player.truncated
    ? tr('player.cut')
    : (player.marks.length ? '' : tr('player.noTimeline'));
}

const playerClock = (sek) => {
  const m = Math.floor(sek / 60), s = Math.floor(sek % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

$('#playerClose').addEventListener('click', closePlayer);
$('#playerPlay').addEventListener('click', () => playerPlay(!player.running));
$('#playerSeek').addEventListener('input', (e) => {
  if (!player.data) return;
  playerSeek(Math.round((e.target.value / 1000) * player.data.length));
});
$('#playerSpeed').addEventListener('click', () => {
  const i = (PLAYER_SPEEDS.indexOf(player.pace) + 1) % PLAYER_SPEEDS.length;
  player.pace = PLAYER_SPEEDS[i];
  $('#playerSpeed').textContent = `${player.pace}×`;
});
$('#playerSkipIdle').addEventListener('click', () => {
  player.skipIdle = !player.skipIdle;
  $('#playerSkipIdle').dataset.on = player.skipIdle ? 'yes' : '';
});
document.addEventListener('keydown', (e) => {
  if ($('#player').hidden) return;
  if (e.key === ' ') { e.preventDefault(); playerPlay(!player.running); }
  if (e.key === 'Escape') { e.preventDefault(); closePlayer(); }
}, true);

/* ═════════════════════════ Agentenprofile ═════════════════════════

   A profile teaches plxr to recognise a CLI: which command it is, when it is
   waiting, when it is working. Profiles of your own could be dropped into
   ~/.plxr/agents from the very beginning — and nothing ever said so. A
   mechanism nobody can find does not exist.

   What matters as much as the editor: the path afterwards. Saving a profile
   and being left to wonder whether it did anything would be the same mistake
   again. So the list says which running session uses which profile, and after
   saving it says what the profile now applies to — or plainly that no running
   session matches it. */

let agentEditing = null;

function agentUsers(name) {
  return state.tiles.filter((t) => t.alive && (t.agent || 'generic') === name);
}

async function renderAgents() {
  let list = [];
  try { list = await api.agents(); } catch { return; }
  const box = $('#agentList');
  box.innerHTML = '';
  for (const a of list) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'splitRow';
    row.innerHTML = '<span class="rart"></span><span class="rmain">' +
      '<b class="rtitle"></b><span class="rdesc"></span></span><span class="rpath"></span>';
    row.querySelector('.rart').textContent = a.own ? '◆' : '·';
    row.querySelector('.rtitle').textContent = a.label || a.name;
    row.querySelector('.rdesc').textContent =
      (a.match || []).length ? tr('agents.matches', { what: a.match.join(', ') }) : '';
    // What it is doing right now — that is what makes the list worth reading.
    const users = agentUsers(a.name);
    row.querySelector('.rpath').textContent = users.length
      ? tr(users.length === 1 ? 'counts.session' : 'counts.sessions', { n: users.length })
      : (a.own ? tr('agents.own') : tr('agents.builtIn'));
    row.addEventListener('click', () => agentOpen(a.name));
    box.appendChild(row);
  }
}

async function agentOpen(name) {
  try {
    $('#agentText').value = await api.agentRead(name);
  } catch (e) {
    plxrUI.notice(errText(e), tr('settings.agentProfiles'));
    return;
  }
  agentEditing = name;
  $('#agentName').textContent = tr('agents.editing', { name });
  $('#agentEdit').hidden = false;
  $('#agentText').focus();
}

$('#agentNew').addEventListener('click', async () => {
  const name = await plxrUI.prompt(tr('agents.nameAsk'), tr('agents.nameTitle'), '');
  if (!name) return;
  const clean = name.trim().toLowerCase();
  try {
    $('#agentText').value = await api.agentStarter(clean);
  } catch (e) {
    plxrUI.notice(errText(e), tr('agents.nameTitle'));
    return;
  }
  agentEditing = clean;
  $('#agentName').textContent = tr('agents.editing', { name: clean });
  $('#agentEdit').hidden = false;
  $('#agentText').focus();
});

$('#agentSave').addEventListener('click', async () => {
  if (!agentEditing) return;
  try {
    await api.agentWrite(agentEditing, $('#agentText').value);
  } catch (e) {
    plxrUI.notice(errText(e), tr('settings.agentProfiles'));
    return;
  }
  /* Say what it now applies to. Otherwise saving is an act of faith: the
     profile only shows its effect when a matching session happens to run. */
  const users = agentUsers(agentEditing);
  plxrUI.notice(
    users.length
      ? users.map((t) => t.title || t.name).join('\n')
      : tr('agents.noneRunning'),
    tr('agents.saved', { name: agentEditing }));
  renderAgents();
});

$('#agentDelete').addEventListener('click', async () => {
  if (!agentEditing) return;
  if (!(await plxrUI.confirm(tr('agents.deleteAsk', { name: agentEditing }), tr('settings.agentProfiles')))) return;
  try {
    await api.agentDelete(agentEditing);
  } catch (e) {
    plxrUI.notice(errText(e), tr('settings.agentProfiles'));
    return;
  }
  agentEditing = null;
  $('#agentEdit').hidden = true;
  renderAgents();
});

/* ═════════════════════════ Merkpunkte ═════════════════════════

   Before every instruction a snapshot of the working directory is taken — a
   git tree object, written with a temporary index, so neither your index nor
   your working tree is touched. See internal/marks.

   What it is for: an agent changes eleven files, one of them wrongly. The only
   tool at hand is `git checkout .`, and that takes your own work with it. Here
   one file goes back and nothing else moves.

   The list opens closed: a mark with its instruction, and what changed since.
   Only on a click does the file list come, because that costs a git diff per
   mark and there can be dozens of them. */

function marksShow(open) {
  $('#marksPane').hidden = !open;
  $('#marksToggle').classList.toggle('on', open);
}

async function marksRow(box, m) {
  const row = document.createElement('div');
  row.className = 'rrow';
  row.innerHTML = '<span class="rart"></span><span class="rmain">' +
    '<b class="rtitle"></b><span class="rdesc"></span></span><span class="rpath"></span>';
  row.querySelector('.rart').textContent = new Date(m.at).toLocaleTimeString(language);
  row.querySelector('.rtitle').textContent = m.prompt || m.tree.slice(0, 8);
  row.querySelector('.rpath').textContent = m.tree.slice(0, 8);
  const desc = row.querySelector('.rdesc');
  box.appendChild(row);

  let open = false;
  const files = document.createElement('div');
  box.appendChild(files);

  row.addEventListener('click', async () => {
    open = !open;
    files.innerHTML = '';
    if (!open) return;
    let list = [];
    try { list = await api.markChanges(state.active, m.tree); } catch { return; }
    desc.textContent = list.length
      ? tr('marks.nChanged', { n: list.length }) : tr('marks.unchanged');
    for (const c of list) {
      const f = document.createElement('div');
      f.className = 'rrow';
      f.innerHTML = '<span class="rart"></span><span class="rmain"><b class="rtitle"></b></span>' +
        '<span class="hitAction"><button class="btn tiny"></button></span>';
      f.querySelector('.rart').textContent = c.status;
      f.querySelector('.rtitle').textContent = c.path;
      const b = f.querySelector('button');
      b.textContent = tr('marks.rollBack');
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!(await plxrUI.confirm(tr('marks.rollBackAsk', { path: c.path }), tr('marks.title')))) return;
        try {
          await api.markRestore(state.active, m.tree, c.path);
          plxrUI.notice(tr('marks.rolledBack', { path: c.path }), tr('marks.title'));
        } catch (err) {
          plxrUI.notice(errText(err), tr('marks.title'));
        }
      });
      files.appendChild(f);
    }
  });
}

$('#marksToggle').addEventListener('click', async () => {
  if (!$('#marksPane').hidden) { marksShow(false); return; }
  if (!state.active) return;
  $('#viewer').hidden = true;
  rulesShow(false);
  marksShow(true);
  const box = $('#marksBody');
  box.innerHTML = '';
  $('#marksMeta').textContent = tr('common.loading');
  let list = [];
  try { list = await api.marks(state.active); } catch { list = []; }
  $('#marksMeta').textContent = '';
  if (!list.length) {
    showEmpty(box, tr('marks.none'),
      hookInstalled === false ? tr('marks.noneHookHint') : tr('marks.noneHint'));
    return;
  }
  for (const m of list.slice(0, 50)) await marksRow(box, m);
});
$('#marksClose').addEventListener('click', () => marksShow(false));

/* ═════════════════════════ Werkstatt ═════════════════════════

   A skin written in the running window, with the real sessions standing behind
   it. Two decisions carry this:

   The live preview is a <style> element, not the saved file. Every keystroke
   would otherwise mean a write to disk and a reload of the sheet — and half a
   second of an unstyled window on every one. The element sits after the skin
   sheet, so its rules win without anything having to be removed.

   What is missing is counted against the DOM, not against a list. classes.py
   compares the source statically; here the actual window stands in front of
   you, with exactly the elements that exist right now. That is more honest —
   and it changes while you click around, which is the point: open the archive
   and you see what the archive still lacks. */

let wbLive = null;      // the <style> element carrying the preview
let wbTimer = null;

/* The classes really present in the window, minus what layout alone covers.
   Deliberately read out of the DOM rather than out of the source: a class that
   nothing ever creates needs no styling either. */
function wbClassesInUse() {
  const out = new Set();
  for (const el of document.querySelectorAll('[class]')) {
    for (const c of el.classList) if (!wbSkipped(c)) out.add(c);
  }
  return [...out].sort();
}

/* Which classes does this stylesheet mention at all? Deliberately rough — the
   exact question ("does it style it, or only position it") is what classes.py
   asks in the gate. Here it is about the quick look while writing. */
function wbStyledBy(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return new Set([...clean.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
}

/* Picking.

   The real hurdle in front of a stylesheet is not the syntax, it is the
   question which of two hundred class names belongs to the thing you want to
   change. Nobody knows that from memory, and a text area full of CSS says
   nothing about it.

   So: click the thing. The workbench finds the class a skin can address and
   writes the rule for it — then all that is left is a colour. */
let wbPicking = false;
let wbBox = null;

/* What a skin has no business with: pure layout, the workbench itself, the
   workbench console, xterm's own classes. The same list serves both the
   picking and the "still missing" column — otherwise that column cries wolf
   with a hundred entries nobody should ever style. */
const WB_NOT_MINE = new Set([
  'app', 'auswahl', 'auswahlText', 'body', 'brand', 'content',
  'farbflaeche', 'farbpunkt', 'farbton', 'farbtonpunkt', 'farbwahl',
  'farbwert', 'feld', 'griff', 'hidden', 'panes', 'pfadListe', 'rtext',
  'sesssplit', 'spacer', 'stil', 'stilzeile', 'tools', 'wahl', 'xterm',
  'xterm-screen', 'zeile2'
]);

const wbSkipped = (c) =>
  WB_NOT_MINE.has(c) || c.startsWith('dev') || c.startsWith('wb') || c.startsWith('xterm');

/* Which class can a skin actually address? The innermost one that is not pure
   layout, because that is the one a skin colours. */
function wbClassFor(el) {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    for (const c of node.classList) if (!wbSkipped(c)) return c;
  }
  return '';
}

function wbPickStop() {
  wbPicking = false;
  $('#wbPick').classList.remove('on');
  if (wbBox) { wbBox.remove(); wbBox = null; }
  $('#wbMeta').textContent = tr('workbench.hint');
}

function wbPickStart() {
  wbPicking = true;
  $('#wbPick').classList.add('on');
  $('#wbMeta').textContent = tr('workbench.picking');
  wbBox = document.createElement('div');
  wbBox.className = 'wbTarget';
  document.body.appendChild(wbBox);
}

document.addEventListener('mousemove', (e) => {
  if (!wbPicking || !wbBox) return;
  if ($('#workbench').contains(e.target)) { wbBox.hidden = true; return; }
  const r = e.target.getBoundingClientRect();
  Object.assign(wbBox.style, {
    left: r.left + 'px', top: r.top + 'px',
    width: r.width + 'px', height: r.height + 'px',
  });
  wbBox.hidden = false;
}, true);

document.addEventListener('click', (e) => {
  if (!wbPicking) return;
  if ($('#workbench').contains(e.target)) return;
  // Do not let the click through: picking must not open a session on the way.
  e.preventDefault();
  e.stopPropagation();
  const cls = wbClassFor(e.target);
  if (!cls) { $('#wbMeta').textContent = tr('workbench.pickNothing'); return; }

  const field = $('#wbCss');
  field.value = field.value.replace(/\s*$/, '\n') + `\n.${cls} {\n  \n}\n`;
  field.focus();
  // The cursor lands inside the braces — that is where the next thing is typed.
  const at = field.value.length - 3;
  field.setSelectionRange(at, at);
  field.scrollTop = field.scrollHeight;
  wbRender();
  $('#wbMeta').textContent = tr('workbench.picked', { what: '.' + cls });
}, true);

$('#wbPick').addEventListener('click', () => (wbPicking ? wbPickStop() : wbPickStart()));

function wbRender() {
  const css = $('#wbCss').value;
  if (!wbLive) {
    wbLive = document.createElement('style');
    wbLive.id = 'wbLive';
    document.head.appendChild(wbLive);
  }
  wbLive.textContent = css;

  const styled = wbStyledBy(css);
  const missing = wbClassesInUse().filter((c) => !styled.has(c));
  $('#wbMeta').textContent = tr('workbench.livePreview');
  const box = $('#wbMissing');
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'rrow';
  head.innerHTML = '<span class="rart"></span><span class="rmain"><b class="rtitle"></b></span>';
  head.querySelector('.rart').textContent = String(missing.length);
  head.querySelector('.rtitle').textContent = missing.length
    ? tr('workbench.missingHead') : tr('workbench.nothingMissing');
  box.appendChild(head);
  for (const c of missing) {
    const row = document.createElement('div');
    row.className = 'rrow';
    row.innerHTML = '<span class="rart"></span><span class="rmain"><b class="rtitle"></b></span>';
    row.querySelector('.rtitle').textContent = '.' + c;
    box.appendChild(row);
  }
}

async function openWorkbench() {
  const t = currentTheme();
  const skin = t?.skin || 'crt';
  $('#wbName').value = skin;
  try {
    $('#wbCss').value = await api.skinRead(skin);
  } catch (e) {
    plxrUI.notice(errText(e), tr('workbench.title'));
    return;
  }
  $('#settings').hidden = true;
  $('#workbench').hidden = false;
  wbRender();
  $('#wbAbout').textContent = tr('workbench.about');
  $('#wbMeta').textContent = tr('workbench.hint');
  // The panel takes width away from the interface — without a refit the
  // terminals keep their old number of columns and wrap in the middle of a line.
  for (const pane of paneList()) paneRefit(pane);
  $('#wbCss').focus();
}

function closeWorkbench() {
  if (wbPicking) wbPickStop();
  $('#workbench').hidden = true;
  // The preview goes with it: what was not saved must not stay behind.
  if (wbLive) { wbLive.remove(); wbLive = null; }
  for (const pane of paneList()) paneRefit(pane);
}

async function wbSave() {
  const name = $('#wbName').value.trim();
  if (!name) { plxrUI.notice(tr('workbench.nameNeeded'), tr('workbench.title')); return; }
  try {
    await api.skinWrite(name, $('#wbCss').value);
  } catch (e) {
    plxrUI.notice(errText(e), tr('workbench.title'));
    return;
  }

  /* A skin alone cannot be selected — switching goes through a THEME that
     points at a skin. Saving under a new name and finding it nowhere would be
     a dead end: the file is written, and nothing has changed.

     So if no theme uses this skin yet, one is created, named after it, and
     selected. Now the thing that was just written is actually on screen. */
  const has = (state.themes || []).some((t) => t.skin === name);
  if (!has) {
    try {
      await api.themeImport(JSON.stringify({ name, label: name, skin: name }));
      await loadThemes(name);
      localStorage.setItem('plxr.theme', name);
      $('#wbMeta').textContent = tr('workbench.savedAndPicked', { name });
      return;
    } catch (e) {
      // The skin is saved either way — say what is missing, do not swallow it.
      plxrUI.notice(errText(e), tr('workbench.themeFailed'));
    }
  }
  $('#wbMeta').textContent = tr('workbench.saved');
}

$('#wbCss').addEventListener('input', () => {
  clearTimeout(wbTimer);
  wbTimer = setTimeout(wbRender, 120);
});
$('#wbOpen').addEventListener('click', openWorkbench);
$('#wbSave').addEventListener('click', wbSave);
$('#wbClose').addEventListener('click', closeWorkbench);
$('#workbench').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); wbSave(); }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (wbPicking) wbPickStop(); else closeWorkbench();
  }
});

/* ═════════════════════════ Regeln ═════════════════════════ */

const ARTNAME = { global: 'global', projekt: 'projekt', lokal: 'lokal', import: 'import', skill: 'skill', agent: 'agent' };

/* The button shows whether the rules are open — like the one for the files.
   Without that indication the tab gives no clue which state it is in, and the
   only visible way back is pressing it again. */
function rulesShow(openOne) {
  $('#rulesPane').hidden = !openOne;
  $('#rulesToggle').classList.toggle('on', openOne);
}

$('#rulesToggle').addEventListener('click', async () => {
  if (!$('#rulesPane').hidden) { rulesShow(false); return; }
  if (!state.active) return;
  $('#viewer').hidden = true;
  rulesShow(true);
  $('#rulesMeta').textContent = tr('common.loading');
  const list = await api.rules(state.active);
  $('#rulesMeta').textContent = list.length === 1
    ? tr('rules.oneFile')
    : tr('rules.nFiles', { n: list.length });
  const box = $('#rulesBody');
  box.innerHTML = '';
  if (!list.length) {
    showEmpty(box, tr('rules.none'),
      tr('rules.noneHint'));
    return;
  }
  for (const e of list) {
    const row = document.createElement('div');
    row.className = 'rrow';
    row.dataset.kind = e.kind;
    row.innerHTML = '<span class="rart"></span><span class="rmain">' +
      '<b class="rtitle"></b><span class="rdesc"></span></span><span class="rpath"></span>';
    row.querySelector('.rart').textContent = ARTNAME[e.kind] || e.kind;
    row.querySelector('.rtitle').textContent = e.name;
    row.querySelector('.rdesc').textContent = e.description || '';
    row.querySelector('.rpath').textContent = e.path;
    row.dataset.tip = e.path;
    box.appendChild(row);
  }
});
$('#rulesClose').addEventListener('click', () => rulesShow(false));

/* An empty list without an explanation is a state that looks like a failure.
   Every list says why it is empty. */
function showEmpty(box, title, text) {
  box.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'emptyNote';
  d.innerHTML = '<b></b><span></span>';
  d.querySelector('b').textContent = title;
  d.querySelector('span').textContent = text;
  box.appendChild(d);
}

/* ═════════════════════════ Archiv ═════════════════════════ */

/* The archived transcripts are a large part of why plxr exists: they lie
   scattered across dozens of project folders, and the built-in picker shows
   only the current directory by default. */

const archiv = { all: [], search: '', hit: null, terminals: null };

async function loadArchive() {
  $('#archInfo').textContent = tr('common.loading');
  await fillAccounts('#archAccount');
  archiv.all = await api.archive(state.filter);
  archiv.hit = null;
  archiv.terminals = null;
  $('#archiveCount').textContent = archiv.all.length;
  renderArchive();
}

$('#archSearch').addEventListener('input', (e) => {
  archiv.search = e.target.value.toLowerCase();
  archiv.hit = null;
  archiv.terminals = null;
  renderArchive();
});
$('#archSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') fullTextSearch(); });
$('#archFullText').addEventListener('click', fullTextSearch);
$('#archTerminals').addEventListener('click', searchTerminals);

/* The second kind of search: not what the assistant wrote but what stood in the
   terminal. Error messages, test run output, stack traces — everything tmux
   loses on restart. */
async function searchTerminals() {
  const q = $('#archSearch').value.trim();
  if (q.length < 2) return;
  $('#archInfo').textContent = tr('archive.searchingRecordings');
  try {
    archiv.terminals = await api.searchTerminals(q);
    archiv.hit = null;
    renderArchive();
  } catch (e) {
    $('#archInfo').textContent = tr('archive.searchFailed', { err: e.message || e });
  }
}

/* Searching titles finds only what is in the title. The actual question is
   usually "where did I do that once" — and for that every message has to be
   walked. Takes a few seconds, hence on request. */
async function fullTextSearch() {
  const q = $('#archSearch').value.trim();
  if (q.length < 2) return;
  $('#archInfo').textContent = tr('archive.searchingTranscripts');
  try {
    archiv.hit = await api.search(q);
    renderArchive();
  } catch (e) {
    $('#archInfo').textContent = tr('archive.searchFailed', { err: e.message || e });
  }
}

function shortDate(ms) {
  return new Date(ms).toLocaleString(language,
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function resumeSession(id, account) {
  try {
    const s = await api.archiveResume(id, account, $('#archAccount').value);
    showGrid();
    setTimeout(() => openSession(s.id), 500);
  } catch (err) {
    plxrUI.notice(errText(err), tr('archive.resumeFailed'));
  }
}

function renderArchive() {
  const box = $('#archList');
  box.innerHTML = '';

  if (archiv.terminals) {
    const wonach = $('#archSearch').value.trim();
    $('#archInfo').textContent = archiv.terminals.length === 1
      ? tr('archive.oneTerminal', { q: wonach })
      : tr('archive.nTerminals', { n: archiv.terminals.length, q: wonach });
    if (!archiv.terminals.length) {
      showEmpty(box, tr('archive.noTerminal'),
        tr('archive.noTerminalHit', { q: wonach }));
      return;
    }
    for (const t of archiv.terminals) {
      const row = document.createElement('div');
      row.className = 'row tall';
      row.innerHTML =
        '<span class="hitDate"></span>' +
        '<span class="hitMain"><b class="hitTitle"></b><span class="hitExcerpt"></span></span>' +
        '<span class="hitProject"></span><span class="hitValue"></span>';
      row.querySelector('.hitDate').textContent = shortDate(t.mod);
      row.querySelector('.hitTitle').textContent = t.name;
      row.querySelector('.hitExcerpt').textContent = t.excerpt;
      row.querySelector('.hitProject').textContent = t.cwd ? t.cwd.split('/').pop() : '';
      row.querySelector('.hitValue').textContent = t.count + '×';
      row.dataset.tip = t.cwd || '';

      /* What came after is the actual find: the same error has been seen three
         times already — what is wanted is the command that fixed it back
         then. */
      if (t.after?.length) {
        const dest = document.createElement('pre');
        dest.className = 'hitAfter';
        dest.textContent = t.after.join('\n');
        row.appendChild(dest);
      }

      /* A click plays the recording from this spot — including for sessions that
         no longer exist. That is exactly why the recording sits on disk. */
      row.style.cursor = 'pointer';
      row.addEventListener('click', (e) => {
        // Clicking the context means reading, not playing.
        if (e.target.closest('.hitAfter')) return;
        openPlayer(t.sessionId, t.name, t.offset || 0);
      });
      box.appendChild(row);
    }
    return;
  }

  if (archiv.hit) {
    const wonach = $('#archSearch').value.trim();
    $('#archInfo').textContent = archiv.hit.length === 1
      ? tr('archive.oneSession', { q: wonach })
      : tr('archive.nSessions', { n: archiv.hit.length, q: wonach });
    if (!archiv.hit.length) {
      showEmpty(box, tr('find.noHit'),
        tr('archive.noFullTextHit', { q: wonach }));
      return;
    }
    for (const t of archiv.hit) {
      const row = document.createElement('div');
      row.className = 'row tall';
      row.innerHTML =
        '<span class="hitDate"></span>' +
        '<span class="hitMain"><b class="hitTitle"></b><span class="hitExcerpt"></span></span>' +
        '<span class="hitProject"></span><span class="hitValue"></span>' +
        '<span class="hitAction"><button class="btn">FORTSETZEN</button></span>';
      row.querySelector('.hitDate').textContent = shortDate(t.mod);
      row.querySelector('.hitTitle').textContent = t.title || tr('archive.untitled');
      row.querySelector('.hitExcerpt').textContent = t.excerpt;
      row.querySelector('.hitProject').textContent = t.project;
      row.querySelector('.hitValue').textContent = t.count + '×';
      row.dataset.tip = t.cwd;
      row.querySelector('button').addEventListener('click', (ev) => {
        ev.stopPropagation();
        resumeSession(t.sessionId, t.account);
      });
      box.appendChild(row);
    }
    return;
  }

  const q = archiv.search;
  const list = q
    ? archiv.all.filter((e) =>
        (e.title || '').toLowerCase().includes(q) ||
        (e.project || '').toLowerCase().includes(q) ||
        (e.cwd || '').toLowerCase().includes(q))
    : archiv.all;

  $('#archInfo').textContent = q
    ? tr('find.count', { i: list.length, n: archiv.all.length })
    : tr(archiv.all.length === 1 ? 'archive.transcript' : 'archive.transcripts', { n: archiv.all.length });

  if (!list.length) {
    if (archiv.all.length) {
      showEmpty(box, tr('archive.noTitleHit'),
        tr('archive.hitEnterForFullText'));
    } else if (state.filter) {
      showEmpty(box, tr('archive.noneUnderPath'),
        tr('archive.filtered', { path: state.filter }));
    } else {
      showEmpty(box, tr('archive.none'), tr('archive.noneHint'));
    }
    return;
  }

  for (const e of list.slice(0, 400)) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML =
      '<span class="hitDate"></span><span class="hitTitle"></span><span class="hitProject"></span>' +
      '<span class="hitSmall"></span><span class="hitValue"></span>' +
      `<span class="hitAction"><button class="btn" data-t="auf">${tr('archive.resume')}</button>` +
      `<button class="btn" data-t="weg">${tr('common.delete')}</button></span>`;
    row.querySelector('.hitDate').textContent = shortDate(e.mod);
    row.querySelector('.hitTitle').textContent = e.title || tr('archive.untitled');
    row.querySelector('.hitProject').textContent = [e.project, e.branch].filter(Boolean).join(' · ');
    row.querySelector('.hitSmall').textContent = (e.accounts || []).length > 1 ? (e.accounts || []).length + '×' : '';
    row.querySelector('.hitValue').textContent = (e.size / 1024).toFixed(0) + ' kB';
    row.dataset.tip = e.cwd;

    row.querySelector('[data-t="auf"]').addEventListener('click', (ev) => {
      ev.stopPropagation();
      resumeSession(e.id, e.account);
    });
    row.querySelector('[data-t="weg"]').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const gone = await plxrUI.confirm(`${e.title || e.id}\n${e.cwd}`, tr('archive.deleteAsk'));
      if (!gone) return;
      try {
        await api.archiveDelete(e.id, e.account);
        archiv.all = archiv.all.filter((x) => x.id !== e.id);
        renderArchive();
      } catch (err) {
        plxrUI.notice(errText(err), tr('archive.deleteFailed'));
      }
    });
    box.appendChild(row);
  }
}

/* ═════════════════════════ Ports ═════════════════════════ */

/* Forgotten dev servers: a Nuxt on 3000 that has been running for days and
   blocks the next start. Whatever belongs to a plxr session is coloured — that
   must not be shot down by accident. */

async function loadPorts() {
  $('#portsInfo').textContent = tr('ports.reading');
  const list = await api.ports();
  $('#portsCount').textContent = list.length;
  $('#portsInfo').textContent = list.length === 1
    ? tr('ports.onePort')
    : tr('ports.nPorts', { n: list.length });
  const box = $('#portsList');
  box.innerHTML = '';
  if (!list.length) {
    showEmpty(box, tr('ports.none'),
      tr('ports.noneHint'));
    return;
  }
  for (const p of list) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.own = p.own ? 'yes' : 'no';
    row.innerHTML =
      '<span class="hitDate"></span><span class="hitTitle"></span><span class="hitProject"></span>' +
      '<span class="hitValue"></span>' +
      '<span class="hitAction"><button class="btn" data-h="0">BEENDEN</button>' +
      '<button class="btn" data-h="1">HART</button></span>';
    row.querySelector('.hitDate').textContent = p.port;
    /* The attribute all four skins have always aimed at — nobody ever set it,
       so the highlighting of our own sessions was dead. */
    row.dataset.own = p.own ? 'yes' : '';
    row.querySelector('.hitTitle').textContent = p.command + (p.own ? '  · ' + tr('ports.ownSession') : '');
    row.querySelector('.hitProject').textContent = p.addr;
    row.querySelector('.hitValue').textContent = 'pid ' + p.pid;
    for (const hard of [false, true]) {
      row.querySelector(`[data-h="${hard ? 1 : 0}"]`).addEventListener('click', async () => {
        const manner = tr(hard ? 'ports.killHard' : 'ports.killSoft');
        const ja = await plxrUI.confirm(`${p.command}, pid ${p.pid}`,
          tr('ports.killAsk', { port: p.port, how: manner }));
        if (!ja) return;
        try { await api.portKill(p.pid, hard); setTimeout(loadPorts, 500); }
        catch (e) { plxrUI.notice(errText(e), tr('ports.killFailed')); }
      });
    }
    box.appendChild(row);
  }
}
$('#portsReload').addEventListener('click', loadPorts);

/* ═════════════════════════ Verbrauch ═════════════════════════ */

/* Counted from the transcripts, not through an API: the spend sits in every
   assistant line and is therefore complete and analysable after the fact. Cache
   reads dominate everything else by orders of magnitude, so they stand apart
   rather than hidden inside a total. */

function tok(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + ' Mrd';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' Mio';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' Tsd';
  return String(n);
}

$('#usageRange').addEventListener('change', loadUsage);

async function loadUsage() {
  $('#usageInfo').textContent = tr('usage.calculating');
  const b = await api.usage($('#usageRange').value);
  $('#usageInfo').textContent =
    tr(b.files === 1 ? 'archive.transcript' : 'archive.transcripts', { n: b.files }) + ' · ' + b.duration;

  const box = $('#usageBody');
  box.innerHTML = '';

  const total = document.createElement('div');
  total.className = 'usum';
  for (const [amount, what] of [
    [b.sum.output, 'ausgabe'],
    [b.sum.input, 'eingabe'],
    [b.sum.cacheWrite, 'cache geschrieben'],
    [b.sum.cacheRead, 'cache gelesen'],
    [b.sum.messages, 'antworten'],
  ]) {
    const d = document.createElement('div');
    d.className = 'ubox';
    d.innerHTML = '<b class="ubig"></b><span></span>';
    d.querySelector('b').textContent = tok(amount);
    d.querySelector('span').textContent = what;
    total.appendChild(d);
  }
  box.appendChild(total);

  const gesamt = (z) => z.input + z.output + z.cacheWrite + z.cacheRead;
  const block = (title, rows, grenze) => {
    if (!rows || !rows.length) return;
    const d = document.createElement('div');
    d.className = 'ublock';
    d.innerHTML = '<b class="uhead"></b>';
    d.querySelector('.uhead').textContent = title;
    const max = Math.max(...rows.map(gesamt), 1);
    for (const z of rows.slice(0, grenze)) {
      const r = document.createElement('div');
      r.className = 'urow';
      r.innerHTML = '<span class="ukey"></span><span class="ubar"><i class="ufill"></i></span><span class="uval"></span>';
      r.querySelector('.ukey').textContent = z.key;
      r.querySelector('.ufill').style.width = (gesamt(z) / max * 100).toFixed(1) + '%';
      r.querySelector('.uval').textContent = tok(gesamt(z));
      d.appendChild(r);
    }
    box.appendChild(d);
  };

  if (!b.byDay.length) {
    showEmpty(box, tr('usage.none'),
      tr('usage.noneHint'));
    return;
  }

  block('nach Tag', b.byDay, 30);
  block('nach Projekt', b.byProject, 12);
  block('nach Modell', b.byModel, 8);
  block(tr('usage.byAccount'), b.byAccount, 8);
  await loadWaiting(box, Number($('#usageRange').value) || 0);
}

/* ═════════════════════════ Waiting account ═════════════════════════

   How long did the agents work, and how long did they wait for you. The second
   number is the one worth having, and nothing in plxr could answer it: the
   state file holds the current status and nothing of what came before.

   A single wait is capped — see internal/hook/ledger.go. What was cut is shown
   rather than swallowed, otherwise the figure would quietly be wrong. */

function duration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return tr('waiting.minutes', { n: min });
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? tr('waiting.hoursMinutes', { h, n: rest }) : tr('waiting.hours', { h });
}

async function loadWaiting(box, days) {
  let w;
  try {
    w = await api.waiting(days);
  } catch {
    return;   // the usage view is worth more than this block
  }
  const d = document.createElement('div');
  d.className = 'ublock';
  d.innerHTML = '<b class="uhead"></b>';
  d.querySelector('.uhead').textContent = tr('waiting.title');

  const sum = document.createElement('div');
  sum.className = 'usum';
  for (const [value, label] of [
    [duration(w.worked), tr('waiting.worked')],
    [duration(w.waited), tr('waiting.waited')],
  ]) {
    const box2 = document.createElement('div');
    box2.className = 'ubox';
    box2.innerHTML = '<b class="ubig"></b><span></span>';
    box2.querySelector('b').textContent = value;
    box2.querySelector('span').textContent = label;
    sum.appendChild(box2);
  }
  d.appendChild(sum);

  /* The cap has to be named where the number stands. A figure that quietly
     leaves something out is worse than no figure. */
  if (w.cut) {
    const note = document.createElement('div');
    note.className = 'urow';
    note.innerHTML = '<span class="ukey"></span><span class="uval"></span>';
    note.querySelector('.ukey').textContent =
      tr('waiting.capped', { cap: duration(w.cap) });
    note.querySelector('.uval').textContent = duration(w.cut);
    d.appendChild(note);
  }

  /* Nothing collected yet? Then say so, rather than hiding the block. It only
     starts counting at the first change of status, and a section that is simply
     absent teaches nobody that it exists. */
  if (!w.worked && !w.waited) {
    const note = document.createElement('div');
    note.className = 'urow';
    note.innerHTML = '<span class="ukey"></span>';
    note.querySelector('.ukey').textContent = tr('waiting.empty');
    d.appendChild(note);
    box.appendChild(d);
    return;
  }

  const max = Math.max(...(w.byDay || []).map((l) => l.worked + l.waited), 1);
  for (const l of (w.byDay || []).slice(0, 30)) {
    const row = document.createElement('div');
    row.className = 'urow';
    row.innerHTML = '<span class="ukey"></span><span class="ubar"><i class="ufill"></i></span><span class="uval"></span>';
    row.querySelector('.ukey').textContent = l.key;
    row.querySelector('.ufill').style.width = ((l.worked + l.waited) / max * 100).toFixed(1) + '%';
    row.querySelector('.uval').textContent = duration(l.waited);
    row.dataset.tip = tr('waiting.rowTip', { worked: duration(l.worked), waited: duration(l.waited) });
    d.appendChild(row);
  }
  box.appendChild(d);
}

/* ═════════════════════════ Spending pace ═════════════════════════

   Claude works in rolling windows — five hours and a week. Running several
   agents at once blows the five-hour window without seeing it coming. Here is
   the pace, before it is too late.

   plxr does not know the absolute limit — that depends on the plan and is
   published nowhere. So it does not claim when the end comes, it shows how fast
   things are going right now and whether the pace is rising. */

const TREND = { rising: '↑', falling: '↓', flat: '·' };

function tokShort(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + ' Mrd';
  if (n >= 1e6) return (n / 1e6).toFixed(0) + ' Mio';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' Tsd';
  return String(n);
}

async function checkPace() {
  let t;
  try { t = await api.pace(); } catch { return; }
  const el = $('#pace');
  if (!t.perHour && !t.window5h) { el.hidden = true; return; }

  el.hidden = false;
  el.textContent =
    `${tokShort(t.perHour)}/h ${TREND[t.trend] || ''} · 5h ${tokShort(t.window5h)}` +
    (t.active ? ` · ${tr('pace.active', { n: t.active })}` : '');
  el.title =
    tr('pace.tooltip', {
      hour: t.perHour.toLocaleString(language),
      window5h: t.window5h.toLocaleString(language),
      active: t.active,
    });

  // Past three billion an hour it gets tight on the common plans — that is a
  // mark from experience, not an official limit.
  el.dataset.warning = t.perHour > 3e9 && t.trend !== 'falling' ? 'yes' : '';
}

/* ═════════════════════════ Fassung ═════════════════════════ */

let versionStatus = null;

/* How often we look.

   Previously once at startup and then hourly — anyone who had published a new
   version saw nothing of it for up to an hour and had to restart the window.
   Now every ten minutes, and additionally as soon as the window comes forward
   again: that is the moment somebody looks.

   The throttle below caps both together. GitHub allows sixty unauthenticated
   requests an hour; without a cap, switching windows often could use those up,
   and then the check reports nothing but errors. */
const VERSION_INTERVAL = 10 * 60 * 1000;
const VERSION_THROTTLE = 2 * 60 * 1000;
let versionCheckedAt = 0;

async function checkVersion(force) {
  const nowMs = Date.now();
  if (!force && nowMs - versionCheckedAt < VERSION_THROTTLE) return;
  versionCheckedAt = nowMs;
  try {
    const st = await api.version();
    versionStatus = st;
    if (!st.available) { $('#updateBar').hidden = true; return; }
    if (localStorage.getItem('plxr.updateIgnoriert') === st.latest) return;
    $('#updateText').textContent =
      tr('update.banner', { latest: st.latest, current: st.current }) +
      (st.size ? ` · ${(st.size / (1 << 20)).toFixed(1)} MB` : '');
    $('#updateBar').hidden = false;
  } catch {}
}

$('#updateHide').addEventListener('click', () => {
  if (versionStatus) localStorage.setItem('plxr.updateIgnoriert', versionStatus.latest);
  $('#updateBar').hidden = true;
});
$('#updateNotes').addEventListener('click', () => {
  plxrUI.notice(versionStatus?.notes || tr('update.noNotes'), tr('update.notesTitle'));
});
/* The expected flow: notice, click, progress, restart.
   What is new is that the daemon goes along — otherwise a new window talks to
   an old daemon, and that is a state in which nothing works and nothing says
   why. So what it costs stands BEFORE the click, not after: running sessions
   become orphaned ones. */
$('#updateGo').addEventListener('click', async () => {
  const laufende = state.tiles.filter((t) => t.alive).length;
  const question = tr('update.installAsk', { v: versionStatus?.latest || '' }) +
    (laufende ? '\n\n' + tr('update.sessionsWarn', { n: laufende }) : '');
  const ja = await plxrUI.confirm(tr('update.confirm'), question);
  if (!ja) return;

  $('#updateGo').disabled = true;
  $('#updateNotes').hidden = true;
  $('#updateHide').hidden = true;
  $('#updateProgress').hidden = false;

  try {
    await api.update();
  } catch (e) {
    updateFehler(errText(e));
    return;
  }
  updateVerfolgen();
});

function updateFehler(text) {
  $('#updateText').textContent = tr('update.failedWith', { err: text });
  $('#updateProgress').hidden = true;
  $('#updateGo').disabled = false;
  $('#updateNotes').hidden = false;
  $('#updateHide').hidden = false;
}

function updateVerfolgen() {
  const tick = setInterval(async () => {
    let st;
    try {
      st = await api.updateStatus();
    } catch {
      return; // connection briefly gone — back on the next attempt
    }
    $('#updateFill').style.width = st.percent + '%';
    $('#updateText').textContent =
      st.phase === tr('update.loading') ? tr('update.progress', { pct: st.percent }) : st.phase;

    if (!st.done) return;
    clearInterval(tick);

    if (st.error) { updateFehler(st.error); return; }

    $('#updateText').textContent = tr('update.doneRestarting');
    $('#updateFill').style.width = '100%';
    // Leave it up briefly so it is visible that it worked.
    setTimeout(async () => {
      try {
        await api.restart();
        // The new version is running. This window bows out, the daemon ends
        // itself in a moment — both come back new and together.
        if (WAILS) Native.Quit();
      } catch {
        $('#updateText').textContent = tr('update.installed');
      }
    }, 900);
  }, 400);
}

/* ═════════════════════════ Neue Session ═════════════════════════ */

/* What gets started. The shell comes first: plxr is a terminal that also runs
   agents — not the other way round. */
const STARTBAR = [
  { id: 'shell', label: 'Shell', cmd: null },  // cmd kommt vom Daemon
  { id: 'claude', label: 'Claude Code', cmd: ['claude'] },
  { id: 'codex', label: 'Codex', cmd: ['codex'] },
  { id: 'opencode', label: 'opencode', cmd: ['opencode'] },
  { id: 'eigenes', label: 'Eigenes …', cmd: null },
];
let shellCmd = null;

async function fillChoice() {
  const box = $('#newCmdChoice');
  if (box.children.length) return;
  try { shellCmd = (await api.shell()).cmd; } catch { shellCmd = ['/bin/sh', '-l']; }
  const last = localStorage.getItem('plxr.startart') || 'shell';
  for (const w of STARTBAR) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choiceButton';
    b.dataset.id = w.id;
    b.textContent = w.id === 'shell' ? tr('template.shellLabel', { cmd: shellCmd[0].split('/').pop() }) : w.label;
    b.addEventListener('click', () => setChoice(w.id));
    box.appendChild(b);
  }
  setChoice(last);
}

function setChoice(id) {
  for (const b of $('#newCmdChoice').children) b.dataset.picked = b.dataset.id === id ? 'yes' : 'no';
  $('#newCmdInput').hidden = id !== 'eigenes';
  localStorage.setItem('plxr.startart', id);
  if (id === 'eigenes') $('#newCmd').focus();
}

function chosenCommand() {
  const id = [...$('#newCmdChoice').children].find((b) => b.dataset.picked === 'yes')?.dataset.id || 'shell';
  if (id === 'shell') return shellCmd || [];
  if (id === 'eigenes') return $('#newCmd').value.trim().split(/\s+/).filter(Boolean);
  return STARTBAR.find((w) => w.id === id).cmd;
}

/* ═════════════════════════ Templates ═════════════════════════

   Three sessions in three directories under three accounts every morning — the
   same set of motions every day. A template turns that into one click, and it
   is built from whatever is open right now. */

$('#templatesBtn').addEventListener('click', openTemplates);
$('#templatesCancel').addEventListener('click', () => { $('#templates').hidden = true; });

async function openTemplates() {
  $('#templates').hidden = false;
  const box = $('#templatesList');
  box.innerHTML = '';
  let list = [];
  try { list = await api.templates(); } catch {}

  if (!list.length) {
    const d = document.createElement('div');
    d.className = 'emptyNote';
    d.innerHTML = `<b>${tr('templates.none')}</b><span>${tr('templates.noneHint')}</span>`;
    box.appendChild(d);
    return;
  }

  for (const v of list) {
    const row = document.createElement('div');
    row.className = 'splitRow';
    row.innerHTML = '<span class="rname"></span><span class="spacer"></span>' +
      '<span class="meta"></span><button class="btn tiny" data-t="weg">✕</button>';
    row.querySelector('.rname').textContent = v.label;
    row.querySelector('.meta').textContent =
      `${v.sessions.length} ${v.sessions.length === 1 ? 'Session' : 'Sessions'}`;
    row.dataset.tip = v.sessions.map((e) => e.cwd).join('\n');

    row.addEventListener('click', async (ev) => {
      if (ev.target.dataset.t === 'weg') return;
      $('#templates').hidden = true;
      try {
        const r = await api.templateStart(v.name);
        if (r.teilweise) plxrUI.notice(r.teilweise, tr('templates.startFailed'));
      } catch (e) {
        plxrUI.notice(errText(e), tr('template.notStarted'));
      }
    });

    row.querySelector('[data-t="weg"]').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!(await plxrUI.confirm(v.label, tr('templates.deleteAsk')))) return;
      try { await api.templateDelete(v.name); openTemplates(); }
      catch (e) { plxrUI.notice(errText(e), tr('theme.notDeleted')); }
    });
    box.appendChild(row);
  }
}

$('#templatesSave').addEventListener('click', async () => {
  const openOne = state.tiles.filter((t) => t.alive).length;
  if (!openOne) { plxrUI.notice(tr('templates.nothingToSave'), tr('templates.nothingToSaveTitle')); return; }
  const label = await plxrUI.prompt(
    tr(openOne === 1 ? 'templates.saveAskOne' : 'templates.saveAskMany', { n: openOne }),
    tr('templates.nameAsk'), tr('templates.nameExample'));
  if (!label) return;
  const name = label.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  try {
    await api.templateSave(name, label);
    openTemplates();
  } catch (e) {
    plxrUI.notice(errText(e), tr('common.notSaved'));
  }
});

$('#newBtn').addEventListener('click', async () => {
  $('#newCwd').value = state.filter || localStorage.getItem('plxr.lastCwd') || '';
  await Promise.all([fillAccounts('#newAccount'), fillChoice()]);
  $('#dialog').hidden = false;
  $('#newCwd').focus();
});
$('#newCancel').addEventListener('click', () => { $('#dialog').hidden = true; });

// The system's folder dialog exists only inside the window.
if (api.inWindow) {
  $('#pickDir').hidden = false;
  $('#pickDir').addEventListener('click', async () => {
    const d = await api.pickDirectory();
    if (d) $('#newCwd').value = d;
  });
}

$('#newForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cwd = $('#newCwd').value.trim();
  const cmd = chosenCommand();
  try {
    const s = await api.start(cwd, cmd, $('#newAccount').value);
    localStorage.setItem('plxr.lastCwd', cwd);
    $('#dialog').hidden = true;
    setTimeout(() => openSession(s.id), 400);
  } catch (err) {
    plxrUI.notice(errText(err), tr('session.startFailed'));
  }
});

/* ═════════════════════════ Start ═════════════════════════ */

/* Apply the last used theme from the cache first, only then talk to the
   daemon — that way the UI is never unstyled, even when the daemon is away. */
(function themeAusSpeicher() {
  try {
    const raw = localStorage.getItem('plxr.themeCache');
    applyTheme(raw ? JSON.parse(raw) : { name: 'crt-amber', skin: 'crt', palette: {} });
  } catch {
    applyTheme({ name: 'crt-amber', skin: 'crt', palette: {} });
  }
})();

plxrUI.replaceSelects();

fetch('/logo.svg').then((r) => r.text()).then((svg) => { $('#mark').innerHTML = svg; }).catch(() => {});

/* With an inset title bar the macOS window buttons float above the content. The
   page cannot know that by itself, so Go says which system it runs on. */
api.env().then((e) => {
  document.documentElement.dataset.platform = e.platform;
  if (e.titlebarInset) document.documentElement.dataset.titlebarInset = 'yes';
}).catch(() => {});

(function bootLine() {
  const el = $('#boot');
  const txt = WAILS ? 'pty host online' : 'browsermodus · pty host online';
  let i = 0;
  const t = setInterval(() => {
    el.textContent = txt.slice(0, ++i);
    if (i >= txt.length) { clearInterval(t); setTimeout(() => { el.textContent = ''; }, 3500); }
  }, 22);
})();

setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString(language); }, 1000);

// Register our own tooltips — title="" would be a box from the system.
plxrUI.bindTips();

/* Emergency brake.

   The case it exists for: a command that must not run appears in a tile, and
   there are two seconds. Which of the four sessions it was gets sorted out
   afterwards — so one grab stops them all. Nothing is lost doing it; the
   sessions stand still and later carry on exactly where they were.

   Deliberately without a confirmation: a safety prompt in front of an emergency
   brake is the same as no brake at all. The second click undoes it. */
async function emergencyBrake() {
  const button = $('#brake');
  if (button.dataset.on === 'yes') {
    try {
      const r = await api.unfreeze();
      button.dataset.on = '';
      button.textContent = tr('header.brake');
      document.documentElement.dataset.frozen = '';
      $('#counts').textContent = tr('brake.resumed', { n: r.resumed });
    } catch (e) { plxrUI.notice(errText(e), tr('brake.notResumed')); }
    return;
  }
  try {
    const r = await api.emergencyBrake();
    if (!r.affected) { plxrUI.notice(tr('brake.nothingRunning'), tr('brake.nothingTitle')); return; }
    button.dataset.on = 'yes';
    button.textContent = tr('header.brakeRelease');
    document.documentElement.dataset.frozen = 'yes';
    $('#counts').textContent = r.frozen === r.affected
      ? tr('brake.halted', { n: r.frozen })
      : tr('brake.partial', { done: r.frozen, total: r.affected });
  } catch (e) { plxrUI.notice(errText(e), tr('brake.failed')); }
}
$('#brake').addEventListener('click', emergencyBrake);

pathComplete($('#pathFilter'), applyFilter);
pathComplete($('#newCwd'));

state.filter = localStorage.getItem('plxr.filter') || '';
$('#pathFilter').value = state.filter;

/* Language before anything else: the interface must never flash up in English
   and then switch. If loading fails the keys stay on screen — visibly broken
   is better than empty. */
loadLanguage()
  .then(translateMarkup)
  .catch((e) => console.error('Sprachdatei:', e))
  .then(connect)
  .then(() => loadThemes())
  .then(() => {
    api.aufZustand(renderAll);
    checkVersion(true);
    // If an update was still running in the last window, keep following it here.
    api.updateStatus().then((st) => {
      if (st.running) { $('#updateBar').hidden = false; $('#updateProgress').hidden = false; updateVerfolgen(); }
    }).catch(() => {});
    setInterval(checkVersion, VERSION_INTERVAL);
  })
  .catch(() => reconnect());
