import { Injectable, signal } from '@angular/core';

const TOKEN_KEY = 'copperdeck.token';
const DEVICE_KEY = 'copperdeck.device';

/**
 * Gerätetoken. iOS trennt den Speicher von Safari und der Home-Bildschirm-App,
 * daher wird nur in der installierten PWA gekoppelt und dort gespeichert.
 * Das Token verlässt das Gerät nur im Authorization-Header bzw. in der ersten WS-Nachricht.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly token = signal<string | null>(read(TOKEN_KEY));
  readonly deviceId = signal<string | null>(read(DEVICE_KEY));

  save(token: string, deviceId: string): void {
    write(TOKEN_KEY, token);
    write(DEVICE_KEY, deviceId);
    this.token.set(token);
    this.deviceId.set(deviceId);
  }

  clear(): void {
    remove(TOKEN_KEY);
    remove(DEVICE_KEY);
    this.token.set(null);
    this.deviceId.set(null);
  }

  authHeader(): Record<string, string> {
    const t = this.token();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Speicher voll/gesperrt: Kopplung gilt nur für diese Sitzung */
  }
}
function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* egal */
  }
}

/** Läuft die App als installierte Home-Bildschirm-App? */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
