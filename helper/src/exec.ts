import { execFile } from 'node:child_process';

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
}

export class ExecError extends Error {
  constructor(
    message: string,
    readonly code: number | string | null,
    readonly stderr: string,
    readonly timedOut: boolean,
    readonly stdout: string = '',
  ) {
    super(message);
  }
}

/** Startet ein Programm mit Argument-Array (keine Shell, keine String-Zusammensetzung). */
export type Exec = (file: string, args: readonly string[], opts?: { timeoutMs?: number }) => Promise<ExecResult>;

export const execFileSafe: Exec = (file, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { timeout: opts.timeoutMs ?? 10_000, maxBuffer: 4 * 1024 * 1024, shell: false, env: process.env, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
          reject(new ExecError(err.message, e.code ?? null, String(stderr), !!e.killed, String(stdout)));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
