import { Injectable, computed, inject, signal } from '@angular/core';
import type { DeckConfig, TileGroup } from '@copper-deck/shared';
import { ConnectionService } from './connection.service';
import { LayoutService } from './layout.service';
import { PlatformService } from './platform.service';

export type Sheet = 'none' | 'about' | 'timer';
/** Hauptansicht: Kacheln oder Lightroom. */
export type MainView = 'deck' | 'lightroom';
const VIEW_KEY = 'copperdeck.view';

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
  private readonly platform = inject(PlatformService);

  /** Aktuelle Konfiguration vom Helper (bzw. zuletzt bekannte, wenn offline). */
  readonly config = computed<DeckConfig>(() => this.conn.config() ?? EMPTY_CONFIG);
  readonly page = signal(0);
  readonly editMode = signal(false);
  readonly view = signal<MainView>(readView());
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

  private readonly _toastListener = window.addEventListener('cd-toast', (e) => this.toast(String((e as CustomEvent).detail), 'info'));

  toast(text: string, kind: Toast['kind']): void {
    this.currentToast.set({ id: ++this.toastId, text, kind });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.currentToast.set(null), kind === 'error' ? 3200 : 1800);
  }

  /** Langes Drücken: Bearbeitungsmodus starten (nur mit Verbindung). */
  enterEditMode(): void {
    if (!this.conn.online()) {
      this.toast(`Bearbeiten ist nur mit Verbindung zum ${this.platform.host()} möglich.`, 'error');
      return;
    }
    this.editMode.set(true);
  }

  /** Zwischen Kacheln und Lightroom wechseln (beendet den Bearbeitungsmodus). */
  toggleLightroom(): void {
    const next: MainView = this.view() === 'lightroom' ? 'deck' : 'lightroom';
    this.editMode.set(false);
    this.overlayOpen.set(false);
    this.view.set(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* privat */ }
  }

  goTo(index: number): void {
    const max = this.pages().length - 1;
    this.page.set(Math.max(0, Math.min(max, index)));
  }
}

const EMPTY_CONFIG: DeckConfig = { schemaVersion: 1, revision: 0, groups: [], emojis: [], dock: [] };

function readView(): MainView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'lightroom' ? 'lightroom' : 'deck';
  } catch {
    return 'deck';
  }
}
