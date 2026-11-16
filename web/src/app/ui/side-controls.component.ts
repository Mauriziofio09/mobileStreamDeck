import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ConnectionService } from '../core/connection.service';
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
        <span class="seg-icon about-icon"><cd-icon name="info" /><span class="conn" [attr.data-state]="permMissing() ? 'perm' : conn.state()"></span></span>
        <span class="seg-label">About</span>
      </button>
      <button type="button" class="seg" [class.active]="store.view() === 'lightroom'" aria-label="Lightroom" (click)="store.toggleLightroom()">
        @if (store.view() === 'lightroom') { <span class="seg-bg" cdSurface="segment" [cdRadius]="0.5"></span> }
        <span class="seg-icon lr-icon"><cd-icon name="aperture" />@if (lrConnected()) { <span class="lr-dot"></span> }</span>
        <span class="seg-label">LR</span>
      </button>
      <button type="button" class="seg" [class.active]="store.barActive()" [disabled]="store.view() === 'lightroom'" (click)="store.toggleBar()">
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
  protected readonly conn = inject(ConnectionService);
  private readonly layout = inject(LayoutService);
  protected readonly permMissing = computed(() => {
    const p = this.conn.permissions();
    return !!p && (p.accessibility !== 'granted' || p.automation !== 'granted' || p.notifications !== 'granted');
  });
  protected readonly vertical = computed(() => this.layout.layout().controls === 'side');
  protected readonly lrConnected = computed(() => this.conn.lightroom().connected);
}
