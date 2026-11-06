import { DeckConfig, Tile, TileGroup } from '@copper-deck/shared';

/** Beispieldaten für Meilenstein 1 (ab Meilenstein 2 liefert der Helper die Konfiguration). */
const app = (id: string, bundleId: string, label: string): Tile => ({
  id, kind: 'app', label, action: { type: 'openApp', bundleId },
});

const group = (id: string, tiles: (Tile | null)[]): TileGroup => ({ id, tiles });

export const SAMPLE_CONFIG: DeckConfig = {
  schemaVersion: 1,
  revision: 1,
  groups: [
    group('g-apps', [
      app('t-finder', 'com.apple.finder', 'Finder'),
      app('t-books', 'com.apple.iBooksX', 'Bücher'),
      app('t-messages', 'com.apple.MobileSMS', 'Nachrichten'),
      app('t-calendar', 'com.apple.iCal', 'Kalender'),
      app('t-music', 'com.apple.Music', 'Musik'),
      app('t-safari', 'com.apple.Safari', 'Safari'),
      app('t-notes', 'com.apple.Notes', 'Notizen'),
      app('t-mail', 'com.apple.mail', 'Mail'),
    ]),
    group('g-work', [
      { id: 't-stage', kind: 'action', label: 'Stage Manager', color: 'violet',
        icon: { type: 'emoji', emoji: '🧑‍💻' }, action: { type: 'stageManager' } },
      { id: 't-gfonts', kind: 'action', label: 'Google Fonts', color: 'brown',
        icon: { type: 'emoji', emoji: '🔤' }, action: { type: 'openUrl', url: 'https://fonts.google.com/' } },
      { id: 't-youtube', kind: 'action', label: 'YouTube', color: 'brown',
        icon: { type: 'emoji', emoji: '▶️' }, action: { type: 'openUrl', url: 'https://www.youtube.com/' } },
      { id: 't-pomodoro', kind: 'action', label: 'Start Pomodoro', color: 'violet',
        icon: { type: 'emoji', emoji: '🍅' }, action: { type: 'timer', preset: 'pomodoro' } },
      { id: 't-notion', kind: 'action', label: 'Notion', color: 'brown',
        icon: { type: 'appIcon', bundleId: 'notion.id' }, action: { type: 'openApp', bundleId: 'notion.id' } },
      app('t-figma', 'com.figma.Desktop', 'Figma'),
      { id: 't-tile', kind: 'action', label: 'Tile Last 4 Windows', color: 'violet',
        icon: { type: 'emoji', emoji: '⚡' }, action: { type: 'tileWindows' } },
      { id: 't-break', kind: 'action', label: 'Take a Break', color: 'violet',
        icon: { type: 'emoji', emoji: '😌' }, action: { type: 'timer', preset: 'break' } },
    ]),
    group('g-tools', [
      { id: 't-shot', kind: 'action', label: 'Bildschirmfoto', color: 'brown',
        icon: { type: 'emoji', emoji: '📸' }, action: { type: 'hotkey', modifiers: ['command', 'shift'], key: '4' } },
      { id: 't-mission', kind: 'action', label: 'Mission Control', color: 'violet',
        icon: { type: 'emoji', emoji: '🪟' }, action: { type: 'hotkey', modifiers: ['control'], key: 'up' } },
      { id: 't-spotlight', kind: 'action', label: 'Spotlight', color: 'brown',
        icon: { type: 'emoji', emoji: '🔍' }, action: { type: 'hotkey', modifiers: ['command'], key: 'space' } },
      { id: 't-lock', kind: 'action', label: 'Bildschirm sperren', color: 'violet',
        icon: { type: 'emoji', emoji: '🔒' }, action: { type: 'hotkey', modifiers: ['control', 'command'], key: 'q' } },
      app('t-terminal', 'com.apple.Terminal', 'Terminal'),
      app('t-vscode', 'com.microsoft.VSCode', 'Visual Studio Code'),
      app('t-chrome', 'com.google.Chrome', 'Google Chrome'),
      app('t-xcode', 'com.apple.dt.Xcode', 'Xcode'),
    ]),
    group('g-more', [
      { id: 't-thumbs', kind: 'action', label: 'Daumen hoch', color: 'brown',
        icon: { type: 'emoji', emoji: '👍' }, action: { type: 'insertEmoji', emoji: '👍' } },
      { id: 't-weather', kind: 'action', label: 'Wetter', color: 'violet',
        icon: { type: 'emoji', emoji: '🌦️' }, action: { type: 'openUrl', url: 'https://www.meteoschweiz.admin.ch/' } },
      app('t-ps', 'com.adobe.Photoshop', 'Photoshop'),
      app('t-discord', 'com.hnc.Discord', 'Discord'),
      null, null, null, null,
    ]),
  ],
  emojis: ['😂', '🤩', '🤣', '❤️', '😱', '😘', '😍', '🥰'],
  // Wird durch die Dock-Liste aus app-icons/index.json ersetzt (häufig genutzte, installierte Apps).
  dock: [],
};
