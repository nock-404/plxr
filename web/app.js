/* plxr — Oberfläche.

   Läuft in zwei Umgebungen: im Wails-Fenster und im Browser (`plxr --browser`).
   Der Unterschied steckt vollständig in `connect()` und den beiden Aufrufen an
   die Wails-Bindungen; alles darüber weiß nichts davon.

   Gesprochen wird immer mit dem Daemon über HTTP und WebSocket. Der Daemon ist
   ein eigener Prozess: Sessions überleben das Schließen des Fensters, und es
   dürfen mehrere Clients gleichzeitig zusehen.
*/

const $ = (s) => document.querySelector(s);

const state = {
  tiles: [],        // letzter bekannter Gesamtzustand
  filter: '',       // Pfadfilter
  panes: [],        // Session-IDs der offenen Terminalflächen
  aktiv: null,      // welche davon die Kopfleiste bedient
  themes: [],
};

/* ═════════════════════════ Transport ═════════════════════════ */

const WAILS = !!(window.go && window.go.main && window.go.main.App);
const Native = WAILS ? window.go.main.App : null;

/* Im Fenster, aber ohne gebundene Methoden: dann findet die Oberfläche den
   Daemon nicht und bliebe stumm weiß. Lieber laut sein — das passiert, wenn
   jemand ohne Bindungen baut. */
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
    // Fragt Go jedes Mal neu — dort wird bei Bedarf ein Daemon gestartet.
    const d = await Native.Daemon();
    BASE = d.url;
    TOKEN = d.token;
    return;
  }
  BASE = location.origin;
  // Das Token kommt einmal über die Adresse. Danach liegt es im
  // sessionStorage, damit ein Neuladen die Verbindung nicht verliert, und
  // verschwindet aus der Adresszeile, damit es nicht im Verlauf landet.
  const ausURL = new URLSearchParams(location.search).get('token');
  if (ausURL) {
    TOKEN = ausURL;
    try { sessionStorage.setItem('plxr.token', ausURL); } catch {}
    history.replaceState(null, '', location.pathname);
  } else {
    try { TOKEN = sessionStorage.getItem('plxr.token') || ''; } catch {}
  }
  if (!TOKEN) throw new Error('kein Token — plxr über die App oder `plxr --browser` öffnen');
}

const wsURL = (p) =>
  BASE.replace(/^http/, 'ws') + p + (p.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN);

async function req(pfad, opts = {}) {
  let r;
  try {
    r = await fetch(BASE + pfad, { ...opts, headers: { 'X-Plxr-Token': TOKEN, ...(opts.headers || {}) } });
  } catch (e) {
    // Netzwerkfehler heißt hier: der Daemon ist weg. Nicht dem Aufrufer
    // aufbürden, sondern die Wiederverbindung anstoßen.
    neuVerbinden();
    throw e;
  }
  if (r.status === 403) { neuVerbinden(); throw new Error('Token abgelaufen'); }
  if (!r.ok) throw new Error((await r.text()).trim() || r.statusText);
  return r.status === 204 ? null : r.json();
}

const b64 = (s) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/* Wer hängt gerade an welcher Session. Nötig, um nach einem Daemon-Neustart
   dieselben Verbindungen wieder aufzubauen. */
const anhaenger = new Map();

