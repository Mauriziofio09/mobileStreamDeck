import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { TimerPreset } from '@copper-deck/shared';
import { ConnectionService } from './connection.service';

export const TIMER_MINUTES: Record<TimerPreset, number> = { pomodoro: 25, break: 5 };
export const TIMER_LABEL: Record<TimerPreset, string> = { pomodoro: 'Pomodoro', break: 'Take a Break' };

/**
 * Anzeige des Timers. Zustand und Endzeit kommen vom Helper (für alle Geräte gleich);
 * lokal wird nur heruntergezählt, korrigiert um die Uhrabweichung zum Mac.
 */
@Injectable({ providedIn: 'root' })
export class TimerService {
  private readonly conn = inject(ConnectionService);
  private readonly now = signal(Date.now());

  readonly running = computed(() => {
    const t = this.conn.timer();
    return t && t.endsAt > this.now() + this.conn.clockOffset() ? t : null;
  });

  readonly remainingMs = computed(() => {
    const t = this.running();
    return t ? Math.max(0, t.endsAt - (this.now() + this.conn.clockOffset())) : 0;
  });

  readonly display = computed(() => {
    const total = Math.ceil(this.remainingMs() / 1000);
    return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
  });

  constructor() {
    const id = setInterval(() => this.now.set(Date.now()), 250);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }
}
