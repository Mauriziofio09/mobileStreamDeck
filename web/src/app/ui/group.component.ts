import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
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
      <cd-tile [tile]="tile" />
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
    }
  `,
})
export class GroupComponent {
  readonly group = input.required<TileGroup>();
  protected readonly layout = inject(LayoutService);
}
