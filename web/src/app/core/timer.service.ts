import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { TimerPreset } from '@copper-deck/shared';

export const TIMER_MINUTES: Record<TimerPreset, number> = { pomodoro: 25, break: 5 };
export const TIMER_LABEL: Record<TimerPreset, string> = { pomodoro: 'Pomodoro', break: 'Take a Break' };

export interface RunningTimer {
  readonly preset: TimerPreset;
  /** Endzeit (ms seit Epoch). Ab Meilenstein 3 vom Helper vorgegeben. */
  readonly endsAt: number;
}

/**
 * Meilenstein 1: nur lokale Anzeige-Logik.
 * Regeln: nur ein Timer; gleicher Timer erneut = stoppen; anderer Timer ersetzt den laufenden.
 */
@Injectable({ providedIn: 'root' })
export class TimerService {
  readonly running = signal<RunningTimer | null>(null);
  private readonly now = signal(Date.now());

  readonly remainingMs = computed(() => {
    const t = this.running();
    return t ? Math.max(0, t.endsAt - this.now()) : 0;
  });

  readonly display = computed(() => {
    const ms = this.remainingMs();
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  });

  constructor() {
    const id = setInterval(() => {
      this.now.set(Date.now());
      const t = this.running();
      if (t && t.endsAt <= Date.now()) this.running.set(null);
    }, 250);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }

  toggle(preset: TimerPreset): 'started' | 'stopped' {
    if (this.running()?.preset === preset) {
      this.running.set(null);
      return 'stopped';
    }
    this.now.set(Date.now());
    this.running.set({ preset, endsAt: Date.now() + TIMER_MINUTES[preset] * 60_000 });
    return 'started';
  }

  stop(): void {
    this.running.set(null);
  }
}
