import { Injectable, inject, signal } from '@angular/core';
import { TILES_PER_GROUP, type DeckConfig, type DockItem, type EmojiItem, type Tile, type TileGroup } from '@copper-deck/shared';
import { ConnectionService } from './connection.service';
import { DeckStore } from './deck.store';

/** Obergrenzen wie im Schema des Helpers. */
export const MAX_EMOJIS = 16;
export const MAX_DOCK = 40;

export type BarList = 'emojis' | 'dock';

/** Eintrag der Emoji-Leiste oder des Docks, der gerade bearbeitet wird (id null = neu). */
export interface BarEditing {
  readonly list: BarList;
  readonly id: string | null;
}

export interface Slot {
  readonly groupId: string;
  readonly index: number;
}

export const newId = (prefix: 't' | 'g' | 'e' | 'd'): string =>
  `${prefix}-${crypto.getRandomValues(new Uint32Array(2)).reduce((s, n) => s + n.toString(36), '')}`.slice(0, 24);

/**
 * Änderungen an der Konfiguration im Bearbeitungsmodus.
 * Jede Änderung: sofort lokal anzeigen, dann in einer Warteschlange speichern
 * (jeweils auf Basis der zuletzt bestätigten Revision). Konflikt -> aktueller Stand vom Helper.
 */
@Injectable({ providedIn: 'root' })
export class EditorService {
  private readonly conn = inject(ConnectionService);
  private readonly store = inject(DeckStore);
  private chain: Promise<unknown> = Promise.resolve();
  /** Kachel, die gerade im Editor offen ist (null = neu an diesem Platz). */
  readonly editing = signal<{ slot: Slot; tile: Tile | null } | null>(null);
  readonly barEditing = signal<BarEditing | null>(null);
  readonly saving = signal(0);
  /** Erhöht sich bei jedem Konflikt: wartende Änderungen beruhen auf altem Stand und werden verworfen. */
  private epoch = 0;

  tileAt(slot: Slot): Tile | null {
    return this.store.config().groups.find((g) => g.id === slot.groupId)?.tiles[slot.index] ?? null;
  }

  move(from: Slot, to: Slot): void {
    if (from.groupId === to.groupId && from.index === to.index) return;
    this.apply((cfg) => {
      const a = this.tileIn(cfg, from);
      const b = this.tileIn(cfg, to);
      // Tauschen (leerer Zielplatz = verschieben)
      return this.setTiles(this.setTiles(cfg, from, b), to, a);
    });
  }

  remove(slot: Slot): void {
    this.apply((cfg) => this.setTiles(cfg, slot, null));
  }

  upsert(slot: Slot, tile: Tile): void {
    this.apply((cfg) => this.setTiles(cfg, slot, tile));
  }

  addGroup(): void {
    this.apply((cfg) => ({ ...cfg, groups: [...cfg.groups, { id: newId('g'), tiles: Array<Tile | null>(TILES_PER_GROUP).fill(null) }] }));
    // Zur neuen Gruppe blättern
    queueMicrotask(() => this.store.goTo(this.store.pages().length - 1));
  }

  removeGroup(groupId: string): void {
    this.apply((cfg) => {
      const g = cfg.groups.find((x) => x.id === groupId);
      if (!g || g.tiles.some((t) => t !== null) || cfg.groups.length <= 1) return cfg;
      return { ...cfg, groups: cfg.groups.filter((x) => x.id !== groupId) };
    });
  }

  // --- Emoji-Leiste und Dock (geordnete Listen, Einfügen statt Tauschen) ---

  /** Verschiebt einen Eintrag an eine neue Position (Index in der Liste nach dem Entfernen). */
  moveItem(list: BarList, id: string, to: number): void {
    this.apply((cfg) => {
      const items = [...cfg[list]] as (EmojiItem | DockItem)[];
      const from = items.findIndex((x) => x.id === id);
      if (from < 0 || from === to) return cfg;
      const [item] = items.splice(from, 1) as [EmojiItem | DockItem];
      items.splice(Math.max(0, Math.min(items.length, to)), 0, item);
      return { ...cfg, [list]: items };
    });
  }

  removeItem(list: BarList, id: string): void {
    this.apply((cfg) => {
      const items = (cfg[list] as readonly (EmojiItem | DockItem)[]).filter((x) => x.id !== id);
      return items.length === cfg[list].length ? cfg : { ...cfg, [list]: items };
    });
  }

  /** Emoji ändern (id) oder hinten anfügen (id null). */
  saveEmoji(id: string | null, emoji: string): void {
    this.apply((cfg) => {
      if (id) return { ...cfg, emojis: cfg.emojis.map((e) => (e.id === id ? { ...e, emoji } : e)) };
      if (cfg.emojis.length >= MAX_EMOJIS) return cfg;
      return { ...cfg, emojis: [...cfg.emojis, { id: newId('e'), emoji }] };
    });
  }

  /** Dock-Eintrag auf eine andere App setzen (id) oder hinten anfügen (id null). */
  saveDockApp(id: string | null, bundleId: string, label: string): void {
    this.apply((cfg) => {
      if (id) return { ...cfg, dock: cfg.dock.map((d) => (d.id === id ? { ...d, bundleId, label } : d)) };
      if (cfg.dock.length >= MAX_DOCK) return cfg;
      return { ...cfg, dock: [...cfg.dock, { id: newId('d'), bundleId, label }] };
    });
  }

  private tileIn(cfg: DeckConfig, slot: Slot): Tile | null {
    return cfg.groups.find((g) => g.id === slot.groupId)?.tiles[slot.index] ?? null;
  }

  private setTiles(cfg: DeckConfig, slot: Slot, tile: Tile | null): DeckConfig {
    return {
      ...cfg,
      groups: cfg.groups.map((g): TileGroup =>
        g.id === slot.groupId ? { ...g, tiles: g.tiles.map((t, i) => (i === slot.index ? tile : t)) } : g,
      ),
    };
  }

  private apply(mutate: (cfg: DeckConfig) => DeckConfig): void {
    if (!this.conn.online()) {
      this.store.toast('Keine Verbindung zum Mac – Bearbeiten ist gerade nicht möglich.', 'error');
      return;
    }
    const current = this.store.config();
    const next = mutate(current);
    if (next === current) return;
    this.conn.showOptimistic(next);
    const epoch = this.epoch;
    this.saving.update((n) => n + 1);
    this.chain = this.chain
      .then(async () => {
        if (epoch !== this.epoch) return; // nach Konflikt verworfen
        const r = await this.conn.saveConfig(next, this.conn.serverRevision());
        if (r.ok) return;
        this.epoch++;
        if (r.reason === 'stale') {
          this.store.toast(r.message, 'error'); // Helper hat den aktuellen Stand bereits geschickt
        } else {
          this.conn.revertToConfirmed();
          this.store.toast(r.message, 'error');
        }
      })
      .finally(() => this.saving.update((n) => n - 1));
  }
}