const api = {
  fenster: WAILS,

  env: () => (WAILS ? Native.Env() : Promise.resolve({ platform: 'web', titlebarInset: false })),
  ordnerWaehlen: () => (WAILS ? Native.PickDirectory() : Promise.resolve('')),

  themes: () => req('/api/themes'),
  themeImport: (text) => req('/api/themes', { method: 'POST', body: text }),
  konten: () => req('/api/accounts'),
  regeln: (session) => req('/api/rules?session=' + encodeURIComponent(session || '')),
  ports: () => req('/api/ports'),
  portBeenden: (pid, hart) => req(`/api/ports/${pid}${hart ? '?hart=1' : ''}`, { method: 'DELETE' }),
  verbrauch: (tage) => req('/api/usage?tage=' + tage),
  fassung: () => req('/api/version'),
  updateStand: () => req('/api/update'),
  neuStarten: () => req('/api/restart', { method: 'POST' }),
  hookStand: () => req('/api/hook'),
  hookSetzen: (an) => req('/api/hook?an=' + (an ? '1' : '0'), { method: 'POST' }),
  aktualisieren: () => req('/api/update', { method: 'POST' }),

  ordner: (id, dir) => req(`/api/files/${id}?dir=${encodeURIComponent(dir || '')}`).catch(() => []),
  pfade: (q) => req('/api/paths?q=' + encodeURIComponent(q)).catch(() => []),
  shell: () => req('/api/shell'),
  datei: (id, pfad) => req(`/api/file/${id}?path=${encodeURIComponent(pfad)}`),
  dateiSchreiben: (id, pfad, text, mod) =>
    req(`/api/file/${id}`, { method: 'PUT', body: JSON.stringify({ path: pfad, text, mod }) }),

  archiv: (pfad) => req('/api/archive' + (pfad ? '?path=' + encodeURIComponent(pfad) : '')),
  archivLoeschen: (id, konto) => req(`/api/archive/${id}?account=${encodeURIComponent(konto || '')}`, { method: 'DELETE' }),
  archivFortsetzen: (id, konto, ziel) =>
    req(`/api/archive/${id}/resume?account=${encodeURIComponent(konto || '')}&target=${encodeURIComponent(ziel || '')}`,
        { method: 'POST' }),
  suche: (q) => req('/api/search?q=' + encodeURIComponent(q)),

  starten: (cwd, cmd, konto) =>
    req('/api/sessions', { method: 'POST', body: JSON.stringify({ cwd, cmd, account: konto }) }),
  beenden: (id) => req('/api/sessions/' + id, { method: 'DELETE' }),
  kontoWechseln: (id, ziel) => req(`/api/sessions/${id}/account?target=${encodeURIComponent(ziel)}`, { method: 'POST' }),
  wiederaufnehmen: (id) => req(`/api/sessions/${id}/resume`, { method: 'POST' }),

  // --- Gesamtzustand ---
  _tiles: null,
  _cb: null,
  aufZustand(cb) { this._cb = cb; this._tilesOeffnen(); },
  _tilesOeffnen() {
    const q = state.filter ? '/ws/tiles?path=' + encodeURIComponent(state.filter) : '/ws/tiles';
    if (this._tiles) { this._tiles.onclose = null; this._tiles.close(); }
    const ws = new WebSocket(wsURL(q));
    ws.onopen = () => zeigeVerbindung(true);
    ws.onmessage = (e) => this._cb(JSON.parse(e.data));
    ws.onclose = () => neuVerbinden();
    ws.onerror = () => { try { ws.close(); } catch {} };
    this._tiles = ws;
  },
  filterSetzen() { this._tilesOeffnen(); },

  // --- Terminals ---
  // Je Session eine eigene Verbindung, in einer Map statt in einer einzelnen
  // Variablen: sonst ließen sich nie zwei Sessions gleichzeitig anzeigen.
  _verb: new Map(),
  anhaengen(id, aufDaten, aufEnde) {
    this.abhaengen(id);
    const ws = new WebSocket(wsURL(`/ws/session/${id}`));
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (e) => aufDaten(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
    // Der Grund für den Unterschied: ein geschlossener Socket heißt nicht, dass
    // der Prozess endete. Stirbt der Daemon, verlieren wir nur die Leitung —
    // "Prozess beendet" wäre schlicht gelogen.
    ws.onclose = () => {
      this._verb.delete(id);
      aufEnde(verbindungOk ? 'prozess' : 'leitung');
    };
    this._verb.set(id, ws);
  },

  // Nach einem Daemon-Neustart hängen alle offenen Flächen an toten Sockets.
  // Wer das nicht nachzieht, hat eine Oberfläche, die aussieht als liefe sie.
  neuAnhaengen() {
    for (const [id, eintrag] of anhaenger) {
      this.anhaengen(id, eintrag.aufDaten, eintrag.aufEnde);
      eintrag.beiNeu?.();
    }
  },
  abhaengen(id) {
    if (id === undefined) { for (const k of [...this._verb.keys()]) this.abhaengen(k); return; }
    const ws = this._verb.get(id);
    if (!ws) return;
    ws.onclose = null;
    ws.close();
    this._verb.delete(id);
  },
  _senden(id, obj) {
    const ws = this._verb.get(id);
    if (ws?.readyState === 1) ws.send(JSON.stringify(obj));
  },
  tippen(id, daten) { this._senden(id, { type: 'in', data: daten }); },
  groesse(id, rows, cols) { this._senden(id, { type: 'resize', rows, cols }); },
};

/* ── Wiederverbinden ──
   Ein Abriss ist kein Fehlerzustand, sondern ein Zwischenzustand: der Daemon
   kann neu gestartet worden sein und dabei Port und Token gewechselt haben.
   Also erneut fragen statt die Oberfläche zu verwerfen. */

let verbindungOk = true;
function zeigeVerbindung(ok) {
  if (ok === verbindungOk) return;
  verbindungOk = ok;
  document.documentElement.dataset.offline = ok ? '' : 'ja';
  if (!ok) $('#counts').textContent = 'Verbindung verloren, versuche erneut …';
}

let neuTimer = null;
function neuVerbinden() {
  if (neuTimer) return;
  zeigeVerbindung(false);
  let wartezeit = 500;
  const versuch = async () => {
    try {
      await connect();
      await themesLaden($('#themeSel').value);
      api.aufZustand(zeichneAlles);
      zeigeVerbindung(true);
      // Erst jetzt die Terminals: vorher wäre die Adresse noch die alte.
      api.neuAnhaengen();
      neuTimer = null;
    } catch {
      wartezeit = Math.min(wartezeit * 1.6, 5000);
      neuTimer = setTimeout(versuch, wartezeit);
    }
  };
  neuTimer = setTimeout(versuch, wartezeit);
}

/* ═════════════════════════ Themes und Skins ═════════════════════════ */

const PALETTE = ['bg','fg','dim','accent','panel','line','working','waiting','blocked','dead'];

/* Skinwechsel doppelt gepuffert: das neue Blatt daneben laden, auf onload
   warten, dann erst das alte entfernen. Wer stattdessen href umbiegt, hat für
   ein paar hundert Millisekunden gar kein Stylesheet — und eine nackte Seite. */
let skinLaeuft = null;

function skinSetzen(name) {
  const href = `/skins/${name}/skin.css`;
  const alt = $('#skinCss');
  if (alt && alt.getAttribute('href') === href) return Promise.resolve();
  if (skinLaeuft === href) return Promise.resolve();
  skinLaeuft = href;

  return new Promise((fertig) => {
    const neu = document.createElement('link');
    neu.rel = 'stylesheet';
    neu.href = href;
    const uebernehmen = () => {
      if (alt && alt !== neu) alt.remove();
      neu.id = 'skinCss';
      skinLaeuft = null;
      fertig();
    };
    neu.addEventListener('load', uebernehmen, { once: true });
    // Kaputtes Blatt: das alte bleibt lieber stehen als gar keins.
    neu.addEventListener('error', () => { neu.remove(); skinLaeuft = null; fertig(); }, { once: true });
    document.head.appendChild(neu);
  });
}

function themeAnwenden(t) {
  if (!t || !t.skin) return;
  const wurzel = document.documentElement;
  wurzel.dataset.skin = t.skin;
  wurzel.dataset.scan = t.scanlines === false ? 'off' : 'on';
  wurzel.dataset.glow = t.glow === false ? 'off' : 'on';

  skinSetzen(t.skin).then(() => {
    // Palette erst setzen, wenn der Skin steht: sonst überschreibt dessen
    // :root-Block die eigenen Werte, weil er später geparst wird.
    for (const k of PALETTE) wurzel.style.removeProperty('--' + k);
    for (const [k, v] of Object.entries(t.palette || {})) {
      if (PALETTE.includes(k)) wurzel.style.setProperty('--' + k, v);
    }
    for (const p of paneListe()) p.term.options.theme = xtermFarben();
  });

  try {
    localStorage.setItem('plxr.theme', t.name);
    // Das ganze Theme mitschreiben: beim nächsten Start steht das Aussehen
    // sofort, ohne auf den Daemon zu warten.
    localStorage.setItem('plxr.themeCache', JSON.stringify(t));
  } catch {}
}

const cssVar = (n, ersatz) =>
  getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim() || ersatz;

function xtermFarben() {
  // Eigene Variablen mit Rückfall auf die Oberflächenpalette: ein heller Skin
  // will ein dunkles Terminal, sonst steht Bernstein auf Papier.
  const bg = cssVar('term-bg', cssVar('bg', '#000'));
  const fg = cssVar('term-fg', cssVar('fg', '#ccc'));
  const akz = cssVar('accent', fg), dim = cssVar('dim', fg);
  const rot = cssVar('blocked', '#f55'), gruen = cssVar('working', '#5f5');
  const tot = cssVar('dead', dim);
  return {
    background: bg, foreground: fg, cursor: akz, selectionBackground: dim,
    black: bg, red: rot, green: gruen, yellow: akz,
    blue: dim, magenta: akz, cyan: fg, white: fg,
    brightBlack: tot, brightRed: rot, brightGreen: gruen,
    brightYellow: akz, brightBlue: dim, brightMagenta: akz,
    brightCyan: fg, brightWhite: fg,
  };
}

/* Findet sich das Theme nicht in der geladenen Liste — etwa weil der Daemon
   gerade weg war —, wird der Skin aus dem Namen abgeleitet statt gar nichts
   zu tun. Ein Wechsel darf nie stumm bleiben. */
function aktuellesTheme() {
  const wert = $('#themeSel').value;
  if (!wert) return null;
  return state.themes.find((t) => t.name === wert) || { name: wert, skin: wert.split('-')[0], palette: {} };
}

async function themesLaden(vorwahl) {
  const liste = await api.themes();
  if (!liste.length) return;
  state.themes = liste;

  const sel = $('#themeSel');
  sel.innerHTML = '';
  let gruppe = null, letzterSkin = null;
  for (const t of liste) {
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
  const gewuenscht = vorwahl || localStorage.getItem('plxr.theme') || 'crt-amber';
  sel.value = liste.some((t) => t.name === gewuenscht) ? gewuenscht : liste[0].name;
  plxrUI.auswahlAlle();
  themeAnwenden(aktuellesTheme());
}

$('#themeSel').addEventListener('change', () => themeAnwenden(aktuellesTheme()));

/* ═════════════════════════ Einstellungen ═════════════════════════ */

/* Aussehen und Einrichtung gehören nicht in die Kopfleiste: das stellt man
   einmal ein und sieht es danach nie wieder. */

async function einstellungenOeffnen() {
  $('#settings').hidden = false;
  plxrUI.auswahlAlle();
  $('#themeHint').textContent =
    'JSON mit skin und palette. Landet in ~/.plxr/themes und steht sofort zur Wahl.';
  try {
    const v = await api.fassung();
    $('#settingsVersion').textContent =
      `plxr ${v.aktuell}` + (v.verfuegbar ? ` · ${v.neueste} verfügbar` : ' · aktuell');
  } catch {
    $('#settingsVersion').textContent = '';
  }
  hookStandZeigen();
}
$('#settingsBtn').addEventListener('click', einstellungenOeffnen);
$('#settingsClose').addEventListener('click', () => { $('#settings').hidden = true; });

async function hookStandZeigen() {
  try {
    const st = await api.hookStand();
    $('#hookHint').textContent = st.eingerichtet
      ? 'Sessions melden ihren Zustand — Status und Modell stehen fest statt geraten.'
      : 'Ohne Anbindung wird der Status aus der Bildschirmausgabe geschätzt.';
    $('#hookBtn').textContent = st.eingerichtet ? 'LÖSEN' : 'EINRICHTEN';
    $('#hookBtn').dataset.an = st.eingerichtet ? 'ja' : 'nein';
  } catch {
    $('#hookHint').textContent = 'Zustand unbekannt.';
    $('#hookBtn').textContent = 'EINRICHTEN';
  }
}

$('#hookBtn').addEventListener('click', async () => {
  const an = $('#hookBtn').dataset.an === 'ja';
  try {
    await api.hookSetzen(!an);
    await hookStandZeigen();
    plxrUI.hinweis(
      an ? 'plxr ist aus den Claude-Code-Einstellungen entfernt.'
         : 'Eingetragen. Neue Sessions melden ihren Zustand ab sofort.\nVorhandene Hooks blieben unangetastet.',
      'Claude Code');
  } catch (e) {
    plxrUI.hinweis(e.message || String(e), 'Nicht geändert');
  }
});

$('#themeImportBtn').addEventListener('click', () => $('#themeFile').click());
$('#themeFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const t = await api.themeImport(await f.text());
    await themesLaden(t.name);
  } catch (err) {
    plxrUI.hinweis(err.message || String(err), 'Theme abgelehnt');
  }
  e.target.value = '';
});

