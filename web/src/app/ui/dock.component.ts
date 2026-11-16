import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, viewChild } from '@angular/core';
import type { DockItem } from '@copper-deck/shared';
import { ActionService } from '../core/action.service';
import { confirmRemoval } from '../core/confirm';
import { EditorService, MAX_DOCK } from '../core/editor.service';
import { HOLD_TO_DRAG_MS, ReorderController } from '../core/reorder';
import { IconComponent } from './icons';
import { AppCatalogService } from '../core/app-catalog.service';
import { ConnectionService } from '../core/connection.service';
import { DeckStore } from '../core/deck.store';
import { SurfaceDirective } from '../core/surface.directive';

/**
 * Dock: App-Icons überlappen leicht, horizontal scrollbar.
 * `data-no-swipe` + touch-action: pan-x -> scrollt nur hier, kein Seitenwechsel.
 * Bearbeitungsmodus: wackeln, kurz halten und ziehen zum Umsortieren, „–“ entfernt, Tippen ersetzt die App, „+“ fügt hinzu.
 */
@Component({
  selector: 'cd-dock',
  imports: [SurfaceDirective, IconComponent],
  host: { '[class.is-editing]': 'store.editMode()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scroller" #scroller data-no-swipe>
      <div class="row">
        @for (item of items(); track item.id; let i = $index) {
          <button
            type="button"
            class="item"
            cdSurface="dock-frame"
            [cdRadius]="0.27"
            [style.z-index]="i + 1"
            [style.--wiggle-delay]="wiggle(item.id)"
            [attr.data-reorder-id]="item.id"
            [attr.aria-label]="store.editMode() ? item.label + ' ersetzen' : item.label"
            [class.offline]="!conn.online()"
            [class.drag-src]="reorder.dragId() === item.id"
            (pointerdown)="reorder.down($event, item.id, ids())"
            (pointermove)="reorder.move($event)"
            (pointerup)="reorder.up($event)"
            (pointercancel)="reorder.cancel()"
            (contextmenu)="$event.preventDefault()"
            (click)="reorder.click(item.id)"
          >
            <span class="face">
              @if (catalog.lookup(item.bundleId)?.icon; as src) {
                <img [src]="src" alt="" draggable="false" />
              } @else {
                <span class="fallback" [class.missing]="catalog.lookup(item.bundleId) === null">{{ item.label }}</span>
              }
            </span>
            @if (store.editMode()) {
              <span class="delete" role="button" [attr.aria-label]="item.label + ' aus dem Dock entfernen'" (pointerdown)="$event.stopPropagation()" (click)="askRemove($event, item)"><cd-icon name="minus" /></span>
            }
          </button>
        }
        @if (store.editMode() && items().length < max) {
          <button type="button" class="item add" cdSurface="dock-frame" [cdRadius]="0.27" [style.z-index]="items().length + 1"
                  aria-label="App zum Dock hinzufügen" (click)="editor.barEditing.set({ list: 'dock', id: null })">
            <span class="plus">+</span>
          </button>
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; }
    .scroller {
      overflow-x: auto;
      overflow-y: hidden;
      overscroll-behavior-x: contain;
      touch-action: pan-x;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
      padding: 10px 0;
    }
    .scroller::-webkit-scrollbar { display: none; }
    .row {
      display: flex;
      width: max-content;
      min-width: 100%;
      justify-content: center;
      padding: 0 var(--dock-pad-x);
      box-sizing: border-box;
    }
    .item {
      position: relative;
      flex: none;
      width: var(--dock-item);
      height: var(--dock-item);
      margin-left: calc(var(--dock-item) * -0.16);
      border: 0;
      padding: 0;
      background: transparent;
      display: grid;
      place-items: center;
      transition: transform var(--t-press) var(--ease-out);
    }
    .item:first-child { margin-left: 0; }
    .item:active { transform: scale(0.92); }
    .item.offline img { opacity: 0.45; }
    .face { display: grid; place-items: center; width: 100%; height: 100%; pointer-events: none; }

    /* Bearbeitungsmodus */
    :host(.is-editing) .item:active { transform: none; }
    :host(.is-editing) .item.offline img { opacity: 1; }
    :host(.is-editing) .face { animation: wiggle 300ms ease-in-out infinite alternate; animation-delay: var(--wiggle-delay); }
    .item.drag-src { opacity: 0.25; }
    @keyframes wiggle { from { transform: rotate(-2.2deg); } to { transform: rotate(2.2deg); } }
    .delete {
      position: absolute;
      top: calc(var(--dock-item) * 0.02);
      left: calc(var(--dock-item) * 0.06);
      z-index: 2;
      width: calc(var(--dock-item) * 0.26);
      height: calc(var(--dock-item) * 0.26);
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: calc(var(--dock-item) * 0.15);
      color: var(--c-text-cream);
      background: var(--c-delete);
      box-shadow: 0 1px 4px var(--c-tile-shadow);
    }
    .plus { font: 700 calc(var(--dock-item) * 0.42) / 1 var(--font-label); color: var(--c-text-cream); opacity: 0.85; }
    .fallback.missing { color: var(--c-missing-ink, var(--c-text-muted)); }
    @media (prefers-reduced-motion: reduce) {
      :host(.is-editing) .face { animation: none; }
    }
    img {
      width: calc(var(--dock-item) * 0.86 * var(--icon-overscan));
      height: calc(var(--dock-item) * 0.86 * var(--icon-overscan));
      pointer-events: none;
    }
    .fallback {
      font-family: var(--font-label);
      font-weight: 700;
      font-size: 12px;
      text-transform: uppercase;
      color: var(--c-text-cream);
      padding: 6px;
      text-align: center;
    }
  `,
})
export class DockComponent {
  protected readonly store = inject(DeckStore);
  protected readonly catalog = inject(AppCatalogService);
  private readonly actions = inject(ActionService);
  protected readonly conn = inject(ConnectionService);
  protected readonly editor = inject(EditorService);
  protected readonly max = MAX_DOCK;
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly reorder = new ReorderController({
    holdMs: HOLD_TO_DRAG_MS,
    scroller: () => this.scroller()?.nativeElement,
    editMode: () => this.store.editMode(),
    onLongPress: () => this.store.enterEditMode(),
    onTap: (id) => (this.store.editMode() ? this.editor.barEditing.set({ list: 'dock', id }) : void this.open(id)),
    onDrop: (id, to) => this.editor.moveItem('dock', id, to),
  });

  /** Während des Ziehens die vorläufige Reihenfolge anzeigen. */
  protected readonly items = computed<readonly DockItem[]>(() => {
    const list = this.store.dock();
    const order = this.reorder.preview();
    if (!order) return list;
    const byId = new Map(list.map((d) => [d.id, d]));
    return order.map((id) => byId.get(id)).filter((d): d is DockItem => !!d);
  });
  protected readonly ids = computed(() => this.store.dock().map((d) => d.id));

  private readonly delays = new Map<string, string>();
  protected wiggle(id: string): string {
    let d = this.delays.get(id);
    if (!d) this.delays.set(id, (d = `${-Math.round(Math.random() * 300)}ms`));
    return d;
  }

  protected askRemove(ev: Event, item: DockItem): void {
    ev.stopPropagation();
    if (confirmRemoval(item.id, item.label)) this.editor.removeItem('dock', item.id);
  }


  private async open(id: string): Promise<void> {
    const r = await this.actions.run(id);
    if (!r.ok) this.store.toast(r.reason, 'error');
  }
}
