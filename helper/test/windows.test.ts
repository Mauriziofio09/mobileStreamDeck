// Windows-Logik, auf dem Mac geprüft: das native Programm (CopperDeckHelper.exe) ist hier eine Attrappe.
// Was nur auf echtem Windows prüfbar ist (SendInput, Shell, Icons), steht in der Testcheckliste.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { defaultWindowsConfig, type InstalledApp } from '@copper-deck/shared';
import { APP_ID_PATTERN, deckConfigSchema } from '@copper-deck/shared/schema';
import { ActionRunner } from '../src/actions/runner';
import { WindowsActions } from '../src/actions/windows';
import { iconFileName, suggestDockWindows, WindowsAppCatalog } from '../src/apps-windows';
import type { Exec } from '../src/exec';
import type { Native, NativeResult } from '../src/native';
import { PermissionMonitor } from '../src/permissions';
import { TimerManager } from '../src/timer';

process.env['COPPER_DECK_QUIET'] = '1';

const APPS = [
  { id: 'Microsoft.Windows.Explorer', name: 'Datei-Explorer' },
  { id: 'MSEdge', name: 'Microsoft Edge' },
  { id: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App', name: 'Rechner' },
  { id: '{6D809377-6AF0-444B-8957-A3773F02200E}\\Adobe\\Adobe Lightroom Classic\\Lightroom.exe', name: 'Adobe Lightroom Classic' },
  { id: 'Spotify', name: 'Spotify' },
  { id: 'bad\u0001id', name: 'Kaputt' },
  { id: 'MSEdge', name: 'Doppelt' },
];

function fakeNative(reply: (args: readonly string[]) => NativeResult) {
  const calls: (readonly string[])[] = [];
  const native = {
    available: true,
    binary: 'C:\\fake\\CopperDeckHelper.exe',
    call: async (args: readonly string[]) => {
      calls.push(args);
      if (args[0] === 'list-apps') return { ok: true, apps: APPS };
      return reply(args);
    },
  } as unknown as Native;
  return { native, calls };
}

describe('App-Kennungen', () => {
  test('AppUserModelIDs und Bundle-IDs sind erlaubt', () => {
    for (const id of ['com.apple.Safari', 'MSEdge', 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App',
      '{6D809377-6AF0-444B-8957-A3773F02200E}\\Notepad++\\notepad++.exe', 'C:\\Tools\\app.exe']) {
      assert.ok(APP_ID_PATTERN.test(id), id);
    }
  });
  test('Steuerzeichen und Zeichen, die in Windows-Pfaden verboten sind, werden abgelehnt', () => {
    for (const id of ['', 'a\nb', 'a"b', 'a|b', 'a<b', 'a>b', 'a?b', 'a*b', 'x'.repeat(261)]) {
      assert.ok(!APP_ID_PATTERN.test(id), JSON.stringify(id));
    }
  });
  test('Icon-Dateinamen sind gültig und eindeutig', () => {
    const a = iconFileName('Microsoft.WindowsCalculator_8wekyb3d8bbwe!App');
    assert.match(a, /^[a-f0-9]{32}\.png$/);
    assert.notEqual(a, iconFileName('MSEdge'));
  });
});

describe('WindowsAppCatalog', () => {
  test('liest shell:AppsFolder, filtert ungültige und doppelte Einträge, sortiert nach Name', async () => {
    const { native } = fakeNative(() => ({ ok: true }));
    const cat = new WindowsAppCatalog(native, mkdtempSync(path.join(tmpdir(), 'cd-win-')));
    const list = await cat.list();
    assert.deepEqual(list.map((a) => a.name), ['Adobe Lightroom Classic', 'Datei-Explorer', 'Microsoft Edge', 'Rechner', 'Spotify']);
    assert.equal((await cat.get('msedge'))?.bundleId, 'MSEdge', 'IDs unabhängig von Gross-/Kleinschreibung');
    assert.equal(await cat.get('com.apple.Safari'), null);
  });

  test('Icon: extrahiert einmal über app-icon, danach aus dem Cache; unbekannte App -> null', async () => {
    const cache = mkdtempSync(path.join(tmpdir(), 'cd-win-'));
    const { native, calls } = fakeNative((args) => {
      if (args[0] === 'app-icon') writeFileSync(args[2]!, 'png');
      return { ok: true };
    });
    const cat = new WindowsAppCatalog(native, cache);
    const f1 = await cat.icon('MSEdge');
    assert.equal(f1, path.join(cache, iconFileName('MSEdge')));
    await cat.icon('MSEdge');
    assert.equal(calls.filter((c) => c[0] === 'app-icon').length, 1);
    assert.equal(await cat.icon('Nicht.Installiert'), null);
  });

  test('Dock-Vorschlag nimmt nur installierte Apps', async () => {
    const { native } = fakeNative(() => ({ ok: true }));
    const dock = await suggestDockWindows(new WindowsAppCatalog(native, tmpdir()));
    assert.deepEqual(dock.map((a) => a.bundleId), ['Microsoft.Windows.Explorer', 'MSEdge', 'Spotify', APPS[3]!.id]);
  });
});

describe('Windows-Aktionen', () => {
  function setup(reply: (args: readonly string[]) => NativeResult = () => ({ ok: true })) {
    const { native, calls } = fakeNative(reply);
    const catalog = new WindowsAppCatalog(native, tmpdir());
    const exec: Exec = async () => { throw new Error('unter Windows darf kein macOS-Programm laufen'); };
    const permissions = new PermissionMonitor(native, 'app');
    const timers = new TimerManager(path.join(mkdtempSync(path.join(tmpdir(), 'cd-t-')), 'timer.json'), async () => true);
    const runner = new ActionRunner({ exec, native, timers, permissions, keystrokeScript: '', activateScript: '', windows: new WindowsActions(native, catalog) });
    return { runner, calls, timers };
  }

  test('App öffnen nur aus dem Katalog, mit der Original-ID', async () => {
    const { runner, calls } = setup();
    assert.deepEqual(await runner.run({ type: 'openApp', bundleId: 'msedge' }), { ok: true });
    assert.deepEqual(calls.at(-1), ['launch', 'MSEdge']);
    const r = await runner.run({ type: 'openApp', bundleId: 'C:\\Windows\\System32\\cmd.exe' });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, 'app_not_found');
    assert.ok(!calls.some((c) => c[0] === 'launch' && c[1]!.includes('cmd.exe')), 'beliebige Pfade werden nie gestartet');
  });

  test('Link: nur http/https, sonst erreicht nichts das native Programm', async () => {
    const { runner, calls } = setup();
    assert.deepEqual(await runner.run({ type: 'openUrl', url: 'https://example.com/a?b=1' }), { ok: true });
    assert.deepEqual(calls.at(-1), ['open-url', 'https://example.com/a?b=1']);
    const before = calls.length;
    const r = await runner.run({ type: 'openUrl', url: 'file:///C:/Windows/System32/calc.exe' });
    assert.equal(r.ok, false);
    assert.equal(calls.length, before);
  });

  test('Tastenkombination und Emoji gehen als Argumente an das native Programm', async () => {
    const { runner, calls } = setup();
    await runner.run({ type: 'hotkey', modifiers: ['control', 'shift'], key: 'z' });
    assert.deepEqual(calls.at(-1), ['hotkey', 'z', 'control', 'shift']);
    await runner.run({ type: 'insertEmoji', emoji: '😂' });
    assert.deepEqual(calls.at(-1), ['insert-text', '😂']);
  });

  test('Fenster als Administrator: verständliche Meldung statt stillem Fehlschlag', async () => {
    const { runner } = setup((args) => args[0] === 'hotkey'
      ? { ok: false, error: 'elevated', message: 'Taskmgr läuft als Administrator – Windows lässt keine Eingaben von Copper Deck zu.' }
      : { ok: true });
    const r = await runner.run({ type: 'hotkey', modifiers: ['control'], key: 'c' });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, 'permission_denied');
    assert.match(!r.ok ? r.message : '', /Administrator/);
  });

  test('Fenster anordnen: Teilerfolg wird mit Grund gemeldet', async () => {
    const { runner } = setup(() => ({ ok: true, count: 2, windows: [
      { app: 'Explorer', title: 'Dokumente', ok: true, reason: '' },
      { app: 'Rechner', title: 'Rechner', ok: false, reason: 'Mindestgrösse zu gross' },
    ] }));
    const r = await runner.run({ type: 'tileWindows' });
    assert.equal(r.ok, true);
    assert.match(r.ok ? r.message ?? '' : '', /1 von 2 angeordnet.*Rechner – Rechner: Mindestgrösse zu gross/);
  });

  test('Stage Manager gibt es unter Windows nicht; Timer läuft wie am Mac', async () => {
    const { runner, timers } = setup();
    const r = await runner.run({ type: 'stageManager' });
    assert.equal(!r.ok && r.code, 'not_implemented');
    const t = await runner.run({ type: 'timer', preset: 'break' });
    assert.equal(t.ok, true);
    await timers.stop(); // sonst hält der 5-Minuten-Timer den Testprozess offen
  });

  test('fehlendes CopperDeckHelper.exe wird erklärt', async () => {
    const { runner } = setup(() => ({ ok: false, error: 'native_missing' }));
    const r = await runner.run({ type: 'tileWindows' });
    assert.match(!r.ok ? r.message : '', /install\.ps1/);
  });
});