/* ═════════════════════════ Ansichten ═════════════════════════ */

/* Eine Stelle bestimmt, was sichtbar ist. Vorher lag das über mehrere
   Funktionen verstreut und lief regelmäßig auseinander. */
const ANSICHTEN = [
  ['#railPorts', '#viewPorts'],
  ['#railUsage', '#viewUsage'],
  ['#railArchive', '#viewArchive'],
];

const keineSonderansicht = () => ANSICHTEN.every(([, v]) => $(v).hidden);

function nurZeigen(welche) {
  for (const [, v] of ANSICHTEN) $(v).hidden = true;
  $('#viewSession').hidden = true;
  $('#viewGrid').hidden = true;
  $('#empty').hidden = true;
  if (welche) $(welche).hidden = false;
}

function zeigeRaster() {
  paneAlleSchliessen();
  nurZeigen(null);
  $('#viewGrid').hidden = state.tiles.length === 0;
  $('#empty').hidden = state.tiles.length > 0;
  zeichneSchiene();
}
$('#railHome').addEventListener('click', zeigeRaster);

async function zeigeArchiv() {
  paneAlleSchliessen();
  nurZeigen('#viewArchive');
  zeichneSchiene();
  await archivLaden();
}
$('#railArchive').addEventListener('click', zeigeArchiv);

async function zeigePorts() {
  paneAlleSchliessen();
  nurZeigen('#viewPorts');
  zeichneSchiene();
  await portsLaden();
}
$('#railPorts').addEventListener('click', zeigePorts);

async function zeigeVerbrauch() {
  paneAlleSchliessen();
  nurZeigen('#viewUsage');
  zeichneSchiene();
  await verbrauchLaden();
}
$('#railUsage').addEventListener('click', zeigeVerbrauch);

/* ═════════════════════════ Schiene ═════════════════════════ */

const ZEICHEN = { working: '●', waiting: '○', permission: '◉', dead: '✕', unknown: '·' };
const WORT = {
  working: 'arbeitet', waiting: 'wartet', permission: 'braucht dich',
  dead: 'beendet', unknown: 'läuft',
};

/* Verwaist ist kein Status vom Daemon, sondern ein Vermerk: die Session lief
   noch, als der Daemon endete. Für die Anzeige zählt er trotzdem wie einer. */
const zustand = (t) => (t.verwaist ? 'verwaist' : (t.status || 'unknown'));
const ZEICHEN_VERWAIST = '⚠';

/* Die Schiene ist der Grund, warum die Session kein Vollbild-Overlay ist: wer
   in einer Session steckt, soll trotzdem sehen, wenn woanders jemand hängt. */
function zeichneSchiene() {
  const liste = $('#railList');
  const gruppen = new Map();
  for (const t of state.tiles) {
    const k = t.project || '—';
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(t);
  }

  const erwartet = [...gruppen.keys()].map((k) => 'g:' + k)
    .concat(state.tiles.map((t) => 's:' + t.id));

  for (const [projekt, eintraege] of gruppen) {
    const kopfSchluessel = 'g:' + projekt;
    let kopf = liste.querySelector(`[data-key="${CSS.escape(kopfSchluessel)}"]`);
    if (!kopf) {
      kopf = document.createElement('div');
      kopf.className = 'railgroup';
      kopf.dataset.key = kopfSchluessel;
      liste.appendChild(kopf);
    }
    kopf.textContent = projekt;

    // Rückwärts einhängen, damit die Reihenfolge innerhalb der Gruppe stimmt.
    for (const t of [...eintraege].reverse()) {
      const schluessel = 's:' + t.id;
      let el = liste.querySelector(`[data-key="${CSS.escape(schluessel)}"]`);
      if (!el) {
        el = document.createElement('button');
        el.className = 'railitem';
        el.dataset.key = schluessel;
        el.dataset.id = t.id;
        el.innerHTML =
          '<span class="rdot dot"></span>' +
          '<span class="rtext"><span class="rname"></span><span class="rsub"></span></span>';
        el.addEventListener('click', (ev) => {
          // Mit gedrückter Alt- oder Meta-Taste kommt die Session daneben,
          // statt die vorhandene zu ersetzen.
          if (ev.altKey || ev.metaKey) paneHinzu(t.id);
          else sessionOeffnen(t.id);
        });
      }
      kopf.after(el);

      const st = zustand(t);
      el.dataset.status = st;
      el.classList.toggle('active', state.panes.includes(t.id));
      const punkt = el.querySelector('.rdot');
      punkt.className = 'rdot dot ' + st;
      punkt.textContent = t.verwaist ? ZEICHEN_VERWAIST : (ZEICHEN[st] || '·');
      el.querySelector('.rname').textContent = t.title || t.name || t.id.slice(0, 8);
      el.querySelector('.rsub').textContent = t.verwaist
        ? 'abgestürzt · wiederaufnehmen'
        : [t.alive ? WORT[st] : 'beendet', t.agent].filter(Boolean).join(' · ');
      el.title = `${t.name} — ${t.cwd}`;
    }
  }

  for (const el of [...liste.children]) {
    if (!erwartet.includes(el.dataset.key)) el.remove();
  }

  for (const [knopf, ansicht] of ANSICHTEN) $(knopf).classList.toggle('active', !$(ansicht).hidden);
  $('#railHome').classList.toggle('active', !state.panes.length && keineSonderansicht());
}

/* ═════════════════════════ Kachelraster ═════════════════════════ */

const ctxKurz = (n) => (!n ? '' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));

function seit(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h';
}

function zeichneRaster() {
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
        '<div class="thead"><span class="dot"></span><span class="tname"></span><span class="tproj"></span></div>' +
        '<pre class="tbody"></pre>' +
        '<div class="tfoot"><span class="act"></span><span class="ctx"></span><span class="agent"></span></div>';
      el.addEventListener('click', () => sessionOeffnen(t.id));
      raster.appendChild(el);
    }
    const st = zustand(t);
    el.dataset.status = st;
    const punkt = el.querySelector('.dot');
    punkt.className = 'dot ' + st;
    punkt.textContent = t.verwaist ? ZEICHEN_VERWAIST : (ZEICHEN[st] || '·');
    el.querySelector('.tname').textContent = t.title || t.name || t.id.slice(0, 8);
    el.querySelector('.tproj').textContent = [t.project, t.branch].filter(Boolean).join(' · ');
    el.querySelector('.tbody').textContent = t.preview || '';
    el.querySelector('.act').textContent = t.verwaist
      ? 'Daemon abgestürzt — Klick nimmt die Unterhaltung wieder auf'
      : (t.alive ? (t.activity || t.last_message || '') : `beendet (${t.exit_code})`);
    el.querySelector('.agent').textContent = t.agent_label || t.agent || '';
    el.querySelector('.ctx').textContent =
      [t.model?.replace('claude-', ''), t.effort, ctxKurz(t.context), seit(t.since)]
        .filter(Boolean).join(' · ');
  }
  for (const el of [...raster.children]) if (!gesehen.has(el.dataset.id)) el.remove();
}

// zeichneAlles ist der einzige Empfänger des Zustandsstroms.
function zeichneAlles(tiles) {
  state.tiles = tiles || [];
  const belegt = !!state.panes.length || !keineSonderansicht();

  const laufen = state.tiles.filter((t) => t.alive).length;
  const blockiert = state.tiles.filter((t) => t.alive && t.status === 'permission').length;
  const verwaist = state.tiles.filter((t) => t.verwaist).length;
  if (verbindungOk) {
    $('#counts').textContent =
      `${state.tiles.length} sessions · ${laufen} laufen` +
      (blockiert ? ` · ${blockiert} wartet auf dich` : '') +
      (verwaist ? ` · ${verwaist} vom Absturz betroffen` : '');
  }

  zeichneRaster();
  zeichneSchiene();
  if (!belegt) {
    $('#viewGrid').hidden = state.tiles.length === 0;
    $('#empty').hidden = state.tiles.length > 0;
  }
  // Eine Fläche, deren Session verschwunden ist, muss weg.
  for (const id of [...state.panes]) {
    if (!state.tiles.some((t) => t.id === id)) paneSchliessen(id);
  }
  if (state.panes.length) kopfleisteAktualisieren();
}

