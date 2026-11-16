import type { HotkeyKey, Modifier } from '@copper-deck/shared';
import { APP_ID_PATTERN } from '@copper-deck/shared/schema';
import type { AppCatalog } from '../apps';
import { log } from '../log';
import type { Native, NativeResult } from '../native';
import type { RunResult } from './runner';

const fail = (code: Extract<RunResult, { ok: false }>['code'], message: string): RunResult => ({ ok: false, code, message });

/**
 * Aktionen unter Windows über CopperDeckHelper.exe (SendInput, Shell, Win32).
 * Windows hat keine Berechtigungsdialoge wie macOS. Eine Grenze gibt es aber: Eingaben in Fenster,
 * die als Administrator laufen, blockiert Windows (UIPI); das native Programm erkennt das und meldet es.
 */
export class WindowsActions {
  constructor(private readonly native: Native, private readonly catalog: AppCatalog) {}

  /** Nur Apps aus dem eigenen Katalog (shell:AppsFolder) – nie beliebige Pfade vom Gerät. */
  async openApp(id: string): Promise<RunResult> {
    if (!APP_ID_PATTERN.test(id)) return fail('invalid_request', 'Ungültige App-Kennung.');
    const app = await this.catalog.get(id);
    if (!app) return fail('app_not_found', 'Diese App ist auf dem PC nicht installiert.');
    const r = await this.native.call(['launch', app.bundleId], 15_000);
    if (r.ok) {
      return r['activated'] === true && r['foreground'] === false
        ? { ok: true, message: `${app.name} läuft schon, Windows hat das Fenster aber nicht nach vorne gelassen.` }
        : { ok: true };
    }
    return this.failure(r, 'Die App konnte nicht geöffnet werden.');
  }

  async openUrl(url: string): Promise<RunResult> {
    const r = await this.native.call(['open-url', url], 10_000);
    return r.ok ? { ok: true } : this.failure(r, 'Der Link konnte nicht geöffnet werden.');
  }

  async hotkey(modifiers: readonly Modifier[], key: HotkeyKey): Promise<RunResult> {
    const r = await this.native.call(['hotkey', key, ...modifiers], 8_000);
    return r.ok ? { ok: true } : this.failure(r, 'Tastenkombination konnte nicht gesendet werden.');
  }

  /** Emoji direkt als Unicode-Eingabe – die Zwischenablage bleibt unberührt. */
  async insertEmoji(emoji: string): Promise<RunResult> {
    const r = await this.native.call(['insert-text', emoji], 8_000);
    return r.ok ? { ok: true } : this.failure(r, 'Emoji konnte nicht eingefügt werden.');
  }

  async tileWindows(): Promise<RunResult> {
    const r = await this.native.call(['tile-windows'], 15_000);
    if (!r.ok) return this.failure(r, 'Fenster konnten nicht angeordnet werden.');
    const windows = (r['windows'] as { app: string; title: string; ok: boolean; reason: string }[] | undefined) ?? [];
    if (windows.length === 0) return { ok: true, message: 'Keine sichtbaren Fenster gefunden.' };
    const failed = windows.filter((w) => !w.ok);
    const details = failed.map((w) => `${w.app}${w.title ? ` – ${w.title}` : ''}: ${w.reason}`);
    const done = windows.length - failed.length;
    return {
      ok: true,
      message: failed.length === 0 ? `${done} Fenster angeordnet.` : `${done} von ${windows.length} angeordnet. Nicht anpassbar: ${details.join('; ')}`,
      details,
    };
  }

  private failure(r: NativeResult, fallback: string): RunResult {
    if (r.error === 'native_missing') return fail('exec_failed', 'CopperDeckHelper.exe fehlt – bitte install.ps1 ausführen.');
    if (r.error === 'timeout') return fail('timeout', `${fallback} (Zeitüberschreitung)`);
    if (r.error === 'app_not_found') return fail('app_not_found', 'Diese App ist auf dem PC nicht installiert.');
    if (r.error === 'invalid_url') return fail('invalid_url', String(r['message'] ?? 'Der Link ist ungültig.'));
    if (r.error === 'elevated') return fail('permission_denied', String(r['message'] ?? 'Das Fenster im Vordergrund läuft als Administrator.'));
    log('warn', fallback, { error: String(r.error ?? '').slice(0, 300) });
    return fail('exec_failed', fallback);
  }
}
