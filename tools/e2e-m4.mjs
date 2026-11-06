#!/usr/bin/env node
// Meilenstein 4 – zwei Geräte gleichzeitig (iPad + iPhone, Playwright WebKit) gegen den Helper unter launchd:
// Bearbeitungsmodus, Ziehen (Gruppe, über Seitenrand), Editor, Bild-Upload, App-Auswahl, Live-Sync, Konflikt.
// Die Konfiguration wird am Ende auf den Stand vor dem Test zurückgesetzt.
import { webkit } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const URL_ = 'https://macbook-pro-von-maurizio.local:7443/';
const CONFIG = path.join(homedir(), 'Library/Application Support/CopperDeck/config.json');
const original = JSON.parse(readFileSync(CONFIG, 'utf8'));
const cli = (...a) => execFileSync('copper-deck', a, { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (c, l, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ' – ' + x : ''}`); if (!c) failures++; };
const serverConfig = () => JSON.parse(readFileSync(CONFIG, 'utf8'));

const browser = await webkit.launch();
async function device(name, w, h, safe) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, screen: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  // Für den Konflikttest: Nachrichten vom Helper an dieses Gerät zurückhalten können.
  const ctl = { hold: false, held: [] };
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => (ctl.hold ? ctl.held.push(m) : ws.send(m)));
    ctl.flush = () => { ctl.hold = false; for (const m of ctl.held.splice(0)) ws.send(m); };
  });
  await page.goto(`${URL_}?safe=${safe}`, { waitUntil: 'networkidle' });
  const code = /Kopplungscode:\s+(\d{3}) (\d{3})/.exec(cli('pair'));
  await page.fill('input[name=name]', `E2E ${name}`);
  await page.fill('input.code', code[1] + code[2]);
  await page.click('button.submit');
  await page.waitForSelector('cd-pager cd-tile[data-group-id]');
  await page.waitForFunction(() => !document.querySelector('.conn-banner'));
  const id = await page.evaluate(() => localStorage.getItem('copperdeck.device'));
  return { page, ctx, id, ctl };
}

const ipad = await device('iPad', 1180, 820, '24,0,20,0');
const iphone = await device('iPhone', 852, 393, '0,59,21,59');
const P = ipad.page;
const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const tileOn = (page, label) => page.locator(`cd-tile[aria-label="${label}"]`).first();
const slotLabels = (page, groupId) => page.$$eval(`cd-tile[data-group-id="${groupId}"]`, (els) => els.map((e) => e.getAttribute('aria-label')));

try {
  const g1 = original.groups[0].id;
  // 1) Langes Drücken -> Bearbeitungsmodus
  const finder = await center(tileOn(P, 'Finder'));
  await P.mouse.move(finder.x, finder.y);
  await P.mouse.down();
  await sleep(650);
  await P.mouse.up();
  await P.waitForSelector('.edit-bar');
  check(await P.locator('cd-tile.is-editing').count() > 0, 'Langes Drücken startet den Bearbeitungsmodus (Kacheln wackeln)');
  await P.screenshot({ path: 'screenshots/m4-edit-mode.png' });

  // 2) Finder auf Mail ziehen (Tausch innerhalb der Gruppe)
  const mail = await center(tileOn(P, 'Mail'));
  await P.mouse.move(finder.x, finder.y);
  await P.mouse.down();
  for (let i = 1; i <= 12; i++) { await P.mouse.move(finder.x + ((mail.x - finder.x) * i) / 12, finder.y + ((mail.y - finder.y) * i) / 12); await sleep(16); }
  await P.mouse.up();
  await sleep(800);
  const rev1 = serverConfig();
  check(rev1.groups[0].tiles[7]?.label === 'Finder' && rev1.groups[0].tiles[0]?.label === 'Mail', 'Ziehen tauscht Finder und Mail, Helper hat gespeichert', `Revision ${rev1.revision}`);
  await iphone.page.waitForFunction(() => document.querySelector('cd-tile[data-index="0"]')?.getAttribute('aria-label') === 'Mail', null, { timeout: 3000 })
    .then(() => check(true, 'Live-Sync: iPhone zeigt den Tausch sofort'), () => check(false, 'Live-Sync: iPhone zeigt den Tausch sofort'));

  // 3) Neue Gruppe -> neue Seite; Kachel über den Seitenrand dorthin ziehen
  await P.click('.edit-btn:has-text("Gruppe")');
  await sleep(1200);
  const groups = serverConfig().groups;
  const newGroup = groups[groups.length - 1].id;
  check(groups.length === original.groups.length + 1, 'Gruppe hinzugefügt');
  await P.locator('cd-page-dots .dot').first().click(); // zurück auf Seite 1
  await sleep(900);
  const yt = await center(tileOn(P, 'YouTube'));
  await P.mouse.move(yt.x, yt.y);
  await P.mouse.down();
  for (let x = yt.x; x <= 1172; x += 40) { await P.mouse.move(x, yt.y); await sleep(16); }
  await P.mouse.move(1172, yt.y);
  await sleep(1100); // am Rand verweilen -> Seite 2
  const firstEmpty = await center(P.locator(`cd-tile[data-group-id="${newGroup}"][data-index="0"]`));
  for (let i = 1; i <= 10; i++) { await P.mouse.move(1172 + ((firstEmpty.x - 1172) * i) / 10, yt.y + ((firstEmpty.y - yt.y) * i) / 10); await sleep(16); }
  await P.mouse.up();
  await sleep(900);
  const afterEdge = serverConfig();
  check(afterEdge.groups.at(-1).tiles[0]?.label === 'YouTube', 'Kachel über den Seitenrand auf die nächste Seite gezogen');
  await P.screenshot({ path: 'screenshots/m4-page2.png' });

  // 4) Leeren Platz antippen -> neue Link-Kachel (violett, Emoji)
  await P.locator(`cd-tile[data-group-id="${newGroup}"][data-index="1"]`).click();
  await P.waitForSelector('cd-tile-editor .sheet');
  await P.selectOption('#ed-action', 'openUrl');
  await P.fill('#ed-url', 'javascript:alert(1)');
  check(await P.locator('cd-tile-editor .primary').isDisabled(), 'Editor sperrt Speichern bei javascript:-Link');
  await P.fill('#ed-url', 'https://www.meteoschweiz.admin.ch/');
  await P.fill('#ed-label', 'Wetter');
  await P.click('cd-tile-editor .c-violet');
  await P.fill('cd-tile-editor .emoji-in', '🌦️');
  await P.screenshot({ path: 'screenshots/m4-editor.png' });
  await P.click('cd-tile-editor .primary');
  await sleep(900);
  const wetter = serverConfig().groups.at(-1).tiles[1];
  check(wetter?.label === 'Wetter' && wetter.color === 'violet' && wetter.action.url === 'https://www.meteoschweiz.admin.ch/', 'Neue Link-Kachel gespeichert');

  // 5) Tastenkombination ⌘⇧4 + eigenes Bild
  await P.locator(`cd-tile[data-group-id="${newGroup}"][data-index="2"]`).click();
  await P.selectOption('#ed-action', 'hotkey');
  await P.click('cd-tile-editor .mods button:has-text("Umschalt")');
  await P.selectOption('cd-tile-editor select[aria-label="Taste"]', '4');
  await P.fill('#ed-label', 'Bildschirmfoto');
  await P.click('cd-tile-editor .seg.four button:has-text("Bild")');
  const work = mkdtempSync(path.join(tmpdir(), 'cd-m4-'));
  execFileSync('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '128', '/System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns', '--out', `${work}/bild.png`], { stdio: 'ignore' });
  await P.setInputFiles('cd-tile-editor .upload input', `${work}/bild.png`);
  await P.waitForFunction(() => !document.querySelector('cd-tile-editor .upload')?.textContent?.includes('Lade hoch'));
  await P.locator('cd-tile-editor .combo').textContent().then((t) => check(t?.trim() === '⌘⇧4', 'Tastenkombination im Editor', t?.trim()));
  await P.click('cd-tile-editor .primary');
  await sleep(900);
  const shot = serverConfig().groups.at(-1).tiles[2];
  check(shot?.action.type === 'hotkey' && shot.action.key === '4' && shot.action.modifiers.join() === 'command,shift' && /^[a-f0-9]{32}\.png$/.test(shot.icon.file ?? ''), 'Hotkey-Kachel mit hochgeladenem Bild gespeichert (Name vom Helper)', shot?.icon?.file);
  await sleep(500);
  check(await P.locator(`cd-tile[data-group-id="${newGroup}"][data-index="2"] img.image-glyph[src^="blob:"]`).count() === 1, 'Eigenes Bild wird auf der Kachel angezeigt');

  // 6) App-Kachel über die App-Auswahl (Rechner)
  await P.locator(`cd-tile[data-group-id="${newGroup}"][data-index="3"]`).click();
  await P.click('cd-tile-editor .seg button:has-text("App-Kachel")');
  await P.click('cd-tile-editor .picker');
  await P.waitForSelector('cd-tile-editor .apps li');
  const count = await P.locator('cd-tile-editor .apps li').count();
  await P.fill('cd-tile-editor .search', 'rechner');
  await sleep(1500);
  await P.screenshot({ path: 'screenshots/m4-app-picker.png' });
  await P.locator('cd-tile-editor .apps button').first().click();
  await P.click('cd-tile-editor .primary');
  await sleep(900);
  const calc = serverConfig().groups.at(-1).tiles[3];
  check(calc?.kind === 'app' && calc.action.bundleId === 'com.apple.calculator', `App-Auswahl (${count} Apps) → Rechner als App-Kachel`, calc?.action?.bundleId);

  // 7) Live-Sync aufs iPhone (neue Gruppe ist dort Seite 3)
  await iphone.page.waitForFunction(() => document.querySelectorAll('cd-tile[aria-label="Wetter"]').length === 1, null, { timeout: 3000 })
    .then(() => check(true, 'Live-Sync: neue Kacheln erscheinen auf dem iPhone'), () => check(false, 'Live-Sync: neue Kacheln erscheinen auf dem iPhone'));

  // 8) Konflikt: iPhone bekommt Änderungen des iPads nicht mit und speichert auf altem Stand
  iphone.ctl.hold = true;
  const IP = iphone.page;
  await IP.locator('cd-page-dots .dot').first().click();
  await sleep(600);
  const ipFinder = await center(tileOn(IP, 'Notizen'));
  await IP.mouse.move(ipFinder.x, ipFinder.y); await IP.mouse.down(); await sleep(650); await IP.mouse.up();
  await IP.waitForSelector('.edit-bar');
  // iPad ändert inzwischen etwas (Beschriftung "Wetter" -> "Wetter CH")
  await P.locator('cd-tile[aria-label="Wetter"]').click({ force: true });
  await P.fill('#ed-label', 'Wetter CH');
  await P.click('cd-tile-editor .primary');
  await sleep(900);
  const revBefore = serverConfig().revision;
  // iPhone löscht "Notizen" auf veraltetem Stand -> muss abgelehnt werden
  const notes = IP.locator('cd-tile[aria-label="Notizen"] .delete');
  // Die Antwort auf das Speichern muss durchkommen, nur alte Broadcasts zurückhalten: Puffer verwerfen, Durchlass wieder an
  iphone.ctl.held.length = 0; iphone.ctl.hold = false;
  await notes.click({ force: true }); await notes.click({ force: true }); // zweimal = bestätigen
  await IP.waitForSelector('.toast.error', { timeout: 5000 }).catch(async (e) => {
    console.log('  [debug] Toast:', await IP.textContent('.toast').catch(() => '-'), '| Rev', serverConfig().revision, 'vorher', revBefore,
      '| Notizen da:', serverConfig().groups[0].tiles.some((t) => t?.label === 'Notizen'), '| delete-Buttons:', await IP.locator('cd-tile[aria-label="Notizen"] .delete').count(),
      '| editMode:', await IP.locator('.edit-bar').count(), '| state:', await IP.evaluate(() => document.querySelector('.conn-banner')?.textContent ?? 'online'));
    await IP.screenshot({ path: 'screenshots/m4-debug-conflict.png' });
    throw e;
  });
  const toast = (await IP.textContent('.toast'))?.trim();
  check(/anderes Gerät/.test(toast ?? ''), 'Konflikt erkannt: veraltete Änderung abgelehnt', toast);
  const afterConflict = serverConfig();
  check(afterConflict.revision === revBefore && afterConflict.groups[0].tiles.some((t) => t?.label === 'Notizen'), 'Helper hat die veraltete Änderung nicht übernommen');
  await IP.waitForFunction(() => document.querySelectorAll('cd-tile[aria-label="Wetter CH"]').length === 1, null, { timeout: 3000 })
    .then(() => check(true, 'iPhone hat danach den aktuellen Stand geladen'), () => check(false, 'iPhone hat danach den aktuellen Stand geladen'));
  await IP.screenshot({ path: 'screenshots/m4-iphone-conflict.png' });

  // 9) Fertig
  await P.click('.edit-btn:has-text("Fertig")');
  check(await P.locator('.edit-bar').count() === 0, '„Fertig“ beendet den Bearbeitungsmodus');
} catch (e) {
  check(false, `Abbruch: ${e.message.split('\n')[0]}`);
} finally {
  // Konfiguration zurücksetzen (über die normale, geprüfte Speicher-Schnittstelle)
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
