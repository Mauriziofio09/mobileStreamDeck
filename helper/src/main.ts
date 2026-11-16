import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultWindowsConfig, type DeviceInfo } from '@copper-deck/shared';
import { ActionRunner } from './actions/runner';
import { adminRequest, startAdminServer, type AdminRequest } from './admin';
import { MacAppCatalog, suggestDock, type AppCatalog } from './apps';
import { suggestDockWindows, WindowsAppCatalog } from './apps-windows';
import { WindowsActions } from './actions/windows';
import { HOST_NAME, IS_WINDOWS, PLATFORM } from './platform';
import { ConfigStore } from './config-store';
import { DeviceStore } from './devices';
import { execFileSafe } from './exec';
import { readJson } from './fsutil';
import { initLog, log } from './log';
import { PairingManager } from './pairing';
import { resolvePaths } from './paths';
import { Native, resolveNativeBinary, resolveScript } from './native';
import { MediaStore } from './media';
import { PermissionMonitor } from './permissions';
import { createServer } from './server';
import { TimerManager } from './timer';
import { actionSchema } from '@copper-deck/shared/schema';
import { access, writeFile } from 'node:fs/promises';
import { caRootFile, ensureCert, hostInfo, inspectCert } from './tls';

declare const __HELPER_VERSION__: string | undefined;
const VERSION = typeof __HELPER_VERSION__ === 'string' ? __HELPER_VERSION__ : 'dev';
const DEFAULT_PORT = 7443;

const paths = resolvePaths();
const here = path.dirname(fileURLToPath(import.meta.url));

interface Settings {
  port: number;
}

