#!/usr/bin/env node
// Meilenstein 5: App-Update über den Service Worker (gegen den Helper unter launchd).
// Version A ist installiert und geöffnet -> Version B wird installiert -> Hinweis -> Aktualisieren -> B läuft.
import { webkit } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL_ = 'https://macbook-pro-von-maurizio.local:7443/';
const cli = (...a) => execFileSync('copper-deck', a, { encoding: 'utf8' });
let failures = 0;
const check = (c, l, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ' – ' + x : ''}`); if (!c) failures++; };
const builtAt = async (p) => p.evaluate(async () => (await (await fetch('/ngsw.json', { cache: 'no-store' })).json()).timestamp);
const mainScript = (p) => p.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => /main-/.test(s)));

const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
let deviceId = null;
try {
  await page.goto(URL_, { waitUntil: 'networkidle' });
  const code = /Kopplungscode:\s+(\d{3}) (\d{3})/.exec(cli('pair'));
  await page.fill('input.code', code[1] + code[2]);
  await page.click('button.submit');
  await page.waitForSelector('cd-pager cd-tile');
  deviceId = await page.evaluate(() => localStorage.getItem('copperdeck.device'));
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 20000 });
  await page.waitForTimeout(6000); // App-Shell im Cache
  await page.reload({ waitUntil: 'networkidle' }); // jetzt vom Service Worker kontrolliert
  await page.waitForSelector('cd-pager cd-tile');
  const scriptA = await mainScript(page);
  console.log('  Version A:', scriptA?.split('/').pop());

  console.log('  … installiere Version B (scripts/install.sh)');
  execFileSync('scripts/install.sh', { stdio: 'ignore' });
  await page.waitForFunction(() => !document.querySelector('.conn-banner'), null, { timeout: 30000 });
  // Zurückkehren in die App simulieren -> Update-Prüfung
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForSelector('.update', { timeout: 30000 })
    .then(() => check(true, 'Hinweis „Neue Version“ erscheint'), () => check(false, 'Hinweis „Neue Version“ erscheint'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/m5-update-banner.png' });
  check(await mainScript(page) === scriptA, 'Bis zum Tippen läuft unverändert Version A (kein ungefragter Reload)');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.click('.update button')]);
  await page.waitForSelector('cd-pager cd-tile');
  const scriptB = await mainScript(page);
  check(!!scriptB && scriptB !== scriptA, 'Nach „Aktualisieren“ läuft Version B', scriptB?.split('/').pop());
  check(await page.locator('.update').count() === 0, 'Hinweis ist danach weg');
  check(!!(await page.evaluate(() => localStorage.getItem('copperdeck.token'))), 'Kopplung bleibt nach dem Update erhalten');
} catch (e) {
  check(false, `Abbruch: ${e.message.split('\n')[0]}`);
} finally {
  if (deviceId) cli('revoke', deviceId);
  await browser.close();
}
console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
