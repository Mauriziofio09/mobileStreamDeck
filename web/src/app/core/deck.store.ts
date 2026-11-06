import { Injectable, computed, inject, signal } from '@angular/core';
import type { DeckConfig, TileGroup } from '@copper-deck/shared';
import { ConnectionService } from './connection.service';
import { LayoutService } from './layout.service';

export type Sheet = 'none' | 'about' | 'timer';

export interface Toast {
  readonly id: number;
  readonly text: string;
  readonly kind: 'info' | 'error';
}

/** Zentraler UI-Zustand. In Meilenstein 1 mit Beispieldaten. */
@Injectable({ providedIn: 'root' })
export class DeckStore {
  private readonly layoutService = inject(LayoutService);
  private readonly conn = inject(ConnectionService);

  /** Aktuelle Konfiguration vom Helper (bzw. zuletzt bekannte, wenn offline). */
  readonly config = computed<DeckConfig>(() => this.conn.config() ?? EMPTY_CONFIG);
  readonly page = signal(0);
  readonly editMode = signal(false);
  readonly sheet = signal<Sheet>('none');
  /** iPhone: Emoji-Leiste + Dock als Overlay. */
  readonly overlayOpen = signal(false);
  readonly currentToast = signal<Toast | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private toastId = 0;

  readonly dock = computed(() => this.config().dock);

  /** Seiten nach Gerät: iPad 2 Gruppen, iPhone 1 Gruppe pro Seite. */
  readonly pages = computed<TileGroup[][]>(() => {
    const per = this.layoutService.layout().groupsPerPage;
    const groups = this.config().groups;
    const pages: TileGroup[][] = [];
    for (let i = 0; i < groups.length; i += per) pages.push(groups.slice(i, i + per));
    return pages.length ? pages : [[]];
  });

  /** "Bar"-Segment: iPad blendet inline ein/aus, iPhone öffnet das Overlay. */
  readonly barActive = computed(() =>
    this.layoutService.layout().barMode === 'inline' ? this.layoutService.barVisible() : this.overlayOpen(),
  );

  toggleBar(): void {
    if (this.layoutService.layout().barMode === 'inline') this.layoutService.barVisible.update((v) => !v);
    else this.overlayOpen.update((v) => !v);
  }

  toast(text: string, kind: Toast['kind']): void {
    this.currentToast.set({ id: ++this.toastId, text, kind });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.currentToast.set(null), kind === 'error' ? 3200 : 1800);
  }

  goTo(index: number): void {
    const max = this.pages().length - 1;
    this.page.set(Math.max(0, Math.min(max, index)));
  }
}

const EMPTY_CONFIG: DeckConfig = { schemaVersion: 1, revision: 0, groups: [], emojis: [], dock: [] };
