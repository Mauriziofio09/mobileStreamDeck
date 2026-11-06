import type { PermissionKind, PermissionState, PermissionStatus } from '@copper-deck/shared';
import { log } from './log';
import type { Native } from './native';

const POLL_MISSING_MS = 3000;
const POLL_OK_MS = 60_000;

/**
 * Prüft Bedienungshilfen, Automation (System Events) und Mitteilungen über das App-Bundle.
 * Beim Start, nach jedem passenden Fehler und – solange etwas fehlt – alle 3 s,
 * damit die App automatisch erkennt, wenn die Berechtigung erteilt wurde.
 */
export class PermissionMonitor {
  private state: PermissionState;
  private timer: NodeJS.Timeout | null = null;
  private checking: Promise<PermissionState> | null = null;
  private readonly listeners = new Set<(s: PermissionState) => void>();

  constructor(private readonly native: Native, private readonly context: 'app' | 'terminal') {
    this.state = { accessibility: 'unknown', automation: 'unknown', notifications: 'unknown', context, checkedAt: new Date(0).toISOString() };
  }

  get(): PermissionState {
    return this.state;
  }

  allGranted(s = this.state): boolean {
    return s.accessibility === 'granted' && s.automation === 'granted' && s.notifications === 'granted';
  }

  onChange(fn: (s: PermissionState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Beim Start: Bundle in die Bedienungshilfen-Liste eintragen und Mitteilungen anfragen (einmalige Dialoge am Mac). */
  async start(prompt: boolean): Promise<void> {
    await this.check(prompt ? ['--prompt-ax', '--request-notifications'] : []);
    this.loop();
  }

  async check(extra: readonly string[] = []): Promise<PermissionState> {
    this.checking ??= (async () => {
      const r = await this.native.call(['permissions', ...extra], extra.length ? 90_000 : 15_000);
      const st = (v: unknown): PermissionStatus =>
        v === 'granted' || v === 'missing' || v === 'notDetermined' ? v : 'unknown';
      const next: PermissionState = r.ok
        ? { accessibility: st(r['accessibility']), automation: st(r['automation']), notifications: st(r['notifications']), context: this.context, checkedAt: new Date().toISOString() }
        : { ...this.state, checkedAt: new Date().toISOString() };
      const changed = (['accessibility', 'automation', 'notifications'] as const).some((k) => next[k] !== this.state[k]);
      this.state = next;
      if (changed) {
        log('info', 'Berechtigungen', { accessibility: next.accessibility, automation: next.automation, notifications: next.notifications, context: next.context });
        for (const l of this.listeners) l(next);
      }
      return next;
    })().finally(() => (this.checking = null));
    return this.checking;
  }

  /** Nach einem Berechtigungsfehler sofort neu prüfen. */
  report(kind: PermissionKind): void {
    log('warn', 'Berechtigung fehlt laut Fehlermeldung', { kind });
    void this.check();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  private loop(): void {
    const delay = this.allGranted() ? POLL_OK_MS : POLL_MISSING_MS;
    this.timer = setTimeout(() => void this.check().finally(() => this.loop()), delay);
  }
}
