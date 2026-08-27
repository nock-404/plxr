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

const SPRACHEN = ['en', 'de'];
let sprache = 'en';
let texte = {};
let texteEn = {};

function spracheWaehlen() {
  try {
    const eigen = localStorage.getItem('plxr.lang');
    if (eigen && SPRACHEN.includes(eigen)) return eigen;
  } catch {}
  // Die Systemsprache ist die beste Vermutung, die ohne Nachfragen zu haben ist.
  const roh = (navigator.language || 'en').toLowerCase().split('-')[0];
  return SPRACHEN.includes(roh) ? roh : 'en';
}

async function spracheLaden(welche) {
  sprache = welche || spracheWaehlen();
  const hol = async (l) => {
    const r = await fetch(`/i18n/${l}.json`);
    if (!r.ok) throw new Error(`Sprachdatei ${l} fehlt`);
    return r.json();
  };
  // Englisch immer mitladen: es ist der Rückfall für jeden fehlenden Schlüssel.
  texteEn = await hol('en');
  texte = sprache === 'en' ? texteEn : await hol(sprache).catch(() => ({}));
}

/* t liefert den Text zu einem Schlüssel.

   Platzhalter stehen als {name} im Text und werden aus dem zweiten Argument
   gefüllt. Absichtlich keine Pluralregeln: die Sprachen, um die es hier geht,
   kommen mit einer Verzweigung im Aufrufer aus, und eine halbe
   Pluralbibliothek wäre mehr Aufwand als der Nutzen. */
function t(schluessel, werte) {
  let s = texte[schluessel] ?? texteEn[schluessel] ?? schluessel;
  if (werte) {
    for (const [k, v] of Object.entries(werte)) s = s.replaceAll(`{${k}}`, v);
  }
  return s;
}

/* Alles im Markup übersetzen, was einen Schlüssel trägt. Wird beim Start und
   nach jedem Sprachwechsel aufgerufen — so braucht ein Wechsel kein Neuladen. */
function markupUebersetzen(wurzel = document) {
  for (const el of wurzel.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of wurzel.querySelectorAll('[data-i18n-tip]')) {
    el.dataset.tip = t(el.dataset.i18nTip);
  }
  for (const el of wurzel.querySelectorAll('[data-i18n-ph]')) {
    el.placeholder = t(el.dataset.i18nPh);
  }
  document.documentElement.lang = sprache;
}

const state = {
  tiles: [],        // letzter bekannter Gesamtzustand
  filter: '',       // Pfadfilter
  panes: [],        // session ids of the open terminal panes
  aktiv: null,      // which of them the header acts on
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
  if (!TOKEN) throw new Error(t('err.noToken'));
}

const wsURL = (p) =>
  BASE.replace(/^http/, 'ws') + p + (p.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN);

