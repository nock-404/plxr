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
                            // The overview: with no tiles #viewGrid is empty and
                            // deliberately hidden — what is on screen then is the
                            // box beside it. Asking for #viewGrid would be asking
                            // the wrong question.
                            ['#railHome', '.emptybox']]) {
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

check(noise.length === 0, 'complaints along the way: ' + noise.join(' | '));
await browser.close();

if (!failed) console.log('  the interface opens, every view is on screen, nothing complains');
process.exit(failed);
