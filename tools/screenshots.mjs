#!/usr/bin/env node
// Screenshots mit Playwright WebKit, Safe Areas über ?safe=oben,rechts,unten,links simuliert.
// Aufruf: node tools/screenshots.mjs [baseUrl] [suffix]
import { webkit } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] ?? 'http://localhost:4200/';
const suffix = process.argv[3] ?? '';
const DEVICES = [
  { name: 'ipad-landscape', w: 1180, h: 820, safe: '24,0,20,0' },
  { name: 'iphone-landscape', w: 852, h: 393, safe: '0,59,21,59' },
  { name: 'ipad-portrait', w: 820, h: 1180, safe: '24,0,20,0' },
  { name: 'iphone-portrait', w: 393, h: 852, safe: '59,0,34,0' },
];
const only = process.env.ONLY?.split(',');

await mkdir('screenshots', { recursive: true });
const browser = await webkit.launch();
for (const d of DEVICES.filter((x) => !only || only.includes(x.name))) {
  const ctx = await browser.newContext({
    viewport: { width: d.w, height: d.h },
    screen: { width: d.w, height: d.h },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${d.name}] ${m.text()}`); });
  page.on('pageerror', (e) => console.log(`[${d.name}] pageerror ${e.message}`));
  await page.goto(`${base}?safe=${d.safe}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const file = `screenshots/${d.name}${suffix}.png`;
  await page.screenshot({ path: file });
  console.log('✓', file);
  await ctx.close();
}
await browser.close();
