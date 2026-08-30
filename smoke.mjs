/* Click through the interface and look at it — with an actual browser.

   Every interface bug of the last two days had to be found by hand, because
   nothing here could open the window: the templates id threw at startup and left the
   whole thing unstyled, the workbench sat in a hidden section and simply did
   not appear, the update banner never showed because it read a field that does
   not exist. Not one of those is visible in the source. All of them are
   visible in one second of a running window.

   The daemon serves exactly the same files the window does — the only thing
   missing here is the handful of Wails bindings (Native.*), and those are
   named below rather than glossed over.

   Runs against its own daemon in a throw-away directory: no session of yours is
   touched, and an empty state is the honest starting point anyway.
*/
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const info = JSON.parse(readFileSync(process.env.PLXR_PROBE + '/daemon.json', 'utf8'));
const url = `http://127.0.0.1:${info.port}/?token=${info.token}`;
const shots = process.env.PLXR_PROBE + '/shots';
mkdirSync(shots, { recursive: true });

let failed = 0;
const check = (ok, what) => { if (!ok) { failed = 1; console.log(`  FAILED: ${what}`); } };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
/* Eight seconds is plenty for anything local. The default of thirty turns a
   single stuck click into half a minute of waiting and then a stack trace —
   which is the least useful way to report a finding. */
page.setDefaultTimeout(8000);

/* Whatever breaks off, the report has to stay readable: one line saying what
   went wrong, the workbench log, and a picture of the moment. Without this a
   real bug arrives as an uncaught TimeoutError and buries its own cause. */
async function ownLog() {
  return page.evaluate(() =>
    (window.plxrDebug?.entries || [])
      .filter((e) => e.kind === 'error' || e.kind === 'bad')
      .map((e) => `${e.where}: ${e.text}`.slice(0, 160))).catch(() => []);
}
process.on('unhandledRejection', async (e) => {
  console.log('  FAILED: the run broke off — ' + String(e?.message || e).split('\n')[0]);
  const own = await ownLog();
  if (own.length) console.log('  the workbench recorded: ' + own.join(' | '));
  await page.screenshot({ path: shots + '/brokeoff.png' }).catch(() => {});
  await browser.close().catch(() => {});
  process.exit(1);
});

/* The workbench opens itself on the first error and then covers the right hand
   side — every click after that lands on the panel. That is right in the app
   and wrong in a test: one bug would hide all the others. So it is noted and
   pushed aside, and the run carries on. */
let panelSeen = false;
async function settle() {
  const open = await page.evaluate(() => {
    const p = document.querySelector('.devPanel');
    return !!p && !p.hidden;
  }).catch(() => false);
  if (!open) return;
  if (!panelSeen) {
    panelSeen = true;
    check(false, 'the workbench opened by itself: ' + (await ownLog()).join(' | '));
  }
  await page.evaluate(() => window.plxrDebug?.close()).catch(() => {});
  await page.waitForTimeout(150);
}

/* Anything the window says out loud. A thrown error is not a warning here —
   in this app it takes everything after it with it. */
