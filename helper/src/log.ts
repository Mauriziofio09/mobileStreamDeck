import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Einfaches Datei-Log. Tokens und Kopplungscodes werden nie übergeben;
 * zusätzlich maskiert `redact` alles, was wie ein Token aussieht.
 */
export type Level = 'info' | 'warn' | 'error';

let logFile: string | null = null;

export function initLog(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  logFile = path.join(dir, 'helper.log');
}

const TOKENISH = /[A-Za-z0-9_-]{32,}/g;
export function redact(text: string): string {
  return text.replace(TOKENISH, '[redacted]');
}

export function log(level: Level, msg: string, extra?: Record<string, unknown>): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${redact(msg)}${extra ? ' ' + redact(JSON.stringify(extra)) : ''}\n`;
  if (logFile) {
    try {
      appendFileSync(logFile, line, { mode: 0o600 });
    } catch {
      /* Log darf den Dienst nicht stoppen */
    }
  }
  if (process.env['COPPER_DECK_QUIET'] !== '1') (level === 'error' ? process.stderr : process.stdout).write(line);
}
