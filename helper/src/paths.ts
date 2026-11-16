import { createHash } from 'node:crypto';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import { IS_WINDOWS } from './platform';

/**
 * macOS:   Daten ~/Library/Application Support/CopperDeck/, Logs ~/Library/Logs/CopperDeck/
 * Windows: Daten %LOCALAPPDATA%\CopperDeck\,              Logs %LOCALAPPDATA%\CopperDeck\Logs\
 * Für Tests per COPPER_DECK_HOME / COPPER_DECK_LOGS umlenkbar.
 */
export interface Paths {
  readonly data: string;
  readonly logs: string;
  readonly config: string;
  readonly configBackup: string;
  readonly devices: string;
  readonly tlsDir: string;
  readonly cert: string;
  readonly key: string;
  readonly iconCache: string;
  readonly bin: string;
  readonly adminSocket: string;
  readonly settings: string;
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const winBase = path.join(env['LOCALAPPDATA'] ?? path.join(homedir(), 'AppData', 'Local'), 'CopperDeck');
  const data = env['COPPER_DECK_HOME'] ?? (IS_WINDOWS ? winBase : path.join(homedir(), 'Library/Application Support/CopperDeck'));
  const logs = env['COPPER_DECK_LOGS'] ?? (IS_WINDOWS ? path.join(winBase, 'Logs') : path.join(homedir(), 'Library/Logs/CopperDeck'));
  return {
    data,
    logs,
    config: path.join(data, 'config.json'),
    configBackup: path.join(data, 'config.backup.json'),
    devices: path.join(data, 'devices.json'),
    tlsDir: path.join(data, 'tls'),
    cert: path.join(data, 'tls/cert.pem'),
    key: path.join(data, 'tls/key.pem'),
    iconCache: path.join(data, 'icons'),
    bin: path.join(data, 'bin'),
    adminSocket: IS_WINDOWS ? windowsPipe(data) : path.join(data, 'admin.sock'),
    settings: path.join(data, 'settings.json'),
  };
}

/**
 * Windows kennt keine Unix-Sockets im Datenordner; der Admin-Kanal ist eine Named Pipe pro Benutzer
 * und Datenordner. Sie ist lokal; Windows erlaubt anderen Benutzern standardmässig nur Lesen, nicht Schreiben.
 */
function windowsPipe(data: string): string {
  const tag = createHash('sha256').update(`${userInfo().username}|${data.toLowerCase()}`).digest('hex').slice(0, 16);
  return `\\\\.\\pipe\\copperdeck-admin-${tag}`;
}