/* ═════════════════════════ Pfadvervollständigung ═════════════════════════ */

/* Einen Pfad blind eintippen ist zumutbar-Grenze. Deshalb schlägt jedes
   Pfadfeld echte Unterverzeichnisse vor: Pfeiltasten wählen, Tab ergänzt,
   Eingabetaste übernimmt. */

function pfadHilfe(feld, beiWahl) {
  // Die Liste hängt am Rumpf, nicht am Feld: sonst schneidet sie jeder
  // Vorfahre mit overflow ab, und die Statuszeile legt sich darüber.
  const liste = document.createElement('div');
  liste.className = 'auswahlListe pfadListe';
  liste.hidden = true;
  document.body.appendChild(liste);

  const stellen = () => {
    const r = feld.getBoundingClientRect();
    liste.style.left = r.left + 'px';
    liste.style.top = r.bottom + 4 + 'px';
    liste.style.minWidth = Math.max(r.width, 380) + 'px';
    // Passt sie nicht mehr nach unten, klappt sie nach oben.
    const platz = window.innerHeight - r.bottom;
    if (platz < 240) {
      liste.style.top = 'auto';
      liste.style.bottom = window.innerHeight - r.top + 4 + 'px';
    } else {
      liste.style.bottom = 'auto';
    }
  };

  let treffer = [];
  let gewaehlt = -1;
  let timer;

  const zu = () => { liste.hidden = true; gewaehlt = -1; };

  const zeichnen = () => {
    liste.innerHTML = '';
    if (!treffer.length) { zu(); return; }
    treffer.forEach((pfad, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'auswahlZeile';
      b.textContent = pfad;
      if (i === gewaehlt) b.dataset.gewaehlt = 'ja';
      b.addEventListener('mousedown', (e) => { e.preventDefault(); waehlen(pfad); });
      liste.appendChild(b);
    });
    stellen();
    liste.hidden = false;
  };

  const waehlen = (pfad) => {
    // Trenner anhängen: der nächste Tastendruck sucht dann schon darin.
    feld.value = pfad.endsWith('/') ? pfad : pfad + '/';
    zu();
    beiWahl?.(feld.value);
    laden();
  };

  const laden = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      treffer = await api.pfade(feld.value);
      gewaehlt = -1;
      zeichnen();
    }, 120);
  };

  feld.addEventListener('input', laden);
  feld.addEventListener('focus', laden);
  feld.addEventListener('blur', () => setTimeout(zu, 120));

  feld.addEventListener('keydown', (e) => {
    if (liste.hidden || !treffer.length) {
      if (e.key === 'Tab' || e.key === 'ArrowDown') { laden(); }
      return;
    }
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      gewaehlt = (gewaehlt + 1) % treffer.length;
      zeichnen();
      liste.children[gewaehlt]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      gewaehlt = (gewaehlt - 1 + treffer.length) % treffer.length;
      zeichnen();
      liste.children[gewaehlt]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && gewaehlt >= 0) {
      e.preventDefault();
      waehlen(treffer[gewaehlt]);
    } else if (e.key === 'Escape') {
      zu();
    }
  });
}

/* Der Filter greift erst auf Bestätigung. Beim Tippen zu filtern heißt: nach
   jedem Zeichen verschwinden alle Kacheln, weil "/Volumes/…/pro" noch kein
   Verzeichnis ist. */
function filterUebernehmen() {
  const wert = $('#pathFilter').value.trim().replace(/\/$/, '');
  if (wert === state.filter) return;
  state.filter = wert;
  localStorage.setItem('plxr.filter', state.filter);
  api.filterSetzen();
}
$('#pathFilter').addEventListener('change', filterUebernehmen);
$('#pathFilter').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.target.blur(); filterUebernehmen(); }
  if (e.key === 'Escape') { e.target.value = state.filter; e.target.blur(); }
});

/* ═════════════════════════ Terminalflächen ═════════════════════════ */

const panes = new Map(); // id -> { term, fit, el, ro }
const paneListe = () => [...panes.values()];
const MAX_PANES = 4;

function sessionOeffnen(id) {
  paneAlleSchliessen();
  paneHinzu(id);
}

function paneHinzu(id) {
  if (panes.has(id)) { paneAktiv(id); return; }
  if (state.panes.length >= MAX_PANES) {
    plxrUI.hinweis(`Mehr als ${MAX_PANES} Flächen werden unübersichtlich.`, 'Genug geteilt');
    return;
  }
  const t = state.tiles.find((x) => x.id === id);
  if (!t) return;
  if (t.verwaist) {
    // Der Daemon endete, während die Session lief. Bei Claude Code steht die
    // Unterhaltung im Transkript — von dort geht es weiter.
    plxrUI.frage(`${t.name} lief noch, als der Daemon endete.\n${t.cwd}`, 'Wiederaufnehmen?')
      .then(async (ja) => {
        if (!ja) return;
        try {
          const neu = await api.wiederaufnehmen(t.id);
          setTimeout(() => sessionOeffnen(neu.id), 700);
        } catch (e) {
          plxrUI.hinweis(e.message || String(e), 'Nicht wiederaufgenommen');
        }
      });
    return;
  }
  if (!t.alive) {
    // Ein totes PTY hat keinen Datenstrom mehr — die Fläche bliebe leer.
    plxrUI.hinweis(
      `${t.name} ist beendet (Code ${t.exit_code}).\nIm Archiv lässt sich die Unterhaltung fortsetzen.`,
      'Nicht mehr aktiv');
    return;
  }

  nurZeigen(null);
  $('#viewSession').hidden = false;
  $('#rulesPane').hidden = true;
  $('#viewer').hidden = true;

  const el = document.createElement('div');
  el.className = 'pane';
  el.dataset.id = id;
  el.innerHTML = '<span class="panelabel"></span><button class="paneclose" title="Fläche schließen">✕</button><div class="pterm"></div>';
  el.querySelector('.panelabel').textContent = t.agent_label || t.agent || t.name;
  el.querySelector('.paneclose').addEventListener('click', (ev) => { ev.stopPropagation(); paneSchliessen(id); });
  el.addEventListener('mousedown', () => paneAktiv(id));
  $('#panes').appendChild(el);

  const term = new Terminal({
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 13, cursorBlink: true, scrollback: 10000,
    theme: xtermFarben(),
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el.querySelector('.pterm'));
  term.onData((d) => api.tippen(id, d));

  const eintrag = { id, term, fit, el };
  panes.set(id, eintrag);
  state.panes.push(id);

  const nachziehen = () => paneNachmessen(eintrag);
  let timer;
  eintrag.ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(nachziehen, 60); });
  eintrag.ro.observe(el.querySelector('.pterm'));

  const aufDaten = (daten) => term.write(daten);
  const aufEnde = (grund) => {
    term.write(grund === 'leitung'
      ? '\r\n[plxr] Verbindung zum Daemon verloren — wird neu aufgebaut …\r\n'
      : '\r\n[plxr] Prozess beendet.\r\n');
  };
  anhaenger.set(id, { aufDaten, aufEnde, beiNeu: () => term.write('\r\n[plxr] wieder verbunden.\r\n') });
  api.anhaengen(id, aufDaten, aufEnde);
  requestAnimationFrame(() => { nachziehen(); term.focus(); });

  paneAktiv(id);
  zeichneSchiene();
  dateibaumLaden(t);
}

/* FitAddon rundet die Zeilenzahl auf. Passt die letzte Zeile nicht mehr ganz
   in die Fläche, ragt sie unten heraus und wird angeschnitten — also so lange
   eine wegnehmen, bis es wirklich passt. */
