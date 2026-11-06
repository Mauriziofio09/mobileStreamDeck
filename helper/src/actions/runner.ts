import type { Action, DeckConfig, ErrorCode, HotkeyKey, Modifier, PermissionKind, SystemActionId } from '@copper-deck/shared';
import { SYSTEM_ACTIONS } from '@copper-deck/shared';
import { actionSchema, BUNDLE_ID_PATTERN } from '@copper-deck/shared/schema';
import { ExecError, type Exec } from '../exec';
import { log } from '../log';
import type { Native } from '../native';
import type { PermissionMonitor } from '../permissions';
import type { TimerManager } from '../timer';

export type RunResult =
  | { readonly ok: true; readonly message?: string; readonly details?: readonly string[] }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string; readonly permission?: PermissionKind };

const fail = (code: ErrorCode, message: string, permission?: PermissionKind): RunResult =>
  permission ? { ok: false, code, message, permission } : { ok: false, code, message };

export const PERMISSION_TEXT: Record<PermissionKind, string> = {
  accessibility: 'Bedienungshilfen fehlen: Systemeinstellungen → Datenschutz & Sicherheit → Bedienungshilfen → „Copper Deck Helper“ einschalten.',
  automation: 'Automation fehlt: Systemeinstellungen → Datenschutz & Sicherheit → Automation → „Copper Deck Helper“ → „System Events“ einschalten.',
  notifications: 'Mitteilungen sind aus: Systemeinstellungen → Mitteilungen → „Copper Deck Helper“ → Mitteilungen erlauben.',
};

/**
 * Tasten mit festem Keycode: Sondertasten und Ziffern (die Ziffernreihe liegt auf QWERTZ/QWERTY
 * an denselben physischen Tasten; "keystroke" ignoriert dort Shift). Buchstaben laufen über
 * "keystroke", das dem aktiven Layout folgt (Schweizerdeutsch: Z und Y vertauscht).
 */
const KEY_CODES: Partial<Record<HotkeyKey, number>> = {
  '1': 18, '2': 19, '3': 20, '4': 21, '5': 23, '6': 22, '7': 26, '8': 28, '9': 25, '0': 29,
  space: 49, return: 36, tab: 48, escape: 53, delete: 51, forwarddelete: 117,
  up: 126, down: 125, left: 123, right: 124, home: 115, end: 119, pageup: 116, pagedown: 121,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
};

/** Findet die Aktion zu einer ID (Kachel, Dock-Eintrag oder Emoji) in der aktuellen Konfiguration. */
export function resolveAction(config: DeckConfig, actionId: string): Action | null {
  for (const g of config.groups) for (const t of g.tiles) if (t && t.id === actionId) return t.action;
  const dock = config.dock.find((d) => d.id === actionId);
  if (dock) return { type: 'openApp', bundleId: dock.bundleId };
  const emoji = config.emojis.find((e) => e.id === actionId);
  if (emoji) return { type: 'insertEmoji', emoji: emoji.emoji };
  return null;
}

export function isSystemAction(id: string): id is SystemActionId {
  return (SYSTEM_ACTIONS as readonly string[]).includes(id);
}

/** Wertet osascript-Fehler aus: fehlende Automation (-1743) bzw. Bedienungshilfen (1002/-1719/-25211). */
export function classifyAppleScriptError(stderr: string): PermissionKind | null {
  if (/-1743|not authori[sz]ed to send Apple events|nicht berechtigt.*Apple-Events/i.test(stderr)) return 'automation';
  if (/\(1002\)|-1719|-25211|assistive access|Hilfszugriff|Bedienungshilfen|not allowed to send keystrokes/i.test(stderr)) return 'accessibility';
  return null;
}

export interface RunnerDeps {
  readonly exec: Exec;
  readonly native: Native;
  readonly timers: TimerManager;
  readonly permissions: PermissionMonitor;
  readonly keystrokeScript: string;
  readonly activateScript: string;
}

/**
 * Führt streng typisierte Aktionen aus. Alle Prozesse über execFile mit Argument-Array,
 * AppleScript-Werte nur als argv.
 */
export class ActionRunner {
  constructor(private readonly d: RunnerDeps) {}

  async run(action: Action): Promise<RunResult> {
    // Zweite Prüfung direkt vor der Ausführung.
    const parsed = actionSchema.safeParse(action);
    if (!parsed.success) return fail('invalid_request', 'Aktion ist ungültig.');
    const a = parsed.data;
    switch (a.type) {
      case 'openApp': return this.openApp(a.bundleId);
      case 'openUrl': return this.openUrl(a.url);
      case 'hotkey': return this.hotkey(a.modifiers, a.key);
      case 'tileWindows': return this.tileWindows();
      case 'stageManager': return this.toggleStageManager();
      case 'timer': return this.timer(a.preset);
      case 'insertEmoji': return this.insertEmoji(a.emoji);
    }
  }

