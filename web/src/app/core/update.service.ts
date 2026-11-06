import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';

const CHECK_EVERY_MS = 30 * 60_000;

/**
 * App-Updates über den Service Worker.
 * Prüft beim Start, beim Zurückkehren in die App und alle 30 Minuten auf eine neue Version.
 * Ist sie geladen, erscheint ein Hinweis; "Aktualisieren" aktiviert sie und lädt neu.
 * Nie mitten in einer Aktion automatisch neu laden – der Nutzer entscheidet.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly sw = inject(SwUpdate);
  readonly available = signal(false);
  readonly enabled = this.sw.isEnabled;

  constructor() {
    if (!this.sw.isEnabled) return;
    const sub = this.sw.versionUpdates.subscribe((e: VersionEvent) => {
      if (e.type === 'VERSION_READY') this.available.set(true);
      if (e.type === 'VERSION_INSTALLATION_FAILED') console.warn('[CopperDeck] Update fehlgeschlagen', e.error);
    });
    // Defekter Cache (z. B. nach Speicherbereinigung durch iOS): sauber neu laden.
    const sub2 = this.sw.unrecoverable.subscribe(() => location.reload());
    const onVisible = () => { if (document.visibilityState === 'visible') void this.check(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
    void this.check();
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      sub2.unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    });
  }

  async check(): Promise<boolean> {
    if (!this.sw.isEnabled) return false;
    try {
      return await this.sw.checkForUpdate();
    } catch {
      return false; // offline: später erneut
    }
  }

  async apply(): Promise<void> {
    try {
      await this.sw.activateUpdate();
    } finally {
      location.reload();
    }
  }
}