describe('Windows-Startbelegung', () => {
  const apps: InstalledApp[] = APPS.slice(0, 5).map((a) => ({ bundleId: a.id, name: a.name }));
  const cfg = defaultWindowsConfig(apps, [{ id: 'd-1', bundleId: 'MSEdge', label: 'Edge' }]);

  test('ist gültig und enthält nur installierte Apps', () => {
    assert.ok(deckConfigSchema.safeParse(cfg).success);
    const first = cfg.groups[0]!.tiles.filter((t) => t !== null).map((t) => t!.action.type === 'openApp' ? t!.action.bundleId : '');
    assert.deepEqual(first, ['Microsoft.Windows.Explorer', 'MSEdge', 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App', 'Spotify']);
    assert.equal(cfg.groups[0]!.tiles.length, 8);
  });

  test('ersetzt Stage Manager durch die Aufgabenansicht und lässt fehlende Apps leer', () => {
    const work = cfg.groups[1]!.tiles;
    assert.ok(!work.some((t) => t?.action.type === 'stageManager'));
    const tv = work.find((t) => t?.id === 't-taskview');
    assert.deepEqual(tv?.action, { type: 'hotkey', modifiers: ['command'], key: 'tab' });
    assert.ok(!work.some((t) => t?.id === 't-notion' || t?.id === 't-figma'), 'Notion/Figma sind nicht installiert');
  });
});
