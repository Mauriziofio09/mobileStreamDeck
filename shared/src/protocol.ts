import type { DeckConfig, InstalledApp } from './config';

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
  | { readonly type: 'ping'; readonly t: number };

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
  | { readonly type: 'result'; readonly requestId: string; readonly ok: true; readonly message?: string }
  | {
      readonly type: 'result';
      readonly requestId: string;
      readonly ok: false;
      readonly code: ErrorCode;
      /** Verständlicher Grund auf Deutsch. */
      readonly message: string;
    };

export type ServerMessage =
  | { readonly type: 'ready'; readonly deviceId: string; readonly deviceName: string; readonly protocol: number; readonly helperVersion: string }
  | { readonly type: 'config'; readonly config: DeckConfig }
  /** Installierte Apps, die in der Konfiguration vorkommen (für "nicht verfügbar"). */
  | { readonly type: 'apps'; readonly apps: readonly InstalledApp[] }
  | ActionResultMessage
  | { readonly type: 'pong'; readonly t: number };

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
