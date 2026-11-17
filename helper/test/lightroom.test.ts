// Lightroom-Brücke gegen ein nachgebildetes Plugin (zwei echte TCP-Server wie LrSocket).
// Lightroom Classic selbst ist hier nicht installiert; das Plugin (Lua) prüft die Testcheckliste.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LR_PARAM_IDS, type LrState } from '@copper-deck/shared';
import { clientMessageSchema, lrCommandSchema } from '@copper-deck/shared/schema';
import { LightroomBridge, toArgs } from '../src/lightroom';

process.env['COPPER_DECK_QUIET'] = '1';
const here = path.dirname(fileURLToPath(import.meta.url));

/** Nachgebildetes Plugin: Port A empfängt Befehle, Port B sendet JSON-Zeilen. */
async function fakePlugin(onCommand: (fields: string[], send: (o: unknown) => void) => void) {
  const received: string[][] = [];
  let out: net.Socket | null = null;
  const send = (o: unknown) => out?.write(JSON.stringify(o) + '\n');
  const inbound = net.createServer((s) => {
    let buf = '';
    s.setEncoding('utf8');
    s.on('data', (c: string) => {
      buf += c;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const f = buf.slice(0, nl).split('\t');
        buf = buf.slice(nl + 1);
        received.push(f);
        onCommand(f, send);
      }
    });
    s.on('error', () => undefined);
  });
  const outbound = net.createServer((s) => {
    out = s;
    s.on('error', () => undefined);
  });
  await new Promise<void>((r) => inbound.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => outbound.listen(0, '127.0.0.1', r));
  const ports = { toPlugin: (inbound.address() as net.AddressInfo).port, fromPlugin: (outbound.address() as net.AddressInfo).port };
  return {
    ports, received, send,
    close: async () => {
      out?.destroy();
      await new Promise((r) => inbound.close(r));
      await new Promise((r) => outbound.close(r));
    },
    dropClients: () => out?.destroy(),
  };
}

const STATE = {
  type: 'state', module: 'develop', lrVersion: '14.1',
  photo: { name: 'DSC_0042.NEF', rating: 3, flag: 'pick', label: 'red' },
  values: { Exposure2012: 0.35, Contrast2012: 12, NotAParam: 5, Temperature: 5600 },
  ranges: { Temperature: [2000, 50000], Bogus: [0, 1] },
  beforeAfter: false,
};

/** Standardverhalten: auf hello Zustand senden, Befehle bestätigen. */
function standard(f: string[], send: (o: unknown) => void) {
  const [id, cmd] = f;
  if (cmd === 'hello') send(STATE);
  if (cmd === 'presets') send({ type: 'presets', folders: [{ name: 'Eigene', presets: [{ id: 'A1B2-C3', name: 'Warm' }, { id: 'bad id!', name: 'X' }] }] });
  if (cmd === 'set' && f[2] === 'Exposure2012') send({ type: 'values', values: { Exposure2012: Number(f[3]) } });
  if (cmd === 'rating' && f[2] === '9') return send({ type: 'result', id, ok: false, message: 'Ungültige Bewertung' });
  if (cmd === 'slow') return;
  send({ type: 'result', id, ok: true });
}

function waitFor(bridge: LightroomBridge, pred: (s: LrState) => boolean, ms = 3000): Promise<LrState> {
  return new Promise((resolve, reject) => {
    if (pred(bridge.get())) return resolve(bridge.get());
    const t = setTimeout(() => { off(); reject(new Error('Zeitüberschreitung')); }, ms);
    const off = bridge.onState((s) => { if (pred(s)) { clearTimeout(t); off(); resolve(s); } });
  });
}

