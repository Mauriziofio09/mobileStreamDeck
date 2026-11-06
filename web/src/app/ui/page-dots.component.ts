import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DeckStore } from '../core/deck.store';

@Component({
  selector: 'cd-page-dots',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (p of store.pages(); track $index) {
      <button
        type="button"
        class="dot"
        [class.active]="$index === store.page()"
        [attr.aria-label]="'Seite ' + ($index + 1)"
        (click)="store.goTo($index)"
      ></button>
    }
  `,
  styles: `
    :host { display: flex; justify-content: center; align-items: center; gap: 2px; }
    .dot {
      width: 18px;
      height: 22px;
      border: 0;
      padding: 0;
      background: transparent;
      position: relative;
    }
    .dot::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 50%;
      width: 7px;
      height: 7px;
      margin: -3.5px 0 0 -3.5px;
      border-radius: 50%;
      background: var(--c-dot);
      transition: opacity 200ms;
    }
    .dot.active::after { background: var(--c-dot-active); }
  `,
})
export class PageDotsComponent {
  protected readonly store = inject(DeckStore);
}