async function req(pfad, opts = {}) {
  let r;
  try {
    r = await fetch(BASE + pfad, { ...opts, headers: { 'X-Plxr-Token': TOKEN, ...(opts.headers || {}) } });
  } catch (e) {
    // A network error means: the daemon is gone. Do not push that onto the
    // caller, start the reconnect instead.
    //
    // And do not pass the webview's own wording through: depending on the
    // system it says "Load failed" or "Failed to fetch". That then stood in the
    // dialog without any context and explained nothing.
    reconnect();
    throw new Error(t('err.daemonGone'));
  }
  if (r.status === 403) { reconnect(); throw new Error(t('err.tokenExpired')); }
  if (!r.ok) throw new Error((await r.text()).trim() || r.statusText);
  return r.status === 204 ? null : r.json();
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
  fenster: WAILS,

  env: () => (WAILS ? Native.Env() : Promise.resolve({ platform: 'web', titlebarInset: false })),
  pickDirectory: () => (WAILS ? Native.PickDirectory() : Promise.resolve('')),

  themes: () => req('/api/themes'),
  themeImport: (text) => req('/api/themes', { method: 'POST', body: text }),
  themeDelete: (name) => req(`/api/themes/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  /* The stream comes as bytes, not JSON — base64 would treble its size. Hence
     around req, which expects JSON. */
  wiedergabe: async (id, ab = 0) => {
    const r = await fetch(`${BASE}/api/playback/${encodeURIComponent(id)}?ab=${ab}`,
      { headers: { 'X-Plxr-Token': TOKEN } });
    if (!r.ok) throw new Error((await r.text()).trim() || r.statusText);
    return {
      daten: new Uint8Array(await r.arrayBuffer()),
      resize: Number(r.headers.get('X-Plxr-Size') || 0),
      beschnitten: r.headers.get('X-Plxr-Cut') === 'true',
    };
  },
  zeitachse: (id) => req(`/api/playback/${encodeURIComponent(id)}/zeitachse`),
  emergencyBrake: () => req('/api/freeze', { method: 'POST' }),
  unfreeze: () => req('/api/unfreeze', { method: 'POST' }),
  konten: () => req('/api/accounts'),
  templates: () => req('/api/vorlagen'),
  templateStart: (name) => req(`/api/vorlagen/${encodeURIComponent(name)}/start`, { method: 'POST' }),
  templateSave: (name, label) =>
    req('/api/vorlagen', { method: 'POST', body: JSON.stringify({ Name: name, Label: label }) }),
  templateDelete: (name) => req(`/api/vorlagen/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  regeln: (session) => req('/api/rules?session=' + encodeURIComponent(session || '')),
  ports: () => req('/api/ports'),
  portBeenden: (pid, hart) => req(`/api/ports/${pid}${hart ? '?hart=1' : ''}`, { method: 'DELETE' }),
  verbrauch: (tage) => req('/api/usage?tage=' + tage),
  tempo: () => req('/api/tempo'),
  version: () => req('/api/version'),
  updateStand: () => req('/api/update'),
  neuStarten: () => req('/api/restart', { method: 'POST' }),
  hookStand: () => req('/api/hook'),
  setHook: (an) => req('/api/hook?an=' + (an ? '1' : '0'), { method: 'POST' }),
  aktualisieren: () => req('/api/update', { method: 'POST' }),

  ordner: (id, dir) => req(`/api/files/${id}?dir=${encodeURIComponent(dir || '')}`).catch(() => []),
  pfade: (q) => req('/api/paths?q=' + encodeURIComponent(q)).catch(() => []),
  shell: () => req('/api/shell'),
  datei: (id, pfad) => req(`/api/file/${id}?path=${encodeURIComponent(pfad)}`),
  dateiSchreiben: (id, pfad, text, mod) =>
    req(`/api/file/${id}`, { method: 'PUT', body: JSON.stringify({ path: pfad, text, mod }) }),

  archiv: (pfad) => req('/api/archive' + (pfad ? '?path=' + encodeURIComponent(pfad) : '')),
  archiveDelete: (id, konto) => req(`/api/archive/${id}?account=${encodeURIComponent(konto || '')}`, { method: 'DELETE' }),
  archiveResume: (id, konto, ziel) =>
    req(`/api/archive/${id}/resume?account=${encodeURIComponent(konto || '')}&target=${encodeURIComponent(ziel || '')}`,
        { method: 'POST' }),
  search: (q) => req('/api/search?q=' + encodeURIComponent(q)),
  searchTerminals: (q) => req('/api/search/terminals?q=' + encodeURIComponent(q)),

  starten: (cwd, cmd, konto) =>
    req('/api/sessions', { method: 'POST', body: JSON.stringify({ cwd, cmd, account: konto }) }),
  beenden: (id) => req('/api/sessions/' + id, { method: 'DELETE' }),
  kontoWechseln: (id, ziel) => req(`/api/sessions/${id}/account?target=${encodeURIComponent(ziel)}`, { method: 'POST' }),
  wiederaufnehmen: (id) => req(`/api/sessions/${id}/resume`, { method: 'POST' }),
  sendReply: (id, text, roh) =>
    req(`/api/sessions/${id}/antwort${roh ? '?roh=1' : ''}`, { method: 'POST', body: text }),

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
    for (const [id, eintrag] of attachments) {
      this.attach(id, eintrag.aufDaten, eintrag.aufEnde);
      eintrag.beiNeu?.();
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
  document.documentElement.dataset.offline = ok ? '' : 'ja';
  if (!ok) {
    $('#counts').textContent = 'Verbindung verloren, versuche erneut …';
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
  const nach = [
    ['#viewPorts', () => loadView('#portsList', '#portsInfo', loadPorts)],
    ['#viewUsage', () => loadView('#usageBody', '#usageInfo', loadUsage)],
    ['#viewArchive', () => loadView('#archList', '#archInfo', loadArchive)],
  ];
  for (const [sel, load] of nach) {
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
  let wartezeit = 500;
  const versuch = async () => {
    try {
      await connect();
      await loadThemes($('#themeSel').value);
      api.aufZustand(renderAll);
      showConnection(true);
      // The terminals only now: before this the address would still be the old one.
      api.reattach();
      neuTimer = null;
    } catch {
      wartezeit = Math.min(wartezeit * 1.6, 5000);
      neuTimer = setTimeout(versuch, wartezeit);
    }
  };
  neuTimer = setTimeout(versuch, wartezeit);
}

/* ═════════════════════════ Themes and skins ═════════════════════════ */

const PALETTE = ['bg','fg','dim','accent','panel','line','working','waiting','blocked','dead'];

/* A skin change is double buffered: load the new sheet alongside, wait for
   onload, only then remove the old one. Redirecting href instead leaves a few
   hundred milliseconds with no stylesheet at all — and a naked page. */
let skinLoading = null;

function setSkin(name) {
  const href = `/skins/${name}/skin.css`;
  const alt = $('#skinCss');
  if (alt && alt.getAttribute('href') === href) return Promise.resolve();
  if (skinLoading === href) return Promise.resolve();
  skinLoading = href;

  return new Promise((fertig) => {
    const neu = document.createElement('link');
    neu.rel = 'stylesheet';
    neu.href = href;
    const adopt = () => {
      if (alt && alt !== neu) alt.remove();
      neu.id = 'skinCss';
      skinLoading = null;
      // A different skin brings different crest glyphs.
      crestGlyphs = null;
      fertig();
    };
    neu.addEventListener('load', adopt, { once: true });
    // A broken sheet: better to keep the old one than have none.
    neu.addEventListener('error', () => { neu.remove(); skinLoading = null; fertig(); }, { once: true });
    document.head.appendChild(neu);
  });
}

function applyTheme(t) {
  if (!t || !t.skin) return;
  const wurzel = document.documentElement;
  wurzel.dataset.skin = t.skin;
  wurzel.dataset.scan = t.scanlines === false ? 'off' : 'on';
  wurzel.dataset.glow = t.glow === false ? 'off' : 'on';

  setSkin(t.skin).then(() => {
    // Set the palette only once the skin is in place: otherwise its :root block
    // overrides our values, because it is parsed later.
    for (const k of PALETTE) wurzel.style.removeProperty('--' + k);
    for (const [k, v] of Object.entries(t.palette || {})) {
      if (PALETTE.includes(k)) wurzel.style.setProperty('--' + k, v);
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
  $('#themeDelete').hidden = !(t || currentTheme())?.eigen;
}

function currentTheme() {
  const wert = $('#themeSel').value;
  if (!wert) return null;
  return state.themes.find((t) => t.name === wert) || { name: wert, skin: wert.split('-')[0], palette: {} };
}

async function loadThemes(preselect) {
  const list = await api.themes();
  if (!list.length) return;
  state.themes = list;

  const sel = $('#themeSel');
  sel.innerHTML = '';
  let gruppe = null, letzterSkin = null;
  for (const t of list) {
    if (t.skin !== letzterSkin) {
      gruppe = document.createElement('optgroup');
      gruppe.label = t.skin;
      sel.appendChild(gruppe);
      letzterSkin = t.skin;
    }
    const o = document.createElement('option');
    o.value = t.name;
    o.textContent = t.label;
    gruppe.appendChild(o);
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
  if (!t?.eigen) return;
  if (!(await plxrUI.confirm(t.label, t('theme.deleteAsk')))) return;
  try {
    await api.themeDelete(t.name);
    await loadThemes();
  } catch (e) {
    plxrUI.notice(e.message || String(e), t('theme.notDeleted'));
  }
});

/* ═════════════════════════ Einstellungen ═════════════════════════ */

/* Appearance and setup do not belong in the header: you set that once and
   never look at it again. */

async function openSettings() {
  $('#settings').hidden = false;
  plxrUI.replaceSelects();
  $('#themeHint').textContent =
    t('settings.themeHint');
  tabWaehlen('look');
  buildStyleEditor();
  showDeleteButton();
  fillLanguages();
  try {
    const v = await api.version();
    $('#settingsVersion').textContent =
      `plxr ${v.aktuell}` + (v.available ? ` · ${t('version.available', { v: v.latest })}` : ' · aktuell');
  } catch {
    $('#settingsVersion').textContent = '';
  }
  showHookStatus();
}
$('#settingsBtn').addEventListener('click', openSettings);

/* Raumzustand — der ganze Raum sagt, was los ist.

   Ein farbiger Punkt je Kachel funktioniert nur, wenn man hinsieht. Wer aber
   in einer Datei liest oder in einem anderen Fenster arbeitet, sieht ihn nicht.
   Deshalb trägt die Oberfläche selbst den Gesamtzustand: die Skins hängen ihre
   Mittel daran — der crt lässt den Rand atmen, sketch das Papier, win95 färbt
   den Schreibtisch. Was das JavaScript liefert, ist nur die Tatsache.

   Bewusst nur DREI Zustände. Fünf feine Abstufungen kann man nicht mehr aus
   dem Augenwinkel unterscheiden, und ein Raum, der ständig etwas anderes
   flüstert, wird zu Rauschen:

     working   irgendwer arbeitet
     waiting   jemand braucht dich — das ist der einzige, der drängt
     idle      alles fertig, es ist ruhig

   Zusätzlich die reine Zahl, damit ein Skin die Stärke daran binden kann:
   drei laufende Agenten dürfen mehr Unruhe machen als einer. */
function raumzustand({ laufen, blockiert, verwaist, gesamt }) {
  const w = document.documentElement;
  const lage = blockiert || verwaist ? 'waiting' : (laufen ? 'working' : 'idle');
  if (w.dataset.raum !== lage) w.dataset.raum = lage;

  // Als CSS-Variable, damit ein Skin daran rechnen kann statt zu raten.
  const setz = (k, v) => {
    if (w.style.getPropertyValue(k) !== String(v)) w.style.setProperty(k, String(v));
  };
  setz('--busy', laufen);
  setz('--waiting-count', blockiert + verwaist);
  setz('--session-count', gesamt);
}

/* Reiter im Einstellungsfenster.

   Der Stil-Editor allein sind zwölf Farbfelder und zwei Regler. Darunter ist
   alles andere unter den Falz gerutscht — die Anbindung von Claude Code hat
   man schlicht nicht mehr gesehen.

   Bewusst kein Zustand, der irgendwo gespeichert wird: wer die Einstellungen
   öffnet, will fast immer dasselbe, und ein Fenster, das sich an den letzten
   Reiter erinnert, zeigt beim nächsten Mal den falschen. */
function tabWaehlen(welcher) {
  for (const b of document.querySelectorAll('#settings .tab')) {
    b.classList.toggle('on', b.dataset.tab === welcher);
    b.setAttribute('aria-selected', b.dataset.tab === welcher ? 'true' : 'false');
  }
  for (const k of document.querySelectorAll('#settings .tabbody')) {
    k.hidden = k.dataset.tab !== welcher;
  }
}

for (const b of document.querySelectorAll('#settings .tab')) {
  b.addEventListener('click', () => tabWaehlen(b.dataset.tab));
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
    for (const l of SPRACHEN) {
      const o = document.createElement('option');
      o.value = l;
      // Der Name steht in der Sprache selbst — deshalb aus deren Tabelle.
      o.textContent = l === sprache ? t('_meta.name') : NAMEN[l] || l;
      sel.appendChild(o);
    }
  }
  sel.value = sprache;
  plxrUI.replaceSelects();
}

// Kurz genug, um sie hier zu halten: eine zweite Abfrage je Sprache nur für
// den Anzeigenamen wäre Aufwand ohne Gegenwert.
const NAMEN = { en: 'English', de: 'Deutsch' };

$('#langSel').addEventListener('change', async (e) => {
  const gewuenscht = e.target.value;
  try { localStorage.setItem('plxr.lang', gewuenscht); } catch {}
  await spracheLaden(gewuenscht);
  markupUebersetzen();
  // Was aus JavaScript kam, zeichnet der nächste Zustandsstrom neu; die
  // Ansichten, die auf Zuruf laden, hier anstoßen.
  refreshView();
  showHookStatus();
});

/* ═════════════════════════ Adjusting the style ═════════════════════════

   Picking a theme is not enough — you want to nudge the colour until it is
   right. Changes take effect at once so you can see what you are doing; saving
   happens on request, as an own theme alongside the shipped ones. */

const STYLE_COLORS = [
  ['bg', 'Hintergrund'], ['fg', 'Text'], ['dim', t('style.dim')],
  ['accent', 'Hervorhebung'], ['panel', t('style.panel')], ['line', 'Linien'],
  ['working', 'arbeitet'], ['waiting', 'wartet'],
  ['blocked', t('state.needsYou')], ['dead', 'beendet'],
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
    styleState.pickers[key] = plxrUI.colorPicker(field, (wert) => {
      styleState.changes[key] = wert;
      document.documentElement.style.setProperty('--' + key, wert);
      if (key.startsWith('term-')) forEachPane((p) => { p.term.options.theme = xtermTheme(); });
    });
  }

  box.appendChild(numberRow(t('style.fontUi'), 'fontSize', 11, 28, () => {
    document.documentElement.style.setProperty('--size', styleState.fontSize + 'px');
  }));
  box.appendChild(numberRow(t('style.fontTerm'), 'termSize', 9, 24, () => {
    forEachPane((p) => { p.term.options.fontSize = styleState.termSize; paneRefit(p); });
  }));
  box.appendChild(toggleRow('Zeilenraster', 'scan'));
  box.appendChild(toggleRow('Schimmer', 'glow'));
}

// The current value of a colour: our own change first, then whatever applies.
function currentColor(key) {
  if (styleState.changes[key]) return styleState.changes[key];
  const wert = cssVar(key, '');
  return /^#[0-9a-f]{6}$/i.test(wert) ? wert : rgbToHex(wert) || '#888888';
}

function rgbToHex(wert) {
  const m = /rgba?\(([^)]+)\)/.exec(wert);
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
  const anzeige = row.querySelector('.styleNumber span');

  const jetzt = () => styleState[field] || (field === 'fontSize'
    ? parseFloat(getComputedStyle(document.body).fontSize)
    : (paneList()[0]?.term.options.fontSize || 13));

  const show = () => { anzeige.textContent = Math.round(jetzt()); };
  for (const b of row.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      const neu = Math.min(max, Math.max(min, Math.round(jetzt()) + (b.dataset.r === '+' ? 1 : -1)));
      styleState[field] = neu;
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
    button.dataset.an = lesen() ? 'ja' : 'nein';
    button.textContent = lesen() ? 'AN' : 'AUS';
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
  const basis = currentTheme();
  const name = await plxrUI.prompt(
    t('theme.nameAsk'),
    'Eigenes Theme speichern', (basis?.name || 'mein') + '-eigen');
  if (!name) return;

  const sauber = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const palette = { ...(basis?.palette || {}) };
  for (const [k, v] of Object.entries(styleState.changes)) {
    if (!k.startsWith('_')) palette[k] = v;
  }

  const theme = {
    name: sauber,
    label: name,
    skin: basis?.skin || 'crt',
    palette,
    scanlines: document.documentElement.dataset.scan !== 'off',
    glow: document.documentElement.dataset.glow !== 'off',
  };
  if (styleState.fontSize) theme.fontSize = styleState.fontSize;
  if (styleState.termSize) theme.termSize = styleState.termSize;

  try {
    await api.themeImport(JSON.stringify(theme));
    await loadThemes(sauber);
    styleState.changes = {};
    plxrUI.notice(t('theme.saved', { name }), 'Gespeichert');
  } catch (e) {
    plxrUI.notice(e.message || String(e), 'Nicht gespeichert');
  }
});
$('#settingsClose').addEventListener('click', () => { $('#settings').hidden = true; });

async function showHookStatus() {
  try {
    const st = await api.hookStand();
    const mehrere = (st.konten || 1) > 1 ? ` (${st.konten} Konten)` : '';
    $('#hookHint').textContent = st.eingerichtet
      ? t('hook.connectedHint', { accounts: mehrere })
      : st.fehlen?.length
        ? t('hook.missingHint', { missing: st.fehlen.join(', ') })
        : t('hook.notConnected');
    $('#hookBtn').textContent = st.eingerichtet ? t('hook.detach') : 'EINRICHTEN';
    $('#hookBtn').dataset.an = st.eingerichtet ? 'ja' : 'nein';
  } catch {
    $('#hookHint').textContent = 'Zustand unbekannt.';
    $('#hookBtn').textContent = 'EINRICHTEN';
  }
}

$('#hookBtn').addEventListener('click', async () => {
  const an = $('#hookBtn').dataset.an === 'ja';
  try {
    await api.setHook(!an);
    await showHookStatus();
    plxrUI.notice(
      an ? t('hook.removed')
         : t('hook.installed'),
      'Claude Code');
  } catch (e) {
    plxrUI.notice(e.message || String(e), t('err.notChanged'));
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
    plxrUI.notice(err.message || String(err), 'Theme abgelehnt');
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

const keineSonderansicht = () => ANSICHTEN.every(([, v]) => $(v).hidden);

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
    showEmpty($(box), t('view.unreachable'),
      t('view.unreachableHint'));
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
  const gesehen = new Set();
  for (const row of String(confirm).split('\n')) {
    const m = OPTION_LINE.exec(row);
    if (!m) continue;
    const [, taste, text] = m;
    if (gesehen.has(taste)) continue;      // dieselbe Ziffer nur einmal
    gesehen.add(taste);
    out.push({ text: taste, label: `${taste} · ${shorten(text)}` });
    if (out.length >= 5) break;            // more does not fit on a card
  }
  // A single digit is not a choice but usually a line number.
  return out.length >= 2 ? out : null;
}

// An option text can be a whole explanation — on the button the start is what counts.
function shorten(t) {
  const sauber = t.replace(/\s+/g, ' ').trim();
  return sauber.length > 22 ? sauber.slice(0, 21) + '…' : sauber;
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

function renderInbox() {
  const list = waitingSessions();
  const box = $('#inboxBody');
  $('#inboxInfo').textContent =
    list.length ? t(list.length === 1 ? 'inbox.oneWaiting' : 'inbox.nWaiting', { n: list.length }) : '';

  if (!list.length) {
    showEmpty(box, t('inbox.nobody'),
      t('inbox.emptyHint'));
    return;
  }

  // Update existing cards rather than rebuilding them, otherwise the reply
  // field loses focus and what was typed on every tick.
  const gesehen = new Set();
  for (const t of list) {
    gesehen.add(t.id);
    let card = box.querySelector(`[data-id="${CSS.escape(t.id)}"]`);
    if (!card) {
      card = document.createElement('div');
      card.className = 'inboxCard';
      card.dataset.id = t.id;
      card.innerHTML =
        '<div class="inboxHead"><span class="dot permission">◉</span>' +
        '<b class="inboxName"></b><span class="inboxPath"></span>' +
        `<button class="btn tiny" data-t="oeffnen">${t('inbox.open')}</button></div>` +
        '<pre class="inboxQuestion"></pre>' +
        '<div class="inboxReply"><input spellcheck="false" placeholder="Antwort, Eingabetaste sendet">' +
        '<span class="inboxQuick"></span></div>';

      card.querySelector('[data-t="oeffnen"]').addEventListener('click', () => openSession(t.id));

      const field = card.querySelector('.inboxReply input');
      field.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        await reply(t.id, field.value);
        field.value = '';
      });

      box.appendChild(card);
    }

    card.querySelector('.inboxName').textContent = t.title || t.name;
    card.querySelector('.inboxPath').textContent = [t.project, t.agent_label].filter(Boolean).join('  ·  ');
    const confirm = card.querySelector('.inboxQuestion');
    const neu = t.confirm || t.activity || t('inbox.noQuestion');
    if (confirm.textContent !== neu) confirm.textContent = neu;

    /* Only rebuild when the question changed: the card refreshes every second,
       and anyone aiming at a button should not lose it from under the
       pointer. */
    const quick = card.querySelector('.inboxQuick');
    if (quick.dataset.fuer !== neu) {
      quick.dataset.fuer = neu;
      quick.innerHTML = '';
      for (const a of quickRepliesFor(t.confirm)) {
        const b = document.createElement('button');
        b.textContent = a.label;
        b.dataset.tip = a.text === '\u001b' ? 'Escape senden' : `„${a.text || 'Eingabetaste'}" senden`;
        b.addEventListener('click', () => reply(t.id, a.text, a.text === '\u001b'));
        quick.appendChild(b);
      }
    }
  }
  for (const el of [...box.querySelectorAll('.inboxCard')]) {
    if (!gesehen.has(el.dataset.id)) el.remove();
  }
}

async function reply(id, text, roh) {
  try {
    await api.sendReply(id, text, roh);
    // Wait a moment, then read again: the session needs a beat before it
    // changes its status.
    setTimeout(() => { if (!$('#viewInbox').hidden) renderInbox(); }, 900);
  } catch (e) {
    plxrUI.notice(e.message || String(e), 'Nicht gesendet');
  }
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

const ZEICHEN = { working: '●', waiting: '○', permission: '◉', dead: '✕', unknown: '·', eingefroren: '❙❙' };
const WORT = {
  working: 'arbeitet', waiting: 'wartet', permission: t('state.needsYou'),
  dead: 'beendet', unknown: t('state.running'),
};

/* Orphaned is not a status from the daemon but a note: the session was still
   running when the daemon ended. For display it counts as one all the same. */
/* Frozen beats any reported status. A stopped session writes nothing more —
   the hook keeps reporting "working", the quiet heuristic eventually says
   "unknown", and both would be a lie. */
const tileState = (t) =>
  t.eingefroren ? 'eingefroren' : (t.verwaist ? 'verwaist' : (t.status || 'unknown'));
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
  const roh = getComputedStyle(document.documentElement).getPropertyValue('--crest').trim();
  // The value arrives as a CSS string, so in quotes.
  const sauber = roh.replace(/^["']|["']$/g, '');
  crestGlyphs = [...(sauber || CREST_FALLBACK)];
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

function crest(pfad) {
  if (!pfad) return '';
  const zeichen = crestGlyphSet();
  return zeichen[hash32(pfad) % zeichen.length];
}

/* The colour comes from the same hash but from a different part of it —
   otherwise identical glyphs would always carry the same colour and the second
   cue would be no cue at all. */
function crestHue(pfad) {
  if (!pfad) return '';
  return `hsl(${(hash32(pfad + '#ton') % 360)} 60% 60%)`;
}

/* The rail is the reason a session is not a full-screen overlay: whoever is
   inside one session should still see when somebody elsewhere is stuck. */
function renderRail() {
  const list = $('#railList');
  const gruppen = new Map();
  for (const t of state.tiles) {
    const k = t.project || '—';
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(t);
  }

  const erwartet = [...gruppen.keys()].map((k) => 'g:' + k)
    .concat(state.tiles.map((t) => 's:' + t.id));

  for (const [projekt, entries] of gruppen) {
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
      punkt.textContent = t.verwaist ? ZEICHEN_VERWAIST : (ZEICHEN[st] || '·');
      const rw = el.querySelector('.crest');
      rw.textContent = crest(t.cwd);
      rw.style.color = crestHue(t.cwd);
      el.querySelector('.rname').textContent = t.title || t.name || t.id.slice(0, 8);
      el.querySelector('.rsub').textContent = t.verwaist
        ? t('state.crashed')
        : [t.alive ? WORT[st] : 'beendet', t.agent].filter(Boolean).join(' · ');
      el.dataset.tip = `${t.name} — ${t.cwd}`;
    }
  }

  for (const el of [...list.children]) {
    if (!erwartet.includes(el.dataset.key)) el.remove();
  }

  for (const [button, ansicht] of ANSICHTEN) $(button).classList.toggle('active', !$(ansicht).hidden);
  $('#railHome').classList.toggle('active', !state.panes.length && keineSonderansicht());
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
  const gesehen = new Set();

  for (const t of state.tiles) {
    gesehen.add(t.id);
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
    el.dataset.isUntamed = isUntamed(t) ? 'ja' : '';
    const punkt = el.querySelector('.dot');
    punkt.className = 'dot ' + st;
    punkt.textContent = t.verwaist ? ZEICHEN_VERWAIST : (ZEICHEN[st] || '·');
    const w = el.querySelector('.crest');
    w.textContent = crest(t.cwd);
    w.style.color = crestHue(t.cwd);
    w.dataset.tip = t.cwd || '';
    el.querySelector('.tname').textContent = t.title || t.name || t.id.slice(0, 8);
    el.querySelector('.tproj').textContent = [t.project, t.branch].filter(Boolean).join(' · ');
    el.querySelector('.tbody').textContent = t.preview || '';
    el.querySelector('.act').textContent = t.verwaist
      ? t('tile.crashedHint')
      : (t.alive ? (t.activity || t.last_message || '') : t('state.ended', { code: t.exit_code }));
    el.querySelector('.agent').textContent = t.agent_label || t.agent || '';
    el.querySelector('.ctx').textContent =
      [t.model?.replace('claude-', ''), t.effort, ctxShort(t.context), agoText(t.since)]
        .filter(Boolean).join(' · ');
  }
  for (const el of [...raster.children]) if (!gesehen.has(el.dataset.id)) el.remove();
}

// renderAll is the only receiver of the state stream.
function renderAll(tiles) {
  state.tiles = tiles || [];
  const belegt = !!state.panes.length || !keineSonderansicht();

  const laufen = state.tiles.filter((t) => t.alive).length;
  const blockiert = state.tiles.filter((t) => t.alive && t.status === 'permission').length;
  const verwaist = state.tiles.filter((t) => t.verwaist).length;
  // A counter on the rail, so that even from inside a session you can see
  // dass jemand wartet.
  const wartet = blockiert;
  raumzustand({ laufen, blockiert, verwaist, gesamt: state.tiles.length });
  $('#inboxCount').textContent = wartet || '';
  $('#railInbox').dataset.status = wartet ? 'permission' : '';
  if (!$('#viewInbox').hidden) renderInbox();
  if (connectionOk) {
    $('#counts').textContent =
      `${state.tiles.length} ${state.tiles.length === 1 ? 'Session' : 'Sessions'} · ` +
      `${laufen} ${laufen === 1 ? t('state.running') : 'laufen'}` +
      (blockiert ? ` · ${t('counts.waiting', { n: blockiert })}` : '') +
      (verwaist ? ` · ${verwaist} vom Absturz betroffen` : '');
  }

  renderGrid();
  renderRail();
  if (!belegt) {
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
    const platz = window.innerHeight - r.bottom;
    if (platz < 240) {
      list.style.top = 'auto';
      list.style.bottom = window.innerHeight - r.top + 4 + 'px';
    } else {
      list.style.bottom = 'auto';
    }
  };

  let treffer = [];
  let picked = -1;
  let timer;

  const zu = () => { list.hidden = true; picked = -1; };

  const render = () => {
    list.innerHTML = '';
    if (!treffer.length) { zu(); return; }
    treffer.forEach((pfad, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'selectRow';
      b.textContent = pfad;
      if (i === picked) b.dataset.picked = 'ja';
      b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(pfad); });
      list.appendChild(b);
    });
    stellen();
    list.hidden = false;
  };

  const pick = (pfad) => {
    // Append the separator: the next keystroke then searches inside it.
    field.value = pfad.endsWith('/') ? pfad : pfad + '/';
    zu();
    onPick?.(field.value);
    load();
  };

  const load = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      treffer = await api.pfade(field.value);
      picked = -1;
      render();
    }, 120);
  };

  field.addEventListener('input', load);
  field.addEventListener('focus', load);
  field.addEventListener('blur', () => setTimeout(zu, 120));

  field.addEventListener('keydown', (e) => {
    if (list.hidden || !treffer.length) {
      if (e.key === 'Tab' || e.key === 'ArrowDown') { load(); }
      return;
    }
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      picked = (picked + 1) % treffer.length;
      render();
      list.children[picked]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      picked = (picked - 1 + treffer.length) % treffer.length;
      render();
      list.children[picked]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && picked >= 0) {
      e.preventDefault();
      pick(treffer[picked]);
    } else if (e.key === 'Escape') {
      zu();
    }
  });
}

/* The filter only takes effect on confirmation. Filtering while typing means:
   after every character all tiles disappear, because "/Volumes/…/pro" is not a
   directory yet. */
function applyFilter() {
  const wert = $('#pathFilter').value.trim().replace(/\/$/, '');
  if (wert === state.filter) return;
  state.filter = wert;
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
    plxrUI.notice(t('pane.tooMany', { n: MAX_PANES }), 'Genug geteilt');
    return;
  }
  const t = state.tiles.find((x) => x.id === id);
  if (!t) return;
  if (t.verwaist) {
    // The daemon ended while the session was running. With Claude Code the
    // Unterhaltung im Transkript — von dort geht es weiter.
    plxrUI.confirm(t('session.resumeAsk', { name: t.name, cwd: t.cwd }), 'Wiederaufnehmen?')
      .then(async (ja) => {
        if (!ja) return;
        try {
          const neu = await api.wiederaufnehmen(t.id);
          setTimeout(() => openSession(neu.id), 700);
        } catch (e) {
          plxrUI.notice(e.message || String(e), 'Nicht wiederaufgenommen');
        }
      });
    return;
  }
  if (!t.alive) {
    // A dead PTY has no stream any more — the pane would stay empty.
    plxrUI.notice(
      t('session.endedHint', { name: t.name, code: t.exit_code }),
      t('session.inactive'));
    return;
  }

  showOnly(null);
  $('#viewSession').hidden = false;
  $('#rulesPane').hidden = true;
  $('#viewer').hidden = true;

  const el = document.createElement('div');
  el.className = 'pane';
  el.dataset.id = id;
  el.innerHTML = `<span class="panelabel"></span><button class="paneclose" data-tip="${t('pane.closeTip')}">✕</button><div class="pterm"></div>`;
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
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
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
    // aufgehellt, bis sie lesbar sind.
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
    if (api.fenster) Native.OpenURL?.(url); else window.open(url, '_blank', 'noopener');
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

  const eintrag = { id, term, fit, search, serial, el };
  panes.set(id, eintrag);
  state.panes.push(id);

  const nachziehen = () => paneRefit(eintrag);
  let timer;
  eintrag.ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(nachziehen, 60); });
  eintrag.ro.observe(el.querySelector('.pterm'));

  const aufDaten = (daten) => term.write(daten);
  const aufEnde = (grund) => {
    term.write(grund === 'leitung'
      ? `\r\n[plxr] ${t('pane.lostLine')}\r\n`
      : `\r\n[plxr] ${t('pane.endedLine')}\r\n`);
  };
  attachments.set(id, { aufDaten, aufEnde, beiNeu: () => term.write('\r\n[plxr] wieder verbunden.\r\n') });
  api.attach(id, aufDaten, aufEnde);
  requestAnimationFrame(() => { nachziehen(); term.focus(); });

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
  if (state.aktiv === id && panes.has(id)) return;
  state.aktiv = id;
  for (const p of paneList()) p.el.dataset.aktiv = p.id === id ? 'ja' : 'nein';
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
  if (state.aktiv === id) state.aktiv = state.panes[0] || null;
  if (!state.panes.length) showGrid();
  else { paneActivate(state.aktiv); for (const q of paneList()) paneRefit(q); }
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
  state.aktiv = null;
}