describe('Lightroom-Brücke', () => {
  const cleanups: (() => unknown)[] = [];
  after(async () => { for (const c of cleanups) await c(); });

  test('verbindet sich, übernimmt Zustand und filtert unbekannte Regler', async () => {
    const plugin = await fakePlugin(standard);
    const bridge = new LightroomBridge(plugin.ports);
    cleanups.push(() => bridge.stop(), plugin.close);
    bridge.start();
    const s = await waitFor(bridge, (x) => x.connected);
    assert.equal(s.module, 'develop');
    assert.deepEqual(s.photo, { name: 'DSC_0042.NEF', rating: 3, flag: 'pick', label: 'red' });
    assert.deepEqual(s.values, { Exposure2012: 0.35, Contrast2012: 12, Temperature: 5600 });
    assert.deepEqual(s.ranges, { Temperature: [2000, 50000] });
    assert.equal(s.lrVersion, '14.1');
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(bridge.getPresets(), [{ name: 'Eigene', presets: [{ id: 'A1B2-C3', name: 'Warm' }] }], 'ungültige Vorgaben-IDs fallen weg');
  });

  test('Befehle: Zeilenformat, Antwort, Wertänderung', async () => {
    const plugin = await fakePlugin(standard);
    const bridge = new LightroomBridge(plugin.ports);
    cleanups.push(() => bridge.stop(), plugin.close);
    bridge.start();
    await waitFor(bridge, (x) => x.connected);
    assert.deepEqual(await bridge.run({ cmd: 'set', param: 'Exposure2012', value: 1.25 }), { ok: true });
    assert.deepEqual(plugin.received.at(-1)!.slice(1), ['set', 'Exposure2012', '1.25']);
    await waitFor(bridge, (x) => x.values['Exposure2012'] === 1.25);
    assert.equal(bridge.get().values['Contrast2012'], 12, 'andere Werte bleiben erhalten');
    const r = await bridge.run({ cmd: 'rating', value: 9 as 5 });
    assert.deepEqual(r, { ok: false, message: 'Ungültige Bewertung' });
  });

  test('getrennt: Befehle melden das, Zustand wird zurückgesetzt, danach neu verbunden', async () => {
    const first = await fakePlugin(standard);
    const ports = first.ports;
    const bridge = new LightroomBridge(ports);
    cleanups.push(() => bridge.stop());
    bridge.start();
    await waitFor(bridge, (x) => x.connected);
    await first.close();
    await waitFor(bridge, (x) => !x.connected);
    assert.equal(bridge.get().photo, null);
    const r = await bridge.run({ cmd: 'nav', value: 'next' });
    assert.equal(r.ok, false);
    assert.match(r.message ?? '', /nicht verbunden/);
    // Lightroom startet neu (gleiche Ports): Brücke verbindet sich von selbst wieder.
    const second = await reopen(ports);
    cleanups.push(second.close);
    await waitFor(bridge, (x) => x.connected, 5000);
  });

  test('offene Befehle scheitern sauber, wenn die Verbindung abbricht', async () => {
    const plugin = await fakePlugin((f, send) => { if (f[1] === 'hello') send(STATE); });
    const bridge = new LightroomBridge(plugin.ports);
    cleanups.push(() => bridge.stop(), plugin.close);
    bridge.start();
    await waitFor(bridge, (x) => x.connected);
    const pending = bridge.run({ cmd: 'undo' });
    plugin.dropClients();
    const r = await pending;
    assert.equal(r.ok, false);
    assert.match(r.message ?? '', /unterbrochen/);
  });
});

async function reopen(ports: { toPlugin: number; fromPlugin: number }) {
  // Wie fakePlugin, aber auf festen Ports
  const inbound = net.createServer((s) => {
    s.setEncoding('utf8');
    s.on('data', (c: string) => { for (const l of c.split('\n').filter(Boolean)) standard(l.split('\t'), send); });
    s.on('error', () => undefined);
  });
  let out: net.Socket | null = null;
  const send = (o: unknown) => out?.write(JSON.stringify(o) + '\n');
  const outbound = net.createServer((s) => { out = s; s.on('error', () => undefined); });
  await new Promise<void>((r) => inbound.listen(ports.toPlugin, '127.0.0.1', r));
  await new Promise<void>((r) => outbound.listen(ports.fromPlugin, '127.0.0.1', r));
  return { close: async () => { out?.destroy(); await new Promise((r) => inbound.close(r)); await new Promise((r) => outbound.close(r)); } };
}

describe('Lightroom-Befehle prüfen', () => {
  test('erlaubt nur bekannte Regler und gültige Werte', () => {
    assert.ok(lrCommandSchema.safeParse({ cmd: 'set', param: 'Exposure2012', value: -1.5 }).success);
    assert.ok(!lrCommandSchema.safeParse({ cmd: 'set', param: 'CameraProfile', value: 1 }).success);
    assert.ok(!lrCommandSchema.safeParse({ cmd: 'set', param: 'Exposure2012', value: Number.NaN }).success);
    assert.ok(!lrCommandSchema.safeParse({ cmd: 'set', param: 'Exposure2012', value: '1' }).success);
    assert.ok(!lrCommandSchema.safeParse({ cmd: 'rating', value: 6 }).success);
    assert.ok(!lrCommandSchema.safeParse({ cmd: 'preset', id: 'abc\tdef' }).success);
    assert.ok(!lrCommandSchema.safeParse({ cmd: 'script', value: 'os.execute()' }).success);
    assert.ok(clientMessageSchema.safeParse({ type: 'lr', requestId: 'r1', command: { cmd: 'flag', value: 'pick' } }).success);
    assert.ok(!clientMessageSchema.safeParse({ type: 'lr', requestId: 'r1', command: { cmd: 'flag', value: 'pick', extra: 1 } }).success);
  });

  test('Zeilenfelder', () => {
    assert.deepEqual(toArgs({ cmd: 'set', param: 'Tint', value: -12 }), ['set', 'Tint', '-12']);
    assert.deepEqual(toArgs({ cmd: 'preset', id: 'AB-12' }), ['preset', 'AB-12']);
    assert.deepEqual(toArgs({ cmd: 'auto', value: 'wb' }), ['auto', 'wb']);
    assert.deepEqual(toArgs({ cmd: 'copy' }), ['copy']);
  });

  test('Regler-Liste im Plugin (Protocol.lua) stimmt mit der App überein', () => {
    const lua = readFileSync(path.resolve(here, '../../lightroom/CopperDeck.lrplugin/Protocol.lua'), 'utf8');
    const block = /Protocol\.PARAMS = \{([\s\S]*?)\n\}/.exec(lua)?.[1] ?? '';
    const ids = [...block.matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1]);
    assert.deepEqual([...ids].sort(), [...LR_PARAM_IDS].sort());
    assert.equal(new Set(LR_PARAM_IDS).size, LR_PARAM_IDS.length, 'keine doppelten Regler');
  });
});

