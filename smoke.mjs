/* Click through the interface and look at it — with an actual browser.

   Every interface bug of the last two days had to be found by hand, because
   nothing here could open the window: #vorlagen threw at startup and left the
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
  if (!/\/wails\//.test(r.url())) noise.push('request: ' + r.url());
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 1. Nothing thrown. This alone would have caught #vorlagen.
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
check((await page.inputValue('#viewerBody')).includes('hallo'), 'the file does not open');
const meta = (await page.textContent('#viewerMeta')).trim();
/* Singular, not "1 Zeilen". The count being right is what made the plural
   wrong visible in the first place. */
check(/^1 (Zeile|line)\b/.test(meta), `line count or plural is wrong: "${meta}"`);
check(!/0[.,]0/.test(meta), `the size reads as nothing: "${meta}"`);
await page.screenshot({ path: shots + '/viewer.png' });

/* 9. The workbench's own log. Playwright does not report every rejected
   promise as a pageerror — the marks bug was invisible in `noise` and stood in
   the workbench log in plain sight. Asking the app what it saw is stricter
   than watching it from outside. */
const own = await ownLog();
check(own.length === 0, 'the workbench recorded: ' + own.join(' | '));

check(noise.length === 0, 'complaints along the way: ' + noise.join(' | '));
await browser.close();

if (!failed) console.log('  the interface opens, every view is on screen, nothing complains');
process.exit(failed);