function updateHeader() {
  const t = state.tiles.find((x) => x.id === state.aktiv);
  if (!t) return;
  $('#sessTitle').textContent = t.title || t.name;
  $('#sessMeta').textContent = [t.cwd, t.branch].filter(Boolean).join('  ·  ');
  fillAccounts('#sessAccount').then(() => { if (t.account) $('#sessAccount').value = t.account; });
}

$('#sessKill').addEventListener('click', async () => {
  if (!state.aktiv) return;
  const t = state.tiles.find((x) => x.id === state.aktiv);
  if (!(await plxrUI.confirm(t?.name || '', t('session.killAsk')))) return;
  await api.beenden(state.aktiv);
  closePane(state.aktiv);
});

/* ═════════════════════════ Suche im Terminal ═════════════════════════ */

function openFind() {
  if (!state.aktiv) return;
  $('#find').hidden = false;
  $('#findInput').focus();
  $('#findInput').select();
}

function closeFind() {
  $('#find').hidden = true;
  const p = panes.get(state.aktiv);
  try { p?.search.clearDecorations(); } catch {}
  p?.term.focus();
}

/* While typing, search from the start rather than from the last hit.
   Otherwise "err" lands three hits further along than expected. */
function findInTerminal(backwards, vonVorn) {
  const p = panes.get(state.aktiv);
  if (!p) return;
  const q = $('#findInput').value;
  if (!q) { $('#findCount').textContent = ''; try { p.search.clearDecorations(); } catch {} return; }

  // Register the counter the first time this pane needs it.
  if (!p.counterBound) {
    p.counterBound = true;
    try {
      p.search.onDidChangeResults((r) => {
        $('#findCount').textContent = !r || !r.resultCount
          ? t('find.noHit')
          : t('find.count', { i: r.resultIndex + 1, n: r.resultCount });
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
  if (!gefunden) $('#findCount').textContent = t('find.noHit');
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

const SHORTCUTS = [
  ['t', () => $('#newBtn').click(),                     t('new.title2')],
  ['w', () => state.aktiv && closePane(state.aktiv), t('pane.closeTip')],
  ['f', () => ($('#viewer').hidden ? openFind() : openFindInFile()), 'suchen'],
  ['.', emergencyBrake,                                        'Notbremse'],
  ['d', () => $('#splitAdd').click(),                    'teilen'],
  [',', openSettings,                            'Einstellungen'],
  ['0', () => changeFontSize(0),                         t('key.fontReset')],
  ['+', () => changeFontSize(1),                         t('key.fontBigger')],
  ['=', () => changeFontSize(1),                         t('key.fontBigger')],
  ['-', () => changeFontSize(-1),                        'Schrift kleiner'],
];

function changeFontSize(richtung) {
  const jetzt = styleState.termSize || paneList()[0]?.term.options.fontSize || 13;
  styleState.termSize = richtung === 0 ? 13 : Math.min(28, Math.max(8, jetzt + richtung));
  forEachPane((p) => { p.term.options.fontSize = styleState.termSize; paneRefit(p); });
}

document.addEventListener('keydown', (e) => {
  const cmd = e.metaKey && !e.ctrlKey && !e.altKey;
  const strgUmschalt = e.ctrlKey && e.shiftKey && !e.metaKey;
  if (!cmd && !strgUmschalt) return;

  // Cmd+1..9 jumps to the session at that position in the rail.
  if (cmd && /^[1-9]$/.test(e.key)) {
    const alle = [...$('#railList').querySelectorAll('.railitem[data-id]')];
    const ziel = alle[parseInt(e.key, 10) - 1];
    if (ziel) { e.preventDefault(); ziel.click(); }
    return;
  }

  const treffer = SHORTCUTS.find(([taste]) => taste === e.key.toLowerCase());
  if (!treffer) return;

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
  treffer[1]();
});

$('#filesToggle').addEventListener('click', () => {
  const f = $('#files');
  f.hidden = !f.hidden;
  $('#filesToggle').classList.toggle('on', !f.hidden);
  // On opening, the tree has to be loaded: while the panel was closed,
  // hat dateibaumLaden nichts getan.
  if (!f.hidden) {
    const t = state.tiles.find((x) => x.id === state.aktiv);
    if (t) loadFileTree(t);
  }
  for (const p of paneList()) paneRefit(p);
});

/* Split the pane: put a second session alongside. */
$('#splitAdd').addEventListener('click', () => {
  const frei = state.tiles.filter((t) => !state.panes.includes(t.id));
  if (!frei.length) { plxrUI.notice(t('split.noOther'), 'Nichts zum Teilen'); return; }
  const box = $('#splitList');
  box.innerHTML = '';
  for (const t of frei) {
    const b = document.createElement('button');
    b.className = 'splitRow';
    b.innerHTML = '<span class="dot"></span><span class="rname"></span>';
    const st = t.status || 'unknown';
    b.querySelector('.dot').className = 'dot ' + st;
    b.querySelector('.dot').textContent = ZEICHEN[st] || '·';
    b.querySelector('.rname').textContent = (t.title || t.name) + '  ·  ' + t.project;
    b.addEventListener('click', () => { $('#splitPick').hidden = true; addPane(t.id); });
    box.appendChild(b);
  }
  $('#splitPick').hidden = false;
});
$('#splitCancel').addEventListener('click', () => { $('#splitPick').hidden = true; });

/* Every dialog closes with Escape and with a click beside it. A window that
   only one particular button leads out of is a trap. */
const DIALOGE = ['#settings', '#splitPick', '#vorlagen', '#dialog'];
for (const d of DIALOGE) {
  $(d).addEventListener('mousedown', (e) => { if (e.target === $(d)) $(d).hidden = true; });
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const d of DIALOGE) if (!$(d).hidden) { $(d).hidden = true; return; }
  if (!$('#find').hidden) { closeFind(); return; }
  if (!$('#viewer').hidden) { closeViewer(); return; }
  if (!$('#rulesPane').hidden) { $('#rulesPane').hidden = true; return; }
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
    kontenCache = kontenCache || await api.konten();
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
  const ziel = e.target.value;
  const t = state.tiles.find((x) => x.id === state.aktiv);
  if (!t || t.account === ziel) return;
  const weiter = await plxrUI.confirm(
    t('session.switchAsk', { account: ziel }), t('session.switchTitle'));
  if (!weiter) { e.target.value = t.account || ''; return; }
  try {
    const neu = await api.kontoWechseln(state.aktiv, ziel);
    closePane(state.aktiv);
    setTimeout(() => openSession(neu.id), 700);
  } catch (err) {
    plxrUI.notice(err.message || String(err), 'Wechsel fehlgeschlagen');
    e.target.value = t.account || '';
  }
});

/* ═════════════════════════ Dateibaum ═════════════════════════ */

const baum = { wurzel: '', rauschen: false };

$('#noiseToggle').addEventListener('click', () => {
  baum.rauschen = !baum.rauschen;
  $('#noiseToggle').classList.toggle('on', baum.rauschen);
  const t = state.tiles.find((x) => x.id === state.aktiv);
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
  baum.wurzel = t.cwd;
  $('#filesRoot').textContent = t.cwd;
  const box = $('#filetree');
  box.innerHTML = '';
  await renderMarkLayer(box, t.cwd, 0, t.id);
}

async function renderMarkLayer(box, dir, tiefe, sid) {
  const entries = await api.ordner(sid, dir);
  if (tiefe === 0 && (!entries || !entries.length)) {
    showEmpty(box, 'leerer ordner', t('file.nothingHere'));
    return;
  }
  for (const e of entries || []) {
    if (e.noise && !baum.rauschen) continue;

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

const datei = { sid: null, pfad: null, mod: 0, original: '', binary: false };

function setDirty(ja) {
  $('#viewerDirty').hidden = !ja;
  $('#viewerSave').disabled = !ja;
}

async function openFile(e, sid) {
  try {
    const c = await api.datei(sid, e.path);
    datei.sid = sid;
    datei.pfad = c.path;
    datei.mod = c.mod;
    datei.binary = c.binary;
    datei.original = c.binary ? '' : c.text;

    $('#viewerName').textContent = e.name;
    $('#viewerMeta').textContent = c.binary
      ? t('file.binary')
      : `${c.lines} Zeilen · ${(c.size / 1024).toFixed(1)} kB` +
        (c.truncated ? t('file.truncated') : '');

    const field = $('#viewerBody');
    field.value = datei.original;
    // Truncated means: we do not have the whole file. Saving that would
    // cut off the rest.
    field.readOnly = c.binary || c.truncated;
    $('#viewerSave').hidden = field.readOnly;
    setDirty(false);

    $('#rulesPane').hidden = true;
    $('#viewer').hidden = false;
  } catch (err) {
    plxrUI.notice(err.message || String(err), t('file.unreadable'));
  }
}

$('#viewerBody').addEventListener('input', () => {
  setDirty($('#viewerBody').value !== datei.original);
});

// Tab belongs in the text, not on the next button.
$('#viewerBody').addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const f = e.target;
  const a = f.selectionStart, b = f.selectionEnd;
  f.value = f.value.slice(0, a) + '\t' + f.value.slice(b);
  f.selectionStart = f.selectionEnd = a + 1;
  setDirty(f.value !== datei.original);
});

async function saveFile() {
  if ($('#viewerSave').hidden || $('#viewerSave').disabled) return;
  const text = $('#viewerBody').value;
  $('#viewerSave').disabled = true;
  try {
    const c = await api.dateiSchreiben(datei.sid, datei.pfad, text, datei.mod);
    datei.mod = c.mod;
    datei.original = text;
    setDirty(false);
    $('#viewerMeta').textContent = `${c.lines} Zeilen · ${(c.size / 1024).toFixed(1)} kB · gespeichert`;
  } catch (err) {
    setDirty(true);
    plxrUI.notice(err.message || String(err), 'Nicht gespeichert');
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
    const weg = await plxrUI.confirm(
      t('file.discardHint', { name: $('#viewerName').textContent }), t('file.discardAsk'));
    if (!weg) return;
  }
  setDirty(false);
  $('#viewer').hidden = true;
}
$('#viewerClose').addEventListener('click', closeViewer);

/* ── Find inside the file editor ──
   A <textarea> brings no search of its own, and the window has no browser bar
   to step in. So we build one — the same bar as in the terminal, so it looks
   right in every skin without further work. */
const fileFind = { treffer: [], index: -1, source: null };

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
  fileFind.treffer = [];
  fileFind.index = -1;
  fileFind.source = null;
  $('#viewerBody').focus();
}

// All hits at once, otherwise the counter cannot be right.
function editorCollectHits() {
  const text = $('#viewerBody').value;
  const q = $('#findInFileInput').value;
  fileFind.source = text;
  fileFind.treffer = [];
  fileFind.index = -1;
  if (q) {
    const heu = text.toLowerCase();
    const nadel = q.toLowerCase();
    for (let i = heu.indexOf(nadel); i !== -1; i = heu.indexOf(nadel, i + nadel.length)) {
      fileFind.treffer.push(i);
    }
  }
  editorShowCount();
}

function editorShowCount() {
  const stand = $('#findInFileCount');
  if (!$('#findInFileInput').value) { stand.textContent = ''; return; }
  if (!fileFind.treffer.length) { stand.textContent = t('find.noHit'); return; }
  stand.textContent = t('find.count', { i: Math.max(fileFind.index, 0) + 1, n: fileFind.treffer.length });
}

function editorJump(backwards) {
  const body = $('#viewerBody');
  // Typing on with the find field open changes the text under the hits.
  if (body.value !== fileFind.source) editorCollectHits();
  const q = $('#findInFileInput').value;
  if (!q || !fileFind.treffer.length) { editorShowCount(); return; }

  if (fileFind.index === -1) {
    // The first jump starts from where the cursor sits.
    const ab = body.selectionStart;
    const i = fileFind.treffer.findIndex((p) => p >= ab);
    fileFind.index = backwards
      ? (i <= 0 ? fileFind.treffer.length - 1 : i - 1)
      : (i === -1 ? 0 : i);
  } else {
    const n = fileFind.treffer.length;
    fileFind.index = backwards ? (fileFind.index - 1 + n) % n : (fileFind.index + 1) % n;
  }

  const pos = fileFind.treffer[fileFind.index];
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

  const spalte = pos - (davor.lastIndexOf('\n') + 1);
  body.scrollLeft = Math.max(0, spalte * charWidth(st) - body.clientWidth / 2);
}

let charWidthCache = null;
function charWidth(st) {
  const font = `${st.fontSize} ${st.fontFamily}`;
  if (charWidthCache?.font === font) return charWidthCache.breite;
  const c = document.createElement('canvas').getContext('2d');
  c.font = font;
  const breite = c.measureText('0').width || parseFloat(st.fontSize) * 0.6;
  charWidthCache = { font, breite };
  return breite;
}

/* The highlight layer takes font and margins from the text field at runtime:
   every skin sets different values there, and a single pixel of drift shifts
   every highlight against the text below. */
function markLayerGeometry() {
  const st = getComputedStyle($('#viewerBody'));
  const lage = $('#viewerMarks').style;
  for (const eig of ['font', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
                     'letterSpacing', 'wordSpacing', 'tabSize', 'padding', 'margin',
                     'borderWidth', 'textIndent']) {
    lage[eig] = st[eig];
  }
}

const HTML_ZEICHEN = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const htmlSicher = (t) => t.replace(/[&<>]/g, (z) => HTML_ZEICHEN[z]);

// Past a certain size redrawing costs more than the highlight is worth —
// then the counter and the jumping have to do.
const MARK_GRENZE = 2 << 20;

function renderMarks() {
  const body = $('#viewerBody');
  const lage = $('#viewerMarks');
  const q = $('#findInFileInput').value;
  if ($('#findInFile').hidden || !q || !fileFind.treffer.length || body.value.length > MARK_GRENZE) {
    lage.textContent = '';
    return;
  }
  markLayerGeometry();
  const text = body.value;
  const teile = [];
  let ab = 0;
  fileFind.treffer.forEach((p, i) => {
    teile.push(htmlSicher(text.slice(ab, p)));
    teile.push(i === fileFind.index ? '<mark class="jetzt">' : '<mark>');
    teile.push(htmlSicher(text.slice(p, p + q.length)), '</mark>');
    ab = p + q.length;
  });
  teile.push(htmlSicher(text.slice(ab)));
  /* A trailing space: if the file ends with a line break the text field keeps an
     empty line for it, a <div> does not. Without that compensation the two
     layers scroll different distances, and at the end of the file every
     highlight would sit one line too high. */
  teile.push(' ');
  lage.innerHTML = teile.join('');
  markLayerScroll();
}

// Both layers have to show the same section.
function markLayerScroll() {
  const body = $('#viewerBody');
  const lage = $('#viewerMarks');
  lage.scrollTop = body.scrollTop;
  lage.scrollLeft = body.scrollLeft;
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
  daten: null,      // Uint8Array des Stroms
  marken: [],       // [{offset, at}]
  pos: 0,           // wie weit bereits geschrieben wurde
  running: false,
  tempo: 1,
  skipIdle: true,
  timer: null,
  id: null,
  beschnitten: false,
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
  $('#playerMeta').textContent = t('common.loading');
  player.id = id;

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
      api.wiedergabe(id),
      api.zeitachse(id),
    ]);
    player.daten = strom.daten;
    player.beschnitten = strom.beschnitten;
    player.marken = marken;
  } catch (e) {
    $('#playerMeta').textContent = '';
    closePlayer();
    plxrUI.notice(e.message || String(e), 'Keine Aufzeichnung');
    return;
  }

  player.pos = 0;
  $('#playerSeek').value = 0;
  playerShowPosition();

  // Coming from a search hit: straight to the spot.
  if (abOffset > 0) playerSeek(Math.min(abOffset, player.daten.length));
  playerPlay(true);
}

