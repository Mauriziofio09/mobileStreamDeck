#!/usr/bin/env -S node --import tsx
// Erzeugt App-Icons und iOS-Splash-Screens (eigener Code, keine Bildausschnitte aus der Vorlage).
// Gerendert mit Playwright WebKit: gleiche Squircle-Geometrie und Schrift wie die App.
//   node --import tsx tools/make-assets.mts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit } from 'playwright';
import sharp from 'sharp';
import { squirclePath } from '../web/src/app/core/squircle.ts';

const root = path.resolve(import.meta.dirname, '..');
const pub = path.join(root, 'web/public');
const font = readFileSync(path.join(pub, 'fonts/barlow-condensed-latin-700-normal.woff2')).toString('base64');

/** Motiv: verschachtelte Rahmen mit 2×2 Kacheln (Braun/Violett) auf Kupfer-Verlauf. */
function iconSvg(size: number, opts: { motif?: number; rounded?: boolean } = {}): string {
  const s = size;
  const m = (opts.motif ?? 0.74) * s; // Grösse des Motivs
  const o = (s - m) / 2;
  const frame = squirclePath(o, o, m, m, m * 0.2);
  const gap = m * 0.07, pad = m * 0.1;
  const cell = (m - 2 * pad - gap) / 2;
  const tiles = [
    { x: 0, y: 0, c: 'b' }, { x: 1, y: 0, c: 'v' }, { x: 0, y: 1, c: 'v' }, { x: 1, y: 1, c: 'b' },
  ].map((t) => {
    const x = o + pad + t.x * (cell + gap), y = o + pad + t.y * (cell + gap);
    const ring = squirclePath(x, y, cell, cell, cell * 0.27);
    const ins = cell * 0.1;
    const tile = squirclePath(x + ins, y + ins, cell - 2 * ins, cell - 2 * ins, (cell - 2 * ins) * 0.25);
    return `<path d="${ring}" fill="url(#ring)" stroke="rgba(255,160,90,.55)" stroke-width="${s * 0.003}"/>
      <path d="${tile}" fill="url(#${t.c})"/>
      <path d="${tile}" fill="url(#sheen)"/>`;
  }).join('');
  const bg = opts.rounded ? `<path d="${squirclePath(0, 0, s, s, s * 0.225)}" fill="url(#bg)"/>` : `<rect width="${s}" height="${s}" fill="url(#bg)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <defs>
      <radialGradient id="bg" cx="0.62" cy="0.78" r="0.95">
        <stop offset="0" stop-color="#9a3e07"/><stop offset="0.35" stop-color="#6c2602"/>
        <stop offset="0.7" stop-color="#3a1500"/><stop offset="1" stop-color="#170800"/>
      </radialGradient>
      <linearGradient id="ring" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="rgba(255,158,92,.20)"/><stop offset="1" stop-color="rgba(255,128,60,.28)"/>
      </linearGradient>
      <linearGradient id="b" x1="0" y1="0" x2="0.2" y2="1"><stop offset="0" stop-color="#a5490f"/><stop offset="1" stop-color="#6a1b02"/></linearGradient>
      <linearGradient id="v" x1="0" y1="0" x2="0.2" y2="1"><stop offset="0" stop-color="#7a1fbd"/><stop offset="1" stop-color="#46016b"/></linearGradient>
      <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(255,226,190,.28)"/><stop offset="0.45" stop-color="rgba(255,226,190,0)"/></linearGradient>
    </defs>
    ${bg}
    <path d="${frame}" fill="rgba(14,4,0,.35)" stroke="rgba(255,128,52,.5)" stroke-width="${s * 0.004}"/>
    ${tiles}
  </svg>`;
}

