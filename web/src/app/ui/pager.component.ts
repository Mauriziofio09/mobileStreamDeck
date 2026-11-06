import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, untracked, viewChild,
} from '@angular/core';
import { DeckStore } from '../core/deck.store';
import { GESTURE, GestureBus } from '../core/gestures';
import { LayoutService } from '../core/layout.service';
import { SurfaceDirective } from '../core/surface.directive';
import { GroupComponent } from './group.component';

/**
 * Horizontale Seiten mit federnder Animation.
 * Animiert wird ausschliesslich `transform` des Tracks (requestAnimationFrame, ausserhalb der Change Detection).
 */
@Component({
  selector: 'cd-pager',
  imports: [GroupComponent, SurfaceDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.top.px]': 'layout.layout().stageTop',
    '[style.height.px]': 'layout.layout().stageH',
    '(pointerdown)': 'onDown($event)',
    '(pointermove)': 'onMove($event)',
    '(pointerup)': 'onUp($event)',
    '(pointercancel)': 'onUp($event)',
    '(lostpointercapture)': 'onUp($event)',
  },
  template: `
    <div class="track" #track [style.padding-left.px]="layout.layout().startX">
      @for (page of store.pages(); track $index) {
        <div
          class="page"
          [class.column]="layout.layout().pageFlow === 'column'"
          [style.width.px]="layout.layout().pageStep"
          [style.gap.px]="layout.layout().groupGap"
        >
          @for (group of page; track group.id) {
            <cd-group [group]="group" cdSurface="group" [cdRadius]="0.19" />
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      left: 0;
      right: 0;
      overflow: hidden;
      touch-action: none;
      /* Gruppen-Schatten und Leuchten nicht an der Bühne abschneiden */
      padding-block: 0;
    }
    .track {
      display: flex;
      height: 100%;
      align-items: center;
      will-change: transform;
    }
    .page {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: flex-start;
    }
    .page.column { flex-direction: column; justify-content: center; }
  `,
})
export class PagerComponent {
  protected readonly store = inject(DeckStore);
  protected readonly layout = inject(LayoutService);
  private readonly bus = inject(GestureBus);
  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');

  /** Aktuelle Position (px) und Geschwindigkeit (px/s) der Feder. */
  private x = 0;
  private v = 0;
  private target = 0;
  private raf = 0;
  private lastT = 0;
  private drag: {
    id: number; x0: number; y0: number; base: number;
    mode: 'pending' | 'swipe' | 'ignore';
    samples: { x: number; t: number }[];
  } | null = null;

  constructor() {
    // Seitenwechsel (Punkte, Wischen) -> Feder zum Ziel.
    effect(() => {
      const page = this.store.page();
      const step = this.layout.layout().pageStep;
      untracked(() => this.animateTo(-page * step));
    });
    // Seitenzahl kann sich mit Gerät/Ausrichtung ändern.
    effect(() => {
      const n = this.store.pages().length;
      untracked(() => { if (this.store.page() > n - 1) this.store.goTo(n - 1); });
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.raf));
  }

  protected onDown(e: PointerEvent): void {
    if (!e.isPrimary || this.drag) return;
    if ((e.target as Element).closest('[data-no-swipe]')) return;
    this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: this.x, mode: 'pending', samples: [] };
  }

  protected onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (d.mode === 'pending') {
      if (Math.abs(dx) > GESTURE.slop && Math.abs(dx) > Math.abs(dy) * 1.2) {
        d.mode = 'swipe';
        d.x0 = e.clientX; // ohne Sprung um die Schwelle starten
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        this.bus.swipeStarted.update((n) => n + 1);
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        d.base = this.x;
      } else if (Math.abs(dy) > GESTURE.slop) {
        d.mode = 'ignore';
      }
      return;
    }
    if (d.mode !== 'swipe') return;
    const delta = e.clientX - d.x0;
    const min = -(this.store.pages().length - 1) * this.layout.layout().pageStep;
    let next = d.base + delta;
    // Gummiband an den Enden (innerhalb der App, nicht das iOS-Rubber-Banding)
    if (next > 0) next = next * 0.35;
    if (next < min) next = min + (next - min) * 0.35;
    this.x = next;
    this.v = 0;
    this.apply();
    d.samples.push({ x: e.clientX, t: e.timeStamp });
    if (d.samples.length > 6) d.samples.shift();
  }

  protected onUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (d.mode !== 'swipe') return;
    const s = d.samples;
    const vel = s.length >= 2 ? (s[s.length - 1]!.x - s[0]!.x) / Math.max(1, s[s.length - 1]!.t - s[0]!.t) : 0; // px/ms
    const step = this.layout.layout().pageStep;
    const current = this.store.page();
    const moved = (this.x + current * step) / step; // >0 nach rechts gezogen
    let target = current;
    if (vel < -0.35 || moved < -0.3) target = current + 1;
    else if (vel > 0.35 || moved > 0.3) target = current - 1;
    this.v = vel * 1000;
    const clamped = Math.max(0, Math.min(this.store.pages().length - 1, target));
    if (clamped === current) this.animateTo(-current * step);
    else this.store.goTo(clamped);
  }

  private animateTo(target: number): void {
    this.target = target;
    if (this.drag?.mode === 'swipe') return;
    if (!this.raf) {
      this.lastT = performance.now();
      this.raf = requestAnimationFrame((t) => this.tick(t));
    }
  }

  /** Unterkritisch gedämpfte Feder -> leichtes Nachfedern. */
  private tick(t: number): void {
    const dt = Math.min(0.032, (t - this.lastT) / 1000);
    this.lastT = t;
    const k = 240, c = 26;
    const a = -k * (this.x - this.target) - c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    if (Math.abs(this.x - this.target) < 0.3 && Math.abs(this.v) < 8) {
      this.x = this.target;
      this.v = 0;
      this.apply();
      this.raf = 0;
      return;
    }
    this.apply();
    this.raf = requestAnimationFrame((n) => this.tick(n));
  }

  private apply(): void {
    this.track().nativeElement.style.transform = `translate3d(${this.x.toFixed(2)}px,0,0)`;
  }
}
