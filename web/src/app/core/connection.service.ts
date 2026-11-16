import { Injectable, computed, inject, signal } from '@angular/core';
import {
  CLOSE, LR_EMPTY_STATE, PROTOCOL_VERSION, WS_PATH,
  type ClientMessage, type LrCommand, type LrPresetFolder, type LrState, type DeckConfig, type InstalledApp, type PermissionKind, type PermissionState, type ServerMessage, type TimerState,
} from '@copper-deck/shared';
import { AuthService } from './auth.service';
import { PlatformService } from './platform.service';

export type ConnState = 'unpaired' | 'connecting' | 'online' | 'offline';

export type RunOutcome =
  | { readonly ok: true; readonly message?: string }
  | { readonly ok: false; readonly kind: 'offline' | 'timeout' | 'error' | 'interrupted'; readonly reason: string; readonly permission?: PermissionKind };

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];
const REQUEST_TIMEOUT_MS = 10_000;
const PING_EVERY_MS = 15_000;
const PONG_TIMEOUT_MS = 4_000;
const CONFIG_CACHE_KEY = 'copperdeck.config';

export type SaveOutcome =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly reason: 'stale' | 'invalid' | 'offline' | 'timeout' | 'interrupted'; readonly message: string };

interface Pending {
  resolve: (r: RunOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}
interface PendingSave {
  resolve: (r: SaveOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * WebSocket zum Helper.
 * - Reconnect mit Backoff, sofort bei visibilitychange/online (iOS trennt im Hintergrund)
 * - Jede Aktion: Request-ID -> Erfolg, Fehler mit Grund oder Timeout
 * - Offline ausgelöste Aktionen werden NICHT gespeichert und nicht nachgeholt
 */
@Injectable({ providedIn: 'root' })
export class ConnectionService {
  private readonly auth = inject(AuthService);
  private readonly platform = inject(PlatformService);

  readonly state = signal<ConnState>(this.auth.token() ? 'connecting' : 'unpaired');
  readonly config = signal<DeckConfig | null>(readCachedConfig());
  readonly apps = signal<readonly InstalledApp[] | null>(null);
  readonly deviceName = signal<string>('');
  readonly helperVersion = signal<string>('');
  readonly lastError = signal<string | null>(null);
  readonly attempt = signal(0);
  readonly timer = signal<TimerState | null>(null);
  /** Serverzeit minus lokale Zeit: alle Geräte zeigen denselben Countdown. */
  readonly clockOffset = signal(0);
  readonly permissions = signal<PermissionState | null>(null);
  /** Lightroom Classic (über das Plugin am Mac/PC). */
  readonly lightroom = signal<LrState>(LR_EMPTY_STATE);
  readonly lrPresets = signal<readonly LrPresetFolder[]>([]);
  /** Letzte vom Helper bestätigte Revision (Basis für Änderungen). */
  readonly serverRevision = signal<number>(this.config()?.revision ?? 0);
  /** Zuletzt vom Helper bestätigte Konfiguration (zum Zurücksetzen bei Ablehnung). */
  private confirmed: DeckConfig | null = this.config();
  readonly online = computed(() => this.state() === 'online');

  private ws: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly pendingSaves = new Map<string, PendingSave>();
  private readonly pendingLr = new Map<string, { resolve: (r: { ok: boolean; message?: string }) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.wake();
    });
    window.addEventListener('pageshow', () => this.wake());
    window.addEventListener('online', () => this.wake());
    window.addEventListener('focus', () => this.wake());
    if (this.auth.token()) this.connect();
  }

  /** Nach der Kopplung oder per "Erneut versuchen". */
  connect(): void {
    if (!this.auth.token()) {
      this.state.set('unpaired');
      return;
    }
    this.clearRetry();
    this.teardown();
    this.state.set('connecting');
    const ws = new WebSocket(`wss://${location.host}${WS_PATH}`);
    this.ws = ws;
    ws.onopen = () => {
      const token = this.auth.token();
      if (!token) return ws.close();
      this.sendRaw({ type: 'auth', token, protocol: PROTOCOL_VERSION });
    };
    ws.onmessage = (e) => this.onMessage(e.data);
    ws.onclose = (e) => {
      if (this.ws !== ws) return; // bereits ersetzt
      this.onClosed(e.code);
    };
    ws.onerror = () => {
      /* folgt close */
    };
  }

