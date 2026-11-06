import { access, mkdir, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { InstalledApp } from '@copper-deck/shared';
import { BUNDLE_ID_PATTERN } from '@copper-deck/shared/schema';
import type { Exec } from './exec';
import { log } from './log';

export const APP_DIRS = [
  '/Applications',
  path.join(homedir(), 'Applications'),
  '/System/Applications',
  '/System/Library/CoreServices',
];

const ICON_PX = 256;
const RESCAN_MS = 60_000;

interface AppEntry extends InstalledApp {
  readonly appPath: string;
}

const exists = (p: string): Promise<boolean> => access(p).then(() => true, () => false);

/**
 * Katalog installierter Apps + Icon-Cache (PNG).
 * Icons: sips aus der .icns; liegt das aktuelle Icon in Assets.car (CFBundleIconName),
 * oder fehlt eine .icns, rendert das native Programm (Copper Deck Helper.app) das Icon über NSWorkspace.
 */
export class AppCatalog {
  private apps = new Map<string, AppEntry>();
  private scannedAt = 0;
  private scanning: Promise<void> | null = null;
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor(
    private readonly exec: Exec,
    private readonly opts: { iconCache: string; nativeBinary: string | null; dirs?: readonly string[] },
  ) {}

  async list(): Promise<InstalledApp[]> {
    await this.ensureScanned();
    return [...this.apps.values()]
      .map(({ bundleId, name }) => ({ bundleId, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  async get(bundleId: string): Promise<InstalledApp | null> {
    await this.ensureScanned();
    const a = this.apps.get(bundleId);
    return a ? { bundleId: a.bundleId, name: a.name } : null;
  }

  async rescan(): Promise<void> {
    this.scannedAt = 0;
    await this.ensureScanned();
  }

  private async ensureScanned(): Promise<void> {
    if (Date.now() - this.scannedAt < RESCAN_MS) return;
    this.scanning ??= this.scan().finally(() => {
      this.scanning = null;
    });
    await this.scanning;
  }

  private async scan(): Promise<void> {
    const found = new Map<string, AppEntry>();
    for (const dir of this.opts.dirs ?? APP_DIRS) {
      for (const p of await listApps(dir)) {
        const entry = await this.describe(p);
        if (entry && !found.has(entry.bundleId)) found.set(entry.bundleId, entry);
      }
    }
    this.apps = found;
    this.scannedAt = Date.now();
  }

  private async plist(appPath: string, key: string): Promise<string | null> {
    try {
      const { stdout } = await this.exec('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path.join(appPath, 'Contents/Info.plist')]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async describe(linkPath: string): Promise<AppEntry | null> {
    // Symlinks (z. B. Safari -> Cryptex) auflösen, sonst zeichnet NSWorkspace ein Alias-Badge.
    const appPath = await realpath(linkPath).catch(() => linkPath);
    const bundleId = await this.plist(appPath, 'CFBundleIdentifier');
    if (!bundleId || !BUNDLE_ID_PATTERN.test(bundleId)) return null;
    let name = path.basename(linkPath, '.app');
    try {
      // Lokalisierter Anzeigename (z. B. "Bücher")
      const { stdout } = await this.exec('/usr/bin/mdls', ['-name', 'kMDItemDisplayName', '-raw', appPath]);
      if (stdout && stdout !== '(null)') name = stdout.replace(/\.app$/, '');
    } catch {
      /* Spotlight aus: Ordnername genügt */
    }
    return { bundleId, name, appPath };
  }

  /** Pfad zum gecachten PNG oder null, wenn die App nicht installiert ist. */
  async icon(bundleId: string): Promise<string | null> {
    if (!BUNDLE_ID_PATTERN.test(bundleId)) return null;
    const file = path.join(this.opts.iconCache, `${bundleId}.png`);
    if (await exists(file)) return file;
    let job = this.inflight.get(bundleId);
    if (!job) {
      job = this.extract(bundleId, file).finally(() => this.inflight.delete(bundleId));
      this.inflight.set(bundleId, job);
    }
    return job;
  }

  private async extract(bundleId: string, file: string): Promise<string | null> {
    await this.ensureScanned();
    const app = this.apps.get(bundleId);
    if (!app) return null;
    await mkdir(this.opts.iconCache, { recursive: true, mode: 0o700 });
    const res = path.join(app.appPath, 'Contents/Resources');
    const iconName = await this.plist(app.appPath, 'CFBundleIconName');
    const hasCar = await exists(path.join(res, 'Assets.car'));
    let iconFile = await this.plist(app.appPath, 'CFBundleIconFile');
    if (iconFile && !iconFile.endsWith('.icns')) iconFile += '.icns';
    const icns = iconFile ? path.join(res, path.basename(iconFile)) : null;
    try {
      if (icns && (await exists(icns)) && !(iconName && hasCar)) {
        await this.exec('/usr/bin/sips', ['-s', 'format', 'png', '-Z', String(ICON_PX), icns, '--out', file]);
      } else {
        if (!this.opts.nativeBinary) throw new Error('Copper Deck Helper.app fehlt (NSWorkspace-Fallback)');
        await this.exec(this.opts.nativeBinary, ['app-icon', app.appPath, file, String(ICON_PX)], { timeoutMs: 20_000 });
      }
      return file;
    } catch (e) {
      log('warn', `Icon für ${bundleId} nicht extrahierbar`, { error: (e as Error).message.split('\n')[0] });
      return null;
    }
  }

}

async function listApps(dir: string, depth = 0): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.name.endsWith('.app')) out.push(p);
    else if (e.isDirectory() && depth < 1 && !e.name.startsWith('.')) out.push(...(await listApps(p, depth + 1)));
  }
  return out;
}

/** Dock-Vorschlag: Apps aus dem echten Dock, dann zuletzt verwendete, dann Ergänzungen. */
export async function suggestDock(exec: Exec, catalog: AppCatalog, max = 12): Promise<{ bundleId: string; name: string }[]> {
  const ids: string[] = [];
  for (const key of ['persistent-apps', 'recent-apps']) {
    try {
      const { stdout } = await exec('/usr/bin/defaults', ['read', 'com.apple.dock', key]);
      for (const m of stdout.matchAll(/"bundle-identifier" = "([^"]+)"/g)) if (m[1]) ids.push(m[1]);
    } catch {
      /* Schlüssel fehlt */
    }
  }
  ids.push('com.google.Chrome', 'com.microsoft.VSCode', 'com.hnc.Discord', 'net.whatsapp.WhatsApp', 'com.apple.Terminal');
  const out: { bundleId: string; name: string }[] = [];
  for (const id of ids) {
    if (out.length >= max || out.some((o) => o.bundleId === id)) continue;
    const app = await catalog.get(id);
    if (app) out.push({ bundleId: app.bundleId, name: app.name });
  }
  return out;
}
