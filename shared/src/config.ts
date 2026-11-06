/**
 * Konfigurationsmodell von Copper Deck.
 * Wird von PWA (web/) und Helper (helper/) gemeinsam verwendet.
 * Es gibt bewusst KEINEN Aktionstyp für Shell-Befehle oder freie Skripte.
 */

export const CONFIG_SCHEMA_VERSION = 1 as const;

/** Anzahl Kacheln pro Gruppe (4 × 2). */
export const TILES_PER_GROUP = 8 as const;

export type TileColor = 'brown' | 'violet';

export type Modifier = 'command' | 'option' | 'control' | 'shift';

export type TimerPreset = 'pomodoro' | 'break';

/** Streng typisierte Aktionen aus einer festen Liste. */
export type Action =
  | { readonly type: 'openApp'; readonly bundleId: string }
  | { readonly type: 'openUrl'; readonly url: string }
  | { readonly type: 'hotkey'; readonly modifiers: readonly Modifier[]; readonly key: string }
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
  readonly emojis: readonly string[];
  readonly dock: readonly DockItem[];
}

/** Infos zu einer installierten App, wie sie der Helper liefert. */
export interface InstalledApp {
  readonly bundleId: string;
  readonly name: string;
  /** Relativer Pfad zum gecachten PNG-Icon, falls vorhanden. */
  readonly icon: string | null;
}
