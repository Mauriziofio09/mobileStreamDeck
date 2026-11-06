import type { DeckConfig, DockItem, Tile, TileGroup } from './config';

/** Startbelegung. Das Dock füllt der Helper mit häufig genutzten, installierten Apps. */
const app = (id: string, bundleId: string, label: string): Tile => ({
  id, kind: 'app', label, action: { type: 'openApp', bundleId },
});
const group = (id: string, tiles: (Tile | null)[]): TileGroup => ({ id, tiles });

export function defaultConfig(dock: readonly DockItem[]): DeckConfig {
  return {
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
    ],
    emojis: ['😂', '🤩', '🤣', '❤️', '😱', '😘', '😍', '🥰'].map((emoji, i) => ({ id: `e-${i + 1}`, emoji })),
    dock,
  };
}