const noise = [];
page.on('pageerror', (e) => noise.push('throw: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') noise.push('console: ' + m.text()); });
page.on('requestfailed', (r) => {
  // Wails bindings do not exist in the browser; the code handles that itself.
  if (/\/wails\//.test(r.url())) return;
  /* A request cut off by the next page load is not a fault. This test reloads
     on purpose to see what survives a restart, and settings on their way to
     disk are in flight exactly then. */
  if (r.failure()?.errorText === 'net::ERR_ABORTED') return;
  noise.push('request: ' + r.url());
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 1. Nothing thrown. This alone would have caught that startup throw.
check(noise.length === 0, 'the window complains: ' + noise.join(' | '));

// 2. A skin is on. The naked window of that evening had none.
check(await page.evaluate(() => !!document.documentElement.dataset.skin), 'no skin applied');
check(await page.evaluate(() => [...document.styleSheets].some((s) => /skins\//.test(s.href || ''))),
  'no skin stylesheet loaded');

// 3. Translated. "_meta.name" on screen was the sign that the tables did not load.
const raw = await page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const t = (el.textContent || '').trim();
    if (/^[a-z][\w]*\.[\w.]+$/.test(t)) bad.push(t);
  }
  return bad;
});
check(raw.length === 0, 'raw keys on screen: ' + raw.join(', '));

// 4. Every view opens and shows something.
for (const [rail, view] of [['#railInbox', '#viewInbox'], ['#railPorts', '#viewPorts'],
                            ['#railUsage', '#viewUsage'], ['#railArchive', '#viewArchive'],
                            // The overview carries a real session now, so the
                            // grid itself is what has to be on screen. It used to
                            // ask for the empty box here — correct back when this
                            // ran against an app with nothing in it.
                            ['#railHome', '#viewGrid']]) {
  await page.click(rail);
  await page.waitForTimeout(700);
  const box = await page.locator(view).boundingBox();
  check(box && box.width > 0 && box.height > 0, `${view} stays invisible`);
}

// 5. The dialogs open — and are actually on screen. The workbench was not.
for (const [open, what] of [['#keysBtn', '#keys .card'], ['#settingsBtn', '#settings .card']]) {
  await page.click(open);
  await page.waitForTimeout(400);
  const box = await page.locator(what).boundingBox();
  check(box && box.width > 0, `${what} does not appear`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

// 6. Settings: tabs, agent profiles, workbench.
await page.click('#settingsBtn');
await page.waitForTimeout(400);
await page.click('[data-tab="agents"]');
await page.waitForTimeout(600);
const agents = await page.locator('#agentList .splitRow').count();
check(agents > 0, 'no agent profile listed');

/* The agent form. It used to be the file in a text box, scrolled to its own
   end, opening below the list where nobody saw it. Checked here is what makes
   it usable at all: the fields carry the file's content, nothing is cut off,
   and the probe answers. */
await page.locator('#agentList .splitRow', { hasText: 'Claude Code' }).click();
await page.waitForTimeout(600);
check(await page.locator('#agentBrowse').isHidden(), 'the list stays behind the editor');
check((await page.inputValue('#agentLabel')).length > 0, 'the name is not filled in');
check((await page.inputValue('#agentBlocked')).split('\n').length > 1,
  'the waiting phrases did not arrive in the field');
/* A list that shows four of its five lines lies about its own length. */
const cut = await page.evaluate(() => ['agentMatch', 'agentBlocked', 'agentWorking']
  .filter((id) => { const el = document.getElementById(id);
    return el.scrollHeight > el.clientHeight + 2; }));
check(cut.length === 0, `cut off: ${cut.join(', ')}`);
check(await page.locator('#agentDelete').isHidden(),
  'a built-in profile offers DELETE');

await page.fill('#agentTry', 'Do you want to proceed?');
await page.waitForTimeout(300);
const verdict = await page.textContent('#agentTryOut');
check(/proceed/.test(verdict), `the probe does not recognise a question: "${verdict}"`);
await page.fill('#agentTry', 'zzz nothing at all zzz');
await page.waitForTimeout(300);
check(!/proceed/.test(await page.textContent('#agentTryOut')),
  'the probe reports a match where there is none');
await page.screenshot({ path: shots + '/agent-form.png' });
await page.click('#agentBack');
await page.waitForTimeout(300);
check(await page.locator('#agentBrowse').isVisible(), 'BACK does not bring the list back');

/* The phosphor picker and the glow dial. CRT is the main theme and its palette
   comes out of one colour now — four list entries for four hues were four
   times the same decision. Checked: the dial belongs to CRT and disappears
   with it, and turning it does not drag the hue along. */
await page.click('[data-tab="look"]');
await page.waitForTimeout(300);
check(await page.locator('#phosphorRow').isVisible(), 'the phosphor colour is not offered for CRT');

/* Every part of the picker has to do something. It offered a square to drag in
   where only the hue strip below it had any effect — dark and light changed
   nothing at all, because the palette was worked out from the hue alone.

   Driven with dispatched events rather than the mouse: the picker listens for
   mousedown and follows the pointer on the document, and a synthetic click
   from outside does not reach it. This is about whether the handler produces
   different colours, not about how the pointer gets there. */
await page.click('#phosphorRow .swatch');
await page.waitForTimeout(300);
const pick = (fx, fy) => page.evaluate(([x, y]) => {
  const pane = document.querySelector('#phosphorRow .swatchArea');
  const r = pane.getBoundingClientRect();
  pane.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true,
    clientX: r.left + r.width * x, clientY: r.top + r.height * y }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}, [fx, fy]);
const paletteNow = () => page.evaluate(() => {
  const c = getComputedStyle(document.documentElement);
  return ['fg', 'dim', 'accent', 'bg'].map((k) => c.getPropertyValue('--' + k).trim()).join(' ');
});
await pick(0.95, 0.05); await page.waitForTimeout(250);
const brightSaturated = await paletteNow();
await pick(0.95, 0.95); await page.waitForTimeout(250);
const darkSaturated = await paletteNow();
await pick(0.05, 0.05); await page.waitForTimeout(250);
const brightPale = await paletteNow();
check(brightSaturated !== darkSaturated,
  `up and down in the picker changes nothing: ${brightSaturated}`);
check(brightSaturated !== brightPale,
  `sideways in the picker changes nothing: ${brightSaturated}`);
/* Back to a colour that has a hue. A near-grey leaves --fg without a defined
   one, and the check below — that the glow dial does not drag the hue along —
   would then be measuring noise. */
await pick(0.95, 0.2);
await page.waitForTimeout(250);
await page.click('#settings .cardTitle');
await page.waitForTimeout(200);
await page.click('[data-tab="colors"]');
await page.waitForTimeout(400);
const glow = page.locator('.styleRow', { hasText: /Leuchtkraft|glow strength/ });
check(await glow.count() > 0, 'the glow dial is missing for CRT');
const hueNow = () => page.evaluate(() => {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim();
  const p = (v.match(/[0-9a-f]{2}/gi) || []).map((x) => parseInt(x, 16) / 255);
  if (p.length < 3) return -1;
  const [r, g, b] = p, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return -1;
  const d = mx - mn;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
});
const hueBefore = await hueNow();
for (let i = 0; i < 4; i++) await glow.locator('button[data-r="-"]').click();
await page.waitForTimeout(300);
check(Math.abs(await hueNow() - hueBefore) <= 4,
  `the glow dial drags the hue along: ${hueBefore}° became ${await hueNow()}°`);
for (let i = 0; i < 4; i++) await glow.locator('button[data-r="+"]').click();
await page.waitForTimeout(300);

/* A dial that belongs to one skin has to go when that skin does. It used to
   stay standing after a switch to win95 and did nothing there. */
await page.click('[data-tab="look"]');
await page.evaluate(() => {
  const sel = document.querySelector('#themeSel');
  sel.value = 'win95';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(700);
check(await page.locator('#phosphorRow').isHidden(), 'the phosphor colour is offered for win95');
await page.click('[data-tab="colors"]');
await page.waitForTimeout(400);
check(await page.locator('.styleRow', { hasText: /Leuchtkraft|glow strength/ }).count() === 0,
  'the glow dial is still standing under win95');
await page.evaluate(() => {
  const sel = document.querySelector('#themeSel');
  sel.value = 'crt';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(600);

await page.click('[data-tab="look"]');
await page.waitForTimeout(300);
await page.click('#wbOpen');
await page.waitForTimeout(800);
const wb = await page.locator('#workbench').boundingBox();
check(wb && wb.width > 100, 'the workbench does not appear');
check((await page.inputValue('#wbCss')).length > 100, 'the workbench is empty');
await page.screenshot({ path: shots + '/workbench.png' });
await page.click('#wbClose');

// 7. Every skin renders. One of them had a transparent list for weeks.
await page.click('#railHome');
for (const theme of ['crt-amber', 'win95', 'pixel', 'sketch']) {
  await page.evaluate((t) => {
    const sel = document.querySelector('#themeSel');
    sel.value = t;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, theme);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${shots}/${theme}.png` });
}

/* 8. The half of the interface that only exists with a session. Without one
   none of this can even be opened — files, rules, marks, the viewer. This test
   ran against an empty app at first and therefore never touched any of it,
   which is how a marks pane that threw on every single open passed a green
   run. */
await page.click('#railHome');
await page.waitForTimeout(500);
check(await page.locator('.tile').count() > 0, 'the session does not show up as a tile');
await page.click('.tile');
await page.waitForTimeout(800);
check((await page.locator('.pane').boundingBox())?.width > 100, 'the terminal does not appear');

// #filesToggle is a switch, not an opener: leaving the pane open here means
// the next click on it closes the pane instead of opening it.
await settle();
for (const [button, pane, close] of [['#filesToggle', '#files', '#filesToggle'],
                                     ['#rulesToggle', '#rulesPane', '#rulesClose'],
                                     ['#marksToggle', '#marksPane', '#marksClose']]) {
  await page.click(button);
  await page.waitForTimeout(900);
  const box = await page.locator(pane).boundingBox();
  check(box && box.width > 50 && box.height > 50, `${pane} stays invisible`);
  /* Something has to be readable in there. An empty pane looks exactly like a
     broken one — and the marks pane was broken in precisely that way: the call
     succeeded, the answer was null, reading its length threw, and what was
     left was a pane with nothing in it and no error anywhere. */
  await settle();
  const text = (await page.locator(pane).innerText()).replace(/\s+/g, ' ').trim();
  check(text.length > 10, `${pane} is empty — no list and no empty state either`);
  await page.screenshot({ path: `${shots}/pane-${pane.replace(/\W/g, '')}.png` });
  if (close) await page.click(close);
}

/* The viewer, with the file the harness laid down itself. Its line count and
   its size are both on screen, and both used to be wrong: one line read as
   two, six bytes read as "0.0 kB". */
await settle();
await page.click('#filesToggle');
await page.waitForTimeout(600);
await page.click('.frow');
await page.waitForTimeout(700);
check((await page.inputValue('#viewerBody')).includes('hello'), 'the file does not open');
const meta = (await page.textContent('#viewerMeta')).trim();
/* Singular, not "1 Zeilen". The count being right is what made the plural
   wrong visible in the first place. */
// singular, not "1 lines"
check(/^1 (line)\b/.test(meta), `line count or plural is wrong: "${meta}"`);
check(!/0[.,]0/.test(meta), `the size reads as nothing: "${meta}"`);
await page.screenshot({ path: shots + '/viewer.png' });

/* 9. The workbench's own log. Playwright does not report every rejected
   promise as a pageerror — the marks bug was invisible in `noise` and stood in
   the workbench log in plain sight. Asking the app what it saw is stricter
   than watching it from outside. */
/* The version line has to admit when it does not know.

   GitHub allows sixty API calls an hour per address, without a token and
   shared with everything else on the machine. Once they are gone it answers
   403 — and what the interface said then was "up to date", because a failed
   check and no update look the same from outside. Here the answer is put in
   front of it, so the failing case can be seen without waiting for a real
   rate limit. */
await page.click('#settingsBtn');
await page.waitForTimeout(800);
check(await page.locator('#versionCheck').isVisible(),
  'there is no way to ask for an update at all');

await page.route('**/api/version', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ current: '0.1.0', latest: '', available: false,
                         error: 'err.update.status|403' }),
}));
await page.click('#versionCheck');
await page.waitForTimeout(900);
const said = (await page.textContent('#settingsVersion')).trim();
check(/403/.test(said), `the failed check does not show its reason: "${said}"`);
check(!/aktuell|up to date/i.test(said), `a failed check claims to be up to date: "${said}"`);
await page.unroute('**/api/version');
await page.screenshot({ path: shots + '/version-failed.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

/* 10. Every theme has to be readable — measured, not judged by eye.

   This runs last on purpose: by now a session is open and a tile is standing,
   so there is something to measure at all. Reading it out of the CSS was tried
   first and thrown away — from the source it cannot be known what actually
   lies behind a text. A rail at 60 per cent over paper, a gradient in a title
   bar, a colour built with color-mix: each of those was reported as a failure
   that did not exist, and one that did (keys at 1.37:1 on the ice palette) sat
   in the middle of the noise.

   Ten themes, not four skins. The palette is where readability is decided. */
await page.click('#railHome');
await page.waitForTimeout(400);
const themeNames = await page.evaluate(() =>
  [...document.querySelectorAll('#themeSel option')].map((o) => o.value));
/* Seven, not ten: the four CRT ones were a single hue each and became one
   entry with a colour picker. The number is checked all the same — a theme
   that falls out of the list does so silently. */
check(themeNames.length >= 7,
  `only ${themeNames.length} themes offered — one has fallen out of the list`);

const unreadable = [];
for (const theme of themeNames) {
  await page.evaluate((t) => {
    const sel = document.querySelector('#themeSel');
    sel.value = t;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, theme);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${shots}/theme-${theme}.png` });

  const weak = await page.evaluate(() => {
    const num = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    /* Three spellings arrive: rgb(), rgba() and color(srgb …) with shares from
       0 to 1. Reading the third as 0-255 gives near-black, and then the report
       fills up with failures that are not there. */
    const parse = (v) => {
      if (!v) return null;
      let m = v.match(/rgba?\(([^)]+)\)/);
      if (m) { const q = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        return [q[0], q[1], q[2], q.length > 3 ? q[3] : 1]; }
      m = v.match(/color\(srgb\s+([^)]+)\)/);
      if (m) { const q = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
        return [q[0] * 255, q[1] * 255, q[2] * 255, q.length > 3 ? q[3] : 1]; }
      return null;
    };
    const rootBg = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      const m = v.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
      return m ? [1, 2, 3].map((i) => parseInt(m[i], 16)) : [0, 0, 0];
    };
    /* Half-transparent surfaces get laid over one another instead of skipped:
       the rail sits on the paper at 60 per cent, and what shows through has a
       say. Once the background carries a gradient this is the only way left. */
    const surface = (el) => {
      const layers = [];
      for (let n = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        let c = parse(cs.backgroundColor);
        if ((!c || c[3] === 0) && cs.backgroundImage && cs.backgroundImage !== 'none') {
          const g = cs.backgroundImage.match(/rgba?\([^)]+\)|color\(srgb[^)]+\)/);
          if (g) c = parse(g[0]);
        }
        if (c && c[3] > 0) { layers.push(c); if (c[3] >= 0.999) break; }
      }
      let out = layers.length && layers[layers.length - 1][3] >= 0.999
        ? layers.pop().slice(0, 3) : rootBg();
      for (let i = layers.length - 1; i >= 0; i--) {
        const [r, g, b, a] = layers[i];
        out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
      }
      return out;
    };
    const chan = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = ([r, g, b]) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
    const ratio = (a, b) => { const x = lum(a), y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.devPanel')) continue;   // brings its own colours on purpose
      const own = [...el.childNodes].filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim()).join('').trim();
      if (!own) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      const v = ratio(num(cs.color).slice(0, 3), surface(el));
      if (v < 4.5) out.push(`${v.toFixed(2)}:1 ${String(el.className).split(' ')[0] || el.tagName}`);
    }
    return out;
  });
  /* One line per class. The archive has a hundred and fifty rows, and the same
     complaint a hundred and fifty times buries every other finding. */
  for (const w of [...new Set(weak)]) unreadable.push(`${theme} ${w}`);
}
check(unreadable.length === 0,
  `${unreadable.length} texts too weak: ${unreadable.slice(0, 10).join(' | ')}`);