// ---------------------------------------------------------------- Adobe Lightroom (Cloud-Version)
import { LR_CLOUD_COMMANDS } from '@copper-deck/shared';
import { LightroomCloud, LR_CLOUD } from '../src/lightroom-cloud';
import { ExecError, type Exec } from '../src/exec';

describe('Lightroom (Cloud) über das Menü', () => {
  function setup(fail?: (args: readonly string[]) => string | null) {
    const calls: (readonly string[])[] = [];
    const runs: unknown[] = [];
    const exec: Exec = async (_f, args) => {
      calls.push(args);
      const err = fail?.(args);
      if (err) throw new ExecError('osascript', 1, err, false);
      return { stdout: 'ok', stderr: '' };
    };
    const catalog = { get: async (id: string) => (id === 'com.adobe.mas.lightroomCC' ? { bundleId: id, name: 'Adobe Lightroom' } : null), list: async () => [] } as never;
    const runner = { run: async (a: unknown) => { runs.push(a); return { ok: true }; } } as never;
    const permissions = { report: () => undefined } as never;
    return { lc: new LightroomCloud({ exec, catalog, runner, permissions, menuScript: '/m.applescript' }), calls, runs };
  }

  test('jeder Befehl hat einen Menüeintrag', () => {
    for (const c of LR_CLOUD_COMMANDS) assert.ok(LR_CLOUD[c]?.mac, c);
    assert.equal(Object.keys(LR_CLOUD).length, LR_CLOUD_COMMANDS.length);
  });

  test('Sterne über den Kurzbefehl im Menü Foto, Navigation über den Namen', async () => {
    const { lc, calls } = setup();
    assert.deepEqual(await lc.run('rating3'), { ok: true });
    assert.deepEqual(calls.at(-1), ['/m.applescript', 'com.adobe.mas.lightroomCC', '5', 'key', '3', '8']);
    await lc.run('next');
    assert.deepEqual(calls.at(-1), ['/m.applescript', 'com.adobe.mas.lightroomCC', '4', 'name', 'Nächstes Foto|Next Photo', '-']);
    await lc.run('labelPurple');
    assert.deepEqual(calls.at(-1)!.slice(3), ['name', 'Lila|Purple', 'Farbbeschriftung festlegen|Set Color Label']);
  });

  test('Lightroom läuft nicht: starten und einmal wiederholen', async () => {
    let first = true;
    const { lc, calls, runs } = setup(() => (first ? ((first = false), 'execution error: not_running (9001)') : null));
    const t = Date.now();
    assert.deepEqual(await lc.run('grid'), { ok: true });
    assert.equal(calls.length, 2);
    assert.deepEqual(runs[0], { type: 'openApp', bundleId: 'com.adobe.mas.lightroomCC' });
    assert.ok(Date.now() - t >= 3900, 'wartet, bis Lightroom bereit ist');
  });

  test('verständliche Fehler: nicht möglich, nicht gefunden, Bedienungshilfen', async () => {
    assert.match((await setup(() => 'disabled (9003)').lc.run('crop') as { message: string }).message, /gerade nicht möglich/);
    assert.match((await setup(() => 'not_found (9002)').lc.run('beforeAfter') as { message: string }).message, /nicht im Menü/);
    assert.match((await setup(() => 'System Events got an error: osascript is not allowed assistive access. (-1719)').lc.run('pick') as { message: string }).message, /Bedienungshilfen/);
  });

  test('ohne Lightroom: klare Meldung, kein Aufruf', async () => {
    const calls: unknown[] = [];
    const lc = new LightroomCloud({
      exec: async (...a) => { calls.push(a); return { stdout: '', stderr: '' }; },
      catalog: { get: async () => null, list: async () => [] } as never,
      runner: {} as never, permissions: {} as never, menuScript: '/m',
    });
    assert.match((await lc.run('auto') as { message: string }).message, /nicht installiert/);
    assert.equal(calls.length, 0);
  });
});
