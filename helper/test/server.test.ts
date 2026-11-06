import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import WebSocket from 'ws';
import { CLOSE, PROTOCOL_VERSION, defaultConfig, type ServerMessage } from '@copper-deck/shared';
import { deckConfigSchema } from '@copper-deck/shared/schema';
import { ActionRunner } from '../src/actions/runner';
import type { AppCatalog } from '../src/apps';
import { ConfigStore } from '../src/config-store';
import { DeviceStore } from '../src/devices';
import { ExecError, type Exec } from '../src/exec';
import type { Native, NativeResult } from '../src/native';
import { PAIR_CODE_TTL_MS, PairingManager } from '../src/pairing';
import { PermissionMonitor } from '../src/permissions';
import { TimerManager } from '../src/timer';
import { createServer } from '../src/server';

process.env['COPPER_DECK_QUIET'] = '1';

const MKCERT = ['/opt/homebrew/bin/mkcert', '/usr/local/bin/mkcert'].find((p) => {
  try { statSync(p); return true; } catch { return false; }
})!;
const CA = readFileSync(path.join(execFileSync(MKCERT, ['-CAROOT']).toString().trim(), 'rootCA.pem'));

const dir = mkdtempSync(path.join(tmpdir(), 'copper-deck-test-'));
execFileSync(MKCERT, ['-cert-file', `${dir}/cert.pem`, '-key-file', `${dir}/key.pem`, 'localhost', '127.0.0.1'], { stdio: 'ignore' });

/** Exec-Attrappe: zeichnet Aufrufe auf, öffnet nichts wirklich. */
const calls: { file: string; args: readonly string[] }[] = [];
const fakeExec: Exec = async (file, args) => {
  calls.push({ file, args });
  if (file === '/usr/bin/open' && args[0] === '-b' && args[1] === 'com.example.missing') {
    throw new ExecError('fail', 1, 'Unable to find application named com.example.missing', false);
  }
  return { stdout: '', stderr: '' };
};

/** Native-Attrappe: zeichnet Aufrufe auf. */
const nativeCalls: (readonly string[])[] = [];
let nativeReply: (args: readonly string[]) => NativeResult = () => ({ ok: true });
const fakeNative = {
  available: true,
  binary: '/fake',
  call: async (args: readonly string[]) => { nativeCalls.push(args); return nativeReply(args); },
} as unknown as Native;
const notifications: string[] = [];
function makeRunner(exec: Exec = fakeExec, timerFile = path.join(dir, `timer-${Math.random()}.json`)) {
  const permissions = new PermissionMonitor(fakeNative, 'app');
  const timers = new TimerManager(timerFile, async (t) => { notifications.push(t); return true; });
  return { runner: new ActionRunner({ exec, native: fakeNative, timers, permissions, keystrokeScript: '/k.applescript', activateScript: '/a.applescript' }), timers, permissions };
}

const catalogStub = {
  list: async () => [{ bundleId: 'com.apple.finder', name: 'Finder' }],
  get: async (id: string) => (id === 'com.apple.finder' ? { bundleId: id, name: 'Finder' } : null),
  icon: async () => null,
} as unknown as AppCatalog;

let base = '';
let origin = '';
let devices: DeviceStore;
let pairing: PairingManager;
let config: ConfigStore;
let srv: ReturnType<typeof createServer>;

before(async () => {
  devices = new DeviceStore(path.join(dir, 'devices.json'));
  await devices.load();
  pairing = new PairingManager();
  config = new ConfigStore(path.join(dir, 'config.json'), path.join(dir, 'config.backup.json'));
  await config.load(async () => [{ id: 'd-finder', bundleId: 'com.apple.finder', label: 'Finder' }]);
  // Origin hängt vom Port ab: erst lauschen, dann Server mit korrektem Origin erstellen.
  const probe = https.createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  origin = `https://localhost:${port}`;
  base = origin;
  const r = makeRunner();
  srv = createServer({
    devices, pairing, config, catalog: catalogStub,
    runner: r.runner, timers: r.timers, permissions: r.permissions,
    origins: [origin],
    webRoot: path.join(dir, 'no-web'),
    tls: { key: readFileSync(`${dir}/key.pem`), cert: readFileSync(`${dir}/cert.pem`) },
    version: 'test',
    pairFailDelayMs: 0,
  });
  await new Promise<void>((r) => srv.server.listen(port, '127.0.0.1', () => r()));
});