function paneNachmessen(p) {
  try {
    p.fit.fit();
    const kasten = p.el.querySelector('.pterm');
    for (let i = 0; i < 3; i++) {
      const schirm = p.term.element?.querySelector('.xterm-screen');
      if (!schirm || schirm.clientHeight <= kasten.clientHeight) break;
      if (p.term.rows <= 4) break;
      p.term.resize(p.term.cols, p.term.rows - 1);
    }
    api.groesse(p.id, p.term.rows, p.term.cols);
  } catch {}
}

function paneAktiv(id) {
  state.aktiv = id;
  for (const p of paneListe()) p.el.dataset.aktiv = p.id === id ? 'ja' : 'nein';
  kopfleisteAktualisieren();
  const t = state.tiles.find((x) => x.id === id);
  if (t) dateibaumLaden(t);
}

function paneSchliessen(id) {
  const p = panes.get(id);
  if (!p) return;
  api.abhaengen(id);
  anhaenger.delete(id);
  p.ro?.disconnect();
  p.term.dispose();
  p.el.remove();
  panes.delete(id);
  state.panes = state.panes.filter((x) => x !== id);
  if (state.aktiv === id) state.aktiv = state.panes[0] || null;
  if (!state.panes.length) zeigeRaster();
  else { paneAktiv(state.aktiv); for (const q of paneListe()) paneNachmessen(q); }
  zeichneSchiene();
}

function paneAlleSchliessen() {
  for (const id of [...state.panes]) {
    const p = panes.get(id);
    if (!p) continue;
    api.abhaengen(id);
    anhaenger.delete(id);
    p.ro?.disconnect();
    p.term.dispose();
    p.el.remove();
    panes.delete(id);
  }
  state.panes = [];
  state.aktiv = null;
}

function kopfleisteAktualisieren() {
  const t = state.tiles.find((x) => x.id === state.aktiv);
  if (!t) return;
  $('#sessTitle').textContent = t.title || t.name;
  $('#sessMeta').textContent = [t.cwd, t.branch].filter(Boolean).join('  ·  ');
  kontenFuellen('#sessAccount').then(() => { if (t.account) $('#sessAccount').value = t.account; });
}

$('#sessKill').addEventListener('click', async () => {
  if (!state.aktiv) return;
  const t = state.tiles.find((x) => x.id === state.aktiv);
  if (!(await plxrUI.frage(t?.name || '', 'Session wirklich beenden?'))) return;
  await api.beenden(state.aktiv);
  paneSchliessen(state.aktiv);
});

$('#filesToggle').addEventListener('click', () => {
  const f = $('#files');
  f.hidden = !f.hidden;
  $('#filesToggle').classList.toggle('on', !f.hidden);
  // Beim Aufklappen muss der Baum geladen werden: solange die Leiste zu war,
  // hat dateibaumLaden nichts getan.
  if (!f.hidden) {
    const t = state.tiles.find((x) => x.id === state.aktiv);
    if (t) dateibaumLaden(t);
  }
  for (const p of paneListe()) paneNachmessen(p);
});

/* Fläche teilen: eine zweite Session danebenlegen. */
$('#splitAdd').addEventListener('click', () => {
  const frei = state.tiles.filter((t) => !state.panes.includes(t.id));
  if (!frei.length) { plxrUI.hinweis('Es gibt keine weitere Session.', 'Nichts zum Teilen'); return; }
  const box = $('#splitList');
  box.innerHTML = '';
  for (const t of frei) {
    const b = document.createElement('button');
    b.className = 'splitzeile';
    b.innerHTML = '<span class="dot"></span><span class="rname"></span>';
    const st = t.status || 'unknown';
    b.querySelector('.dot').className = 'dot ' + st;
    b.querySelector('.dot').textContent = ZEICHEN[st] || '·';
    b.querySelector('.rname').textContent = (t.title || t.name) + '  ·  ' + t.project;
    b.addEventListener('click', () => { $('#splitPick').hidden = true; paneHinzu(t.id); });
    box.appendChild(b);
  }
  $('#splitPick').hidden = false;
});
$('#splitCancel').addEventListener('click', () => { $('#splitPick').hidden = true; });

/* Jeder Dialog schließt mit Escape und mit einem Klick daneben. Ein Fenster,
   aus dem nur ein bestimmter Knopf herausführt, ist eine Falle. */
const DIALOGE = ['#settings', '#splitPick', '#dialog'];
for (const d of DIALOGE) {
  $(d).addEventListener('mousedown', (e) => { if (e.target === $(d)) $(d).hidden = true; });
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const d of DIALOGE) if (!$(d).hidden) { $(d).hidden = true; return; }
  if (!$('#viewer').hidden) { viewerSchliessen(); return; }
  if (!$('#rulesPane').hidden) { $('#rulesPane').hidden = true; return; }
  if (state.panes.length) zeigeRaster();
});

window.addEventListener('resize', () => { for (const p of paneListe()) paneNachmessen(p); });

/* ═════════════════════════ Konten ═════════════════════════ */

let kontenCache = null;

async function kontenFuellen(sel) {
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
    plxrUI.auswahlAlle();
  } catch {}
}

/* Ist ein Kontingent aufgebraucht, muss dieselbe Unterhaltung unter einem
   anderen Zugang weiterlaufen. plxr kopiert dafür das Transkript ins Zielkonto
   und startet die Session dort mit --resume neu. */
$('#sessAccount').addEventListener('change', async (e) => {
  const ziel = e.target.value;
  const t = state.tiles.find((x) => x.id === state.aktiv);
  if (!t || t.account === ziel) return;
  const weiter = await plxrUI.frage(
    `Der Prozess wird beendet und mit --resume unter ${ziel} neu gestartet.`, 'Konto wechseln?');
  if (!weiter) { e.target.value = t.account || ''; return; }
  try {
    const neu = await api.kontoWechseln(state.aktiv, ziel);
    paneSchliessen(state.aktiv);
    setTimeout(() => sessionOeffnen(neu.id), 700);
  } catch (err) {
    plxrUI.hinweis(err.message || String(err), 'Wechsel fehlgeschlagen');
    e.target.value = t.account || '';
  }
});

/* ═════════════════════════ Dateibaum ═════════════════════════ */

const baum = { wurzel: '', rauschen: false };

$('#noiseToggle').addEventListener('click', () => {
  baum.rauschen = !baum.rauschen;
  $('#noiseToggle').classList.toggle('on', baum.rauschen);
  const t = state.tiles.find((x) => x.id === state.aktiv);
  if (t) dateibaumLaden(t);
});

