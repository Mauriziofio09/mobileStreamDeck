import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeviceInfo } from '@copper-deck/shared';
import { ActionRunner } from './actions/runner';
import { adminRequest, startAdminServer, type AdminRequest } from './admin';
import { AppCatalog, defaultSwiftSource, suggestDock } from './apps';
import { ConfigStore } from './config-store';
import { DeviceStore } from './devices';
import { execFileSafe } from './exec';
import { readJson } from './fsutil';
import { initLog, log } from './log';
import { PairingManager } from './pairing';
import { resolvePaths } from './paths';
import { createServer } from './server';
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

  const catalog = new AppCatalog(execFileSafe, {
    iconCache: paths.iconCache,
    binDir: paths.bin,
    swiftSource: process.env['COPPER_DECK_SWIFT_SRC'] ?? defaultSwiftSource(),
  });
  const devices = new DeviceStore(paths.devices);
  await devices.load();
  const config = new ConfigStore(paths.config, paths.configBackup);
  await config.load(async () =>
    (await suggestDock(execFileSafe, catalog)).map((a) => ({ id: `d-${a.bundleId.replace(/[^A-Za-z0-9_-]/g, '-')}`.slice(0, 64), bundleId: a.bundleId, label: a.name })),
  );
  const pairing = new PairingManager();
  const origins = [`https://${host.mdnsName}:${settings.port}`, `https://localhost:${settings.port}`];
  const webRoot = process.env['COPPER_DECK_WEB'] ?? path.resolve(here, '../../web/dist/web/browser');

  const readTls = async () => ({ key: await readFile(paths.key), cert: await readFile(paths.cert) });
  const srv = createServer({
    devices, pairing, config, catalog,
    runner: new ActionRunner(execFileSafe),
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
  log('info', `Copper Deck ${VERSION} läuft: ${origins[0]}`, { ips: host.lanIps, webRoot });

  const shutdown = (sig: string) => {
    log('info', `Beende (${sig})`);
    // Admin-Socket zuerst schliessen, damit ein Nachfolger sofort starten kann.
    admin.close();
    void rm(paths.adminSocket, { force: true })
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
      throw new Error(`Helper nicht erreichbar (${e.message}). Läuft er? Start: copper-deck serve`);
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
      process.stdout.write(`mkcert-Root-CA: ${file}\nFinder zeigt die Datei – per AirDrop an iPhone/iPad senden.\n`);
      await execFileSafe('/usr/bin/open', ['-R', file]);
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
          '  copper-deck serve            Helper starten (macht später der LaunchAgent)\n' +
          '  copper-deck pair             Kopplungscode anzeigen\n' +
          '  copper-deck devices          Gekoppelte Geräte auflisten\n' +
          '  copper-deck revoke <id>      Gerät widerrufen\n' +
          '  copper-deck cert [--renew]   TLS-Zertifikat prüfen/erneuern\n' +
          '  copper-deck ca               mkcert-Root-CA im Finder zeigen\n' +
          '  copper-deck status           Status des laufenden Helpers\n',
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