function splashHtml(w: number, h: number): string {
  const short = Math.min(w, h);
  const icon = Math.round(short * 0.26);
  return `<!doctype html><html><head><style>
    @font-face { font-family: 'BC'; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 700; }
    html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; }
    body {
      display: grid; place-content: center; justify-items: center; gap: ${Math.round(short * 0.05)}px;
      background:
        repeating-linear-gradient(90deg, rgba(255,150,80,0) 0 61px, rgba(255,150,80,.016) 61px 66px, rgba(255,150,80,0) 66px 97px),
        linear-gradient(100deg, rgba(14,4,0,.55) 0%, rgba(14,4,0,0) 38%),
        radial-gradient(120% 110% at 60% 72%, #8a3404 0%, #6c2602 22%, #4c1b00 48%, #2a0f00 76%, #170800 100%);
    }
    .word { font: 700 ${Math.round(short * 0.085)}px/1 'BC'; letter-spacing: .04em; color: #f4cfa6; text-transform: uppercase; }
  </style></head><body>
    ${iconSvg(icon, { motif: 0.78, rounded: true })}
    <div class="word">Copper Deck</div>
  </body></html>`;
}

// Gängige Geräte (CSS-Punkte, Pixelverhältnis). Hochformat-Masse; Querformat wird ergänzt.
const DEVICES: [string, number, number, number][] = [
  ['iPhone SE', 375, 667, 2], ['iPhone 13/14', 390, 844, 3], ['iPhone 14 Pro/15/16', 393, 852, 3],
  ['iPhone 16 Pro/17', 402, 874, 3], ['iPhone Air', 420, 912, 3], ['iPhone Plus/Pro Max', 430, 932, 3],
  ['iPhone 16/17 Pro Max', 440, 956, 3],
  ['iPad mini', 744, 1133, 2], ['iPad 10/Air 11', 820, 1180, 2], ['iPad Pro 11 (alt)', 834, 1194, 2],
  ['iPad Pro 11 (M4)', 834, 1210, 2], ['iPad Air 13/Pro 12.9', 1024, 1366, 2], ['iPad Pro 13 (M4)', 1032, 1376, 2],
];

mkdirSync(path.join(pub, 'icons'), { recursive: true });
mkdirSync(path.join(pub, 'splash'), { recursive: true });
const browser = await webkit.launch();
const page = await browser.newPage();

async function renderSvg(svg: string, size: number): Promise<Buffer> {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const master = await renderSvg(iconSvg(1024), 1024);
writeFileSync(path.join(pub, 'icons/icon-1024.png'), master);
for (const [name, px] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512], ['favicon-32.png', 32], ['favicon-64.png', 64]] as const) {
  await sharp(master).resize(px, px, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(path.join(pub, 'icons', name));
}
// Maskable: Motiv in der sicheren Zone (80 %)
const maskable = await renderSvg(iconSvg(1024, { motif: 0.6 }), 1024);
await sharp(maskable).resize(512, 512).png({ compressionLevel: 9 }).toFile(path.join(pub, 'icons/icon-maskable-512.png'));

const links: string[] = [];
for (const [name, w, h, dpr] of DEVICES) {
  for (const orient of ['portrait', 'landscape'] as const) {
    const cw = orient === 'portrait' ? w : h, ch = orient === 'portrait' ? h : w;
    await page.setViewportSize({ width: cw * dpr, height: ch * dpr });
    await page.setContent(splashHtml(cw * dpr, ch * dpr));
    await page.evaluate(() => document.fonts.ready);
    const file = `splash/splash-${cw * dpr}x${ch * dpr}.jpg`;
    const buf = await page.screenshot({ type: 'png' });
    await sharp(buf).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(pub, file));
    links.push(`  <link rel="apple-touch-startup-image" href="${file}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: ${orient})"><!-- ${name} -->`);
  }
}
await browser.close();

const indexPath = path.join(root, 'web/src/index.html');
const index = readFileSync(indexPath, 'utf8');
const block = `<!-- splash:start (tools/make-assets.mts) -->\n${links.join('\n')}\n  <!-- splash:end -->`;
writeFileSync(indexPath, index.replace(/<!-- splash:start[\s\S]*?<!-- splash:end -->/, block));
console.log(`✓ Icons und ${links.length} Splash-Screens erzeugt`);
