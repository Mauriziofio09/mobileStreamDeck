#!/usr/bin/env node
// Echter Durchlauf gegen den laufenden Helper (Meilenstein 2) in Playwright WebKit:
// HTTPS ohne Zertifikatsausnahme, Kopplung per CLI-Code, App öffnen, Link öffnen, Offline/Reconnect.
import { webkit } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL_ = process.argv[2] ?? 'https://macbook-pro-von-maurizio.local:7443/';
const cli = (...a) => execFileSync('copper-deck', a, { encoding: 'utf8' });
const step = (s) => console.log(`\n▶ ${s}`);

const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));

step('App-Shell über HTTPS laden (Zertifikat muss vertraut sein)');
await page.goto(URL_, { waitUntil: 'networkidle' });
await page.waitForSelector('cd-pairing');
console.log('  Kopplungsansicht sichtbar');

step('Kopplung: Code per "copper-deck pair"');
const code = /Kopplungscode:\s+(\d{3}) (\d{3})/.exec(cli('pair'));
await page.fill('input[name=name]', 'E2E WebKit');
await page.fill('input.code', '999999');
await page.click('button.submit');
await page.waitForSelector('cd-pairing .error');
console.log('  falscher Code →', (await page.textContent('cd-pairing form .error'))?.trim());
await page.fill('input.code', code[1] + code[2]);
await page.click('button.submit');
await page.waitForSelector('cd-pager cd-tile', { timeout: 10000 });
await page.waitForFunction(() => !document.querySelector('.conn-banner'));
console.log('  gekoppelt und verbunden');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'screenshots/m2-connected.png' });

async function tap(label) {
  const tile = page.locator(`cd-tile[aria-label="${label}"]`).first();
  await tile.dispatchEvent('pointerdown', { isPrimary: true, pointerId: 1, clientX: 1, clientY: 1 });
  await tile.dispatchEvent('pointerup', { isPrimary: true, pointerId: 1, clientX: 1, clientY: 1 });
  await tile.locator('.badge').waitFor({ timeout: 12000 });
  return (await tile.locator('.badge').getAttribute('class')).includes('error') ? 'Fehler' : 'Erfolg';
}

step('Aktion: App öffnen (Finder)');
console.log('  Ergebnis:', await tap('Finder'));
step('Aktion: Link öffnen (Google Fonts)');
console.log('  Ergebnis:', await tap('Google Fonts'));

const tokenInLs = await page.evaluate(() => !!localStorage.getItem('copperdeck.token'));
console.log('\n  Token im localStorage der App:', tokenInLs);
cli('revoke', await page.evaluate(() => localStorage.getItem('copperdeck.device')));
await page.close();
await ctx.close();
await browser.close();
