#!/usr/bin/env node
// Screenshots von Interaktionszuständen (Bar-Overlay, Timer, Bearbeiten, Seite 2) in WebKit.
import { webkit } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4200/';
const suffix = process.argv[3] ?? '';
const browser = await webkit.launch();
async function ctx(w, h, safe) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, screen: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await c.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(`${base}?safe=${safe}`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  return { c, p };
}
{ // iPhone: Bar-Overlay
  const { c, p } = await ctx(852, 393, '0,59,21,59');
  await p.locator('.seg').nth(1).click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `screenshots/state-iphone-bar${suffix}.png` });
  await c.close();
}
{ // iPad: Timer-Auswahl
  const { c, p } = await ctx(1180, 820, '24,0,20,0');
  await p.locator('.clock').click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `screenshots/state-ipad-timer${suffix}.png` });
  await p.locator('.choice').first().click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: `screenshots/state-ipad-timer-running${suffix}.png` });
  // Langes Drücken -> Bearbeitungsmodus
  const tile = p.locator('cd-tile').first();
  const box = await tile.boundingBox();
  await p.mouse.move(box.x + 30, box.y + 30);
  await p.mouse.down();
  await p.waitForTimeout(650);
  await p.mouse.up();
  await p.waitForTimeout(200);
  await p.screenshot({ path: `screenshots/state-ipad-edit${suffix}.png` });
  await p.locator('.done').click();
  // Seite 2 per Wischen
  await p.mouse.move(900, 400); await p.mouse.down();
  for (let x = 900; x >= 400; x -= 50) { await p.mouse.move(x, 402); await p.waitForTimeout(16); }
  await p.mouse.up();
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `screenshots/state-ipad-page2${suffix}.png` });
  await c.close();
}
await browser.close();
console.log('ok');
