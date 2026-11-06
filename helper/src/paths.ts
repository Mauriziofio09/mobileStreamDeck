import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Daten: ~/Library/Application Support/CopperDeck/
 * Logs:  ~/Library/Logs/CopperDeck/
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
  const data = env['COPPER_DECK_HOME'] ?? path.join(homedir(), 'Library/Application Support/CopperDeck');
  const logs = env['COPPER_DECK_LOGS'] ?? path.join(homedir(), 'Library/Logs/CopperDeck');
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
    adminSocket: path.join(data, 'admin.sock'),
    settings: path.join(data, 'settings.json'),
  };
}
