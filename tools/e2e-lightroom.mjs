#!/usr/bin/env node
// Lightroom-Tab Ende-zu-Ende: iPad + iPhone (Playwright WebKit) → Helper unter launchd → nachgebildetes Plugin
// (tools/fake-lightroom.mjs auf den echten Plugin-Ports). Prüft Verbindung, Regler, Bewertung, Markierung,
// Navigation, Vorgaben, Rückgängig, Live-Sync und das Trennen. Lightroom selbst ist dafür nicht nötig.
import { webkit } from 'playwright';
import { execFileSync } from 'node:child_process';
import { startFakeLightroom } from './fake-lightroom.mjs';

const URL_ = 'https://macbook-pro-von-maurizio.local:7443/';
const cli = (...a) => execFileSync('copper-deck', a, { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (c, l, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ' – ' + x : ''}`); if (!c) failures++; };
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return fn(); };

const browser = await webkit.launch();
const devices = [];
async function device(name, w, h, safe) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, screen: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto(`${URL_}?safe=${safe}`, { waitUntil: 'networkidle' });
  const code = /Kopplungscode:\s+(\d{3}) (\d{3})/.exec(cli('pair'));
  await page.fill('input[name=name]', `E2E LR ${name}`);
  await page.fill('input.code', code[1] + code[2]);
  await page.click('button.submit');
  await page.waitForSelector('cd-side-controls');
  const id = await page.evaluate(() => localStorage.getItem('copperdeck.device'));
  devices.push(id);
  return page;
}

let fake = null;
const P = await device('iPad', 1180, 820, '24,0,20,0');
const IP = await device('iPhone', 852, 393, '0,59,21,59');
try {
  // 1) Ohne Lightroom: Hinweis
  await P.click('cd-side-controls button[aria-label="Lightroom"]');
  await P.waitForSelector('cd-lightroom');
  // Ohne Classic: Hinweis – oder, wenn Adobe Lightroom (Cloud) installiert ist, dessen Schaltflächen
  check(await P.locator('cd-lightroom h2', { hasText: 'nicht verbunden' }).count() === 1 || await P.locator('cd-lightroom .cloud').count() === 1,
    'Ohne Classic: Hinweis bzw. Schaltflächen für Adobe Lightroom');
  await P.screenshot({ path: 'screenshots/lr-ipad-disconnected.png' });

  // 2) "Lightroom" startet: Helper verbindet sich von selbst
  fake = await startFakeLightroom();
  check(await until(async () => (await P.locator('cd-lightroom .photo .name').count()) === 1, 6000), 'Helper verbindet sich von selbst mit dem Plugin (Classic hat Vorrang)');
  check((await P.locator('cd-lightroom .photo .name').textContent()) === 'DSC_0042.NEF', 'Aktuelles Foto wird angezeigt');
  check(await P.locator('cd-side-controls .lr-dot').count() === 1, 'Grüner Punkt am LR-Segment');

  // 3) Regler ziehen: Belichtung
  const exp = P.locator('cd-lr-slider').filter({ hasText: 'Belichtung' });
  const track = await exp.locator('.track').boundingBox();
  const y = track.y + track.height / 2;
  await P.mouse.move(track.x + track.width / 2, y);
  await P.mouse.down();
  for (let i = 1; i <= 10; i++) { await P.mouse.move(track.x + track.width / 2 + i * 6, y); await sleep(30); }
  await P.mouse.up();
  check(await until(() => fake.photos[1].values.Exposure2012 > 0.4), 'Ziehen am Regler ändert die Belichtung in Lightroom', `+${fake.photos[1].values.Exposure2012.toFixed(2)}`);
  const sets = fake.state.commands.filter((c) => c[0] === 'set').length;
  check(sets >= 2 && sets <= 12, 'Regler sendet gedrosselt (kein Stau)', `${sets} Werte für 10 Bewegungen`);
  await sleep(1200);
  const shown = (await exp.locator('.value').textContent()).trim();
  // de-CH schreibt Dezimalpunkt (wie Lightroom mit Schweizer Einstellungen)
  check(shown === `+${fake.photos[1].values.Exposure2012.toFixed(2)}`, 'Angezeigter Wert = Wert in Lightroom', shown);
  await P.screenshot({ path: 'screenshots/lr-ipad-basic.png' });

  // 4) + und − nutzen Lightroom-Schritte, Doppeltippen setzt zurück
  const before = fake.photos[1].values.Exposure2012;
  await exp.locator('button[aria-label="Belichtung erhöhen"]').click();
  check(await until(() => Math.abs(fake.photos[1].values.Exposure2012 - (before + 0.05)) < 1e-9), '+ erhöht um den Lightroom-Schritt');
  await exp.locator('.track').dblclick();
  check(await until(() => fake.photos[1].values.Exposure2012 === 0), 'Doppeltippen setzt den Regler zurück');

  // 5) Bewertung, Markierung, Farbe – und Live-Sync aufs iPhone
  await P.click('cd-lightroom .star[aria-label="4 Sterne"]');
  await P.click('cd-lightroom .chip:has-text("Auswahl")');
  await P.click('cd-lightroom .dot[aria-label="Grün"]');
  check(await until(() => fake.photos[1].rating === 4 && fake.photos[1].flag === 'pick' && fake.photos[1].label === 'green'), 'Sterne, Auswahl und Farbmarkierung gesetzt');
  await IP.click('cd-side-controls button[aria-label="Lightroom"]');
  await IP.waitForSelector('cd-lightroom .rate');
  check(await until(async () => (await IP.locator('cd-lightroom .star.on').count()) === 4), 'Live-Sync: iPhone zeigt 4 Sterne');
  await P.click('cd-lightroom .star[aria-label="4 Sterne"]');
  check(await until(() => fake.photos[1].rating === 0), 'Erneutes Tippen auf denselben Stern entfernt die Bewertung');

  // 6) Navigation
  await P.click('cd-lightroom button[aria-label="Nächstes Foto"]');
  check(await until(async () => (await P.locator('cd-lightroom .photo .name').textContent()) === 'IMG_2201.jpg'), 'Nächstes Foto');
  check(await until(async () => (await P.locator('cd-lr-slider').filter({ hasText: 'Temperatur' }).locator('.value').textContent()).trim() === '0'),
    'JPEG: Temperatur im Bereich −100…100 statt Kelvin');

  // 7) HSL und Vorgaben
  await P.click('cd-lightroom .tabs button:has-text("HSL")');
  await P.click('cd-lightroom .hsl-mode button:has-text("Sättigung")');
  check(await P.locator('cd-lr-slider').count() === 8, 'HSL: 8 Farbregler je Modus');
  await P.screenshot({ path: 'screenshots/lr-ipad-hsl.png' });
  await P.click('cd-lightroom .tabs button:has-text("Vorgaben")');
  await P.click('cd-lightroom .folder-head:has-text("Eigene Vorgaben")');
  await P.click('cd-lightroom .preset:has-text("Schwarzweiss Kontrast")');
  check(await until(() => fake.photos[2].values.Saturation === -100), 'Vorgabe angewendet');
  await P.screenshot({ path: 'screenshots/lr-ipad-presets.png' });

  // 8) Rückgängig, Schnellaktionen
  await P.click('cd-lightroom button[aria-label="Rückgängig"]');
  check(await until(() => fake.photos[2].values.Saturation === 0), 'Rückgängig');
  await P.click('cd-lightroom .act:has-text("Auto-WA")');
  await P.click('cd-lightroom .act:has-text("Vorher/Nachher")');
  check(await until(() => fake.state.beforeAfter === true), 'Vorher/Nachher umgeschaltet');
  await P.click('cd-lightroom .act:has-text("Zurücksetzen")');
  await sleep(200);
  check(!fake.state.commands.some((c) => c[0] === 'resetall'), '„Zurücksetzen“ fragt zuerst nach');

  // 9) Bibliothek: Regler gesperrt mit Hinweis
  await P.click('cd-lightroom .tabs button:has-text("Grundeinstellungen")');
  await P.click('cd-lightroom .module button:has-text("Bibliothek")');
  check(await until(async () => (await P.locator('cd-lightroom .note', { hasText: 'Modul Entwickeln' }).count()) === 1), 'Bibliothek: Hinweis, Regler gesperrt');
  await P.click('cd-lightroom .link:has-text("Zu Entwickeln wechseln")');
  check(await until(() => fake.state.module === 'develop'), 'Zurück zu Entwickeln');

  // 10) iPhone-Ansichten
  await IP.screenshot({ path: 'screenshots/lr-iphone-landscape.png' });
  await IP.setViewportSize({ width: 393, height: 852 });
  await sleep(400);
  await IP.screenshot({ path: 'screenshots/lr-iphone-portrait.png' });

  // 11) Lightroom wird beendet
  await fake.close();
  fake = null;
  check(await until(async () => (await P.locator('cd-lightroom h2', { hasText: 'nicht verbunden' }).count()) === 1 || (await P.locator('cd-lightroom .cloud').count()) === 1, 6000),
    'Classic beendet: App zeigt das sofort');
} catch (e) {
  check(false, `Abbruch: ${e.message.split('\n')[0]}`);
} finally {
  if (fake) await fake.close();
  for (const p of [P, IP]) await p.evaluate(() => localStorage.setItem('copperdeck.view', 'deck')).catch(() => {});
  for (const id of devices) if (id) cli('revoke', id);
  await browser.close();
}
console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
