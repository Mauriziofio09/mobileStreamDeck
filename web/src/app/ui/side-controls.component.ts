import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DeckStore } from '../core/deck.store';
import { LayoutService } from '../core/layout.service';
import { SurfaceDirective } from '../core/surface.directive';
import { TimerService } from '../core/timer.service';
import { IconComponent } from './icons';

/** Runder Uhr-Button + Pille mit den Segmenten "About" und "Bar". */
@Component({
  selector: 'cd-side-controls',
  imports: [SurfaceDirective, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-no-swipe': '',
    '[class.vertical]': 'vertical()',
  },
  template: `
    <button
      type="button"
      class="clock"
      [class.running]="!!timers.running()"
      cdSurface="button"
      [cdRadius]="0.5"
      aria-label="Timer"
      (click)="store.sheet.set('timer')"
    >
      <cd-icon name="clock" />
      @if (timers.running()) { <span class="time">{{ timers.display() }}</span> }
    </button>

    <div class="pill" cdSurface="pill" [cdRadius]="0.5">
      <button
        type="button"
        class="seg"
        [class.active]="store.sheet() === 'about'"
        (click)="store.sheet.set('about')"
      >
        @if (store.sheet() === 'about') { <span class="seg-bg" cdSurface="segment" [cdRadius]="0.5"></span> }
        <span class="seg-icon about-icon"><cd-icon name="info" /></span>
        <span class="seg-label">About</span>
      </button>
      <button type="button" class="seg" [class.active]="store.barActive()" (click)="store.toggleBar()">
        @if (store.barActive()) { <span class="seg-bg" cdSurface="segment" [cdRadius]="0.5"></span> }
        <span class="seg-icon"><cd-icon name="grid" /></span>
        <span class="seg-label">Bar</span>
      </button>
    </div>
  `,
  styleUrl: './side-controls.component.css',
})
export class SideControlsComponent {
  protected readonly store = inject(DeckStore);
  protected readonly timers = inject(TimerService);
  private readonly layout = inject(LayoutService);
  protected readonly vertical = computed(() => this.layout.layout().controls === 'side');
}
