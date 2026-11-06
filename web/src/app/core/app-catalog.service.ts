import { Injectable, signal } from '@angular/core';
import { DockItem } from '@copper-deck/shared';

interface CatalogEntry {
  readonly name: string;
  readonly icon: string | null;
}

interface CatalogFile {
  readonly apps: Record<string, CatalogEntry>;
  readonly dock: string[];
}

/**
 * Meilenstein 1: liest den lokal erzeugten Icon-Index (npm run icons).
 * Später liefert der Helper diese Daten.
 */
@Injectable({ providedIn: 'root' })
export class AppCatalogService {
  readonly loaded = signal(false);
  /** Index konnte nicht geladen werden: Verfügbarkeit unbekannt, nichts als "nicht installiert" markieren. */
  private readonly failed = signal(false);
  private readonly apps = signal<Record<string, CatalogEntry>>({});
  readonly dock = signal<DockItem[]>([]);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const res = await fetch('app-icons/index.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as CatalogFile;
      this.apps.set(data.apps);
      this.dock.set(
        data.dock
          .filter((id) => data.apps[id])
          .map((id) => ({ id: `d-${id}`, bundleId: id, label: data.apps[id]!.name })),
      );
    } catch {
      this.failed.set(true);
      console.warn('[CopperDeck] app-icons/index.json fehlt – "npm run icons" ausführen.');
    } finally {
      this.loaded.set(true);
    }
  }

  /** `undefined` = noch unbekannt, `null` = nicht installiert. */
  lookup(bundleId: string): CatalogEntry | null | undefined {
    if (!this.loaded() || this.failed()) return undefined;
    return this.apps()[bundleId] ?? null;
  }
}
