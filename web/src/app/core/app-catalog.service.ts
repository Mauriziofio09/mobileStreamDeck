import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { ConnectionService } from './connection.service';

export interface CatalogEntry {
  readonly name: string;
  /** Blob-URL des Icons oder null, solange es lädt/fehlt. */
  readonly icon: string | null;
}

const ICON_CACHE = 'copperdeck-icons-v1';

/**
 * Installierte Apps (vom Helper) und deren Icons.
 * Icons sind geschützt: Abruf per fetch mit Authorization-Header (nie Token in der URL),
 * Anzeige als Blob-URL; zusätzlich in Cache Storage für die Offline-Ansicht.
 */
@Injectable({ providedIn: 'root' })
export class AppCatalogService {
  private readonly conn = inject(ConnectionService);
  private readonly auth = inject(AuthService);
  private readonly icons = signal<ReadonlyMap<string, string>>(new Map());
  private readonly requested = new Set<string>();

  private readonly installed = computed(() => {
    const apps = this.conn.apps();
    return apps ? new Map(apps.map((a) => [a.bundleId, a.name])) : null;
  });

  constructor() {
    // Icons aller in der Konfiguration verwendeten Apps vorladen.
    effect(() => {
      const cfg = this.conn.config();
      if (!cfg) return;
      const ids = new Set<string>(cfg.dock.map((d) => d.bundleId));
      for (const g of cfg.groups) {
        for (const t of g.tiles) {
          if (!t) continue;
          if (t.action.type === 'openApp') ids.add(t.action.bundleId);
          if (t.kind === 'action' && t.icon.type === 'appIcon') ids.add(t.icon.bundleId);
        }
      }
      for (const id of ids) void this.loadIcon(id);
    });
    // Nach dem (Wieder-)Verbinden fehlende Icons nachladen.
    effect(() => {
      if (!this.conn.online()) return;
      for (const id of [...this.requested]) if (!this.icons().has(id)) { this.requested.delete(id); void this.loadIcon(id); }
    });
  }

  /** Icon-URL für die App-Auswahl (lädt bei Bedarf nach). */
  iconUrl(bundleId: string): string | null {
    const u = this.icons().get(bundleId);
    if (!u) void this.loadIcon(bundleId);
    return u ?? null;
  }

  /** Alle installierten Apps (für die App-Auswahl im Editor). */
  async listInstalled(): Promise<{ bundleId: string; name: string }[]> {
    const res = await fetch('/api/apps', { headers: this.auth.authHeader() });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as { bundleId: string; name: string }[];
  }

  /** `undefined` = unbekannt (noch keine Antwort vom Helper), `null` = nicht installiert. */
  lookup(bundleId: string): CatalogEntry | null | undefined {
    const installed = this.installed();
    const icon = this.icons().get(bundleId) ?? null;
    if (!installed) return icon ? { name: '', icon } : undefined;
    const name = installed.get(bundleId);
    return name === undefined ? null : { name, icon };
  }

  private async loadIcon(bundleId: string): Promise<void> {
    if (this.requested.has(bundleId)) return;
    this.requested.add(bundleId);
    const url = `/api/icons/${encodeURIComponent(bundleId)}`;
    let blob: Blob | null = null;
    let cache: Cache | null = null;
    try {
      cache = await caches.open(ICON_CACHE);
      const hit = await cache.match(url);
      if (hit) blob = await hit.blob();
    } catch {
      /* Cache Storage nicht verfügbar */
    }
    if (!blob && this.auth.token()) {
      try {
        const res = await fetch(url, { headers: this.auth.authHeader(), cache: 'no-store' });
        if (res.ok) {
          blob = await res.blob();
          await cache?.put(url, new Response(blob, { headers: { 'content-type': 'image/png' } }));
        }
      } catch {
        /* offline */
      }
    }
    if (!blob) {
      this.requested.delete(bundleId); // später erneut versuchen
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    this.icons.update((m) => new Map(m).set(bundleId, objectUrl));
  }

  async clearCache(): Promise<void> {
    try {
      await caches.delete(ICON_CACHE);
    } catch {
      /* egal */
    }
  }
}