function dateiZeichen(e) {
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

async function dateibaumLaden(t) {
  if ($('#files').hidden) return;
  baum.wurzel = t.cwd;
  $('#filesRoot').textContent = t.cwd;
  const box = $('#filetree');
  box.innerHTML = '';
  await ebeneZeichnen(box, t.cwd, 0, t.id);
}

async function ebeneZeichnen(box, dir, tiefe, sid) {
  const eintraege = await api.ordner(sid, dir);
  if (tiefe === 0 && (!eintraege || !eintraege.length)) {
    leerZeigen(box, 'leerer ordner', 'Hier liegt nichts, was angezeigt werden könnte.');
    return;
  }
  for (const e of eintraege || []) {
    if (e.noise && !baum.rauschen) continue;

    const zeile = document.createElement('div');
    zeile.className = 'frow' + (e.noise ? ' noise' : '');
    zeile.style.paddingLeft = 8 + tiefe * 13 + 'px';
    zeile.innerHTML = '<span class="fchev"></span><span class="ficon"></span><span class="fname"></span>';
    zeile.querySelector('.fchev').textContent = e.dir ? '▸' : '';
    zeile.querySelector('.ficon').textContent = dateiZeichen(e);
    zeile.querySelector('.fname').textContent = e.name;
    box.appendChild(zeile);

    if (e.dir) {
      const kinder = document.createElement('div');
      kinder.hidden = true;
      box.appendChild(kinder);
      zeile.addEventListener('click', async () => {
        if (kinder.hidden && !kinder.dataset.geladen) {
          kinder.dataset.geladen = '1';
          await ebeneZeichnen(kinder, e.path, tiefe + 1, sid);
        }
        kinder.hidden = !kinder.hidden;
        zeile.querySelector('.fchev').textContent = kinder.hidden ? '▸' : '▾';
      });
    } else {
      zeile.addEventListener('click', () => dateiOeffnen(e, sid));
    }
  }
}

/* Der Betrachter ist auch ein Editor. Gespeichert wird nur auf Zuruf, und der
   Stand der Datei wandert mit: hat inzwischen jemand anderes geschrieben — ein
   Agent in genau dieser Session zum Beispiel —, lehnt der Daemon ab, statt die
   fremde Änderung zu überschreiben. */

const datei = { sid: null, pfad: null, mod: 0, original: '', binaer: false };

function dirtySetzen(ja) {
  $('#viewerDirty').hidden = !ja;
  $('#viewerSave').disabled = !ja;
}

async function dateiOeffnen(e, sid) {
  try {
    const c = await api.datei(sid, e.path);
    datei.sid = sid;
    datei.pfad = c.path;
    datei.mod = c.mod;
    datei.binaer = c.binary;
    datei.original = c.binary ? '' : c.text;

    $('#viewerName').textContent = e.name;
    $('#viewerMeta').textContent = c.binary
      ? 'binär, nicht anzeigbar'
      : `${c.lines} Zeilen · ${(c.size / 1024).toFixed(1)} kB` +
        (c.truncated ? ' · gekürzt, Speichern gesperrt' : '');

    const feld = $('#viewerBody');
    feld.value = datei.original;
    // Gekürzt heißt: wir haben nicht die ganze Datei. Wer das speichert,
    // schneidet den Rest ab.
    feld.readOnly = c.binary || c.truncated;
    $('#viewerSave').hidden = feld.readOnly;
    dirtySetzen(false);

    $('#rulesPane').hidden = true;
    $('#viewer').hidden = false;
  } catch (err) {
    plxrUI.hinweis(err.message || String(err), 'Datei nicht lesbar');
  }
}

$('#viewerBody').addEventListener('input', () => {
  dirtySetzen($('#viewerBody').value !== datei.original);
});

// Tabulator gehört in den Text, nicht auf den nächsten Knopf.
$('#viewerBody').addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const f = e.target;
  const a = f.selectionStart, b = f.selectionEnd;
  f.value = f.value.slice(0, a) + '\t' + f.value.slice(b);
  f.selectionStart = f.selectionEnd = a + 1;
  dirtySetzen(f.value !== datei.original);
});

async function dateiSpeichern() {
  if ($('#viewerSave').hidden || $('#viewerSave').disabled) return;
  const text = $('#viewerBody').value;
  $('#viewerSave').disabled = true;
  try {
    const c = await api.dateiSchreiben(datei.sid, datei.pfad, text, datei.mod);
    datei.mod = c.mod;
    datei.original = text;
    dirtySetzen(false);
    $('#viewerMeta').textContent = `${c.lines} Zeilen · ${(c.size / 1024).toFixed(1)} kB · gespeichert`;
  } catch (err) {
    dirtySetzen(true);
    plxrUI.hinweis(err.message || String(err), 'Nicht gespeichert');
  }
}
$('#viewerSave').addEventListener('click', dateiSpeichern);

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's' && !$('#viewer').hidden) {
    e.preventDefault();
    dateiSpeichern();
  }
});

async function viewerSchliessen() {
  if (!$('#viewerDirty').hidden) {
    const weg = await plxrUI.frage(
      'Die Änderungen an ' + $('#viewerName').textContent + ' gehen verloren.', 'Ohne Speichern schließen?');
    if (!weg) return;
  }
  dirtySetzen(false);
  $('#viewer').hidden = true;
}
$('#viewerClose').addEventListener('click', viewerSchliessen);

/* ═════════════════════════ Regeln ═════════════════════════ */

const ARTNAME = { global: 'global', projekt: 'projekt', lokal: 'lokal', import: 'import', skill: 'skill', agent: 'agent' };

$('#rulesToggle').addEventListener('click', async () => {
  if (!$('#rulesPane').hidden) { $('#rulesPane').hidden = true; return; }
  if (!state.aktiv) return;
  $('#viewer').hidden = true;
  $('#rulesPane').hidden = false;
  $('#rulesMeta').textContent = 'lädt …';
  const liste = await api.regeln(state.aktiv);
  $('#rulesMeta').textContent =
    `${liste.length} Dateien wirken hier · Ist-Zustand, nicht der von damals`;
  const box = $('#rulesBody');
  box.innerHTML = '';
  if (!liste.length) {
    leerZeigen(box, 'keine regeln',
      'In diesem Verzeichnis und darüber liegt keine CLAUDE.md, kein Skill und ' +
      'kein Agent. Der Assistent arbeitet hier ohne zusätzliche Anweisungen.');
    return;
  }
  for (const e of liste) {
    const zeile = document.createElement('div');
    zeile.className = 'rrow';
    zeile.dataset.art = e.art;
    zeile.innerHTML = '<span class="rart"></span><span class="rmain">' +
      '<b class="rtitle"></b><span class="rdesc"></span></span><span class="rpath"></span>';
    zeile.querySelector('.rart').textContent = ARTNAME[e.art] || e.art;
    zeile.querySelector('.rtitle').textContent = e.name;
    zeile.querySelector('.rdesc').textContent = e.description || '';
    zeile.querySelector('.rpath').textContent = e.path;
    zeile.title = e.path;
    box.appendChild(zeile);
  }
});
$('#rulesClose').addEventListener('click', () => { $('#rulesPane').hidden = true; });

/* Eine leere Liste ohne Erklärung ist ein Fehlerzustand, der wie ein Fehler
   aussieht. Jede Liste sagt, warum sie leer ist. */
function leerZeigen(box, titel, text) {
  box.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'leer';
  d.innerHTML = '<b></b><span></span>';
  d.querySelector('b').textContent = titel;
  d.querySelector('span').textContent = text;
  box.appendChild(d);
}

/* ═════════════════════════ Archiv ═════════════════════════ */

/* Die abgelegten Transkripte sind der Grund, warum es plxr gibt: sie liegen
   über Dutzende Projektordner verstreut, und der eingebaute Picker zeigt
   standardmäßig nur das aktuelle Verzeichnis. */

const archiv = { alle: [], suche: '', treffer: null };

async function archivLaden() {
  $('#archInfo').textContent = 'lädt …';
  await kontenFuellen('#archAccount');
  archiv.alle = await api.archiv(state.filter);
  archiv.treffer = null;
  $('#archiveCount').textContent = archiv.alle.length;
  archivZeichnen();
}

$('#archSearch').addEventListener('input', (e) => {
  archiv.suche = e.target.value.toLowerCase();
  archiv.treffer = null;
  archivZeichnen();
});
$('#archSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') volltext(); });
$('#archFullText').addEventListener('click', volltext);

/* Die Titelsuche findet nur, was im Titel steht. Die eigentliche Frage ist
   aber meist "wo hab ich das mal gemacht" — dafür muss durch alle Nachrichten
   gegangen werden. Dauert ein paar Sekunden, deshalb auf Zuruf. */
async function volltext() {
  const q = $('#archSearch').value.trim();
  if (q.length < 2) return;
  $('#archInfo').textContent = 'durchsuche alle Transkripte …';
  try {
    archiv.treffer = await api.suche(q);
    archivZeichnen();
  } catch (e) {
    $('#archInfo').textContent = 'Suche fehlgeschlagen: ' + (e.message || e);
  }
}

