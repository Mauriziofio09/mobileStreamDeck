import { Injectable, computed, signal } from '@angular/core';
import type { HostPlatform, PlatformInfo } from '@copper-deck/shared';

const KEY = 'copperdeck.platform';

/**
 * Auf welchem System läuft der Helper (Mac oder Windows-PC)? Bestimmt Texte, Tastennamen und
 * verfügbare Aktionen. Kommt aus GET /api/platform (auch ungekoppelt) und aus der ready-Nachricht.
 */
@Injectable({ providedIn: 'root' })
export class PlatformService {
  readonly platform = signal<HostPlatform>(readCached());
  readonly isWindows = computed(() => this.platform() === 'windows');
  /** "Mac" bzw. "PC" für Texte. */
  readonly host = computed(() => (this.isWindows() ? 'PC' : 'Mac'));

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const res = await fetch('/api/platform', { cache: 'no-store' });
      if (res.ok) this.set(((await res.json()) as PlatformInfo).platform);
    } catch {
      /* offline: zuletzt bekannter Wert bleibt */
    }
  }

  set(p: HostPlatform): void {
    if (p !== 'mac' && p !== 'windows') return;
    this.platform.set(p);
    try { localStorage.setItem(KEY, p); } catch { /* privater Modus */ }
  }
}

function readCached(): HostPlatform {
  try {
    return localStorage.getItem(KEY) === 'windows' ? 'windows' : 'mac';
  } catch {
    return 'mac';
  }
}