  async runSystem(id: SystemActionId): Promise<RunResult> {
    switch (id) {
      case 'sys-timer-pomodoro': return this.timer('pomodoro');
      case 'sys-timer-break': return this.timer('break');
      case 'sys-timer-stop':
        return (await this.d.timers.stop()) ? { ok: true, message: 'Timer gestoppt.' } : { ok: true, message: 'Es läuft kein Timer.' };
      case 'sys-settings-accessibility':
        return this.openSettings('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
      case 'sys-settings-automation':
        return this.openSettings('x-apple.systempreferences:com.apple.preference.security?Privacy_Automation');
      case 'sys-settings-notifications':
        return this.openSettings('x-apple.systempreferences:com.apple.Notifications-Settings.extension');
      case 'sys-request-permissions': {
        // Zeigt die Systemdialoge am Mac (Automation fragt nur, solange noch nicht entschieden).
        const s = await this.d.permissions.check(['--prompt-ax', '--prompt-automation', '--request-notifications']);
        return { ok: true, message: this.d.permissions.allGranted(s) ? 'Alle Berechtigungen erteilt.' : 'Dialoge am Mac beantworten bzw. Einstellungen öffnen.' };
      }
    }
  }

  /** "open -b" statt App-Namen, weil Namen lokalisiert sind (Bücher/Books). */
  private async openApp(bundleId: string): Promise<RunResult> {
    if (!BUNDLE_ID_PATTERN.test(bundleId)) return fail('invalid_request', 'Ungültige Bundle-ID.');
    try {
      await this.d.exec('/usr/bin/open', ['-b', bundleId]);
    } catch (e) {
      const err = e as ExecError;
      if (err.timedOut) return fail('timeout', 'Die App hat nicht rechtzeitig reagiert.');
      if (/Unable to find application|LSCopyApplicationURLsForBundleIdentifier|-10814/i.test(err.stderr ?? '')) {
        return fail('app_not_found', 'Diese App ist auf dem Mac nicht installiert.');
      }
      log('warn', 'open -b fehlgeschlagen', { bundleId, stderr: err.stderr?.slice(0, 200) });
      return fail('exec_failed', 'Die App konnte nicht geöffnet werden.');
    }
    // macOS ≥ 14 aktiviert von Hintergrundprozessen geöffnete Apps nicht zuverlässig
    // ("kooperative Aktivierung"): daher über System Events in den Vordergrund holen.
    try {
      await this.d.exec('/usr/bin/osascript', [this.d.activateScript, bundleId], { timeoutMs: 8000 });
      return { ok: true };
    } catch (e) {
      const kind = classifyAppleScriptError((e as ExecError).stderr ?? '');
      if (kind) this.d.permissions.report(kind);
      return { ok: true, message: kind
        ? `App geöffnet, aber nicht in den Vordergrund geholt. ${PERMISSION_TEXT[kind]}`
        : 'App geöffnet, konnte aber nicht in den Vordergrund geholt werden.' };
    }
  }

  /** Öffnet im Standardbrowser. Nur http/https. */
  private async openUrl(url: string): Promise<RunResult> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return fail('invalid_url', 'Der Link ist ungültig.');
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fail('invalid_url', 'Nur http- und https-Links sind erlaubt.');
    try {
      await this.d.exec('/usr/bin/open', [u.href]);
      return { ok: true };
    } catch (e) {
      const err = e as ExecError;
      log('warn', 'open URL fehlgeschlagen', { stderr: err.stderr?.slice(0, 200) });
      return fail(err.timedOut ? 'timeout' : 'exec_failed', 'Der Link konnte nicht geöffnet werden.');
    }
  }

  private async openSettings(url: string): Promise<RunResult> {
    await this.d.exec('/usr/bin/open', [url]);
    return { ok: true, message: 'Systemeinstellungen am Mac geöffnet.' };
  }

  /** Tastenkombination über System Events (AppleScript mit on run argv). */
  private async hotkey(modifiers: readonly Modifier[], key: HotkeyKey): Promise<RunResult> {
    const code = KEY_CODES[key];
    const keyArg = code !== undefined ? `code:${code}` : key;
    try {
      await this.d.exec('/usr/bin/osascript', [this.d.keystrokeScript, keyArg, ...modifiers], { timeoutMs: 8000 });
      return { ok: true };
    } catch (e) {
      return this.appleScriptFailure(e as ExecError, 'Tastenkombination');
    }
  }

  private appleScriptFailure(err: ExecError, what: string): RunResult {
    const kind = classifyAppleScriptError(err.stderr ?? '');
    if (kind) {
      this.d.permissions.report(kind);
      return fail('permission_denied', PERMISSION_TEXT[kind], kind);
    }
    if (err.timedOut) {
      // Erste Nutzung: macOS fragt am Mac "… möchte System Events steuern" und osascript wartet darauf.
      if (this.d.permissions.get().automation !== 'granted') {
        void this.d.permissions.check();
        return fail('permission_denied', 'Am Mac wartet ein Dialog „Copper Deck Helper möchte System Events steuern“ – bitte „Erlauben“ wählen und erneut tippen.', 'automation');
      }
      return fail('timeout', `${what}: keine Reaktion von System Events.`);
    }
    log('warn', `${what} fehlgeschlagen`, { stderr: err.stderr?.slice(0, 300) });
    return fail('exec_failed', `${what} konnte nicht gesendet werden.`);
  }