async function loadSettings(): Promise<Settings> {
  const raw = (await readJson(paths.settings)) as Partial<Settings> | undefined;
  const envPort = Number(process.env['COPPER_DECK_PORT']);
  const port = Number.isInteger(envPort) && envPort > 0 ? envPort : Number(raw?.port ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Ungültiger Port: ${port}`);
  return { port };
}

async function serve(): Promise<void> {
  initLog(paths.logs);
  await mkdir(paths.data, { recursive: true, mode: 0o700 });
  const settings = await loadSettings();
  const host = await hostInfo(execFileSafe);
  const cert = await ensureCert(execFileSafe, paths, host);

  const native = new Native(execFileSafe, resolveNativeBinary());
  const context = process.env['COPPER_DECK_CONTEXT'] === 'app' ? 'app' : 'terminal';
  if (!native.available) log('warn', `${IS_WINDOWS ? 'CopperDeckHelper.exe' : 'Copper Deck Helper.app'} nicht gefunden – native Aktionen nicht verfügbar`);
  if (context === 'terminal' && !IS_WINDOWS) log('warn', 'Von Hand gestartet: macOS-Berechtigungen gelten fürs Terminal, nicht für den LaunchAgent');
  const catalog: AppCatalog = IS_WINDOWS
    ? new WindowsAppCatalog(native, paths.iconCache)
    : new MacAppCatalog(execFileSafe, { iconCache: paths.iconCache, nativeBinary: native.binary });
  const permissions = new PermissionMonitor(native, context);
  const timers = new TimerManager(path.join(paths.data, 'timer.json'), async (title, body) => {
    const r = await native.call(['notify', title, body], 15_000);
    if (!r.ok) permissions.report('notifications');
    return r.ok;
  });
  await timers.load();
  const devices = new DeviceStore(paths.devices);
  await devices.load();
  const config = new ConfigStore(paths.config, paths.configBackup);
  const dockId = (bundleId: string, i: number) => `d-${i + 1}-${bundleId.replace(/[^A-Za-z0-9_-]/g, '-')}`.slice(0, 64);
  await config.load(
    async () => {
      const apps = IS_WINDOWS ? await suggestDockWindows(catalog) : await suggestDock(execFileSafe, catalog as MacAppCatalog);
      return apps.map((a, i) => ({ id: dockId(a.bundleId, i), bundleId: a.bundleId, label: a.name.slice(0, 40) }));
    },
    IS_WINDOWS ? async (dock) => defaultWindowsConfig(await catalog.list(), dock) : undefined,
  );
  const pairing = new PairingManager();
  const origins = [`https://${host.mdnsName}:${settings.port}`, `https://localhost:${settings.port}`];
  const webRoot = process.env['COPPER_DECK_WEB']
    ?? [path.resolve(here, '../web'), path.resolve(here, '../../web/dist/web/browser')].find((p) => existsSync(path.join(p, 'index.html')))
    ?? path.resolve(here, '../../web/dist/web/browser');

  const readTls = async () => ({ key: await readFile(paths.key), cert: await readFile(paths.cert) });
  const runner = new ActionRunner({
    exec: execFileSafe, native, timers, permissions, keystrokeScript: resolveScript('keystroke'), activateScript: resolveScript('activate'),
    ...(IS_WINDOWS ? { windows: new WindowsActions(native, catalog) } : {}),
  });
  const media = IS_WINDOWS
    ? new MediaStore(path.join(paths.data, 'media'), execFileSafe, async (src, dst, maxPx) => {
        const r = await native.call(['convert-image', src, dst, String(maxPx)], 15_000);
        if (!r.ok) throw new Error(String(r.error ?? 'convert-image fehlgeschlagen'));
      })
    : new MediaStore(path.join(paths.data, 'media'), execFileSafe);
  const srv = createServer({
    devices, pairing, config, catalog, runner, timers, permissions,
    media,
    origins, webRoot, tls: await readTls(), version: VERSION,
  });

  const admin = await startAdminServer(paths.adminSocket, async (req: AdminRequest) => {
    switch (req.cmd) {
      case 'pair': {
        const { code, expiresAt } = pairing.create();
        log('info', 'Kopplungscode erzeugt'); // Code selbst nie ins Log
        return { code, expiresAt, url: origins[0] };
      }
      case 'devices':
        return { devices: devices.list(), connected: [...srv.connectedDevices()] };
      case 'revoke':
        return { revoked: await srv.revokeDevice(req.id) };
      case 'status':
        return { version: VERSION, url: origins[0], pid: process.pid, devices: devices.list().length, certValidTo: cert.validTo };
      case 'permissions':
        return permissions.check();
      case 'notifyTest': {
        const r = await native.call(['notify', 'Copper Deck', 'Testmitteilung – Mitteilungen funktionieren.'], 15_000);
        if (!r.ok) permissions.report('notifications');
        return r;
      }
      case 'runAction': {
        // Für Tests unter launchd: führt eine streng typisierte Aktion aus (nur lokal, Socket mit Rechten 600).
        const a = actionSchema.safeParse(req.action);
        if (!a.success) throw new Error('Ungültige Aktion');
        return runner.run(a.data);
      }
      case 'reloadTls':
        srv.server.setSecureContext(await readTls());
        log('info', 'TLS-Zertifikat neu geladen');
        return { reloaded: true };
    }
  });

  await new Promise<void>((resolve, reject) => {
    srv.server.once('error', reject);
    srv.server.listen(settings.port, '0.0.0.0', () => resolve());
  });
  log('info', `Copper Deck ${VERSION} läuft: ${origins[0]}`, { platform: PLATFORM, ips: host.lanIps, webRoot, context, native: native.binary });

  // Berechtigungen: Systemdialoge nur beim ersten Start im App-Kontext zeigen, danach still prüfen.
  if (native.available) {
    const marker = path.join(paths.data, 'permissions-prompted');
    const prompted = await access(marker).then(() => true, () => false);
    if (context === 'app' && !prompted) {
      await writeFile(marker, new Date().toISOString(), { mode: 0o600 });
      void permissions.start(true);
    } else {
      void permissions.start(false);
    }
  }

  const shutdown = (sig: string) => {
    log('info', `Beende (${sig})`);
    // Admin-Socket zuerst schliessen, damit ein Nachfolger sofort starten kann.
    admin.close();
    void (IS_WINDOWS ? Promise.resolve() : rm(paths.adminSocket, { force: true }))
      .then(() => srv.close())
      .finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function cli(cmd: string, args: string[]): Promise<void> {
  const call = (req: AdminRequest) =>
    adminRequest(paths.adminSocket, req).catch((e: Error) => {
      throw new Error(`Helper nicht erreichbar (${e.message}). Läuft er? Start: copper-deck serve (${HOST_NAME})`);
    });

  switch (cmd) {
    case 'pair': {
      const r = (await call({ cmd: 'pair' })) as { code: string; expiresAt: number; url: string };
      const until = new Date(r.expiresAt).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
      process.stdout.write(
        `\n  Kopplungscode:  ${r.code.slice(0, 3)} ${r.code.slice(3)}\n\n` +
          `  Gültig bis ${until} (5 Minuten), einmalig, höchstens 5 Fehlversuche.\n` +
          `  In der installierten Copper-Deck-App auf dem Home-Bildschirm eingeben.\n  Adresse: ${r.url}\n\n`,
      );
      return;
    }
    case 'devices': {
      const r = (await call({ cmd: 'devices' })) as { devices: DeviceInfo[]; connected: string[] };
      if (r.devices.length === 0) process.stdout.write('Keine gekoppelten Geräte.\n');
      for (const d of r.devices) {
        const on = r.connected.includes(d.id) ? '● verbunden' : '○';
        process.stdout.write(`${d.id}  ${d.name.padEnd(24)}  gekoppelt ${d.createdAt.slice(0, 10)}  zuletzt ${d.lastSeenAt?.slice(0, 16).replace('T', ' ') ?? '–'}  ${on}\n`);
      }
      return;
    }
    case 'revoke': {
      const id = args[0];
      if (!id) throw new Error('Aufruf: copper-deck revoke <Geräte-ID>  (IDs: copper-deck devices)');
      const r = (await call({ cmd: 'revoke', id })) as { revoked: boolean };
      process.stdout.write(r.revoked ? `Widerrufen: ${id}\n` : `Unbekannte Geräte-ID: ${id}\n`);
      return;
    }
    case 'notify-test': {
      const r = (await call({ cmd: 'notifyTest' })) as { ok: boolean; status?: string };
      process.stdout.write(r.ok ? 'Testmitteilung gesendet.\n' : IS_WINDOWS
        ? 'Mitteilung nicht möglich. Einstellungen → System → Benachrichtigungen prüfen (auch „Nicht stören“).\n'
        : `Mitteilung nicht möglich (${r.status ?? 'Fehler'}). Systemeinstellungen → Mitteilungen → „Copper Deck Helper“.\n`);
      return;
    }
    case 'permissions': {
      const r = await call({ cmd: 'permissions' });
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      return;
    }
    case 'status': {
      const r = await call({ cmd: 'status' });
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      return;
    }
    case 'cert': {
      const host = await hostInfo(execFileSafe);
      const status = await ensureCert(execFileSafe, paths, host, args.includes('--renew'));
      process.stdout.write(`Zertifikat: ${paths.cert}\nNamen: ${status.names.join(', ')}\nGültig bis: ${status.validTo?.toISOString().slice(0, 10)}\n`);
      if (await call({ cmd: 'reloadTls' }).then(() => true, () => false)) process.stdout.write('Laufender Helper hat das Zertifikat neu geladen.\n');
      return;
    }
    case 'ca': {
      const file = await caRootFile(execFileSafe);
      if (IS_WINDOWS) {
        process.stdout.write(`mkcert-Root-CA: ${file}\nDer Explorer zeigt die Datei – per Mail, OneDrive/iCloud oder Kabel aufs iPhone/iPad bringen.\n`);
        // explorer.exe meldet auch bei Erfolg Exit-Code 1.
        await execFileSafe('explorer.exe', [`/select,${file}`]).catch(() => undefined);
      } else {
        process.stdout.write(`mkcert-Root-CA: ${file}\nFinder zeigt die Datei – per AirDrop an iPhone/iPad senden.\n`);
        await execFileSafe('/usr/bin/open', ['-R', file]);
      }
      return;
    }
    case 'add-app': {
      // Nur Windows: beliebiges Programm über eine Startmenü-Verknüpfung in die App-Auswahl bringen.
      if (!IS_WINDOWS) throw new Error('add-app gibt es nur unter Windows. Am Mac erscheinen alle Apps aus /Applications automatisch.');
      const [target, ...nameParts] = args;
      if (!target) throw new Error('Aufruf: copper-deck add-app <Pfad zur .exe> [Name]');
      const name = nameParts.join(' ') || path.basename(target, path.extname(target));
      const native = new Native(execFileSafe, resolveNativeBinary());
      const r = await native.call(['create-shortcut', path.resolve(target), name]);
      if (!r.ok) throw new Error(String(r.error ?? 'Verknüpfung nicht erstellt'));
      process.stdout.write(`Verknüpfung erstellt: ${String(r['shortcut'])}\n„${name}“ erscheint in der App-Auswahl (spätestens nach einer Minute).\n`);
      return;
    }
    case 'cert-status': {
      const host = await hostInfo(execFileSafe);
      const s = await inspectCert(paths, host);
      process.stdout.write(JSON.stringify(s, null, 2) + '\n');
      return;
    }
    default:
      process.stdout.write(
        'Copper Deck Helper\n\n' +
          `  copper-deck serve            Helper starten (macht sonst ${IS_WINDOWS ? 'die Aufgabenplanung' : 'der LaunchAgent'})\n` +
          '  copper-deck pair             Kopplungscode anzeigen\n' +
          '  copper-deck devices          Gekoppelte Geräte auflisten\n' +
          '  copper-deck revoke <id>      Gerät widerrufen\n' +
          '  copper-deck cert [--renew]   TLS-Zertifikat prüfen/erneuern\n' +
          `  copper-deck ca               mkcert-Root-CA im ${IS_WINDOWS ? 'Explorer' : 'Finder'} zeigen\n` +
          '  copper-deck status           Status des laufenden Helpers\n' +
          (IS_WINDOWS
            ? '  copper-deck add-app <exe> [Name]  Programm in die App-Auswahl aufnehmen\n'
            : '  copper-deck permissions      macOS-Berechtigungen prüfen\n') +
          '  copper-deck notify-test      Testmitteilung senden\n',
      );
  }
}

const [cmd = 'help', ...args] = process.argv.slice(2);
const task = cmd === 'serve' ? serve() : cli(cmd, args);
task.catch((e: Error) => {
  process.stderr.write(`Fehler: ${e.message}\n`);
  if (cmd === 'serve') log('error', 'Start fehlgeschlagen', { error: e.message });
  process.exit(1);
});
