import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DeckConfig } from '@copper-deck/shared';
import { MEDIA_MAX_BYTES } from '@copper-deck/shared';
import { IMAGE_FILE_PATTERN } from '@copper-deck/shared/schema';
import type { Exec } from './exec';
import { log } from './log';

export type MediaError = 'too_large' | 'unsupported' | 'invalid_image';

/** Erkennt das Format an den ersten Bytes (Content-Type allein ist nicht vertrauenswürdig). */
export function sniffImage(buf: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Eigene Bilder für Kacheln. Nur PNG/JPEG/WebP (kein SVG), max. 2 MB.
 * Der Helper vergibt den Dateinamen und rechnet jedes Bild in ein PNG (max. 512 px) um (sips bzw. WIC):
 * das prüft, dass es wirklich dekodierbar ist, und entfernt Metadaten.
 */
/** Dekodiert `src` und schreibt ein PNG (höchstens maxPx) nach `dst`; wirft bei ungültigem Bild. */
export type ImageConverter = (src: string, dst: string, maxPx: number) => Promise<void>;

export class MediaStore {
  private readonly convert: ImageConverter;

  /** macOS: sips. Windows: CopperDeckHelper.exe convert-image (WIC), als `convert` übergeben. */
  constructor(private readonly dir: string, exec: Exec, convert?: ImageConverter) {
    this.convert = convert ?? (async (src, dst, maxPx) => {
      await exec('/usr/bin/sips', ['-s', 'format', 'png', '-Z', String(maxPx), src, '--out', dst], { timeoutMs: 15_000 });
    });
  }

  async save(buf: Buffer): Promise<{ ok: true; file: string } | { ok: false; error: MediaError }> {
    if (buf.length > MEDIA_MAX_BYTES) return { ok: false, error: 'too_large' };
    const kind = sniffImage(buf);
    if (!kind) return { ok: false, error: 'unsupported' };
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const id = randomBytes(16).toString('hex');
    const tmp = path.join(this.dir, `.upload-${id}.${kind === 'jpeg' ? 'jpg' : kind}`);
    const file = `${id}.png`;
    try {
      await writeFile(tmp, buf, { mode: 0o600 });
      await this.convert(tmp, path.join(this.dir, file), 512);
      const st = await stat(path.join(this.dir, file));
      if (st.size === 0) throw new Error('leer');
      return { ok: true, file };
    } catch (e) {
      log('warn', 'Bild nicht dekodierbar', { error: (e as Error).message.split('\n')[0] });
      await rm(path.join(this.dir, file), { force: true });
      return { ok: false, error: 'invalid_image' };
    } finally {
      await rm(tmp, { force: true });
    }
  }

  /** Absoluter Pfad oder null (Dateiname wird streng geprüft, kein Pfad-Traversal). */
  async resolve(file: string): Promise<string | null> {
    if (!IMAGE_FILE_PATTERN.test(file)) return null;
    const p = path.join(this.dir, file);
    return stat(p).then((s) => (s.isFile() ? p : null), () => null);
  }

  /** Verweise der Konfiguration auf fehlende Bilder. */
  async missing(cfg: DeckConfig): Promise<string[]> {
    const out: string[] = [];
    for (const f of referencedImages(cfg)) if (!(await this.resolve(f))) out.push(f);
    return out;
  }

  /** Löscht nicht mehr verwendete Bilder (frische Uploads bleiben 15 Min. für das Speichern). */
  async gc(cfg: DeckConfig): Promise<void> {
    const keep = new Set(referencedImages(cfg));
    let entries: string[] = [];
    try { entries = await readdir(this.dir); } catch { return; }
    for (const f of entries) {
      if (!IMAGE_FILE_PATTERN.test(f) || keep.has(f)) continue;
      const st = await stat(path.join(this.dir, f)).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 15 * 60_000) await rm(path.join(this.dir, f), { force: true });
    }
  }
}

export function referencedImages(cfg: DeckConfig): string[] {
  const out: string[] = [];
  for (const g of cfg.groups) for (const t of g.tiles) if (t?.kind === 'action' && t.icon.type === 'image') out.push(t.icon.file);
  return out;
}
