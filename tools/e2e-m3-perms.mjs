#!/usr/bin/env node
// Meilenstein 3 – Aktionen mit Berechtigungen, ausgeführt vom Helper UNTER LAUNCHD.
// Öffnet TextEdit mit einer Testdatei, prüft Schweizer Layout, Emoji-Einfügen mit
// Bild + Datei in der Zwischenablage (darf nicht beschädigt werden), Fenster anordnen, Mitteilung.
// Deine Zwischenablage wird vorher gesichert und am Ende wiederhergestellt.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const DATA = path.join(homedir(), 'Library/Application Support/CopperDeck');
const NATIVE = path.join(homedir(), 'Applications/Copper Deck Helper.app/Contents/MacOS/CopperDeckHelper');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (c, l, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ' – ' + x : ''}`); if (!c) failures++; };
const admin = (req) => new Promise((resolve, reject) => {
  const s = net.createConnection(path.join(DATA, 'admin.sock'));
  let b = ''; s.on('connect', () => s.write(JSON.stringify(req) + '\n')); s.on('data', (c) => (b += c));
  s.on('end', () => { const r = JSON.parse(b); r.ok ? resolve(r.result) : reject(new Error(r.error)); }); s.on('error', reject);
});
const action = (a) => admin({ cmd: 'runAction', action: a });
const FRONT = (() => {
  const bin = path.join(tmpdir(), 'copperdeck-front');
  writeFileSync(bin + '.swift', 'import AppKit\nprint(NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "")\n');
  execFileSync('/usr/bin/xcrun', ['swiftc', '-O', bin + '.swift', '-o', bin], { stdio: 'ignore' });
  return () => execFileSync(bin).toString().trim();
})();
/** Sicherheitsnetz: Tasten nur senden, wenn TextEdit wirklich vorne ist. */
function requireTextEdit() {
  const f = FRONT();
  if (f !== 'com.apple.TextEdit') throw new Error(`Abbruch: vorne ist ${f}, nicht TextEdit – keine Tasten gesendet`);
}
const digest = () => JSON.stringify(JSON.parse(execFileSync(NATIVE, ['clipboard-digest']).toString()).items);

const p = await admin({ cmd: 'permissions' });
console.log('  Berechtigungen:', JSON.stringify(p));
if (p.accessibility !== 'granted' || p.automation !== 'granted') { console.log('Bedienungshilfen/Automation fehlen noch – Test abgebrochen.'); process.exit(2); }

const previousFront = FRONT();
const textEditWasRunning = (() => { try { execFileSync('pgrep', ['-x', 'TextEdit']); return true; } catch { return false; } })();
const work = mkdtempSync(path.join(tmpdir(), 'copperdeck-e2e-'));
const clip = path.join(work, 'clip');
execFileSync('/usr/bin/xcrun', ['swiftc', '-O', 'tools/native-test/clip.swift', '-o', clip], { stdio: 'ignore' });
execFileSync(clip, ['save', work]);
try {
  // Testinhalt: Bild (PNG) + kopierte Datei
  const png = path.join(work, 'bild.png');
  execFileSync('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '64', '/System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns', '--out', png], { stdio: 'ignore' });
  const doc = path.join(work, 'dokument.pdf');
  writeFileSync(doc, '%PDF-1.4 Testdatei\n');
  execFileSync(clip, ['set-test', png, doc]);
  const before = digest();
  check(before.includes('public.png') && before.includes('public.file-url'), 'Testinhalt in Zwischenablage: Bild + Datei');

  // TextEdit mit leerer Textdatei öffnen (Ziel für Eingaben)
  const txt = path.join(work, 'schweiz.txt');
  writeFileSync(txt, '');
  execFileSync('/usr/bin/open', ['-b', 'com.apple.TextEdit', txt]);
  // Über den Helper (launchd) in den Vordergrund holen – genau wie "App öffnen".
  const act = await action({ type: 'openApp', bundleId: 'com.apple.TextEdit' });
  await sleep(800);
  check(FRONT() === 'com.apple.TextEdit', 'App öffnen holt TextEdit in den Vordergrund', act.message ?? '');
  requireTextEdit();

  requireTextEdit();
  const e = await action({ type: 'insertEmoji', emoji: '🥰' });
  check(e.ok, 'Emoji eingefügt', e.message ?? '');
  await sleep(300);
  const after = digest();
  check(after === before, 'Zwischenablage danach identisch (Bild und Datei unbeschädigt)');

  // Schweizer Layout: z/y liegen vertauscht; Shift+1 ergibt "+"; ⌘S speichert.
  for (const k of [
    { modifiers: [], key: 'z' }, { modifiers: [], key: 'y' }, { modifiers: ['shift'], key: '1' },
    { modifiers: [], key: 'space' }, { modifiers: ['shift'], key: '7' }, { modifiers: ['shift'], key: 'a' },
  ]) {
    requireTextEdit();
    const r = await action({ type: 'hotkey', ...k });
    if (!r.ok) check(false, `Taste ${JSON.stringify(k)}`, r.message);
    await sleep(120);
  }
  requireTextEdit();
  await action({ type: 'hotkey', modifiers: ['command'], key: 's' });
  await sleep(1200);
  const text = readFileSync(txt, 'utf8');
  check(text === '🥰zy+ /A', 'Schweizer Layout korrekt (erwartet „🥰zy+ /A“)', JSON.stringify(text));

  const t = await action({ type: 'tileWindows' });
  check(t.ok, 'Fenster angeordnet', t.message);
  if (t.details?.length) console.log('    nicht anpassbar:', t.details.join(' | '));


  const n = await admin({ cmd: 'notifyTest' });
  check(n.ok, 'Mitteilung gesendet (siehe Mitteilungszentrale)', n.ok ? '' : `Status: ${n.status ?? n.error}`);
} catch (e) {
  check(false, String(e.message));
} finally {
  if (!textEditWasRunning) { try { execFileSync('pkill', ['-x', 'TextEdit']); } catch { /* schon zu */ } }
  if (previousFront) await action({ type: 'openApp', bundleId: previousFront }).catch(() => null);
  execFileSync(clip, ['restore', work]);
  console.log('  Deine Zwischenablage wurde wiederhergestellt.');
}
console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