function closePlayer() {
  playerPause();
  $('#player').hidden = true;
  player.daten = null;
  player.marken = [];
  player.id = null;
}

/* How much time passed between two points in the stream. Without a timeline —
   a recording from before it existed — playback runs at a constant rate. */
function playerGap(vonOffset, bisOffset) {
  if (!player.marken.length) return 16;   // roughly one frame
  let a = null, b = null;
  for (const m of player.marken) {
    if (m.offset <= vonOffset) a = m;
    if (m.offset <= bisOffset) b = m;
  }
  if (!a || !b) return 16;
  return Math.max(0, b.at - a.at);
}

// The next mark past the current position — everything up to there is written
// geschrieben, danach gewartet.
function playerNextMark(pos) {
  for (const m of player.marken) if (m.offset > pos) return m.offset;
  return player.daten ? player.daten.length : pos;
}

function playerStep() {
  if (!player.running || !player.daten) return;
  if (player.pos >= player.daten.length) { playerPause(); return; }

  const bis = Math.min(playerNextMark(player.pos), player.daten.length);
  player.term.write(player.daten.subarray(player.pos, bis));
  const vorher = player.pos;
  player.pos = bis;
  playerShowPosition();

  let warten = playerGap(vorher, bis) / player.tempo;
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
function playerSeek(ziel) {
  if (!player.daten) return;
  const lief = player.running;
  playerPause();
  player.term.reset();
  player.pos = Math.max(0, Math.min(ziel, player.daten.length));
  if (player.pos > 0) player.term.write(player.daten.subarray(0, player.pos));
  playerShowPosition();
  if (lief) playerPlay(true);
}

function playerShowPosition() {
  if (!player.daten) return;
  const anteil = player.daten.length ? player.pos / player.daten.length : 0;
  const regler = $('#playerSeek');
  // Do not set it while it is being dragged.
  if (document.activeElement !== regler) regler.value = Math.round(anteil * 1000);

  const gesamt = player.marken.length > 1
    ? (player.marken[player.marken.length - 1].at - player.marken[0].at) / 1000
    : 0;
  $('#playerTime').textContent = gesamt
    ? `${playerClock(gesamt * anteil)} / ${playerClock(gesamt)}`
    : `${Math.round(anteil * 100)} %`;
  $('#playerMeta').textContent = player.beschnitten
    ? t('player.cut')
    : (player.marken.length ? '' : t('player.noTimeline'));
}

const playerClock = (sek) => {
  const m = Math.floor(sek / 60), s = Math.floor(sek % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

$('#playerClose').addEventListener('click', closePlayer);
$('#playerPlay').addEventListener('click', () => playerPlay(!player.running));
$('#playerSeek').addEventListener('input', (e) => {
  if (!player.daten) return;
  playerSeek(Math.round((e.target.value / 1000) * player.daten.length));
});
$('#playerSpeed').addEventListener('click', () => {
  const i = (PLAYER_SPEEDS.indexOf(player.tempo) + 1) % PLAYER_SPEEDS.length;
  player.tempo = PLAYER_SPEEDS[i];
  $('#playerSpeed').textContent = `${player.tempo}×`;
});
$('#playerSkipIdle').addEventListener('click', () => {
  player.skipIdle = !player.skipIdle;
  $('#playerSkipIdle').dataset.an = player.skipIdle ? 'ja' : '';
});
document.addEventListener('keydown', (e) => {
  if ($('#player').hidden) return;
  if (e.key === ' ') { e.preventDefault(); playerPlay(!player.running); }
  if (e.key === 'Escape') { e.preventDefault(); closePlayer(); }
}, true);

/* ═════════════════════════ Regeln ═════════════════════════ */

const ARTNAME = { global: 'global', projekt: 'projekt', lokal: 'lokal', import: 'import', skill: 'skill', agent: 'agent' };

$('#rulesToggle').addEventListener('click', async () => {
  if (!$('#rulesPane').hidden) { $('#rulesPane').hidden = true; return; }
  if (!state.aktiv) return;
  $('#viewer').hidden = true;
  $('#rulesPane').hidden = false;
  $('#rulesMeta').textContent = t('common.loading');
  const list = await api.regeln(state.aktiv);
  $('#rulesMeta').textContent = list.length === 1
    ? t('rules.oneFile')
    : t('rules.nFiles', { n: list.length });
  const box = $('#rulesBody');
  box.innerHTML = '';
  if (!list.length) {
    showEmpty(box, t('rules.none'),
      t('rules.noneHint'));
    return;
  }
  for (const e of list) {
    const row = document.createElement('div');
    row.className = 'rrow';
    row.dataset.art = e.art;
    row.innerHTML = '<span class="rart"></span><span class="rmain">' +
      '<b class="rtitle"></b><span class="rdesc"></span></span><span class="rpath"></span>';
    row.querySelector('.rart').textContent = ARTNAME[e.art] || e.art;
    row.querySelector('.rtitle').textContent = e.name;
    row.querySelector('.rdesc').textContent = e.description || '';
    row.querySelector('.rpath').textContent = e.path;
    row.dataset.tip = e.path;
    box.appendChild(row);
  }
});
$('#rulesClose').addEventListener('click', () => { $('#rulesPane').hidden = true; });

/* An empty list without an explanation is a state that looks like a failure.
   Every list says why it is empty. */
function showEmpty(box, titel, text) {
  box.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'emptyNote';
  d.innerHTML = '<b></b><span></span>';
  d.querySelector('b').textContent = titel;
  d.querySelector('span').textContent = text;
  box.appendChild(d);
}

/* ═════════════════════════ Archiv ═════════════════════════ */

/* The archived transcripts are a large part of why plxr exists: they lie
   scattered across dozens of project folders, and the built-in picker shows
   only the current directory by default. */

const archiv = { alle: [], search: '', treffer: null, terminals: null };

async function loadArchive() {
  $('#archInfo').textContent = t('common.loading');
  await fillAccounts('#archAccount');
  archiv.alle = await api.archiv(state.filter);
  archiv.treffer = null;
  archiv.terminals = null;
  $('#archiveCount').textContent = archiv.alle.length;
  renderArchive();
}

$('#archSearch').addEventListener('input', (e) => {
  archiv.search = e.target.value.toLowerCase();
  archiv.treffer = null;
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
  $('#archInfo').textContent = 'durchsuche alle Terminalmitschnitte …';
  try {
    archiv.terminals = await api.searchTerminals(q);
    archiv.treffer = null;
    renderArchive();
  } catch (e) {
    $('#archInfo').textContent = 'Suche fehlgeschlagen: ' + (e.message || e);
  }
}

/* Searching titles finds only what is in the title. The actual question is
   usually "where did I do that once" — and for that every message has to be
   walked. Takes a few seconds, hence on request. */
async function fullTextSearch() {
  const q = $('#archSearch').value.trim();
  if (q.length < 2) return;
  $('#archInfo').textContent = 'durchsuche alle Transkripte …';
  try {
    archiv.treffer = await api.search(q);
    renderArchive();
  } catch (e) {
    $('#archInfo').textContent = 'Suche fehlgeschlagen: ' + (e.message || e);
  }
}

function shortDate(ms) {
  return new Date(ms).toLocaleString('de-DE',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function resumeSession(id, konto) {
  try {
    const s = await api.archiveResume(id, konto, $('#archAccount').value);
    showGrid();
    setTimeout(() => openSession(s.id), 500);
  } catch (err) {
    plxrUI.notice(err.message || String(err), 'Fortsetzen fehlgeschlagen');
  }
}

function renderArchive() {
  const box = $('#archList');
  box.innerHTML = '';

  if (archiv.terminals) {
    const wonach = $('#archSearch').value.trim();
    $('#archInfo').textContent = archiv.terminals.length === 1
      ? t('archive.oneTerminal', { q: wonach })
      : `${archiv.terminals.length} Terminals enthalten „${wonach}"`;
    if (!archiv.terminals.length) {
      showEmpty(box, t('archive.noTerminal'),
        t('archive.noTerminalHit', { q: wonach }));
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
      row.querySelector('.hitExcerpt').textContent = t.auszug;
      row.querySelector('.hitProject').textContent = t.cwd ? t.cwd.split('/').pop() : '';
      row.querySelector('.hitValue').textContent = t.anzahl + '×';
      row.dataset.tip = t.cwd || '';

      /* What came after is the actual find: the same error has been seen three
         times already — what is wanted is the command that fixed it back
         then. */
      if (t.danach?.length) {
        const nach = document.createElement('pre');
        nach.className = 'hitAfter';
        nach.textContent = t.danach.join('\n');
        row.appendChild(nach);
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

  if (archiv.treffer) {
    const wonach = $('#archSearch').value.trim();
    $('#archInfo').textContent = archiv.treffer.length === 1
      ? t('archive.oneSession', { q: wonach })
      : t('archive.nSessions', { n: archiv.treffer.length, q: wonach });
    if (!archiv.treffer.length) {
      showEmpty(box, t('find.noHit'),
        t('archive.noFullTextHit', { q: wonach }));
      return;
    }
    for (const t of archiv.treffer) {
      const row = document.createElement('div');
      row.className = 'row tall';
      row.innerHTML =
        '<span class="hitDate"></span>' +
        '<span class="hitMain"><b class="hitTitle"></b><span class="hitExcerpt"></span></span>' +
        '<span class="hitProject"></span><span class="hitValue"></span>' +
        '<span class="hitAction"><button class="btn">FORTSETZEN</button></span>';
      row.querySelector('.hitDate').textContent = shortDate(t.mod);
      row.querySelector('.hitTitle').textContent = t.title || '(ohne Titel)';
      row.querySelector('.hitExcerpt').textContent = t.auszug;
      row.querySelector('.hitProject').textContent = t.project;
      row.querySelector('.hitValue').textContent = t.anzahl + '×';
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
    ? archiv.alle.filter((e) =>
        (e.title || '').toLowerCase().includes(q) ||
        (e.project || '').toLowerCase().includes(q) ||
        (e.cwd || '').toLowerCase().includes(q))
    : archiv.alle;

  $('#archInfo').textContent = q
    ? t('find.count', { i: list.length, n: archiv.alle.length })
    : `${archiv.alle.length} ${archiv.alle.length === 1 ? 'Transkript' : 'Transkripte'}`;

  if (!list.length) {
    if (archiv.alle.length) {
      showEmpty(box, t('archive.noTitleHit'),
        'Eingabetaste durchsucht stattdessen den vollen Text aller Transkripte.');
    } else if (state.filter) {
      showEmpty(box, t('archive.noneUnderPath'),
        t('archive.filtered', { path: state.filter }));
    } else {
      showEmpty(box, t('archive.none'),
        'Hier erscheinen abgelegte Claude-Code-Unterhaltungen, sobald welche existieren.');
    }
    return;
  }

  for (const e of list.slice(0, 400)) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML =
      '<span class="hitDate"></span><span class="hitTitle"></span><span class="hitProject"></span>' +
      '<span class="hitSmall"></span><span class="hitValue"></span>' +
      `<span class="hitAction"><button class="btn" data-t="auf">${t('archive.resume')}</button>` +
      `<button class="btn" data-t="weg">${t('common.delete')}</button></span>`;
    row.querySelector('.hitDate').textContent = shortDate(e.mod);
    row.querySelector('.hitTitle').textContent = e.title || '(ohne Titel)';
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
      const weg = await plxrUI.confirm(`${e.title || e.id}\n${e.cwd}`, t('archive.deleteAsk'));
      if (!weg) return;
      try {
        await api.archiveDelete(e.id, e.account);
        archiv.alle = archiv.alle.filter((x) => x.id !== e.id);
        renderArchive();
      } catch (err) {
        plxrUI.notice(err.message || String(err), t('archive.deleteFailed'));
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
  $('#portsInfo').textContent = 'liest …';
  const list = await api.ports();
  $('#portsCount').textContent = list.length;
  $('#portsInfo').textContent = list.length === 1
    ? 'Ein lauschender Port'
    : `${list.length} lauschende Ports`;
  const box = $('#portsList');
  box.innerHTML = '';
  if (!list.length) {
    showEmpty(box, t('ports.none'),
      t('ports.noneHint'));
    return;
  }
  for (const p of list) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.eigen = p.eigen ? 'ja' : 'nein';
    row.innerHTML =
      '<span class="hitDate"></span><span class="hitTitle"></span><span class="hitProject"></span>' +
      '<span class="hitValue"></span>' +
      '<span class="hitAction"><button class="btn" data-h="0">BEENDEN</button>' +
      '<button class="btn" data-h="1">HART</button></span>';
    row.querySelector('.hitDate').textContent = p.port;
    row.querySelector('.hitTitle').textContent = p.command + (p.eigen ? '  · plxr-session' : '');
    row.querySelector('.hitProject').textContent = p.addr;
    row.querySelector('.hitValue').textContent = 'pid ' + p.pid;
    for (const hart of [false, true]) {
      row.querySelector(`[data-h="${hart ? 1 : 0}"]`).addEventListener('click', async () => {
        const wie = hart ? 'HART beenden (SIGKILL)' : 'beenden (SIGTERM)';
        const ja = await plxrUI.confirm(`${p.command}, pid ${p.pid}`, `Port ${p.port} ${wie}?`);
        if (!ja) return;
        try { await api.portBeenden(p.pid, hart); setTimeout(loadPorts, 500); }
        catch (e) { plxrUI.notice(e.message || String(e), 'Beenden fehlgeschlagen'); }
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
  $('#usageInfo').textContent = 'rechnet …';
  const b = await api.verbrauch($('#usageRange').value);
  $('#usageInfo').textContent =
    `${b.dateien} ${b.dateien === 1 ? 'Transkript' : 'Transkripte'} · ${b.dauer}`;

  const box = $('#usageBody');
  box.innerHTML = '';

  const summe = document.createElement('div');
  summe.className = 'usum';
  for (const [wert, was] of [
    [b.summe.aus, 'ausgabe'],
    [b.summe.ein, 'eingabe'],
    [b.summe.cacheNeu, 'cache geschrieben'],
    [b.summe.cacheLesen, 'cache gelesen'],
    [b.summe.nachrichten, 'antworten'],
  ]) {
    const d = document.createElement('div');
    d.className = 'ubox';
    d.innerHTML = '<b class="ubig"></b><span></span>';
    d.querySelector('b').textContent = tok(wert);
    d.querySelector('span').textContent = was;
    summe.appendChild(d);
  }
  box.appendChild(summe);

  const gesamt = (z) => z.ein + z.aus + z.cacheNeu + z.cacheLesen;
  const block = (titel, rows, grenze) => {
    if (!rows || !rows.length) return;
    const d = document.createElement('div');
    d.className = 'ublock';
    d.innerHTML = '<b class="uhead"></b>';
    d.querySelector('.uhead').textContent = titel;
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

  if (!b.nachTag.length) {
    showEmpty(box, t('usage.none'),
      t('usage.noneHint'));
    return;
  }

  block('nach Tag', b.nachTag, 30);
  block('nach Projekt', b.nachProjekt, 12);
  block('nach Modell', b.nachModell, 8);
  block(t('usage.byAccount'), b.nachKonto, 8);
}

/* ═════════════════════════ Spending pace ═════════════════════════

   Claude works in rolling windows — five hours and a week. Running several
   agents at once blows the five-hour window without seeing it coming. Here is
   the pace, before it is too late.

   plxr does not know the absolute limit — that depends on the plan and is
   published nowhere. So it does not claim when the end comes, it shows how fast
   things are going right now and whether the pace is rising. */

const TREND = { steigt: '↑', falling: '↓', gleich: '·' };

function tokShort(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + ' Mrd';
  if (n >= 1e6) return (n / 1e6).toFixed(0) + ' Mio';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' Tsd';
  return String(n);
}

async function checkPace() {
  let t;
  try { t = await api.tempo(); } catch { return; }
  const el = $('#pace');
  if (!t.proStunde && !t.fenster5h) { el.hidden = true; return; }

  el.hidden = false;
  el.textContent =
    `${tokShort(t.proStunde)}/h ${TREND[t.trend] || ''} · 5h ${tokShort(t.fenster5h)}` +
    (t.aktive ? ` · ${window.t('pace.active', { n: t.aktive })}` : '');
  el.title =
    t('pace.tooltip', {
      hour: t.proStunde.toLocaleString(sprache),
      window5h: t.fenster5h.toLocaleString(sprache),
      active: t.aktive,
    });

  // Past three billion an hour it gets tight on the common plans — that is a
  // mark from experience, not an official limit.
  el.dataset.warnung = t.proStunde > 3e9 && t.trend !== 'faellt' ? 'ja' : '';
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

async function checkVersion(erzwingen) {
  const jetzt = Date.now();
  if (!erzwingen && jetzt - versionCheckedAt < VERSION_THROTTLE) return;
  versionCheckedAt = jetzt;
  try {
    const st = await api.version();
    versionStatus = st;
    if (!st.available) { $('#updateBar').hidden = true; return; }
    if (localStorage.getItem('plxr.updateIgnoriert') === st.latest) return;
    $('#updateText').textContent =
      t('update.banner', { latest: st.latest, current: st.aktuell }) +
      (st.resize ? ` · ${(st.resize / (1 << 20)).toFixed(1)} MB` : '');
    $('#updateBar').hidden = false;
  } catch {}
}

$('#updateHide').addEventListener('click', () => {
  if (versionStatus) localStorage.setItem('plxr.updateIgnoriert', versionStatus.latest);
  $('#updateBar').hidden = true;
});
$('#updateNotes').addEventListener('click', () => {
  plxrUI.notice(versionStatus?.notizen || t('update.noNotes'), t('update.notesTitle'));
});
/* The flow you expect: notice, click, progress bar, restart. The sessions
   notice none of it — they belong to the daemon, and it keeps running. Only the
   window comes back new. */
$('#updateGo').addEventListener('click', async () => {
  const ja = await plxrUI.confirm(
    t('update.confirm'),
    t('update.installAsk', { v: versionStatus?.latest || '' }));
  if (!ja) return;

  $('#updateGo').disabled = true;
  $('#updateNotes').hidden = true;
  $('#updateHide').hidden = true;
  $('#updateProgress').hidden = false;

  try {
    await api.aktualisieren();
  } catch (e) {
    updateFehler(e.message || String(e));
    return;
  }
  updateVerfolgen();
});

function updateFehler(text) {
  $('#updateText').textContent = 'fehlgeschlagen: ' + text;
  $('#updateProgress').hidden = true;
  $('#updateGo').disabled = false;
  $('#updateNotes').hidden = false;
  $('#updateHide').hidden = false;
}

function updateVerfolgen() {
  const tick = setInterval(async () => {
    let st;
    try {
      st = await api.updateStand();
    } catch {
      return; // connection briefly gone — back on the next attempt
    }
    $('#updateFill').style.width = st.prozent + '%';
    $('#updateText').textContent =
      st.phase === t('update.loading') ? t('update.progress', { pct: st.prozent }) : st.phase;

    if (!st.fertig) return;
    clearInterval(tick);

    if (st.fehler) { updateFehler(st.fehler); return; }

    $('#updateText').textContent = 'fertig — startet neu';
    $('#updateFill').style.width = '100%';
    // Leave it up briefly so it is visible that it worked.
    setTimeout(async () => {
      try {
        await api.neuStarten();
        // The new version is running now. This window bows out —
        // the daemon stays, so the sessions notice nothing.
        if (WAILS) Native.Quit();
      } catch {
        $('#updateText').textContent = t('update.installed');
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
  const zuletzt = localStorage.getItem('plxr.startart') || 'shell';
  for (const w of STARTBAR) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choiceButton';
    b.dataset.id = w.id;
    b.textContent = w.id === 'shell' ? `Shell (${shellCmd[0].split('/').pop()})` : w.label;
    b.addEventListener('click', () => setChoice(w.id));
    box.appendChild(b);
  }
  setChoice(zuletzt);
}

function setChoice(id) {
  for (const b of $('#newCmdChoice').children) b.dataset.picked = b.dataset.id === id ? 'ja' : 'nein';
  $('#newCmdInput').hidden = id !== 'eigenes';
  localStorage.setItem('plxr.startart', id);
  if (id === 'eigenes') $('#newCmd').focus();
}

function chosenCommand() {
  const id = [...$('#newCmdChoice').children].find((b) => b.dataset.picked === 'ja')?.dataset.id || 'shell';
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
    d.innerHTML = `<b>${t('templates.none')}</b><span>${t('templates.noneHint')}</span>`;
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
        if (r.teilweise) plxrUI.notice(r.teilweise, t('templates.startFailed'));
      } catch (e) {
        plxrUI.notice(e.message || String(e), 'Nicht gestartet');
      }
    });

    row.querySelector('[data-t="weg"]').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!(await plxrUI.confirm(v.label, t('templates.deleteAsk')))) return;
      try { await api.templateDelete(v.name); openTemplates(); }
      catch (e) { plxrUI.notice(e.message || String(e), t('theme.notDeleted')); }
    });
    box.appendChild(row);
  }
}

$('#templatesSave').addEventListener('click', async () => {
  const offen = state.tiles.filter((t) => t.alive).length;
  if (!offen) { plxrUI.notice(t('templates.nothingToSave'), t('templates.nothingToSaveTitle')); return; }
  const label = await plxrUI.prompt(
    t(offen === 1 ? 'templates.saveAskOne' : 'templates.saveAskMany', { n: offen }),
    t('templates.nameAsk'), 'Arbeitstag');
  if (!label) return;
  const name = label.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  try {
    await api.templateSave(name, label);
    openTemplates();
  } catch (e) {
    plxrUI.notice(e.message || String(e), 'Nicht gespeichert');
  }
});

$('#newBtn').addEventListener('click', async () => {
  $('#newCwd').value = state.filter || localStorage.getItem('plxr.lastCwd') || '';
  await Promise.all([fillAccounts('#newAccount'), fillChoice()]);
  $('#dialog').hidden = false;
  $('#newCwd').focus();
});
$('#newCancel').addEventListener('click', () => { $('#dialog').hidden = true; });

// Der Ordnerdialog des Systems gibt es nur im Fenster.
if (api.fenster) {
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
    const s = await api.starten(cwd, cmd, $('#newAccount').value);
    localStorage.setItem('plxr.lastCwd', cwd);
    $('#dialog').hidden = true;
    setTimeout(() => openSession(s.id), 400);
  } catch (err) {
    plxrUI.notice(err.message || String(err), 'Start fehlgeschlagen');
  }
});

/* ═════════════════════════ Start ═════════════════════════ */

/* Apply the last used theme from the cache first, only then talk to the
   daemon — that way the UI is never unstyled, even when the daemon is away. */
(function themeAusSpeicher() {
  try {
    const roh = localStorage.getItem('plxr.themeCache');
    applyTheme(roh ? JSON.parse(roh) : { name: 'crt-amber', skin: 'crt', palette: {} });
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

setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('de-DE'); }, 1000);

// Register our own tooltips — title="" would be a box from the system.
plxrUI.tippBinden();

/* Emergency brake.

   The case it exists for: a command that must not run appears in a tile, and
   there are two seconds. Which of the four sessions it was gets sorted out
   afterwards — so one grab stops them all. Nothing is lost doing it; the
   sessions stand still and later carry on exactly where they were.

   Deliberately without a confirmation: a safety prompt in front of an emergency
   brake is the same as no brake at all. The second click undoes it. */
async function emergencyBrake() {
  const button = $('#brake');
  if (button.dataset.an === 'ja') {
    try {
      const r = await api.unfreeze();
      button.dataset.an = '';
      button.textContent = t('header.brake');
      document.documentElement.dataset.eingefroren = '';
      $('#counts').textContent = t('brake.resumed', { n: r.fortgesetzt });
    } catch (e) { plxrUI.notice(e.message || String(e), t('brake.notResumed')); }
    return;
  }
  try {
    const r = await api.emergencyBrake();
    if (!r.betroffen) { plxrUI.notice(t('brake.nothingRunning'), 'Nichts anzuhalten'); return; }
    button.dataset.an = 'ja';
    button.textContent = t('header.brakeRelease');
    document.documentElement.dataset.eingefroren = 'ja';
    $('#counts').textContent = r.eingefroren === r.betroffen
      ? t('brake.halted', { n: r.eingefroren })
      : t('brake.partial', { done: r.eingefroren, total: r.betroffen });
  } catch (e) { plxrUI.notice(e.message || String(e), 'Notbremse fehlgeschlagen'); }
}
$('#brake').addEventListener('click', emergencyBrake);

pathComplete($('#pathFilter'), applyFilter);
pathComplete($('#newCwd'));

state.filter = localStorage.getItem('plxr.filter') || '';
$('#pathFilter').value = state.filter;

/* Sprache vor allem anderen: die Oberfläche darf nie kurz auf Englisch
   aufblitzen und dann umspringen. Scheitert das Laden, bleiben die Schlüssel
   stehen — sichtbar kaputt ist besser als leer. */
spracheLaden()
  .then(markupUebersetzen)
  .catch((e) => console.error('Sprachdatei:', e))
  .then(connect)
  .then(() => loadThemes())
  .then(() => {
    api.aufZustand(renderAll);
    checkVersion(true);
    // If an update was still running in the last window, keep following it here.
    api.updateStand().then((st) => {
      if (st.running) { $('#updateBar').hidden = false; $('#updateProgress').hidden = false; updateVerfolgen(); }
    }).catch(() => {});
    setInterval(checkVersion, VERSION_INTERVAL);
  })
  .catch(() => reconnect());