  private async tileWindows(): Promise<RunResult> {
    const r = await this.d.native.call(['tile-windows'], 15_000);
    if (!r.ok) {
      if (r.error === 'accessibility') {
        this.d.permissions.report('accessibility');
        return fail('permission_denied', PERMISSION_TEXT.accessibility, 'accessibility');
      }
      if (r.error === 'native_missing') return fail('exec_failed', 'Copper Deck Helper.app fehlt – bitte install.sh ausführen.');
      return fail(r.error === 'timeout' ? 'timeout' : 'exec_failed', 'Fenster konnten nicht angeordnet werden.');
    }
    const windows = (r['windows'] as { app: string; title: string; ok: boolean; reason: string }[] | undefined) ?? [];
    if (windows.length === 0) return { ok: true, message: 'Keine sichtbaren Standardfenster gefunden.' };
    const failed = windows.filter((w) => !w.ok);
    const details = failed.map((w) => `${w.app}${w.title ? ` – ${w.title}` : ''}: ${w.reason}`);
    const done = windows.length - failed.length;
    const message = failed.length === 0
      ? `${done} ${done === 1 ? 'Fenster' : 'Fenster'} angeordnet.`
      : `${done} von ${windows.length} angeordnet. Nicht anpassbar: ${details.join('; ')}`;
    return { ok: true, message, details };
  }

  /**
   * Stage Manager über die Einstellung com.apple.WindowManager/GloballyEnabled (unter macOS 27
   * live wirksam), danach tatsächlichen Zustand prüfen: Einstellung + sichtbarer Streifen.
   */
  private async toggleStageManager(): Promise<RunResult> {
    const before = await this.d.native.call(['stage-manager-state']);
    if (!before.ok) return fail('exec_failed', 'Stage-Manager-Zustand nicht lesbar.');
    const target = !before['pref'];
    await this.d.exec('/usr/bin/defaults', ['write', 'com.apple.WindowManager', 'GloballyEnabled', '-bool', target ? 'true' : 'false']);
    let state = before;
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 250));
      state = await this.d.native.call(['stage-manager-state']);
      const strip = Number(state['strip'] ?? 0);
      if (state.ok && state['pref'] === target && (target ? strip > 0 : strip === 0)) {
        return { ok: true, message: target ? 'Stage Manager ist an.' : 'Stage Manager ist aus.' };
      }
    }
    if (state['pref'] !== target) return fail('exec_failed', 'Stage Manager hat die Änderung nicht übernommen.');
    if (target) {
      // Eingeschaltet, aber kein Streifen sichtbar: kommt vor, wenn keine weiteren Apps/Fenster offen sind.
      return { ok: true, message: 'Stage Manager ist laut System an; der Seitenstreifen ist nicht sichtbar (evtl. keine weiteren Fenster).' };
    }
    return fail('exec_failed', 'Stage Manager scheint trotz Ausschalten noch aktiv zu sein.');
  }

  private async timer(preset: 'pomodoro' | 'break'): Promise<RunResult> {
    const r = await this.d.timers.toggle(preset);
    const name = preset === 'pomodoro' ? 'Pomodoro (25 Min.)' : 'Pause (5 Min.)';
    return { ok: true, message: r === 'stopped' ? `${name} gestoppt.` : r === 'replaced' ? `${name} ersetzt den laufenden Timer.` : `${name} gestartet.` };
  }

  /** Emoji einfügen: Zwischenablage komplett sichern, Emoji einfügen (⌘V über System Events), wiederherstellen. */
  private async insertEmoji(emoji: string): Promise<RunResult> {
    const r = await this.d.native.call(['insert-emoji', emoji, this.d.keystrokeScript], 12_000);
    if (r.ok) {
      return r['restored'] === false
        ? { ok: true, message: 'Eingefügt. Zwischenablage wurde inzwischen neu belegt und daher nicht zurückgesetzt.' }
        : { ok: true };
    }
    if (r.error === 'keystroke') {
      const kind = classifyAppleScriptError(String(r['stderr'] ?? ''));
      if (kind) {
        this.d.permissions.report(kind);
        return fail('permission_denied', PERMISSION_TEXT[kind], kind);
      }
    }
    if (r.error === 'native_missing') return fail('exec_failed', 'Copper Deck Helper.app fehlt – bitte install.sh ausführen.');
    return fail('exec_failed', 'Emoji konnte nicht eingefügt werden.');
  }
}