function datumKurz(ms) {
  return new Date(ms).toLocaleString('de-DE',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function fortsetzen(id, konto) {
  try {
    const s = await api.archivFortsetzen(id, konto, $('#archAccount').value);
    zeigeRaster();
    setTimeout(() => sessionOeffnen(s.id), 500);
  } catch (err) {
    plxrUI.hinweis(err.message || String(err), 'Fortsetzen fehlgeschlagen');
  }
}

function archivZeichnen() {
  const box = $('#archList');
  box.innerHTML = '';

  if (archiv.treffer) {
    const wonach = $('#archSearch').value.trim();
    $('#archInfo').textContent = `${archiv.treffer.length} Sessions enthalten „${wonach}"`;
    if (!archiv.treffer.length) {
      leerZeigen(box, 'nichts gefunden',
        `Kein Transkript enthält „${wonach}". Gesucht wird in dem, was du und der ` +
        'Assistent geschrieben habt — nicht in Werkzeugausgaben.');
      return;
    }
    for (const t of archiv.treffer) {
      const zeile = document.createElement('div');
      zeile.className = 'zeile hoch';
      zeile.innerHTML =
        '<span class="zdatum"></span>' +
        '<span class="zhaupt"><b class="ztitel"></b><span class="zauszug"></span></span>' +
        '<span class="zproj"></span><span class="zwert"></span>' +
        '<span class="ztat"><button class="btn">FORTSETZEN</button></span>';
      zeile.querySelector('.zdatum').textContent = datumKurz(t.mod);
      zeile.querySelector('.ztitel').textContent = t.title || '(ohne Titel)';
      zeile.querySelector('.zauszug').textContent = t.auszug;
      zeile.querySelector('.zproj').textContent = t.project;
      zeile.querySelector('.zwert').textContent = t.anzahl + '×';
      zeile.title = t.cwd;
      zeile.querySelector('button').addEventListener('click', (ev) => {
        ev.stopPropagation();
        fortsetzen(t.sessionId, t.account);
      });
      box.appendChild(zeile);
    }
    return;
  }

  const q = archiv.suche;
  const liste = q
    ? archiv.alle.filter((e) =>
        (e.title || '').toLowerCase().includes(q) ||
        (e.project || '').toLowerCase().includes(q) ||
        (e.cwd || '').toLowerCase().includes(q))
    : archiv.alle;

  $('#archInfo').textContent =
    q ? `${liste.length} von ${archiv.alle.length}` : `${archiv.alle.length} Transkripte`;

  if (!liste.length) {
    if (archiv.alle.length) {
      leerZeigen(box, 'kein treffer im titel',
        'Eingabetaste durchsucht stattdessen den vollen Text aller Transkripte.');
    } else if (state.filter) {
      leerZeigen(box, 'nichts unter diesem pfad',
        `Unter ${state.filter} liegt kein Transkript. Filter oben leeren zeigt alle.`);
    } else {
      leerZeigen(box, 'noch kein archiv',
        'Hier erscheinen abgelegte Claude-Code-Unterhaltungen, sobald welche existieren.');
    }
    return;
  }

  for (const e of liste.slice(0, 400)) {
    const zeile = document.createElement('div');
    zeile.className = 'zeile';
    zeile.innerHTML =
      '<span class="zdatum"></span><span class="ztitel"></span><span class="zproj"></span>' +
      '<span class="zklein"></span><span class="zwert"></span>' +
      '<span class="ztat"><button class="btn" data-t="auf">FORTSETZEN</button>' +
      '<button class="btn" data-t="weg">LÖSCHEN</button></span>';
    zeile.querySelector('.zdatum').textContent = datumKurz(e.mod);
    zeile.querySelector('.ztitel').textContent = e.title || '(ohne Titel)';
    zeile.querySelector('.zproj').textContent = [e.project, e.branch].filter(Boolean).join(' · ');
    zeile.querySelector('.zklein').textContent = (e.accounts || []).length > 1 ? (e.accounts || []).length + '×' : '';
    zeile.querySelector('.zwert').textContent = (e.size / 1024).toFixed(0) + ' kB';
    zeile.title = e.cwd;

    zeile.querySelector('[data-t="auf"]').addEventListener('click', (ev) => {
      ev.stopPropagation();
      fortsetzen(e.id, e.account);
    });
    zeile.querySelector('[data-t="weg"]').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const weg = await plxrUI.frage(`${e.title || e.id}\n${e.cwd}`, 'Transkript löschen?');
      if (!weg) return;
      try {
        await api.archivLoeschen(e.id, e.account);
        archiv.alle = archiv.alle.filter((x) => x.id !== e.id);
        archivZeichnen();
      } catch (err) {
        plxrUI.hinweis(err.message || String(err), 'Löschen fehlgeschlagen');
      }
    });
    box.appendChild(zeile);
  }
}

/* ═════════════════════════ Ports ═════════════════════════ */

/* Vergessene Dev-Server: ein Nuxt auf 3000, das seit Tagen läuft und den
   nächsten Start blockiert. Was zu einer plxr-Session gehört, wird eingefärbt
   — das darf man nicht versehentlich abschießen. */

async function portsLaden() {
  $('#portsInfo').textContent = 'liest …';
  const liste = await api.ports();
  $('#portsCount').textContent = liste.length;
  $('#portsInfo').textContent = `${liste.length} lauschende Ports`;
  const box = $('#portsList');
  box.innerHTML = '';
  if (!liste.length) {
    leerZeigen(box, 'kein port belegt',
      'Kein Prozess lauscht gerade auf einem TCP-Port. Hier tauchen vergessene ' +
      'Dev-Server auf, die den nächsten Start blockieren.');
    return;
  }
  for (const p of liste) {
    const zeile = document.createElement('div');
    zeile.className = 'zeile';
    zeile.dataset.eigen = p.eigen ? 'ja' : 'nein';
    zeile.innerHTML =
      '<span class="zdatum"></span><span class="ztitel"></span><span class="zproj"></span>' +
      '<span class="zwert"></span>' +
      '<span class="ztat"><button class="btn" data-h="0">BEENDEN</button>' +
      '<button class="btn" data-h="1">HART</button></span>';
    zeile.querySelector('.zdatum').textContent = p.port;
    zeile.querySelector('.ztitel').textContent = p.command + (p.eigen ? '  · plxr-session' : '');
    zeile.querySelector('.zproj').textContent = p.addr;
    zeile.querySelector('.zwert').textContent = 'pid ' + p.pid;
    for (const hart of [false, true]) {
      zeile.querySelector(`[data-h="${hart ? 1 : 0}"]`).addEventListener('click', async () => {
        const wie = hart ? 'HART beenden (SIGKILL)' : 'beenden (SIGTERM)';
        const ja = await plxrUI.frage(`${p.command}, pid ${p.pid}`, `Port ${p.port} ${wie}?`);
        if (!ja) return;
        try { await api.portBeenden(p.pid, hart); setTimeout(portsLaden, 500); }
        catch (e) { plxrUI.hinweis(e.message || String(e), 'Beenden fehlgeschlagen'); }
      });
    }
    box.appendChild(zeile);
  }
}
$('#portsReload').addEventListener('click', portsLaden);

/* ═════════════════════════ Verbrauch ═════════════════════════ */

/* Gezählt wird aus den Transkripten, nicht über eine API: der Verbrauch steht
   in jeder Assistenten-Zeile und ist damit vollständig und rückwirkend
   auswertbar. Die Cache-Lesungen dominieren alles andere um Größenordnungen,
   deshalb stehen sie getrennt und nicht in einer Summe versteckt. */

function tok(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + ' Mrd';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' Mio';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' Tsd';
  return String(n);
}

$('#usageRange').addEventListener('change', verbrauchLaden);

async function verbrauchLaden() {
  $('#usageInfo').textContent = 'rechnet …';
  const b = await api.verbrauch($('#usageRange').value);
  $('#usageInfo').textContent = `${b.dateien} Transkripte · ${b.dauer}`;

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
  const block = (titel, zeilen, grenze) => {
    if (!zeilen || !zeilen.length) return;
    const d = document.createElement('div');
    d.className = 'ublock';
    d.innerHTML = '<b class="uhead"></b>';
    d.querySelector('.uhead').textContent = titel;
    const max = Math.max(...zeilen.map(gesamt), 1);
    for (const z of zeilen.slice(0, grenze)) {
      const r = document.createElement('div');
      r.className = 'urow';
      r.innerHTML = '<span class="ukey"></span><span class="ubar"><i class="ufill"></i></span><span class="uval"></span>';
      r.querySelector('.ukey').textContent = z.schluessel;
      r.querySelector('.ufill').style.width = (gesamt(z) / max * 100).toFixed(1) + '%';
      r.querySelector('.uval').textContent = tok(gesamt(z));
      d.appendChild(r);
    }
    box.appendChild(d);
  };

  if (!b.nachTag.length) {
    leerZeigen(box, 'kein verbrauch',
      'In diesem Zeitraum wurde nichts gezählt. Gerechnet wird aus den ' +
      'Transkripten — ohne abgelegte Unterhaltungen bleibt die Rechnung leer.');
    return;
  }

  block('nach Tag', b.nachTag, 30);
  block('nach Projekt', b.nachProjekt, 12);
  block('nach Modell', b.nachModell, 8);
  block('nach Konto', b.nachKonto, 8);
}

