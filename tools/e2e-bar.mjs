#!/usr/bin/env node
// Emoji-Leiste und Dock bearbeiten – zwei Geräte (iPad + iPhone, Playwright WebKit) gegen den Helper unter launchd:
// langes Drücken, Emoji ändern/hinzufügen/umsortieren/entfernen, Dock hinzufügen/ersetzen/umsortieren/entfernen,
// doppelte App, Live-Sync, iPhone-Overlay. Es wird keine Aktion auf dem Mac ausgelöst (geprüft).
// Die Konfiguration wird am Ende auf den Stand vor dem Test zurückgesetzt.
import { webkit } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const URL_ = 'https://macbook-pro-von-maurizio.local:7443/';
const CONFIG = path.join(homedir(), 'Library/Application Support/CopperDeck/config.json');
const original = JSON.parse(readFileSync(CONFIG, 'utf8'));
const cli = (...a) => execFileSync('copper-deck', a, { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (c, l, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ' – ' + x : ''}`); if (!c) failures++; };
const serverConfig = () => JSON.parse(readFileSync(CONFIG, 'utf8'));
const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(100); } return fn(); };

const browser = await webkit.launch();
const runs = [];
async function device(name, w, h, safe) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, screen: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      // Sicherheitsnetz: Aktionen (Emoji einfügen, App öffnen) nie an den Mac weitergeben, nur zählen.
      try { if (JSON.parse(m).type === 'run') { runs.push(`${name}:${JSON.parse(m).actionId}`); return; } } catch { /* */ }
      server.send(m);
    });
    server.onMessage((m) => ws.send(m));
  });
  await page.goto(`${URL_}?safe=${safe}`, { waitUntil: 'networkidle' });
  const code = /Kopplungscode:\s+(\d{3}) (\d{3})/.exec(cli('pair'));
  await page.fill('input[name=name]', `E2E ${name}`);
  await page.fill('input.code', code[1] + code[2]);
  await page.click('button.submit');
  await page.waitForSelector('cd-pager cd-tile[data-group-id]');
  await page.waitForFunction(() => !document.querySelector('.conn-banner'));
  const id = await page.evaluate(() => localStorage.getItem('copperdeck.device'));
  return { page, ctx, id };
}

const ipad = await device('iPad', 1180, 820, '24,0,20,0');
const iphone = await device('iPhone', 852, 393, '0,59,21,59');
const P = ipad.page;
const IP = iphone.page;
const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const emojiBtn = (page, i) => page.locator('cd-emoji-bar .emoji').nth(i);
const dockBtn = (page, i) => page.locator('cd-dock .item:not(.add)').nth(i);
/** Kurz halten (länger als die Haltezeit), dann ziehen. */
async function holdDrag(page, from, to, holdMs = 320) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await sleep(holdMs);
  for (let i = 1; i <= 14; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / 14, from.y + ((to.y - from.y) * i) / 14); await sleep(20); }
  await sleep(60);
  await page.mouse.up();
}

try {
  if (!(await P.locator('cd-emoji-bar .emoji').count())) {
    await P.click('cd-side-controls .seg:has-text("Bar")'); // Leiste war ausgeblendet
    await P.waitForSelector('cd-emoji-bar .emoji');
  }
  const e0 = original.emojis;
  const d0 = original.dock;

  // 1) Langes Drücken auf ein Emoji -> Bearbeitungsmodus, ohne Emoji einzufügen
  const first = await center(emojiBtn(P, 0));
  await P.mouse.move(first.x, first.y);
  await P.mouse.down();
  await sleep(650);
  await P.mouse.up();
  await P.waitForSelector('.edit-bar');
  await sleep(100);
  check(runs.length === 0, 'Langes Drücken auf ein Emoji startet den Bearbeitungsmodus und fügt nichts ein');
  check(await P.locator('cd-emoji-bar .delete').count() === e0.length, 'Jedes Emoji hat ein „–“');
  check(await P.locator('cd-emoji-bar .add').count() === 1 && await P.locator('cd-dock .add').count() === 1, '„+“ in Emoji-Leiste und Dock');
  await P.screenshot({ path: 'screenshots/bar-ipad-edit.png' });

  // 2) Emoji ändern
  await emojiBtn(P, 0).click();
  await P.waitForSelector('cd-bar-item-editor .sheet');
  await sleep(350);
  await P.screenshot({ path: 'screenshots/bar-ipad-emoji-editor.png' });
  await P.click('cd-bar-item-editor .suggest button:has-text("👍")');
  await P.click('cd-bar-item-editor .primary');
  check(await waitFor(() => serverConfig().emojis[0].emoji === '👍' && serverConfig().emojis[0].id === e0[0].id), 'Emoji geändert (gleiche ID) und gespeichert');
  // Live-Sync: iPhone-Overlay öffnen
  await IP.click('.grabber');
  await IP.waitForSelector('.overlay cd-emoji-bar .emoji');
  await IP.waitForFunction(() => document.querySelector('.overlay cd-emoji-bar .emoji .glyph')?.textContent === '👍', null, { timeout: 3000 })
    .then(() => check(true, 'Live-Sync: iPhone zeigt das geänderte Emoji'), () => check(false, 'Live-Sync: iPhone zeigt das geänderte Emoji'));

  // 3) Emoji per Tastatur-Eingabe hinzufügen
  await P.click('cd-emoji-bar .add');
  await P.fill('#bar-emoji', '🦊');
  await P.click('cd-bar-item-editor .primary');
  check(await waitFor(() => serverConfig().emojis.length === e0.length + 1 && serverConfig().emojis.at(-1).emoji === '🦊'), 'Emoji hinten angefügt');
  // Ungültige Eingabe
  await P.click('cd-emoji-bar .add');
  await P.fill('#bar-emoji', 'a b');
  check(await P.locator('cd-bar-item-editor .primary').isDisabled(), 'Leerzeichen im Emoji wird abgelehnt (Sichern gesperrt)');
  await P.click('cd-bar-item-editor .ghost:has-text("Abbrechen")');

  // 4) Umsortieren: erstes Emoji hinter das dritte ziehen
  const idOrder = () => serverConfig().emojis.map((e) => e.id);
  const before = idOrder();
  const a = await center(emojiBtn(P, 0));
  const c = await center(emojiBtn(P, 2));
  await holdDrag(P, a, { x: c.x + 12, y: c.y });
  const expected = [before[1], before[2], before[0], ...before.slice(3)];
  check(await waitFor(() => JSON.stringify(idOrder()) === JSON.stringify(expected)), 'Ziehen sortiert die Emojis um (Einfügen, nicht Tauschen)', idOrder().slice(0, 4).join(','));
  check(runs.length === 0, 'Ziehen löst keine Aktion aus');
  // Schnelles Wischen ohne Halten zieht nicht
  const b0 = await center(emojiBtn(P, 0));
  const b2 = await center(emojiBtn(P, 2));
  await holdDrag(P, b0, b2, 0);
  await sleep(500);
  check(JSON.stringify(idOrder()) === JSON.stringify(expected), 'Wischen ohne Halten verschiebt nichts');

  // 5) Entfernen mit Bestätigung (zweimal tippen)
  const fox = serverConfig().emojis.at(-1).id;
  const foxBtn = P.locator(`cd-emoji-bar .emoji[data-reorder-id="${fox}"] .delete`);
  await foxBtn.click();
  await sleep(300);
  check(serverConfig().emojis.some((e) => e.id === fox), 'Erstes Tippen auf „–“ fragt nur nach');
  await foxBtn.click();
  check(await waitFor(() => !serverConfig().emojis.some((e) => e.id === fox)), 'Zweites Tippen entfernt das Emoji');

  // 6) Dock: App hinzufügen
  await P.click('cd-dock .add');
  await P.waitForSelector('cd-bar-item-editor .apps button');
  await P.screenshot({ path: 'screenshots/bar-ipad-dock-picker.png' });
  const inDock = new Set(serverConfig().dock.map((d) => d.bundleId));
  const free = await P.$$eval('cd-bar-item-editor .apps button', (els) => els.map((e) => e.querySelector('.bid').textContent.replace(/^Schon im Dock · /, '')));
  const pick = free.find((b) => !inDock.has(b));
  await P.fill('cd-bar-item-editor input.search', pick);
  await P.locator('cd-bar-item-editor .apps button').first().click();
  check(await waitFor(() => serverConfig().dock.at(-1)?.bundleId === pick), 'App zum Dock hinzugefügt', pick);
  check(!!serverConfig().dock.at(-1)?.label, 'Dock-Eintrag hat den App-Namen als Beschriftung', serverConfig().dock.at(-1)?.label);

  // 7) Doppelte App wird abgelehnt
  const dupe = serverConfig().dock[0].bundleId;
  const lenBefore = serverConfig().dock.length;
  await P.click('cd-dock .add');
  await P.fill('cd-bar-item-editor input.search', dupe);
  await P.locator('cd-bar-item-editor .apps button').first().click();
  await sleep(500);
  check(serverConfig().dock.length === lenBefore && (await P.locator('.toast.error').textContent()).includes('schon im Dock'), 'App, die schon im Dock ist, wird nicht doppelt hinzugefügt');
  await P.click('cd-bar-item-editor .ghost:has-text("Abbrechen")');

  // 8) Dock-Eintrag ersetzen (Tippen)
  const target = serverConfig().dock.at(-1);
  await P.locator(`cd-dock .item[data-reorder-id="${target.id}"]`).click();
  await P.waitForSelector('cd-bar-item-editor .apps button.on');
  const other = free.find((b) => !inDock.has(b) && b !== pick);
  await P.fill('cd-bar-item-editor input.search', other);
  await P.locator('cd-bar-item-editor .apps button').first().click();
  check(await waitFor(() => serverConfig().dock.find((d) => d.id === target.id)?.bundleId === other), 'Tippen auf ein Dock-Icon ersetzt die App (gleiche ID)', other);

  // 9) Dock umsortieren: erstes Icon hinter das dritte ziehen
  const dockOrder = () => serverConfig().dock.map((d) => d.id);
  const dBefore = dockOrder();
  const s0 = await center(dockBtn(P, 0));
  const s2 = await center(dockBtn(P, 2));
  await holdDrag(P, s0, { x: s2.x + 20, y: s2.y });
  const dExpected = [dBefore[1], dBefore[2], dBefore[0], ...dBefore.slice(3)];
  check(await waitFor(() => JSON.stringify(dockOrder()) === JSON.stringify(dExpected)), 'Ziehen sortiert das Dock um');
  await IP.waitForFunction((id) => document.querySelector('.overlay cd-dock .item')?.getAttribute('data-reorder-id') === id, dExpected[0], { timeout: 3000 })
    .then(() => check(true, 'Live-Sync: iPhone zeigt die neue Dock-Reihenfolge'), () => check(false, 'Live-Sync: iPhone zeigt die neue Dock-Reihenfolge'));

  // 10) Dock-Eintrag über den Editor entfernen
  await P.locator(`cd-dock .item[data-reorder-id="${target.id}"]`).click();
  await P.click('cd-bar-item-editor .danger');
  check(await waitFor(() => !serverConfig().dock.some((d) => d.id === target.id)), '„Aus dem Dock entfernen“ im Editor');

  // 11) iPhone: Bearbeitungsmodus, Knopf „Leiste & Dock“ öffnet das Overlay im Bearbeitungsmodus
  await IP.click('.overlay', { position: { x: 400, y: 190 } });
  await IP.waitForSelector('.overlay', { state: 'detached' });
  const ipTile = await center(IP.locator('cd-tile[data-group-id]').first());
  await IP.mouse.move(ipTile.x, ipTile.y); await IP.mouse.down(); await sleep(650); await IP.mouse.up();
  await IP.click('.edit-btn:has-text("Leiste")');
  await IP.waitForSelector('.overlay cd-emoji-bar .delete');
  check(await IP.locator('.overlay cd-dock .add').count() === 1, 'iPhone: „Leiste & Dock“ zeigt Emoji-Leiste und Dock zum Bearbeiten');
  await IP.screenshot({ path: 'screenshots/bar-iphone-edit.png' });
  await IP.click('.overlay cd-emoji-bar .add');
  await IP.waitForSelector('cd-bar-item-editor .sheet');
  await sleep(350);
  await IP.screenshot({ path: 'screenshots/bar-iphone-emoji-editor.png' });
  await IP.click('cd-bar-item-editor .ghost:has-text("Abbrechen")');
  // iPhone hochkant
  await IP.setViewportSize({ width: 393, height: 852 });
  await sleep(400);
  await IP.screenshot({ path: 'screenshots/bar-iphone-portrait-edit.png' });

  // 12) Fertig; danach normale Bedienung
  await P.click('.edit-btn:has-text("Fertig")');
  check(await P.locator('cd-emoji-bar .delete').count() === 0, '„Fertig“ blendet die Bearbeitungs-Elemente aus');
  await emojiBtn(P, 0).click();
  await sleep(200);
  check(runs.length === 1 && (await P.locator('cd-bar-item-editor .sheet').count()) === 0, 'Ausserhalb des Bearbeitungsmodus fügt Tippen das Emoji ein (Aktion abgefangen)', runs.join(' '));
  await P.screenshot({ path: 'screenshots/bar-ipad-after.png' });
} catch (e) {
  check(false, `Abbruch: ${e.message.split('\n')[0]}`);
} finally {
  const cur = serverConfig();
  const r = await P.evaluate(async ({ cfg, base }) => {
    return await new Promise((resolve) => {
      const ws = new WebSocket(`wss://${location.host}/ws`);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: localStorage.getItem('copperdeck.token'), protocol: 1 }));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'ready') ws.send(JSON.stringify({ type: 'saveConfig', requestId: 'restore', baseRevision: base, config: cfg }));
        if (m.type === 'saveResult') { ws.close(); resolve(m.ok); }
      };
    });
  }, { cfg: { ...original, revision: cur.revision }, base: cur.revision }).catch(() => false);
  console.log(r ? '  Konfiguration auf den Stand vor dem Test zurückgesetzt.' : '  ⚠️ Zurücksetzen fehlgeschlagen');
  for (const d of [ipad, iphone]) if (d.id) cli('revoke', d.id);
  await browser.close();
}
console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
