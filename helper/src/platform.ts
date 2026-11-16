import type { HostPlatform } from '@copper-deck/shared';

/** Betriebssystem des Helpers. Alles andere als Windows wird wie macOS behandelt. */
export const PLATFORM: HostPlatform = process.platform === 'win32' ? 'windows' : 'mac';
export const IS_WINDOWS = PLATFORM === 'windows';
/** Für Texte: "Mac" bzw. "PC". */
export const HOST_NAME = IS_WINDOWS ? 'PC' : 'Mac';
