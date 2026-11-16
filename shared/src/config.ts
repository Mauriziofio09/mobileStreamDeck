/**
 * Konfigurationsmodell von Copper Deck.
 * Wird von PWA (web/) und Helper (helper/) gemeinsam verwendet.
 * Es gibt bewusst KEINEN Aktionstyp für Shell-Befehle oder freie Skripte.
 */

export const CONFIG_SCHEMA_VERSION = 1 as const;

/** Anzahl Kacheln pro Gruppe (4 × 2). */
export const TILES_PER_GROUP = 8 as const;

export type TileColor = 'brown' | 'violet';

/** Betriebssystem, auf dem der Helper läuft. */
export type HostPlatform = 'mac' | 'windows';

export type Modifier = 'command' | 'option' | 'control' | 'shift';


export type TimerPreset = 'pomodoro' | 'break';

/** Streng typisierte Aktionen aus einer festen Liste. */
export type Action =
  | { readonly type: 'openApp'; readonly bundleId: string }
  | { readonly type: 'openUrl'; readonly url: string }
  | { readonly type: 'hotkey'; readonly modifiers: readonly Modifier[]; readonly key: HotkeyKey }
  | { readonly type: 'tileWindows' }
  | { readonly type: 'stageManager' }
  | { readonly type: 'timer'; readonly preset: TimerPreset }
  | { readonly type: 'insertEmoji'; readonly emoji: string };

export type ActionType = Action['type'];

/** Symbol oben rechts auf einer Aktions-Kachel. */
export type TileIcon =
  | { readonly type: 'none' }
  | { readonly type: 'emoji'; readonly emoji: string }
  /** Icon einer installierten Mac-App (aus dem Icon-Cache des Helpers). */
  | { readonly type: 'appIcon'; readonly bundleId: string }
  /** Vom Helper gespeichertes Bild (PNG/JPEG/WebP); Dateiname vergibt der Helper. */
  | { readonly type: 'image'; readonly file: string };

/**
 * Zwei Darstellungen:
 * - `app`: echtes App-Icon füllt den Rahmen (Aktion immer openApp)
 * - `action`: Verlaufskachel mit Symbol oben rechts und Beschriftung unten links
 */
export type Tile =
  | {
      readonly id: string;
      readonly kind: 'app';
      readonly label: string;
      readonly action: Extract<Action, { type: 'openApp' }>;
    }
  | {
      readonly id: string;
      readonly kind: 'action';
      readonly label: string;
      readonly color: TileColor;
      readonly icon: TileIcon;
      readonly action: Action;
    };

export interface TileGroup {
  readonly id: string;
  /** Genau TILES_PER_GROUP Plätze; `null` = leerer Platz. */
  readonly tiles: readonly (Tile | null)[];
}

export interface EmojiItem {
  readonly id: string;
  readonly emoji: string;
}

export interface DockItem {
  readonly id: string;
  readonly bundleId: string;
  readonly label: string;
}

export interface DeckConfig {
  readonly schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  /** Wird bei jeder akzeptierten Änderung vom Helper erhöht. */
  readonly revision: number;
  /** Geordnete Liste; Seiten ergeben sich aus dem Gerät (iPad 2, iPhone 1 Gruppe pro Seite). */
  readonly groups: readonly TileGroup[];
  readonly emojis: readonly EmojiItem[];
  readonly dock: readonly DockItem[];
}

/**
 * Infos zu einer installierten App, wie sie der Helper liefert.
 * `bundleId` ist die App-Kennung des Systems: macOS Bundle-ID (com.apple.Safari),
 * Windows AppUserModelID aus dem Startmenü (MSEdge, Microsoft.WindowsCalculator_8wekyb3d8bbwe!App, …).
 */
export interface InstalledApp {
  readonly bundleId: string;
  readonly name: string;
}

/** Erlaubte Tasten für Tastenkombinationen (feste Liste). */
export const HOTKEY_KEYS = [
  ...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''),
  'space', 'return', 'tab', 'escape', 'delete', 'forwarddelete',
  'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
] as const;
export type HotkeyKey = (typeof HOTKEY_KEYS)[number];

export const MODIFIERS = ['command', 'option', 'control', 'shift'] as const;
