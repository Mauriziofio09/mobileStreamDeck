import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  HOTKEY_KEYS, MODIFIERS,
  type Action, type ActionType, type HotkeyKey, type Modifier, type Tile, type TileColor, type TileIcon, type TimerPreset,
} from '@copper-deck/shared';
import { AppCatalogService } from '../core/app-catalog.service';
import { EditorService, newId } from '../core/editor.service';
import { MediaService } from '../core/media.service';
import { PlatformService } from '../core/platform.service';
import { SurfaceDirective } from '../core/surface.directive';
import { TileComponent } from './tile.component';
import { AppPickerComponent, type AppEntry } from './app-picker.component';

type IconType = TileIcon['type'];

/** Feste Liste der Aktionen (kein Aktionstyp für Befehle oder Skripte). */
const ACTIONS: readonly { type: ActionType; label: string }[] = [
  { type: 'openApp', label: 'App öffnen' },
  { type: 'openUrl', label: 'Link öffnen' },
  { type: 'hotkey', label: 'Tastenkombination' },
  { type: 'insertEmoji', label: 'Emoji einfügen' },
  { type: 'timer', label: 'Timer' },
  { type: 'tileWindows', label: 'Letzte 4 Fenster anordnen' },
  { type: 'stageManager', label: 'Stage Manager ein/aus' },
];

const MOD_SYMBOL: Record<Modifier, string> = { command: '⌘', option: '⌥', control: '⌃', shift: '⇧' };
const MOD_NAME: Record<Modifier, string> = { command: 'Befehl', option: 'Wahl', control: 'Control', shift: 'Umschalt' };
/**
 * Windows: dieselben vier Tasten nach ihrer Lage auf der Tastatur –
 * ⌘ entspricht der Windows-Taste, ⌥ Alt, ⌃ Strg.
 */
const WIN_MOD_SYMBOL: Record<Modifier, string> = { command: 'Win', option: 'Alt', control: 'Strg', shift: '⇧' };
const WIN_MOD_NAME: Record<Modifier, string> = { command: 'Windows', option: 'Alt', control: 'Strg', shift: 'Umschalt' };
const KEY_NAME: Partial<Record<HotkeyKey, string>> = {
  space: 'Leertaste', return: 'Zeilenschalter', tab: 'Tab', escape: 'Esc', delete: 'Rückschritt', forwarddelete: 'Entf',
  up: 'Pfeil ↑', down: 'Pfeil ↓', left: 'Pfeil ←', right: 'Pfeil →', home: 'Pos1', end: 'Ende', pageup: 'Bild ↑', pagedown: 'Bild ↓',
};