/* 11. See-through: nothing readable may end up standing on the desktop.

   The claim when this was built was that only the space between the panels
   shows through. Measured, that was wrong — the whole header, the clock, the
   session count and the empty state sat straight on the page. What is behind
   the window cannot be measured, so the rule is the other way round: with
   see-through switched on, every text has to find an opaque ground of its own
   inside the page. */
/* Under a named theme, not under whichever one the loop above happened to end
   on. Some skins give the header a ground of their own, and then this passes
   without proving anything — the first version of this check did exactly that
   and stayed green with the rule deleted. */
await page.evaluate(() => {
  const sel = document.querySelector('#themeSel');
  sel.value = 'crt-amber';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(600);
await page.evaluate(() => {
  document.documentElement.dataset.pagebg = 'seethrough';
  document.documentElement.style.setProperty('--bgSolid', '40%');
});
await page.waitForTimeout(400);
const onDesktop = await page.evaluate(() => {
  const out = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.devPanel')) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim()).join('').trim();
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    let ground = null;
    for (let n = el; n; n = n.parentElement) {
      const v = (getComputedStyle(n).backgroundColor.match(/[\d.]+/g) || []).map(Number);
      if (v.length >= 3 && (v.length < 4 || v[3] > 0.85)) { ground = n; break; }
    }
    if (!ground || ground === document.documentElement || ground === document.body) {
      out.add(String(el.className).split(' ')[0] || el.tagName);
    }
  }
  return [...out];
});
check(onDesktop.length === 0,
  `${onDesktop.length} texts would stand on the desktop: ${onDesktop.slice(0, 8).join(', ')}`);
await page.screenshot({ path: shots + '/seethrough.png' });
await page.evaluate(() => {
  delete document.documentElement.dataset.pagebg;
  document.documentElement.style.removeProperty('--bgSolid');
});

/* Does what you set stay set?

   Everything in the style editor applied at once and was gone on the next
   start — it only survived if you went and saved a theme of your own, and
   nothing said so. With the colour picker as the main way to set the look,
   that meant the setting evaporated every time.

   Reloading the page is the same thing here as starting again: the state lives
   in the browser, and nothing of it is in the daemon. */
await page.click('#settingsBtn');
await page.waitForTimeout(500);
// Back to CRT: the theme loop above leaves whichever came last, and the
// phosphor colour only exists for this skin.
await page.click('[data-tab="look"]');
await page.evaluate(() => {
  const sel = document.querySelector('#themeSel');
  sel.value = 'crt';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(800);
await page.click('#phosphorRow .swatch');
await page.waitForTimeout(300);
await page.evaluate(() => {
  const hue = document.querySelector('#phosphorRow .swatchHue');
  const r = hue.getBoundingClientRect();
  hue.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true,
    clientX: r.left + r.width * 0.55, clientY: r.top + 2 }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});
await page.waitForTimeout(500);
const readFg = () => page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--fg').trim());
const chosen = await readFg();
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
check(await readFg() === chosen,
  `the chosen colour does not survive a restart: ${chosen} became ${await readFg()}`);

/* And RESET has to forget it, otherwise it comes back on the next start and
   the reset was a lie. */
await page.click('#settingsBtn');
await page.waitForTimeout(500);
await page.click('[data-tab="colors"]');
await page.waitForTimeout(400);
await page.click('#styleReset');
await page.waitForTimeout(900);
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
check(await readFg() !== chosen,
  `RESET did not forget the colour: it is still ${await readFg()}`);

const own = await ownLog();
check(own.length === 0, 'the workbench recorded: ' + own.join(' | '));

check(noise.length === 0, 'complaints along the way: ' + noise.join(' | '));
await browser.close();

if (!failed) console.log('  the interface opens, every view is on screen, nothing complains');
process.exit(failed);
