import type { TimerPreset, TimerState } from '@copper-deck/shared';
import { z } from 'zod';
import { readJson, writeFileAtomic } from './fsutil';
import { log } from './log';

export const TIMER_MINUTES: Record<TimerPreset, number> = { pomodoro: 25, break: 5 };
const TITLES: Record<TimerPreset, [string, string]> = {
  pomodoro: ['Pomodoro beendet', '25 Minuten geschafft – Zeit für eine Pause.'],
  break: ['Pause vorbei', 'Die 5 Minuten Pause sind um.'],
};

const fileSchema = z.object({
  preset: z.enum(['pomodoro', 'break']),
  startedAt: z.number(),
  endsAt: z.number(),
}).nullable();

/**
 * Ein einziger Timer. Der Helper speichert die Endzeit (timer.json), damit alle Geräte
 * denselben Countdown zeigen und ein Neustart den Timer nicht verliert.
 */
export class TimerManager {
  private state: TimerState | null = null;
  private handle: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<(s: TimerState | null) => void>();

  constructor(
    private readonly file: string,
    private readonly notify: (title: string, body: string) => Promise<boolean>,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<void> {
    const parsed = fileSchema.safeParse(await readJson(this.file) ?? null);
    const s = parsed.success ? parsed.data : null;
    if (!s) return;
    if (s.endsAt <= this.now()) {
      // Während der Helper aus war abgelaufen: Mitteilung nachholen, wenn es nicht lange her ist.
      await this.persist(null);
      if (this.now() - s.endsAt < 15 * 60_000) await this.fire(s.preset, true);
      return;
    }
    this.state = s;
    this.schedule();
    log('info', 'Timer wiederhergestellt', { preset: s.preset, endsAt: new Date(s.endsAt).toISOString() });
  }

  get(): TimerState | null {
    return this.state;
  }

  /** Gleicher Timer erneut = stoppen; anderer Timer ersetzt den laufenden. */
  async toggle(preset: TimerPreset): Promise<'started' | 'stopped' | 'replaced'> {
    const prev = this.state;
    if (prev?.preset === preset) {
      await this.set(null);
      return 'stopped';
    }
    const now = this.now();
    await this.set({ preset, startedAt: now, endsAt: now + TIMER_MINUTES[preset] * 60_000 });
    return prev ? 'replaced' : 'started';
  }

  async stop(): Promise<boolean> {
    if (!this.state) return false;
    await this.set(null);
    return true;
  }

  onChange(fn: (s: TimerState | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose(): void {
    if (this.handle) clearTimeout(this.handle);
  }

  private async set(s: TimerState | null): Promise<void> {
    this.state = s;
    await this.persist(s);
    this.schedule();
    for (const l of this.listeners) l(s);
  }

  private schedule(): void {
    if (this.handle) clearTimeout(this.handle);
    this.handle = null;
    const s = this.state;
    if (!s) return;
    // setTimeout ist auf ~24,8 Tage begrenzt; Timer hier sind max. 25 Min.
    this.handle = setTimeout(() => void this.expire(s), Math.max(0, s.endsAt - this.now()));
  }

  private async expire(s: TimerState): Promise<void> {
    if (this.state !== s) return;
    await this.set(null);
    await this.fire(s.preset, false);
  }

  private async fire(preset: TimerPreset, late: boolean): Promise<void> {
    const [title, body] = TITLES[preset];
    const ok = await this.notify(title, late ? `${body} (Helper war beim Ablauf nicht aktiv.)` : body);
    log(ok ? 'info' : 'warn', 'Timer abgelaufen', { preset, notified: ok });
  }

  private async persist(s: TimerState | null): Promise<void> {
    await writeFileAtomic(this.file, JSON.stringify(s), { mode: 0o600 });
  }
}