/* ═════════════════════════ Fassung ═════════════════════════ */

let fassungsStand = null;

async function fassungPruefen() {
  try {
    const st = await api.fassung();
    fassungsStand = st;
    if (!st.verfuegbar) { $('#updateBar').hidden = true; return; }
    if (localStorage.getItem('plxr.updateIgnoriert') === st.neueste) return;
    $('#updateText').textContent =
      `Fassung ${st.neueste} ist da (du hast ${st.aktuell})` +
      (st.groesse ? ` · ${(st.groesse / (1 << 20)).toFixed(1)} MB` : '');
    $('#updateBar').hidden = false;
  } catch {}
}

$('#updateHide').addEventListener('click', () => {
  if (fassungsStand) localStorage.setItem('plxr.updateIgnoriert', fassungsStand.neueste);
  $('#updateBar').hidden = true;
});
$('#updateNotes').addEventListener('click', () => {
  plxrUI.hinweis(fassungsStand?.notizen || 'keine Anmerkungen zu dieser Fassung', 'Was ist neu');
});
/* Der Ablauf, den man erwartet: Hinweis, Klick, Ladebalken, Neustart. Die
   Sessions merken davon nichts — sie gehören dem Daemon, und der läuft
   weiter. Nur das Fenster kommt neu. */
$('#updateGo').addEventListener('click', async () => {
  const ja = await plxrUI.frage(
    'Der Daemon läuft weiter, alle Sessions bleiben. Nur das Fenster startet neu.',
    'Fassung ' + (fassungsStand?.neueste || '') + ' installieren?');
  if (!ja) return;

  $('#updateGo').disabled = true;
  $('#updateNotes').hidden = true;
  $('#updateHide').hidden = true;
  $('#updateBalken').hidden = false;

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
  $('#updateBalken').hidden = true;
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
      return; // Verbindung kurz weg — beim nächsten Versuch wieder da
    }
    $('#updateFuellung').style.width = st.prozent + '%';
    $('#updateText').textContent =
      st.phase === 'lädt' ? `lädt … ${st.prozent}%` : st.phase;

    if (!st.fertig) return;
    clearInterval(tick);

    if (st.fehler) { updateFehler(st.fehler); return; }

    $('#updateText').textContent = 'fertig — startet neu';
    $('#updateFuellung').style.width = '100%';
    // Kurz stehen lassen, damit man sieht, dass es geklappt hat.
    setTimeout(() => api.neuStarten().catch(() => {
      $('#updateText').textContent = 'eingesetzt — plxr von Hand neu starten';
    }), 900);
  }, 400);
}

/* ═════════════════════════ Neue Session ═════════════════════════ */

/* Was gestartet wird. Die Shell steht vorn: plxr ist ein Terminal, in dem
   auch Agenten laufen — nicht umgekehrt. */
const STARTBAR = [
  { id: 'shell', label: 'Shell', cmd: null },  // cmd kommt vom Daemon
  { id: 'claude', label: 'Claude Code', cmd: ['claude'] },
  { id: 'codex', label: 'Codex', cmd: ['codex'] },
  { id: 'opencode', label: 'opencode', cmd: ['opencode'] },
  { id: 'eigenes', label: 'Eigenes …', cmd: null },
];
let shellCmd = null;

async function wahlFuellen() {
  const box = $('#newWahl');
  if (box.children.length) return;
  try { shellCmd = (await api.shell()).cmd; } catch { shellCmd = ['/bin/sh', '-l']; }
  const zuletzt = localStorage.getItem('plxr.startart') || 'shell';
  for (const w of STARTBAR) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wahlknopf';
    b.dataset.id = w.id;
    b.textContent = w.id === 'shell' ? `Shell (${shellCmd[0].split('/').pop()})` : w.label;
    b.addEventListener('click', () => wahlSetzen(w.id));
    box.appendChild(b);
  }
  wahlSetzen(zuletzt);
}

function wahlSetzen(id) {
  for (const b of $('#newWahl').children) b.dataset.gewaehlt = b.dataset.id === id ? 'ja' : 'nein';
  $('#newCmdFeld').hidden = id !== 'eigenes';
  localStorage.setItem('plxr.startart', id);
  if (id === 'eigenes') $('#newCmd').focus();
}

function gewaehltesKommando() {
  const id = [...$('#newWahl').children].find((b) => b.dataset.gewaehlt === 'ja')?.dataset.id || 'shell';
  if (id === 'shell') return shellCmd || [];
  if (id === 'eigenes') return $('#newCmd').value.trim().split(/\s+/).filter(Boolean);
  return STARTBAR.find((w) => w.id === id).cmd;
}

$('#newBtn').addEventListener('click', async () => {
  $('#newCwd').value = state.filter || localStorage.getItem('plxr.lastCwd') || '';
  await Promise.all([kontenFuellen('#newAccount'), wahlFuellen()]);
  $('#dialog').hidden = false;
  $('#newCwd').focus();
});
$('#newCancel').addEventListener('click', () => { $('#dialog').hidden = true; });

// Der Ordnerdialog des Systems gibt es nur im Fenster.
if (api.fenster) {
  $('#pickDir').hidden = false;
  $('#pickDir').addEventListener('click', async () => {
    const d = await api.ordnerWaehlen();
    if (d) $('#newCwd').value = d;
  });
}

$('#newForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cwd = $('#newCwd').value.trim();
  const cmd = gewaehltesKommando();
  try {
    const s = await api.starten(cwd, cmd, $('#newAccount').value);
    localStorage.setItem('plxr.lastCwd', cwd);
    $('#dialog').hidden = true;
    setTimeout(() => sessionOeffnen(s.id), 400);
  } catch (err) {
    plxrUI.hinweis(err.message || String(err), 'Start fehlgeschlagen');
  }
});

/* ═════════════════════════ Start ═════════════════════════ */

/* Zuerst das zuletzt benutzte Theme aus dem Zwischenspeicher anlegen, dann
   erst mit dem Daemon reden — so ist die Oberfläche nie ungestylt, auch wenn
   er gerade nicht da ist. */
(function themeAusSpeicher() {
  try {
    const roh = localStorage.getItem('plxr.themeCache');
    themeAnwenden(roh ? JSON.parse(roh) : { name: 'crt-amber', skin: 'crt', palette: {} });
  } catch {
    themeAnwenden({ name: 'crt-amber', skin: 'crt', palette: {} });
  }
})();

plxrUI.auswahlAlle();

fetch('/logo.svg').then((r) => r.text()).then((svg) => { $('#mark').innerHTML = svg; }).catch(() => {});

/* Die Fensterknöpfe von macOS schweben bei eingelassener Titelleiste über dem
   Inhalt. Das Gerüst weiß das nicht von allein, also sagt Go, wo es läuft. */
api.env().then((e) => {
  document.documentElement.dataset.platform = e.platform;
  if (e.titlebarInset) document.documentElement.dataset.titlebarInset = 'yes';
}).catch(() => {});

(function bootzeile() {
  const el = $('#boot');
  const txt = WAILS ? 'pty host online' : 'browsermodus · pty host online';
  let i = 0;
  const t = setInterval(() => {
    el.textContent = txt.slice(0, ++i);
    if (i >= txt.length) { clearInterval(t); setTimeout(() => { el.textContent = ''; }, 3500); }
  }, 22);
})();

setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('de-DE'); }, 1000);

pfadHilfe($('#pathFilter'), filterUebernehmen);
pfadHilfe($('#newCwd'));

state.filter = localStorage.getItem('plxr.filter') || '';
$('#pathFilter').value = state.filter;

connect()
  .then(() => themesLaden())
  .then(() => {
    api.aufZustand(zeichneAlles);
    fassungPruefen();
    // Lief beim letzten Fenster noch ein Update, hier weiter verfolgen.
    api.updateStand().then((st) => {
      if (st.laeuft) { $('#updateBar').hidden = false; $('#updateBalken').hidden = false; updateVerfolgen(); }
    }).catch(() => {});
    setInterval(fassungPruefen, 60 * 60 * 1000);
  })
  .catch(() => neuVerbinden());
