#!/usr/bin/env node
// Offline/Reconnect: Helper stoppen, Aktion auslösen (muss sofort mit "offline" scheitern),
// Helper starten, automatischer Reconnect, und es darf KEINE Aktion nachgeholt werden.
import { webkit } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { openSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const URL_ = 'https://macbook-pro-von-maurizio.local:7443/';
const LOG = `${homedir()}/Library/Logs/CopperDeck/helper.log`;
const out = process.argv[2];
const cli = (...a) => execFileSync('helper/bin/copper-deck', a, { encoding: 'utf8' });
const actionLines = () => readFileSync(LOG, 'utf8').split('\n').filter((l) => l.includes(' Aktion ')).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
await page.goto(URL_, { waitUntil: 'networkidle' });
const code = /Kopplungscode:\s+(\d{3}) (\d{3})/.exec(cli('pair'));
await page.fill('input.code', code[1] + code[2]);
await page.click('button.submit');
await page.waitForSelector('cd-pager cd-tile');
await page.waitForFunction(() => !document.querySelector('.conn-banner'));
console.log('✓ verbunden');

execFileSync('pkill', ['-f', 'copper-deck.mjs serve']);
await page.waitForSelector('.conn-banner', { timeout: 30000 });
console.log('✓ Offline erkannt:', (await page.textContent('.conn-banner')).trim());
await page.screenshot({ path: 'screenshots/m2-offline.png' });

const before = actionLines();
const tile = page.locator('cd-tile[aria-label="Finder"]').first();
await tile.dispatchEvent('pointerdown', { isPrimary: true, pointerId: 1 });
await tile.dispatchEvent('pointerup', { isPrimary: true, pointerId: 1 });
await page.waitForSelector('.toast');
console.log('✓ Tippen offline →', (await page.textContent('.toast')).trim());

const child = spawn('helper/bin/copper-deck', ['serve'], { detached: true, stdio: ['ignore', openSync(out, 'a'), openSync(out, 'a')] });
child.unref();
const t0 = Date.now();
await page.waitForFunction(() => !document.querySelector('.conn-banner'), null, { timeout: 30000 });
console.log(`✓ automatisch wieder verbunden nach ${((Date.now() - t0) / 1000).toFixed(1)} s (Backoff)`);
await sleep(2500);
console.log(actionLines() === before ? '✓ keine Aktion nachgeholt' : '✗ Aktion wurde nachgeholt!');
await browser.close();