@Component({
  selector: 'cd-tile-editor',
  imports: [SurfaceDirective, TileComponent, AppPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tile-editor.component.html',
  styleUrl: './tile-editor.component.css',
})
export class TileEditorComponent {
  protected readonly editor = inject(EditorService);
  protected readonly catalog = inject(AppCatalogService);
  private readonly media = inject(MediaService);
  protected readonly platform = inject(PlatformService);

  /** Stage Manager gibt es nur am Mac (bleibt sichtbar, wenn die Kachel ihn schon verwendet). */
  protected readonly actions = computed(() =>
    ACTIONS.filter((a) => a.type !== 'stageManager' || !this.platform.isWindows() || this.actionType() === 'stageManager'),
  );
  /** Unter Windows in der üblichen Reihenfolge Strg, Alt, Umschalt, Win. */
  protected readonly modifiers = computed<readonly Modifier[]>(() =>
    this.platform.isWindows() ? ['control', 'option', 'shift', 'command'] : MODIFIERS,
  );
  protected readonly keys = HOTKEY_KEYS;
  protected readonly modSymbol = computed(() => (this.platform.isWindows() ? WIN_MOD_SYMBOL : MOD_SYMBOL));
  protected readonly modName = computed(() => (this.platform.isWindows() ? WIN_MOD_NAME : MOD_NAME));

  // Entwurf
  protected readonly kind = signal<'app' | 'action'>('action');
  protected readonly label = signal('');
  protected readonly color = signal<TileColor>('brown');
  protected readonly actionType = signal<ActionType>('openApp');
  protected readonly bundleId = signal('');
  protected readonly appName = signal('');
  protected readonly url = signal('https://');
  protected readonly mods = signal<readonly Modifier[]>(['command']);
  protected readonly key = signal<HotkeyKey>('a');
  protected readonly preset = signal<TimerPreset>('pomodoro');
  protected readonly actionEmoji = signal('👍');
  protected readonly iconType = signal<IconType>('emoji');
  protected readonly iconEmoji = signal('⭐️');
  protected readonly iconFile = signal('');
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  // App-Auswahl
  protected readonly picking = signal(false);

  protected readonly isNew = computed(() => !this.editor.editing()?.tile);

  constructor() {
    // Beim Öffnen den Entwurf aus der Kachel befüllen
    effect(() => {
      const e = this.editor.editing();
      untracked(() => (e ? this.load(e.tile) : this.picking.set(false)));
    });
  }

  /** Validierung (der Helper prüft zusätzlich verbindlich gegen das Schema). */
  protected readonly errors = computed(() => {
    const errs: string[] = [];
    const label = this.label().trim();
    if (!label) errs.push('Beschriftung fehlt.');
    if (label.length > 40) errs.push('Beschriftung ist zu lang (max. 40 Zeichen).');
    const t = this.kind() === 'app' ? 'openApp' : this.actionType();
    if (t === 'openApp' && !this.bundleId()) errs.push('Bitte eine App auswählen.');
    if (t === 'openUrl' && !isHttpUrl(this.url())) errs.push('Link muss mit http:// oder https:// beginnen.');
    if (t === 'insertEmoji' && !isEmojiish(this.actionEmoji())) errs.push('Emoji fehlt.');
    if (this.kind() === 'action') {
      if (this.iconType() === 'emoji' && !isEmojiish(this.iconEmoji())) errs.push('Symbol-Emoji fehlt.');
      if (this.iconType() === 'image' && !this.iconFile()) errs.push('Bitte ein Bild hochladen.');
      if (this.iconType() === 'appIcon' && !this.bundleId()) errs.push('App-Icon braucht eine ausgewählte App.');
    }
    return errs;
  });

  protected readonly draft = computed<Tile | null>(() => {
    const e = this.editor.editing();
    const id = e?.tile?.id ?? this.newTileId;
    const label = this.label().trim() || ' ';
    if (this.kind() === 'app') {
      return { id, kind: 'app', label, action: { type: 'openApp', bundleId: this.bundleId() || 'invalid.app' } };
    }
    return { id, kind: 'action', label, color: this.color(), icon: this.buildIcon(), action: this.buildAction() };
  });
  private newTileId = newId('t');

  private buildAction(): Action {
    switch (this.actionType()) {
      case 'openApp': return { type: 'openApp', bundleId: this.bundleId() || 'invalid.app' };
      case 'openUrl': return { type: 'openUrl', url: this.url().trim() };
      case 'hotkey': return { type: 'hotkey', modifiers: [...this.mods()], key: this.key() };
      case 'insertEmoji': return { type: 'insertEmoji', emoji: this.actionEmoji().trim() };
      case 'timer': return { type: 'timer', preset: this.preset() };
      case 'tileWindows': return { type: 'tileWindows' };
      case 'stageManager': return { type: 'stageManager' };
    }
  }

  private buildIcon(): TileIcon {
    switch (this.iconType()) {
      case 'none': return { type: 'none' };
      case 'emoji': return { type: 'emoji', emoji: this.iconEmoji().trim() || '⭐️' };
      case 'appIcon': return { type: 'appIcon', bundleId: this.bundleId() || 'invalid.app' };
      case 'image': return { type: 'image', file: this.iconFile() };
    }
  }

  private load(tile: Tile | null): void {
    this.newTileId = newId('t');
    this.uploadError.set(null);
    this.picking.set(false);
    if (!tile) {
      this.kind.set('action');
      this.label.set('');
      this.color.set('brown');
      this.actionType.set('openUrl');
      this.url.set('https://');
      this.bundleId.set('');
      this.appName.set('');
      this.iconType.set('emoji');
      this.iconEmoji.set('⭐️');
      this.iconFile.set('');
      return;
    }
    this.kind.set(tile.kind);
    this.label.set(tile.label);
    const a = tile.action;
    this.actionType.set(a.type);
    this.bundleId.set(a.type === 'openApp' ? a.bundleId : tile.kind === 'action' && tile.icon.type === 'appIcon' ? tile.icon.bundleId : '');
    this.appName.set(this.bundleId() ? (this.catalog.lookup(this.bundleId())?.name ?? this.bundleId()) : '');
    if (a.type === 'openUrl') this.url.set(a.url);
    if (a.type === 'hotkey') { this.mods.set(a.modifiers); this.key.set(a.key); }
    if (a.type === 'timer') this.preset.set(a.preset);
    if (a.type === 'insertEmoji') this.actionEmoji.set(a.emoji);
    if (tile.kind === 'action') {
      this.color.set(tile.color);
      this.iconType.set(tile.icon.type);
      if (tile.icon.type === 'emoji') this.iconEmoji.set(tile.icon.emoji);
      if (tile.icon.type === 'image') this.iconFile.set(tile.icon.file);
    }
  }

  // --- UI-Handler ---
  protected text(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected setKind(k: 'app' | 'action'): void {
    this.kind.set(k);
    if (k === 'app') this.actionType.set('openApp');
  }

  protected setAction(t: string): void {
    // Neue Tastenkombination: ⌘ am Mac, Strg unter Windows vorbelegen.
    if (t === 'hotkey' && this.actionType() !== 'hotkey') this.mods.set(this.platform.isWindows() ? ['control'] : ['command']);
    this.actionType.set(t as ActionType);
    if (t !== 'openApp' && this.iconType() === 'appIcon') this.iconType.set('emoji');
  }

  protected toggleMod(m: Modifier): void {
    this.mods.update((list) => (list.includes(m) ? list.filter((x) => x !== m) : MODIFIERS.filter((x) => x === m || list.includes(x))));
  }

  protected keyLabel(k: HotkeyKey): string {
    return KEY_NAME[k] ?? k.toUpperCase();
  }

  protected hotkeyText = computed(() => {
    const key = this.keyLabel(this.key());
    if (!this.platform.isWindows()) return `${this.mods().map((m) => MOD_SYMBOL[m]).join('')}${key}`;
    return [...this.modifiers().filter((m) => this.mods().includes(m)).map((m) => WIN_MOD_SYMBOL[m]), key].join('+');
  });

  protected openPicker(): void {
    this.picking.set(true);
  }

  protected pick(a: AppEntry): void {
    const prevName = this.appName();
    this.bundleId.set(a.bundleId);
    this.appName.set(a.name);
    if (!this.label().trim() || this.label() === prevName) this.label.set(a.name);
    this.picking.set(false);
  }

  protected async onFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    this.uploading.set(true);
    this.uploadError.set(null);
    const r = await this.media.upload(f);
    this.uploading.set(false);
    if (r.ok) {
      this.iconFile.set(r.file);
      this.iconType.set('image');
    } else {
      this.uploadError.set(r.error);
    }
  }

  protected save(): void {
    const e = this.editor.editing();
    const t = this.draft();
    if (!e || !t || this.errors().length) return;
    this.editor.upsert(e.slot, t);
    this.editor.editing.set(null);
  }

  protected remove(): void {
    const e = this.editor.editing();
    if (!e) return;
    this.editor.remove(e.slot);
    this.editor.editing.set(null);
  }

  protected close(): void {
    this.editor.editing.set(null);
  }
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v.trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

function isEmojiish(v: string): boolean {
  const s = v.trim();
  return s.length > 0 && s.length <= 32 && !/[\s<>]/.test(s);
}
