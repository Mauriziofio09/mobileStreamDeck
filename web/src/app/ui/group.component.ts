import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DeckStore } from '../core/deck.store';
import { EditorService } from '../core/editor.service';
import { TileGroup } from '@copper-deck/shared';
import { LayoutService } from '../core/layout.service';
import { TileComponent } from './tile.component';

/** Verwendung: <cd-group cdSurface="group" ...>. Grosser Gruppen-Container mit 4×2 (iPhone hochkant 2×4) Kacheln. */
@Component({
  selector: 'cd-group',
  imports: [TileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.width.px]': 'layout.layout().groupW',
    '[style.height.px]': 'layout.layout().groupH',
    '[style.padding]': 'layout.layout().padY + "px " + layout.layout().padX + "px"',
    '[style.--cols]': 'layout.layout().cols',
  },
  template: `
    @for (tile of group().tiles; track $index) {
      <cd-tile [tile]="tile" [groupId]="group().id" [index]="$index" />
    }
    @if (store.editMode() && isEmpty() && store.config().groups.length > 1) {
      <button type="button" class="remove-group" data-no-swipe (click)="editor.removeGroup(group().id)">Gruppe entfernen</button>
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: repeat(var(--cols), var(--frame));
      gap: var(--gap);
      align-content: center;
      justify-content: center;
      flex: none;
      position: relative;
    }
    .remove-group {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      z-index: 4;
      border: 1px solid var(--c-err);
      border-radius: 999px;
      background: var(--c-toast);
      color: var(--c-err);
      font: 600 14px var(--font-ui);
      padding: 8px 16px;
    }
  `,
})
export class GroupComponent {
  readonly group = input.required<TileGroup>();
  protected readonly layout = inject(LayoutService);
  protected readonly store = inject(DeckStore);
  protected readonly editor = inject(EditorService);
  protected readonly isEmpty = computed(() => this.group().tiles.every((t) => t === null));
}
