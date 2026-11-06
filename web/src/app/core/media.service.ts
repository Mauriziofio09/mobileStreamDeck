import { Injectable, inject, signal } from '@angular/core';
import type { ApiError, MediaUploadResponse } from '@copper-deck/shared';
import { MEDIA_MAX_BYTES, MEDIA_TYPES } from '@copper-deck/shared';
import { AuthService } from './auth.service';

const CACHE = 'copperdeck-media-v1';

/** Eigene Bilder: Upload und geschützter Abruf (Authorization-Header, Anzeige als Blob-URL). */
@Injectable({ providedIn: 'root' })
export class MediaService {
  private readonly auth = inject(AuthService);
  private readonly urls = signal<ReadonlyMap<string, string>>(new Map());
  private readonly requested = new Set<string>();

  /** Blob-URL oder null (lädt bei Bedarf nach). */
  url(file: string): string | null {
    const u = this.urls().get(file);
    if (!u && !this.requested.has(file)) void this.load(file);
    return u ?? null;
  }

  async upload(f: File): Promise<{ ok: true; file: string } | { ok: false; error: string }> {
    if (!(MEDIA_TYPES as readonly string[]).includes(f.type)) return { ok: false, error: 'Nur PNG, JPEG oder WebP (kein SVG).' };
    if (f.size > MEDIA_MAX_BYTES) return { ok: false, error: 'Bild ist grösser als 2 MB.' };
    try {
      const res = await fetch('/api/media', { method: 'POST', headers: { ...this.auth.authHeader(), 'content-type': f.type }, body: f });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: `Fehler ${res.status}` }))) as ApiError;
        return { ok: false, error: body.error };
      }
      const { file } = (await res.json()) as MediaUploadResponse;
      // Lokale Vorschau sofort aus der hochgeladenen Datei
      this.urls.update((m) => new Map(m).set(file, URL.createObjectURL(f)));
      return { ok: true, file };
    } catch {
      return { ok: false, error: 'Mac nicht erreichbar.' };
    }
  }

  private async load(file: string): Promise<void> {
    this.requested.add(file);
    const url = `/api/media/${encodeURIComponent(file)}`;
    let blob: Blob | null = null;
    let cache: Cache | null = null;
    try {
      cache = await caches.open(CACHE);
      blob = (await (await cache.match(url))?.blob()) ?? null;
    } catch {
      /* kein Cache Storage */
    }
    if (!blob) {
      try {
        const res = await fetch(url, { headers: this.auth.authHeader() });
        if (res.ok) {
          blob = await res.blob();
          await cache?.put(url, new Response(blob, { headers: { 'content-type': 'image/png' } }));
        }
      } catch {
        /* offline */
      }
    }
    if (!blob) {
      setTimeout(() => this.requested.delete(file), 5000);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    this.urls.update((m) => new Map(m).set(file, objectUrl));
  }
}
