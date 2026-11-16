import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExecError, type Exec } from './exec';
import { IS_WINDOWS } from './platform';

export const APP_NAME = 'Copper Deck Helper';
export const BUNDLE_ID = 'ch.copperdeck.helper';
export const INSTALLED_APP = path.join(homedir(), 'Applications', `${APP_NAME}.app`);

/** Pfad zum nativen Programm: vom Launcher gesetzt, sonst installiertes bzw. lokal gebautes Bundle. */
export function resolveNativeBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (IS_WINDOWS) {
    // Vom Launcher gesetzt bzw. neben dem Helper-Bundle (runtime\helper\) von install.ps1 abgelegt.
    const win = [env['COPPER_DECK_NATIVE'], path.join(here, 'CopperDeckHelper.exe'), path.resolve(here, '../dist/windows/CopperDeckHelper.exe')];
    return win.find((c): c is string => !!c && existsSync(c)) ?? null;
  }
  const candidates = [
    env['COPPER_DECK_NATIVE'],
    path.join(INSTALLED_APP, 'Contents/MacOS/CopperDeckHelper'),
    path.resolve(here, '../dist', `${APP_NAME}.app`, 'Contents/MacOS/CopperDeckHelper'),
    path.resolve(here, `${APP_NAME}.app`, 'Contents/MacOS/CopperDeckHelper'),
  ];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

/** AppleScript-Dateien: neben dem Bundle (runtime/helper/) oder im Quellbaum (helper/native/). */
export function resolveScript(name: 'keystroke' | 'activate'): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, `${name}.applescript`), path.resolve(here, `../native/${name}.applescript`)];
  return candidates.find((c) => existsSync(c)) ?? candidates[1]!;
}

export interface NativeResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly [key: string]: unknown;
}

/** Ruft Unterbefehle des nativen Programms auf (execFile, Argumente als Array). */
export class Native {
  constructor(private readonly exec: Exec, readonly binary: string | null) {}

  get available(): boolean {
    return this.binary !== null;
  }

  async call(args: readonly string[], timeoutMs = 10_000): Promise<NativeResult> {
    if (!this.binary) return { ok: false, error: 'native_missing' };
    try {
      const { stdout } = await this.exec(this.binary, args, { timeoutMs });
      return parse(stdout);
    } catch (e) {
      const err = e as ExecError & { stdout?: string };
      if (err.timedOut) return { ok: false, error: 'timeout' };
      // Unterbefehle melden Fehler als JSON auf stdout und Exit-Code ≠ 0
      const out = (e as { stdout?: string }).stdout;
      if (out) return parse(out);
      return { ok: false, error: err.stderr?.trim().slice(0, 300) || err.message };
    }
  }
}

function parse(stdout: string): NativeResult {
  const line = stdout.trim().split('\n').pop() ?? '';
  try {
    return JSON.parse(line) as NativeResult;
  } catch {
    return { ok: false, error: 'invalid_output' };
  }
}
