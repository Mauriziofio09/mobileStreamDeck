import { Injectable, computed, inject, signal } from '@angular/core';
import {
  CLOSE, PROTOCOL_VERSION, WS_PATH,
  type ClientMessage, type DeckConfig, type InstalledApp, type PermissionKind, type PermissionState, type ServerMessage, type TimerState,
} from '@copper-deck/shared';
import { AuthService } from './auth.service';

export type ConnState = 'unpaired' | 'connecting' | 'online' | 'offline';

export type RunOutcome =
  | { readonly ok: true; readonly message?: string }
  | { readonly ok: false; readonly kind: 'offline' | 'timeout' | 'error' | 'interrupted'; readonly reason: string; readonly permission?: PermissionKind };

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];
const REQUEST_TIMEOUT_MS = 10_000;
const PING_EVERY_MS = 15_000;
const PONG_TIMEOUT_MS = 4_000;
const CONFIG_CACHE_KEY = 'copperdeck.config';

interface Pending {
  resolve: (r: RunOutcome) => void;
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
  readonly online = computed(() => this.state() === 'online');

  private ws: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<string, Pending>();

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
      return Promise.resolve({ ok: false, kind: 'offline', reason: 'Keine Verbindung zum Mac – Aktion wurde nicht ausgeführt.' });
    }
    const requestId = crypto.randomUUID();
    return new Promise<RunOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, kind: 'timeout', reason: 'Keine Antwort vom Mac (Zeitüberschreitung).' });
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, timer });
      this.sendRaw({ type: 'run', requestId, actionId });
    });
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
        this.startHeartbeat();
        return;
      case 'config':
        this.config.set(msg.config);
        writeCachedConfig(msg.config);
        return;
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
      this.lastError.set(code === CLOSE.revoked ? 'Dieses Gerät wurde am Mac widerrufen.' : 'Kopplung ungültig. Bitte neu koppeln.');
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
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, kind: 'interrupted', reason: 'Verbindung unterbrochen – Ergebnis unbekannt.' });
      this.pending.delete(id);
    }
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
