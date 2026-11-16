import type { DeckConfig, DockItem, InstalledApp, Tile, TileGroup } from './config';

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

/** Startbelegung unter Windows: Apps, die es auf dem PC tatsächlich gibt, statt der Mac-Apps. */
const WINDOWS_STARTER: readonly { id: string; label: string; match: (a: InstalledApp) => boolean }[] = [
  { id: 't-explorer', label: 'Explorer', match: (a) => a.bundleId === 'Microsoft.Windows.Explorer' },
  { id: 't-edge', label: 'Edge', match: (a) => a.bundleId === 'MSEdge' },
  { id: 't-chrome', label: 'Chrome', match: (a) => a.bundleId === 'Chrome' || /^Google Chrome$/i.test(a.name) },
  { id: 't-outlook', label: 'Outlook', match: (a) => /^(Microsoft )?Outlook/i.test(a.name) },
  { id: 't-teams', label: 'Teams', match: (a) => /^(Microsoft )?Teams/i.test(a.name) },
  { id: 't-photos', label: 'Fotos', match: (a) => /^Microsoft\.Windows\.Photos_/i.test(a.bundleId) },
  { id: 't-calc', label: 'Rechner', match: (a) => /^Microsoft\.WindowsCalculator_/i.test(a.bundleId) },
  { id: 't-notepad', label: 'Editor', match: (a) => /^Microsoft\.WindowsNotepad_/i.test(a.bundleId) || /notepad\.exe$/i.test(a.bundleId) },
  { id: 't-terminal', label: 'Terminal', match: (a) => /^Microsoft\.WindowsTerminal_/i.test(a.bundleId) },
  { id: 't-settings', label: 'Einstellungen', match: (a) => /immersivecontrolpanel/i.test(a.bundleId) },
  { id: 't-spotify', label: 'Spotify', match: (a) => /^Spotify$/i.test(a.name) },
];

export function defaultWindowsConfig(apps: readonly InstalledApp[], dock: readonly DockItem[]): DeckConfig {
  const first: (Tile | null)[] = [];
  for (const s of WINDOWS_STARTER) {
    if (first.length >= 8) break;
    const a = apps.find(s.match);
    if (a) first.push(app(s.id, a.bundleId, a.name.length <= 40 ? a.name : s.label));
  }
  while (first.length < 8) first.push(null);
  const byName = (re: RegExp, id: string): Tile | null => {
    const a = apps.find((x) => re.test(x.name));
    return a ? app(id, a.bundleId, a.name.slice(0, 40)) : null;
  };
  const mac = defaultConfig(dock);
  const work = mac.groups[1]!.tiles.map((t): Tile | null => {
    if (!t) return null;
    switch (t.id) {
      // Kein Stage Manager unter Windows: stattdessen die Aufgabenansicht (Win+Tab).
      case 't-stage':
        return { id: 't-taskview', kind: 'action', label: 'Aufgabenansicht', color: 'violet',
          icon: { type: 'emoji', emoji: '🗂️' }, action: { type: 'hotkey', modifiers: ['command'], key: 'tab' } };
      case 't-notion': return byName(/^Notion$/i, 't-notion');
      case 't-figma': return byName(/^Figma$/i, 't-figma');
      default: return t;
    }
  });
  return { ...mac, groups: [group('g-apps', first), group('g-work', work)] };
}
