import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActionService } from '../core/action.service';
import { AppCatalogService } from '../core/app-catalog.service';
import { ConnectionService } from '../core/connection.service';
import { DeckStore } from '../core/deck.store';
import { SurfaceDirective } from '../core/surface.directive';

/**
 * Dock: App-Icons überlappen leicht, horizontal scrollbar.
 * `data-no-swipe` + touch-action: pan-x -> scrollt nur hier, kein Seitenwechsel.
 */
@Component({
  selector: 'cd-dock',
  imports: [SurfaceDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scroller" data-no-swipe>
      <div class="row">
        @for (item of store.dock(); track item.id; let i = $index) {
          <button
            type="button"
            class="item"
            cdSurface="dock-frame"
            [cdRadius]="0.27"
            [style.z-index]="i + 1"
            [attr.aria-label]="item.label"
            (click)="open(item.id)"
            [class.offline]="!conn.online()"
          >
            @if (catalog.lookup(item.bundleId)?.icon; as src) {
              <img [src]="src" alt="" draggable="false" />
            } @else {
              <span class="fallback">{{ item.label }}</span>
            }
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

  protected async open(id: string): Promise<void> {
    const r = await this.actions.run(id);
    if (!r.ok) this.store.toast(r.reason, 'error');
  }
}
