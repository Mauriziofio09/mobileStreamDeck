import { createHash } from 'node:crypto';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { InstalledApp } from '@copper-deck/shared';
import { APP_ID_PATTERN } from '@copper-deck/shared/schema';
import type { AppCatalog } from './apps';
import { log } from './log';
import type { Native } from './native';

const ICON_PX = '256';
const RESCAN_MS = 60_000;

/** Dateiname im Icon-Cache: AppUserModelIDs enthalten \ ! { } und sind damit keine Dateinamen. */
export const iconFileName = (id: string): string => `${createHash('sha256').update(id).digest('hex').slice(0, 32)}.png`;

/**
 * Windows: alle Einträge von shell:AppsFolder (Startmenü inkl. Store-Apps, wie Get-StartApps).
 * Ein Programm, das dort fehlt, erscheint nach `copper-deck add-app <pfad.exe>` (Verknüpfung im Startmenü).
 */
export class WindowsAppCatalog implements AppCatalog {
  private apps = new Map<string, InstalledApp>();
  private scannedAt = 0;
  private scanning: Promise<void> | null = null;
  private readonly inflight = new Map<string, Promise<string | null>>();
  private running = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly native: Native, private readonly iconCache: string) {}

  async list(): Promise<InstalledApp[]> {
    await this.ensureScanned();
    return [...this.apps.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  async get(id: string): Promise<InstalledApp | null> {
    await this.ensureScanned();
    return this.apps.get(id.toLowerCase()) ?? null;
  }

  async rescan(): Promise<void> {
    this.scannedAt = 0;
    await this.ensureScanned();
  }

  async icon(id: string): Promise<string | null> {
    if (!APP_ID_PATTERN.test(id)) return null;
    const app = await this.get(id);
    if (!app) return null;
    const file = path.join(this.iconCache, iconFileName(app.bundleId));
    if (await access(file).then(() => true, () => false)) return file;
    let job = this.inflight.get(file);
    if (!job) {
      job = this.slot(() => this.extract(app.bundleId, file)).finally(() => this.inflight.delete(file));
      this.inflight.set(file, job);
    }
    return job;
  }

  private async extract(id: string, file: string): Promise<string | null> {
    await mkdir(this.iconCache, { recursive: true });
    const r = await this.native.call(['app-icon', id, file, ICON_PX], 20_000);
    if (r.ok) return file;
    log('warn', `Icon für ${id} nicht extrahierbar`, { error: String(r.error ?? '') });
    return null;
  }

  /** Höchstens 4 Icon-Extraktionen gleichzeitig. */
  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= 4) await new Promise<void>((r) => this.queue.push(r));
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.queue.shift()?.();
    }
  }

  private async ensureScanned(): Promise<void> {
    if (Date.now() - this.scannedAt < RESCAN_MS) return;
    this.scanning ??= this.scan().finally(() => (this.scanning = null));
    await this.scanning;
  }

  private async scan(): Promise<void> {
    const r = await this.native.call(['list-apps'], 30_000);
    if (!r.ok || !Array.isArray(r['apps'])) {
      log('warn', 'App-Liste nicht lesbar', { error: String(r.error ?? '') });
      this.scannedAt = Date.now() - RESCAN_MS + 5_000; // in 5 s erneut versuchen
      return;
    }
    const found = new Map<string, InstalledApp>();
    for (const a of r['apps'] as { id?: unknown; name?: unknown }[]) {
      if (typeof a.id !== 'string' || typeof a.name !== 'string' || !APP_ID_PATTERN.test(a.id)) continue;
      const name = a.name.trim();
      if (!name) continue;
      // IDs sind unter Windows unabhängig von Gross-/Kleinschreibung.
      if (!found.has(a.id.toLowerCase())) found.set(a.id.toLowerCase(), { bundleId: a.id, name });
    }
    this.apps = found;
    this.scannedAt = Date.now();
  }
}

/** Dock-Vorschlag unter Windows: häufige Apps, sofern installiert. */
const DOCK_PREFS: readonly RegExp[] = [
  /^Microsoft\.Windows\.Explorer$/i, /^MSEdge$/i, /^Chrome$/i, /firefox/i, /^(Microsoft )?Outlook/i, /^(Microsoft )?Teams/i,
  /^Spotify$/i, /^Discord$/i, /^Visual Studio Code$/i, /^WhatsApp$/i, /^Lightroom Classic$/i, /^Adobe Lightroom Classic$/i,
  /^Word$/i, /^Excel$/i, /^Microsoft\.WindowsTerminal_/i,
];

export async function suggestDockWindows(catalog: AppCatalog, max = 12): Promise<InstalledApp[]> {
  const apps = await catalog.list();
  const out: InstalledApp[] = [];
  for (const re of DOCK_PREFS) {
    if (out.length >= max) break;
    const a = apps.find((x) => (re.test(x.bundleId) || re.test(x.name)) && !out.includes(x));
    if (a) out.push(a);
  }
  return out;
}