  run(actionId: string): Promise<RunOutcome> {
    if (this.state() !== 'online' || !this.ws) {
      return Promise.resolve({ ok: false, kind: 'offline', reason: `Keine Verbindung zum ${this.platform.host()} – Aktion wurde nicht ausgeführt.` });
    }
    const requestId = crypto.randomUUID();
    return new Promise<RunOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, kind: 'timeout', reason: `Keine Antwort vom ${this.platform.host()} (Zeitüberschreitung).` });
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, timer });
      this.sendRaw({ type: 'run', requestId, actionId });
    });
  }

  /** Lightroom-Befehl; Antwort vom Plugin (über den Helper) oder Zeitüberschreitung. */
  lr(command: LrCommand): Promise<{ ok: boolean; message?: string }> {
    if (this.state() !== 'online' || !this.ws) {
      return Promise.resolve({ ok: false, message: `Keine Verbindung zum ${this.platform.host()}.` });
    }
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingLr.delete(requestId);
        resolve({ ok: false, message: 'Keine Antwort von Lightroom (Zeitüberschreitung).' });
      }, REQUEST_TIMEOUT_MS);
      this.pendingLr.set(requestId, { resolve, timer });
      this.sendRaw({ type: 'lr', requestId, command });
    });
  }

  /**
   * Konfiguration speichern. Die Änderung wird sofort lokal angezeigt (optimistisch);
   * lehnt der Helper ab, gilt wieder sein Stand.
   */
  saveConfig(next: DeckConfig, baseRevision: number): Promise<SaveOutcome> {
    if (this.state() !== 'online' || !this.ws) {
      return Promise.resolve({ ok: false, reason: 'offline', message: `Keine Verbindung zum ${this.platform.host()} – Änderung nicht gespeichert.` });
    }
    const requestId = crypto.randomUUID();
    return new Promise<SaveOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingSaves.delete(requestId);
        resolve({ ok: false, reason: 'timeout', message: `Keine Antwort vom ${this.platform.host()} – Änderung evtl. nicht gespeichert.` });
      }, REQUEST_TIMEOUT_MS);
      this.pendingSaves.set(requestId, { resolve, timer });
      this.sendRaw({ type: 'saveConfig', requestId, baseRevision, config: next });
    });
  }

  /** Lokale Vorschau einer Änderung (bis zur Bestätigung durch den Helper). */
  showOptimistic(next: DeckConfig): void {
    this.config.set(next);
  }

  /** Auf den zuletzt bestätigten Stand zurück. */
  revertToConfirmed(): void {
    if (this.confirmed) this.config.set(this.confirmed);
  }

  /** App kommt in den Vordergrund: offline -> sofort verbinden, online -> Verbindung prüfen. */
  private wake(): void {
    if (!this.auth.token()) return;
    if (this.state() === 'online') this.ping();
    else this.connect();
  }

  private onMessage(raw: unknown): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(raw)) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'ready':
        this.state.set('online');
        this.attempt.set(0);
        this.lastError.set(null);
        this.deviceName.set(msg.deviceName);
        this.helperVersion.set(msg.helperVersion);
        if (msg.platform) this.platform.set(msg.platform);
        this.startHeartbeat();
        return;
      case 'config':
        this.confirmed = msg.config;
        this.serverRevision.set(msg.config.revision);
        this.config.set(msg.config);
        writeCachedConfig(msg.config);
        return;
      case 'saveResult': {
        const p = this.pendingSaves.get(msg.requestId);
        if (!p) return;
        clearTimeout(p.timer);
        this.pendingSaves.delete(msg.requestId);
        if (msg.ok) this.serverRevision.update((r) => Math.max(r, msg.revision));
        p.resolve(msg.ok ? { ok: true, revision: msg.revision } : { ok: false, reason: msg.reason, message: msg.message });
        return;
      }
      case 'apps':
        this.apps.set(msg.apps);
        return;
      case 'timer':
        this.clockOffset.set(msg.serverNow - Date.now());
        this.timer.set(msg.timer);
        return;
      case 'permissions':
        this.permissions.set(msg.permissions);
        return;
      case 'lightroom':
        this.lightroom.set(msg.state);
        return;
      case 'lrPresets':
        this.lrPresets.set(msg.folders);
        return;
      case 'lrResult': {
        const p = this.pendingLr.get(msg.requestId);
        if (!p) return;
        clearTimeout(p.timer);
        this.pendingLr.delete(msg.requestId);
        p.resolve(msg.ok ? { ok: true } : { ok: false, ...(msg.message ? { message: msg.message } : {}) });
        return;
      }
      case 'pong':
        if (this.pongTimer) clearTimeout(this.pongTimer);
        this.pongTimer = null;
        return;
      case 'result': {
        const p = this.pending.get(msg.requestId);
        if (!p) return; // Timeout bereits gemeldet
        clearTimeout(p.timer);
        this.pending.delete(msg.requestId);
        p.resolve(msg.ok
          ? { ok: true, ...(msg.message ? { message: msg.message } : {}) }
          : { ok: false, kind: 'error', reason: msg.message, ...(msg.permission ? { permission: msg.permission } : {}) });
        return;
      }
    }
  }

  private onClosed(code: number): void {
    this.stopHeartbeat();
    this.ws = null;
    this.failPending();
    if (code === CLOSE.unauthorized || code === CLOSE.revoked) {
      this.lastError.set(code === CLOSE.revoked ? `Dieses Gerät wurde am ${this.platform.host()} widerrufen.` : 'Kopplung ungültig. Bitte neu koppeln.');
      this.forget();
      return;
    }
    if (code === CLOSE.protocolMismatch) {
      this.lastError.set('App-Version passt nicht zum Helper. Bitte App neu laden.');
    }
    this.state.set('offline');
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    this.clearRetry();
    if (document.visibilityState === 'hidden') return; // wake() übernimmt
    const n = this.attempt();
    const base = BACKOFF_MS[Math.min(n, BACKOFF_MS.length - 1)]!;
    const delay = base + Math.random() * base * 0.3;
    this.attempt.set(n + 1);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => this.ping(), PING_EVERY_MS);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  /** Erkennt "halb offene" Verbindungen nach dem Aufwachen. */
  private ping(): void {
    if (!this.ws || this.pongTimer) return;
    this.sendRaw({ type: 'ping', t: Date.now() });
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      const ws = this.ws;
      if (ws) {
        this.ws = null;
        ws.onclose = null;
        ws.close();
        this.onClosed(1006);
      }
    }, PONG_TIMEOUT_MS);
  }

  private failPending(): void {
    for (const [id, p] of this.pendingSaves) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, reason: 'interrupted', message: 'Verbindung unterbrochen – Änderung evtl. nicht gespeichert.' });
      this.pendingSaves.delete(id);
    }
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, kind: 'interrupted', reason: 'Verbindung unterbrochen – Ergebnis unbekannt.' });
      this.pending.delete(id);
    }    for (const [id, p] of this.pendingLr) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, message: 'Verbindung unterbrochen.' });
      this.pendingLr.delete(id);
    }
    // Lightroom-Zustand ist ohne Verbindung unbekannt.
    this.lightroom.set(LR_EMPTY_STATE);
  }

  private teardown(): void {
    this.stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.close();
    }
    this.failPending();
  }

  private sendRaw(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Nach Widerruf/Abmelden. */
  forget(): void {
    this.teardown();
    this.auth.clear();
    this.state.set('unpaired');
    this.config.set(null);
    try {
      localStorage.removeItem(CONFIG_CACHE_KEY);
    } catch {
      /* egal */
    }
  }
}

/** Letzte Konfiguration für die Offline-Darstellung (enthält keine Geheimnisse). */
function readCachedConfig(): DeckConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_CACHE_KEY);
    return raw ? (JSON.parse(raw) as DeckConfig) : null;
  } catch {
    return null;
  }
}
function writeCachedConfig(c: DeckConfig): void {
  try {
    localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(c));
  } catch {
    /* egal */
  }
}
