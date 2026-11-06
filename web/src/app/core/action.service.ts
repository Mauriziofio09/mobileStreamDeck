import { Injectable, inject } from '@angular/core';
import { Action } from '@copper-deck/shared';
import { AppCatalogService } from './app-catalog.service';
import { TimerService } from './timer.service';

export type ActionResult =
  | { readonly ok: true; readonly message?: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Meilenstein 1: simuliert Antworten, damit sich das UI-Feedback (Erfolg/Fehler) prüfen lässt.
 * Ab Meilenstein 2 geht jede Aktion mit Request-ID über WebSocket an den Helper.
 */
@Injectable({ providedIn: 'root' })
export class ActionService {
  private readonly catalog = inject(AppCatalogService);
  private readonly timers = inject(TimerService);

  async run(action: Action): Promise<ActionResult> {
    await new Promise((r) => setTimeout(r, 220));
    if (action.type === 'openApp' && this.catalog.lookup(action.bundleId) === null) {
      return { ok: false, reason: 'App ist auf dem Mac nicht installiert.' };
    }
    if (action.type === 'timer') {
      const r = this.timers.toggle(action.preset);
      return { ok: true, message: r === 'started' ? 'Timer gestartet' : 'Timer gestoppt' };
    }
    return { ok: true };
  }
}
