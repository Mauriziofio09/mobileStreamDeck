#!/usr/bin/env node
// Meilenstein 3 – Tests gegen den Helper UNTER LAUNCHD (nicht im Terminal).
//   node tools/e2e-m3.mjs basic   Aktionen ohne Berechtigung + korrekte Berechtigungsfehler
//   node tools/e2e-m3.mjs perms   Tastenkombination (Schweizer Layout), Emoji/Zwischenablage, Fenster, Mitteilung
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const phase = process.argv[2] ?? 'basic';
const HOST = 'macbook-pro-von-maurizio.local';
const ORIGIN = `https://${HOST}:7443`;
const DATA = path.join(homedir(), 'Library/Application Support/CopperDeck');
const NATIVE = path.join(homedir(), 'Applications/Copper Deck Helper.app/Contents/MacOS/CopperDeckHelper');
const CA = readFileSync(path.join(execFileSync('/opt/homebrew/bin/mkcert', ['-CAROOT']).toString().trim(), 'rootCA.pem'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, label, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ' – ' + extra : ''}`); if (!cond) failures++; };

function admin(req) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(path.join(DATA, 'admin.sock'));
    let buf = '';
    s.on('connect', () => s.write(JSON.stringify(req) + '\n'));
    s.on('data', (c) => (buf += c));
    s.on('end', () => { const r = JSON.parse(buf); r.ok ? resolve(r.result) : reject(new Error(r.error)); });
    s.on('error', reject);
  });
}

// Prüfen, dass wirklich launchd → App-Bundle → node läuft.
const pid = execFileSync('pgrep', ['-f', 'copper-deck.mjs serve']).toString().trim().split('\n')[0];
const ppid = execFileSync('ps', ['-o', 'ppid=', '-p', pid]).toString().trim();
const parent = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', ppid]).toString().trim();
check(/^1\s.*Copper Deck Helper\.app\/Contents\/MacOS\/CopperDeckHelper$/.test(parent), 'Helper läuft unter launchd im App-Bundle', parent);

async function pair() {
  const { code } = await admin({ cmd: 'pair' });
  const body = JSON.stringify({ code, deviceName: 'E2E M3' });
  return new Promise((resolve, reject) => {
    const req = https.request(`${ORIGIN}/api/pair`, { method: 'POST', ca: CA, headers: { origin: ORIGIN, 'content-type': 'application/json' } }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject); req.end(body);
  });
}

const { token, deviceId } = await pair();
const ws = new WebSocket(`wss://${HOST}:7443/ws`, { origin: ORIGIN, ca: CA });
const inbox = [];
const waiters = [];
ws.on('message', (d) => { const m = JSON.parse(String(d)); inbox.push(m); waiters.splice(0).forEach((w) => w()); });
await new Promise((r) => ws.on('open', r));
ws.send(JSON.stringify({ type: 'auth', token, protocol: 1 }));
async function waitMsg(pred, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const i = inbox.findIndex(pred);
    if (i >= 0) return inbox.splice(i, 1)[0];
    if (Date.now() > end) throw new Error('Zeitüberschreitung');
    await new Promise((r) => { waiters.push(r); setTimeout(r, 200); });
  }
}
let n = 0;
async function run(actionId) {
  const requestId = `e2e-${++n}`;
  ws.send(JSON.stringify({ type: 'run', requestId, actionId }));
  return waitMsg((m) => m.type === 'result' && m.requestId === requestId, 30000);
}
await waitMsg((m) => m.type === 'ready');
const perms = (await waitMsg((m) => m.type === 'permissions')).permissions;
console.log('  Berechtigungen:', JSON.stringify(perms));
check(perms.context === 'app', 'Berechtigungskontext ist das App-Bundle');

try {
  if (phase === 'basic') {
    const sm0 = JSON.parse(execFileSync(NATIVE, ['stage-manager-state']).toString());
    const r1 = await run('t-stage');
    const sm1 = JSON.parse(execFileSync(NATIVE, ['stage-manager-state']).toString());
    check(r1.ok && sm1.pref === !sm0.pref, 'Stage Manager umgeschaltet und Zustand geprüft', r1.message ?? r1.message);
    const r2 = await run('t-stage');
    const sm2 = JSON.parse(execFileSync(NATIVE, ['stage-manager-state']).toString());
    check(r2.ok && sm2.pref === sm0.pref, 'Stage Manager zurückgeschaltet', r2.message);

    inbox.length = 0;
    const t1 = await run('t-pomodoro');
    const tm1 = await waitMsg((m) => m.type === 'timer');
    check(t1.ok && tm1.timer?.preset === 'pomodoro' && Math.abs(tm1.timer.endsAt - tm1.timer.startedAt - 25 * 60000) < 5, 'Pomodoro gestartet, Endzeit vom Helper', t1.message);
    const saved = JSON.parse(readFileSync(path.join(DATA, 'timer.json'), 'utf8'));
    check(saved?.endsAt === tm1.timer.endsAt, 'Endzeit in timer.json gespeichert');
    const t2 = await run('t-break');
    const tm2 = await waitMsg((m) => m.type === 'timer');
    check(t2.ok && tm2.timer?.preset === 'break', 'Take a Break ersetzt Pomodoro', t2.message);
    // Neustart durch launchd: Timer muss erhalten bleiben
    execFileSync('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/ch.copperdeck.helper`]);
    await sleep(4000);
    const st = await admin({ cmd: 'status' });
    check(!!st.pid, 'Helper nach Neustart durch launchd wieder da', `pid ${st.pid}`);
    const after = JSON.parse(readFileSync(path.join(DATA, 'timer.json'), 'utf8'));
    check(after?.endsAt === tm2.timer.endsAt, 'Timer überlebt den Neustart');
    // Neue Verbindung nach Neustart
    console.log('  (Verbindung nach Neustart neu aufgebaut über eigenes Skript-Ende)');
  } else {
    console.log('  Phase "perms" siehe tools/e2e-m3-perms.mjs');
  }
} finally {
  ws.close();
  await admin({ cmd: 'devices' }).catch(() => null);
  await admin({ cmd: 'revoke', id: deviceId }).catch(() => null);
}

if (phase === 'basic') {
  // Aktionen, die Berechtigungen brauchen: jetzt per Admin-Socket (gleicher launchd-Prozess)
  const hk = await admin({ cmd: 'runAction', action: { type: 'hotkey', modifiers: [], key: 'escape' } });
  const p = await admin({ cmd: 'permissions' });
  if (p.accessibility !== 'granted' || p.automation !== 'granted') {
    check(!hk.ok && hk.code === 'permission_denied' && /Systemeinstellungen/.test(hk.message), 'Tastenkombination ohne Berechtigung → verständlicher Hinweis', hk.message);
    const tw = await admin({ cmd: 'runAction', action: { type: 'tileWindows' } });
    if (p.accessibility !== 'granted') check(!tw.ok && tw.permission === 'accessibility', 'Fenster anordnen ohne Bedienungshilfen → Hinweis', tw.message);
  } else {
    check(hk.ok, 'Tastenkombination (Escape) gesendet');
  }
  const t3 = await admin({ cmd: 'runAction', action: { type: 'timer', preset: 'break' } });
  check(t3.ok && /gestoppt/.test(t3.message), 'Timer per erneutem Tippen gestoppt', t3.message);
}
console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
