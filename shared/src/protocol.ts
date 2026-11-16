import type { DeckConfig, HostPlatform, InstalledApp } from './config';

/**
 * WebSocket-Protokoll zwischen PWA und Helper.
 * Der Client sendet zum Ausführen nur Aktions-IDs (Kachel-, Dock- oder Emoji-ID), niemals Befehle.
 */
export const PROTOCOL_VERSION = 1 as const;

export const WS_PATH = '/ws';

/** Muster für IDs (Request-, Aktions-, Geräte-IDs). */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type ClientMessage =
  /** Erste Nachricht nach dem Verbindungsaufbau; Token nie in der URL. */
  | { readonly type: 'auth'; readonly token: string; readonly protocol: number }
  | { readonly type: 'run'; readonly requestId: string; readonly actionId: string }
  | { readonly type: 'ping'; readonly t: number }
  /** Konfigurationsänderung; basiert auf baseRevision (sonst Ablehnung als veraltet). */
  | { readonly type: 'saveConfig'; readonly requestId: string; readonly baseRevision: number; readonly config: DeckConfig };

export type SaveRejectReason = 'stale' | 'invalid';

export type ErrorCode =
  | 'unknown_action'
  | 'invalid_request'
  | 'not_implemented'
  | 'app_not_found'
  | 'invalid_url'
  | 'exec_failed'
  | 'permission_denied'
  | 'timeout'
  | 'busy';

export type ActionResultMessage =
  | { readonly type: 'result'; readonly requestId: string; readonly ok: true; readonly message?: string; readonly details?: readonly string[] }
  | {
      readonly type: 'result';
      readonly requestId: string;
      readonly ok: false;
      readonly code: ErrorCode;
      /** Verständlicher Grund auf Deutsch. */
      readonly message: string;
      readonly permission?: PermissionKind;
    };

export type PermissionStatus = 'granted' | 'missing' | 'notDetermined' | 'unknown';
export type PermissionKind = 'accessibility' | 'automation' | 'notifications';

export interface PermissionState {
  readonly accessibility: PermissionStatus;
  readonly automation: PermissionStatus;
  readonly notifications: PermissionStatus;
  /** "app" = unter launchd im App-Bundle, "terminal" = von Hand gestartet (Rechte gelten dann fürs Terminal). */
  readonly context: 'app' | 'terminal';
  readonly checkedAt: string;
}

export interface TimerState {
  readonly preset: 'pomodoro' | 'break';
  readonly startedAt: number;
  readonly endsAt: number;
}

/**
 * Feste System-Aktionen (nicht konfigurierbar). Konfigurations-IDs dürfen nicht mit "sys-" beginnen.
 */
export const SYSTEM_ACTIONS = [
  'sys-timer-pomodoro',
  'sys-timer-break',
  'sys-timer-stop',
  'sys-settings-accessibility',
  'sys-settings-automation',
  'sys-settings-notifications',
  'sys-request-permissions',
] as const;
export type SystemActionId = (typeof SYSTEM_ACTIONS)[number];

export type ServerMessage =
  | { readonly type: 'ready'; readonly deviceId: string; readonly deviceName: string; readonly protocol: number; readonly helperVersion: string; readonly platform: HostPlatform }
  | { readonly type: 'config'; readonly config: DeckConfig }
  /** Installierte Apps, die in der Konfiguration vorkommen (für "nicht verfügbar"). */
  | { readonly type: 'apps'; readonly apps: readonly InstalledApp[] }
  | ActionResultMessage
  | { readonly type: 'pong'; readonly t: number }
  /** Laufender Timer (Endzeit vom Helper) + Serverzeit zur Uhrkorrektur. */
  | { readonly type: 'timer'; readonly timer: TimerState | null; readonly serverNow: number }
  | { readonly type: 'permissions'; readonly permissions: PermissionState }
  | { readonly type: 'saveResult'; readonly requestId: string; readonly ok: true; readonly revision: number }
  | { readonly type: 'saveResult'; readonly requestId: string; readonly ok: false; readonly reason: SaveRejectReason; readonly message: string; readonly issues?: readonly string[] };

/** Antwort von GET /api/platform (ohne Anmeldung, damit Kopplungs- und Offline-Ansicht passende Texte zeigen). */
export interface PlatformInfo {
  readonly platform: HostPlatform;
}

/** Antwort von POST /api/media */
export interface MediaUploadResponse {
  readonly file: string;
}

/** Grenzen für eigene Bilder. */
export const MEDIA_MAX_BYTES = 2 * 1024 * 1024;
export const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Close-Codes (4000–4999 sind für Anwendungen reserviert). */
export const CLOSE = {
  unauthorized: 4401,
  authTimeout: 4408,
  revoked: 4403,
  protocolMismatch: 4426,
  invalidMessage: 4400,
} as const;

/** Antworten der Kopplungs-API (POST /api/pair). */
export interface PairRequest {
  readonly code: string;
  readonly deviceName: string;
}
export interface PairResponse {
  readonly deviceId: string;
  readonly token: string;
}
export interface ApiError {
  readonly error: string;
  readonly attemptsLeft?: number;
}

export interface DeviceInfo {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly lastSeenAt: string | null;
  /** Gerät, das die Anfrage stellt. */
  readonly current?: boolean;
}