after(async () => {
  await srv.close();
});

async function req(method: string, url: string, opts: { body?: unknown; token?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  const o = opts.origin === undefined ? origin : opts.origin;
  if (o) headers['origin'] = o;
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const r = https.request(`${base}${url}`, { method, headers, ca: CA }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: data ? safeJson(data) : null }));
    });
    r.on('error', reject);
    if (opts.body !== undefined) r.write(JSON.stringify(opts.body));
    r.end();
  });
}
const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return s; } };

async function pairDevice(name = 'Test-iPad'): Promise<{ token: string; deviceId: string }> {
  const { code } = pairing.create();
  const res = await req('POST', '/api/pair', { body: { code, deviceName: name } });
  assert.equal(res.status, 201);
  return res.json;
}

/** Öffnet eine WebSocket-Verbindung und sammelt Nachrichten. */
function connect(opts: { origin?: string; path?: string } = {}) {
  const ws = new WebSocket(`wss://localhost:${new URL(base).port}${opts.path ?? '/ws'}`, { origin: opts.origin ?? origin, ca: CA });
  const messages: ServerMessage[] = [];
  const waiters: ((m: ServerMessage) => boolean)[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as ServerMessage;
    messages.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i]!(m)) waiters.splice(i, 1);
  });
  const next = <T extends ServerMessage['type']>(type: T) =>
    new Promise<Extract<ServerMessage, { type: T }>>((resolve) => {
      const found = messages.find((m) => m.type === type);
      if (found) return resolve(found as Extract<ServerMessage, { type: T }>);
      waiters.push((m) => (m.type === type ? (resolve(m as Extract<ServerMessage, { type: T }>), true) : false));
    });
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  const opened = new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on('error', (e) => reject(e));
  });
  return { ws, next, closed, opened };
}

describe('Kopplung', () => {
  test('ohne aktiven Code wird abgelehnt', async () => {
    const res = await req('POST', '/api/pair', { body: { code: '123456', deviceName: 'X' } });
    assert.equal(res.status, 410);
  });

  test('falsche Codes zählen herunter, nach 5 Fehlversuchen ist der Code gesperrt', async () => {
    const { code } = pairing.create();
    const wrong = code === '000000' ? '000001' : '000000';
    for (let left = 4; left >= 1; left--) {
      const r = await req('POST', '/api/pair', { body: { code: wrong, deviceName: 'X' } });
      assert.equal(r.status, 401);
      assert.equal(r.json.attemptsLeft, left);
    }
    const locked = await req('POST', '/api/pair', { body: { code: wrong, deviceName: 'X' } });
    assert.equal(locked.status, 410);
    // Auch der richtige Code gilt danach nicht mehr
    const after = await req('POST', '/api/pair', { body: { code, deviceName: 'X' } });
    assert.equal(after.status, 410);
  });

  test('richtiger Code liefert Token genau einmal; gespeichert wird nur der Hash (Rechte 600)', async () => {
    const { code } = pairing.create();
    const ok = await req('POST', '/api/pair', { body: { code, deviceName: 'iPhone' } });
    assert.equal(ok.status, 201);
    assert.match(ok.json.token, /^[A-Za-z0-9_-]{43}$/);
    const again = await req('POST', '/api/pair', { body: { code, deviceName: 'iPhone' } });
    assert.equal(again.status, 410, 'Code ist einmalig');
    const file = path.join(dir, 'devices.json');
    assert.ok(!readFileSync(file, 'utf8').includes(ok.json.token), 'Token darf nicht im Klartext gespeichert sein');
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });

  test('Code läuft nach 5 Minuten ab', () => {
    let now = 1_000_000;
    const p = new PairingManager(() => now);
    const { code } = p.create();
    now += PAIR_CODE_TTL_MS + 1;
    assert.deepEqual(p.check(code), { ok: false, reason: 'expired', attemptsLeft: 0 });
  });

  test('Kopplung von fremdem Origin wird abgelehnt', async () => {
    const { code } = pairing.create();
    const r = await req('POST', '/api/pair', { body: { code, deviceName: 'X' }, origin: 'https://evil.example' });
    assert.equal(r.status, 403);
  });
});

