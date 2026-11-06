import type { Action, DeckConfig, ErrorCode } from '@copper-deck/shared';
import { actionSchema, BUNDLE_ID_PATTERN } from '@copper-deck/shared/schema';
import { ExecError, type Exec } from '../exec';
import { log } from '../log';

export type RunResult =
  | { readonly ok: true; readonly message?: string }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

const fail = (code: ErrorCode, message: string): RunResult => ({ ok: false, code, message });

/** Findet die Aktion zu einer ID (Kachel, Dock-Eintrag oder Emoji) in der aktuellen Konfiguration. */
export function resolveAction(config: DeckConfig, actionId: string): Action | null {
  for (const g of config.groups) for (const t of g.tiles) if (t && t.id === actionId) return t.action;
  const dock = config.dock.find((d) => d.id === actionId);
  if (dock) return { type: 'openApp', bundleId: dock.bundleId };
  const emoji = config.emojis.find((e) => e.id === actionId);
  if (emoji) return { type: 'insertEmoji', emoji: emoji.emoji };
  return null;
}

/**
 * Führt streng typisierte Aktionen aus. Alle Prozesse über execFile mit Argument-Array.
 * Meilenstein 2: openApp und openUrl. Der Rest folgt in Meilenstein 3.
 */
export class ActionRunner {
  constructor(private readonly exec: Exec) {}

  async run(action: Action): Promise<RunResult> {
    // Zweite Prüfung direkt vor der Ausführung (Konfiguration wurde bereits beim Laden geprüft).
    const parsed = actionSchema.safeParse(action);
    if (!parsed.success) return fail('invalid_request', 'Aktion ist ungültig.');
    const a = parsed.data;
    switch (a.type) {
      case 'openApp':
        return this.openApp(a.bundleId);
      case 'openUrl':
        return this.openUrl(a.url);
      default:
        return fail('not_implemented', 'Diese Aktion ist noch nicht verfügbar (Meilenstein 3).');
    }
  }

  /** "open -b" statt App-Namen, weil Namen lokalisiert sind (Bücher/Books). */
  private async openApp(bundleId: string): Promise<RunResult> {
    if (!BUNDLE_ID_PATTERN.test(bundleId)) return fail('invalid_request', 'Ungültige Bundle-ID.');
    try {
      await this.exec('/usr/bin/open', ['-b', bundleId]);
      return { ok: true };
    } catch (e) {
      const err = e as ExecError;
      if (err.timedOut) return fail('timeout', 'Die App hat nicht rechtzeitig reagiert.');
      if (/Unable to find application|LSCopyApplicationURLsForBundleIdentifier|-10814/i.test(err.stderr ?? '')) {
        return fail('app_not_found', 'Diese App ist auf dem Mac nicht installiert.');
      }
      log('warn', 'open -b fehlgeschlagen', { bundleId, stderr: err.stderr?.slice(0, 200) });
      return fail('exec_failed', 'Die App konnte nicht geöffnet werden.');
    }
  }

  /** Öffnet im Standardbrowser. Nur http/https (bereits per Schema geprüft, hier nochmals). */
  private async openUrl(url: string): Promise<RunResult> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return fail('invalid_url', 'Der Link ist ungültig.');
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fail('invalid_url', 'Nur http- und https-Links sind erlaubt.');
    try {
      await this.exec('/usr/bin/open', [u.href]);
      return { ok: true };
    } catch (e) {
      const err = e as ExecError;
      log('warn', 'open URL fehlgeschlagen', { stderr: err.stderr?.slice(0, 200) });
      return fail(err.timedOut ? 'timeout' : 'exec_failed', 'Der Link konnte nicht geöffnet werden.');
    }
  }
}
