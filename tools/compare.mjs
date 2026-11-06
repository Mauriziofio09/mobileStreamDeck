#!/usr/bin/env node
// Legt Screenshot und den passenden Ausschnitt der Vorlage nebeneinander (nur lokal, design-ref/ ist ignoriert).
import sharp from 'sharp';

const REF = 'design-ref/vorlage.png';
// Bildschirmbereiche in der Vorlage (Pixel der Originaldatei 3198×2261).
const REGIONS = {
  'ipad-landscape': { left: 373, top: 147, width: 2097, height: 1439 },
  'iphone-landscape': { left: 1303, top: 1203, width: 1695, height: 634 },
};
const suffix = process.argv[2] ?? '';
for (const [name, region] of Object.entries(REGIONS)) {
  const shot = `screenshots/${name}${suffix}.png`;
  const meta = await sharp(shot).metadata();
  const h = 700;
  const shotBuf = await sharp(shot).resize({ height: h }).toBuffer();
  const sw = Math.round((meta.width / meta.height) * h);
  const refBuf = await sharp(REF).extract(region).resize({ height: h }).toBuffer();
  const rw = Math.round((region.width / region.height) * h);
  await sharp({ create: { width: sw + rw + 20, height: h, channels: 3, background: '#000' } })
    .composite([{ input: refBuf, left: 0, top: 0 }, { input: shotBuf, left: rw + 20, top: 0 }])
    .png()
    .toFile(`screenshots/compare-${name}${suffix}.png`);
  console.log(`✓ screenshots/compare-${name}${suffix}.png (links Vorlage, rechts App)`);
}