describe('HTTP-Endpunkte', () => {
  test('ohne Token 401, mit ungültigem Token 401', async () => {
    assert.equal((await req('GET', '/api/apps')).status, 401);
    assert.equal((await req('GET', '/api/apps', { token: 'x'.repeat(43) })).status, 401);
  });

  test('falscher Origin wird trotz gültigem Token abgelehnt', async () => {
    const { token } = await pairDevice();
    assert.equal((await req('GET', '/api/apps', { token, origin: 'https://evil.example' })).status, 403);
    assert.equal((await req('GET', '/api/apps', { token })).status, 200);
  });

  test('Token in der URL wird nicht akzeptiert', async () => {
    const { token } = await pairDevice();
    assert.equal((await req('GET', `/api/apps?token=${token}`)).status, 401);
  });
});

describe('WebSocket', () => {
  test('falscher Origin wird beim Upgrade abgelehnt', async () => {
    const c = connect({ origin: 'https://evil.example' });
    await assert.rejects(c.opened, /HTTP 403/);
  });

  test('fehlender Origin wird abgelehnt', async () => {
    const c = connect({ origin: '' });
    await assert.rejects(c.opened, /HTTP 403/);
  });

  test('Query-Parameter in der WS-URL werden abgelehnt (kein Token in der URL)', async () => {
    const c = connect({ path: '/ws?token=abc' });
    await assert.rejects(c.opened, /HTTP 400/);
  });

  test('ungültiges Token wird mit 4401 geschlossen', async () => {
    const c = connect();
    await c.opened;
    c.ws.send(JSON.stringify({ type: 'auth', token: 'y'.repeat(43), protocol: PROTOCOL_VERSION }));
    assert.equal(await c.closed, CLOSE.unauthorized);
  });

  test('Aktion vor der Anmeldung wird mit 4401 geschlossen', async () => {
    const c = connect();
    await c.opened;
    c.ws.send(JSON.stringify({ type: 'run', requestId: 'r1', actionId: 't-finder' }));
    assert.equal(await c.closed, CLOSE.unauthorized);
  });

  test('unbekannte Aktions-ID wird mit Fehler beantwortet', async () => {
    const { token } = await pairDevice();
    const c = connect();
    await c.opened;
    c.ws.send(JSON.stringify({ type: 'auth', token, protocol: PROTOCOL_VERSION }));
    await c.next('ready');
    await c.next('config');
    calls.length = 0;
    c.ws.send(JSON.stringify({ type: 'run', requestId: 'r-unknown', actionId: 'gibt-es-nicht' }));
    const res = await c.next('result');
    assert.equal(res.requestId, 'r-unknown');
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.code, 'unknown_action');
    assert.equal(calls.length, 0, 'es darf nichts ausgeführt werden');
    c.ws.close();
  });

  test('Freie Befehle statt Aktions-ID werden nicht angenommen', async () => {
    const { token } = await pairDevice();
    const c = connect();
    await c.opened;
    c.ws.send(JSON.stringify({ type: 'auth', token, protocol: PROTOCOL_VERSION }));
    await c.next('ready');
    calls.length = 0;
    c.ws.send(JSON.stringify({ type: 'run', requestId: 'r2', actionId: 'x', command: 'rm -rf /' }));
    c.ws.send(JSON.stringify({ type: 'run', requestId: 'r3', actionId: '$(open -a Calculator)' }));
    c.ws.send(JSON.stringify({ type: 'ping', t: 1 }));
    await c.next('pong');
    assert.equal(calls.length, 0);
    c.ws.close();
  });

  test('App öffnen und Link öffnen laufen per execFile mit Argumenten', async () => {
    const { token } = await pairDevice();
    const c = connect();
    await c.opened;
    c.ws.send(JSON.stringify({ type: 'auth', token, protocol: PROTOCOL_VERSION }));
    await c.next('ready');
    calls.length = 0;
    c.ws.send(JSON.stringify({ type: 'run', requestId: 'r-app', actionId: 't-finder' }));
    const r1 = await c.next('result');
    assert.equal(r1.ok, true);
    assert.deepEqual(calls[0], { file: '/usr/bin/open', args: ['-b', 'com.apple.finder'] });
    assert.deepEqual(calls[1], { file: '/usr/bin/osascript', args: ['/a.applescript', 'com.apple.finder'] }, 'App wird danach in den Vordergrund geholt');
    c.ws.close();

    const c2 = connect();
    await c2.opened;
    c2.ws.send(JSON.stringify({ type: 'auth', token, protocol: PROTOCOL_VERSION }));
    await c2.next('ready');
    c2.ws.send(JSON.stringify({ type: 'run', requestId: 'r-url', actionId: 't-gfonts' }));
    const r2 = await c2.next('result');
    assert.equal(r2.ok, true);
    assert.deepEqual(calls[2], { file: '/usr/bin/open', args: ['https://fonts.google.com/'] });
    c2.ws.close();
  });

  test('Widerruf trennt das Gerät (4403) und das Token gilt nicht mehr', async () => {
    const { token, deviceId } = await pairDevice('Widerruf');
    const c = connect();
    await c.opened;
    c.ws.send(JSON.stringify({ type: 'auth', token, protocol: PROTOCOL_VERSION }));
    await c.next('ready');
    const del = await req('DELETE', `/api/devices/${deviceId}`, { token });
    assert.equal(del.status, 204);
    assert.equal(await c.closed, CLOSE.revoked);
    assert.equal((await req('GET', '/api/apps', { token })).status, 401);
  });
});

