import { randomBytes } from 'node:crypto';
import { chmod, copyFile, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * Atomar schreiben: temporäre Datei im selben Ordner, fsync, rename.
 * Optional vorher die bisherige Version als Backup sichern.
 */
export async function writeFileAtomic(
  file: string,
  data: string,
  opts: { mode?: number; backup?: string } = {},
): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  const mode = opts.mode ?? 0o600;
  const fh = await open(tmp, 'wx', mode);
  try {
    await fh.writeFile(data, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    if (opts.backup) {
      await copyFile(file, opts.backup).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e;
      });
      await chmod(opts.backup, mode).catch(() => undefined);
    }
    await rename(tmp, file);
    await chmod(file, mode);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export async function readJson(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}