describe('Aktionen und Konfiguration', () => {
  test('nicht installierte App liefert verständlichen Fehler', async () => {
    const r = await makeRunner().runner.run({ type: 'openApp', bundleId: 'com.example.missing' });
    assert.deepEqual(r, { ok: false, code: 'app_not_found', message: 'Diese App ist auf dem Mac nicht installiert.' });
  });

  test('Links nur http/https', async () => {
    const { runner } = makeRunner();
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'x-apple.systempreferences:', 'ftp://a.b']) {
      const r = await runner.run({ type: 'openUrl', url });
      assert.equal(r.ok, false, url);
    }
  });

  test('Konfiguration: Schema und Revision werden geprüft', async () => {
    const current = config.get();
    const bad = { ...current, groups: [{ id: 'g', tiles: [{ id: 't', kind: 'action', label: 'X', color: 'brown', icon: { type: 'none' }, action: { type: 'openUrl', url: 'javascript:alert(1)' } }, null, null, null, null, null, null, null] }] };
    const r1 = await config.update(bad, current.revision);
    assert.equal(r1.ok, false);
    const shell = { ...current, groups: [{ id: 'g', tiles: [{ id: 't', kind: 'action', label: 'X', color: 'brown', icon: { type: 'none' }, action: { type: 'shell', command: 'ls' } }, null, null, null, null, null, null, null] }] };
    assert.equal((await config.update(shell, current.revision)).ok, false, 'kein Aktionstyp für Befehle');
    const ok = await config.update({ ...current }, current.revision);
    assert.equal(ok.ok, true);
    const stale = await config.update({ ...current }, current.revision);
    assert.equal(stale.ok === false && stale.reason, 'stale');
    assert.ok(statSync(path.join(dir, 'config.backup.json')).isFile(), 'Backup der letzten Version');
  });

  test('Startbelegung ist schemakonform', () => {
    const cfg = defaultConfig([{ id: 'd-x', bundleId: 'com.apple.finder', label: 'Finder' }]);
    assert.equal(deckConfigSchema.safeParse(cfg).success, true);
    assert.equal(cfg.groups.length, 2);
    assert.equal(cfg.emojis.map((e) => e.emoji).join(''), '😂🤩🤣❤️😱😘😍🥰');
  });
});

describe('Meilenstein 3: Aktionen', () => {
  test('Tastenkombination: Werte nur als osascript-Argumente; Sondertasten als Keycode', async () => {
    const { runner } = makeRunner();
    calls.length = 0;
    assert.equal((await runner.run({ type: 'hotkey', modifiers: ['command', 'shift'], key: 'z' })).ok, true);
    assert.equal((await runner.run({ type: 'hotkey', modifiers: ['control'], key: 'up' })).ok, true);
    assert.deepEqual(calls[0], { file: '/usr/bin/osascript', args: ['/k.applescript', 'z', 'command', 'shift'] });
    assert.deepEqual(calls[1], { file: '/usr/bin/osascript', args: ['/k.applescript', 'code:126', 'control'] });
    assert.equal((await runner.run({ type: 'hotkey', modifiers: ['command', 'shift'], key: '4' })).ok, true);
    assert.deepEqual(calls[2], { file: '/usr/bin/osascript', args: ['/k.applescript', 'code:21', 'command', 'shift'] }, 'Ziffern als Keycode (⌘⇧4)');
  });

  test('Tastenkombination: unbekannte Taste/Modifier wird abgelehnt', async () => {
    const { runner } = makeRunner();
    calls.length = 0;
    const r1 = await runner.run({ type: 'hotkey', modifiers: ['command'], key: '" & do shell script "x' } as never);
    const r2 = await runner.run({ type: 'hotkey', modifiers: ['hyper'], key: 'a' } as never);
    assert.equal(r1.ok, false);
    assert.equal(r2.ok, false);
    assert.equal(calls.length, 0);
  });

  test('fehlende Berechtigungen werden erkannt und erklärt', async () => {
    const deny = (stderr: string): Exec => async () => { throw new ExecError('x', 1, stderr, false); };
    const a = await makeRunner(deny('execution error: Not authorized to send Apple events to System Events. (-1743)')).runner.run({ type: 'hotkey', modifiers: [], key: 'a' });
    assert.equal(a.ok === false && a.permission, 'automation');
    assert.match(a.ok === false ? a.message : '', /Automation/);
    const b = await makeRunner(deny('System Events got an error: osascript is not allowed to send keystrokes. (1002)')).runner.run({ type: 'hotkey', modifiers: [], key: 'a' });
    assert.equal(b.ok === false && b.permission, 'accessibility');
    assert.match(b.ok === false ? b.message : '', /Bedienungshilfen/);
  });

  test('Fenster anordnen: nicht anpassbare Fenster werden gemeldet', async () => {
    nativeReply = () => ({ ok: true, count: 3, windows: [
      { app: 'Safari', title: 'A', ok: true, reason: '' },
      { app: 'Rechner', title: '', ok: false, reason: 'Grösse nicht änderbar' },
      { app: 'Mail', title: 'B', ok: true, reason: '' },
    ] });
    const r = await makeRunner().runner.run({ type: 'tileWindows' });
    assert.equal(r.ok, true);
    assert.match(r.ok ? r.message ?? '' : '', /2 von 3 angeordnet.*Rechner: Grösse nicht änderbar/);
    nativeReply = () => ({ ok: false, error: 'accessibility' });
    const r2 = await makeRunner().runner.run({ type: 'tileWindows' });
    assert.equal(r2.ok === false && r2.permission, 'accessibility');
    nativeReply = () => ({ ok: true });
  });

  test('Stage Manager: schaltet per defaults und prüft den tatsächlichen Zustand', async () => {
    let pref = false;
    const exec: Exec = async (file, args) => {
      calls.push({ file, args });
      if (file === '/usr/bin/defaults') pref = args[4] === 'true';
      return { stdout: '', stderr: '' };
    };
    nativeReply = (a) => (a[0] === 'stage-manager-state' ? { ok: true, pref, strip: pref ? 3 : 0 } : { ok: true });
    calls.length = 0;
    const { runner } = makeRunner(exec);
    const on = await runner.run({ type: 'stageManager' });
    assert.deepEqual(calls[0], { file: '/usr/bin/defaults', args: ['write', 'com.apple.WindowManager', 'GloballyEnabled', '-bool', 'true'] });
    assert.equal(on.ok && on.message, 'Stage Manager ist an.');
    const off = await runner.run({ type: 'stageManager' });
    assert.equal(off.ok && off.message, 'Stage Manager ist aus.');
    // Einstellung greift nicht -> Fehler statt falscher Erfolgsmeldung
    nativeReply = (a) => (a[0] === 'stage-manager-state' ? { ok: true, pref: false, strip: 0 } : { ok: true });
    const stuck = await makeRunner(async () => ({ stdout: '', stderr: '' })).runner.run({ type: 'stageManager' });
    assert.equal(stuck.ok, false);
    nativeReply = () => ({ ok: true });
  });

  test('Emoji: über das native Programm, Zwischenablage-Ergebnis wird gemeldet', async () => {
    nativeCalls.length = 0;
    nativeReply = () => ({ ok: true, restored: true, items: 2 });
    const r = await makeRunner().runner.run({ type: 'insertEmoji', emoji: '🥰' });
    assert.equal(r.ok, true);
    assert.deepEqual(nativeCalls[0], ['insert-emoji', '🥰', '/k.applescript']);
    nativeReply = () => ({ ok: true });
  });

  test('Timer: einer läuft, erneut = stoppen, anderer ersetzt; Endzeit überlebt Neustart', async () => {
    let now = 1_000_000;
    const file = path.join(dir, 'timer-restart.json');
    const t1 = new TimerManager(file, async () => true, () => now);
    assert.equal(await t1.toggle('pomodoro'), 'started');
    assert.equal(t1.get()?.endsAt, now + 25 * 60_000);
    assert.equal(await t1.toggle('break'), 'replaced');
    assert.equal(t1.get()?.preset, 'break');
    t1.dispose();
    // "Neustart": neuer Manager liest dieselbe Endzeit
    const t2 = new TimerManager(file, async () => true, () => now + 60_000);
    await t2.load();
    assert.equal(t2.get()?.preset, 'break');
    assert.equal(t2.get()?.endsAt, now + 5 * 60_000);
    assert.equal(await t2.toggle('break'), 'stopped');
    assert.equal(t2.get(), null);
    t2.dispose();
  });

  test('Timer: Ablauf löst eine Mitteilung aus (auch nachträglich nach Neustart)', async () => {
    const file = path.join(dir, 'timer-expire.json');
    const sent: string[] = [];
    let now = 5_000_000;
    const t1 = new TimerManager(file, async (title) => { sent.push(title); return true; }, () => now);
    await t1.toggle('break');
    t1.dispose();
    now += 6 * 60_000; // Helper war aus, Timer ist inzwischen abgelaufen
    const t2 = new TimerManager(file, async (title) => { sent.push(title); return true; }, () => now);
    await t2.load();
    assert.deepEqual(sent, ['Pause vorbei']);
    assert.equal(t2.get(), null);
  });

  test('System-Aktionen per ID; Konfigurations-IDs mit sys- sind verboten', async () => {
    const { token } = await pairDevice();
    const c = connect();
    await c.opened;
    c.ws.send(JSON.stringify({ type: 'auth', token, protocol: PROTOCOL_VERSION }));
    await c.next('timer');
    await c.next('permissions');
    c.ws.send(JSON.stringify({ type: 'run', requestId: 'r-sys', actionId: 'sys-timer-stop' }));
    const r = await c.next('result');
    assert.equal(r.ok, true);
    c.ws.close();
    const cur = config.get();
    const bad = { ...cur, emojis: [{ id: 'sys-evil', emoji: '😀' }] };
    assert.equal((await config.update(bad, cur.revision)).ok, false);
  });
});
