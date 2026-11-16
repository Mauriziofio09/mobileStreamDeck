import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { LrParamDef } from '@copper-deck/shared';
import { formatLr, LightroomService } from '../core/lightroom.service';

const DOUBLE_TAP_MS = 320;

/**
 * Lightroom-Regler.
 * - Ziehen ist relativ (kein Sprung beim Antippen); je weiter der Finger senkrecht vom Regler weg ist,
 *   desto feiner (wie das Scrubbing in iOS).
 * - Doppeltippen setzt auf den Standardwert zurück, − und + verwenden die Schrittweite von Lightroom.
 */
@Component({
  selector: 'cd-lr-slider',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.disabled]': 'disabled()', '[class.active]': 'dragging()' },
  template: `
    <div class="head">
      <span class="label">{{ def().label }}</span>
      <span class="value">{{ text() }}</span>
    </div>
    <div class="row">
      <button type="button" class="step" [disabled]="disabled()" [attr.aria-label]="def().label + ' verringern'" (click)="lr.run({ cmd: 'dec', param: def().id })">−</button>
      <div
        class="track"
        role="slider"
        [attr.aria-label]="def().label"
        [attr.aria-valuemin]="range()[0]"
        [attr.aria-valuemax]="range()[1]"
        [attr.aria-valuenow]="value() ?? null"
        [attr.aria-valuetext]="text()"
        [style.--track]="def().track ?? null"
        (pointerdown)="down($event)"
        (pointermove)="move($event)"
        (pointerup)="up($event)"
        (pointercancel)="up($event)"
      >
        <span class="rail" [class.colored]="!!def().track"></span>
        @if (!def().track) { <span class="fill" [style.left.%]="fill()[0]" [style.width.%]="fill()[1]"></span> }
        <span class="thumb" [style.left.%]="pos()"></span>
        @if (fine()) { <span class="fine">fein</span> }
      </div>
      <button type="button" class="step" [disabled]="disabled()" [attr.aria-label]="def().label + ' erhöhen'" (click)="lr.run({ cmd: 'inc', param: def().id })">+</button>
    </div>
  `,
  styles: `
    :host { display: block; padding: 6px 0 4px; user-select: none; -webkit-user-select: none; }
    :host(.disabled) { opacity: 0.4; pointer-events: none; }
    .head { display: flex; justify-content: space-between; align-items: baseline; font-size: 14px; color: var(--c-text-muted); padding: 0 34px; }
    .label { color: var(--c-text-cream); }
    .value { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--c-text-cream); }
    :host(.active) .value { color: var(--c-text-lilac); }
    .row { display: flex; align-items: center; gap: 4px; }
    .step {
      flex: none; width: 30px; height: 36px; border: 0; background: transparent;
      color: var(--c-text-muted); font: 500 22px/1 var(--font-ui);
    }
    .step:active { color: var(--c-text-cream); }
    .track { position: relative; flex: 1; height: 36px; touch-action: none; cursor: ew-resize; }
    .rail {
      position: absolute; left: 0; right: 0; top: 50%; height: 4px; margin-top: -2px; border-radius: 2px;
      background: var(--c-group-fill-top); box-shadow: inset 0 0 0 1px var(--c-frame-rim);
    }
    .rail.colored { background: var(--track); height: 6px; margin-top: -3px; opacity: 0.85; }
    .fill { position: absolute; top: 50%; height: 4px; margin-top: -2px; border-radius: 2px; background: var(--c-text-lilac); opacity: 0.75; }
    .thumb {
      position: absolute; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
      background: var(--c-text-cream); box-shadow: 0 1px 4px var(--c-tile-shadow), 0 0 0 1px var(--c-frame-rim);
      transition: transform var(--t-press) var(--ease-out);
    }
    :host(.active) .thumb { transform: scale(1.18); }
    .fine { position: absolute; right: 0; top: -2px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--c-text-lilac); }
  `,
})
export class LrSliderComponent {
  readonly def = input.required<LrParamDef>();
  readonly disabled = input(false);

  protected readonly lr = inject(LightroomService);
  protected readonly dragging = signal(false);
  protected readonly fine = signal(false);

  protected readonly range = computed(() => this.lr.range(this.def().id));
  protected readonly value = computed(() => this.lr.values()[this.def().id]);
  protected readonly text = computed(() => formatLr(this.def(), this.value(), this.range()));

  /** Position des Reglerknopfs in %. */
  protected readonly pos = computed(() => {
    const [lo, hi] = this.range();
    const v = this.value() ?? (lo < 0 ? 0 : lo);
    return ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100;
  });

  /** Füllung ab der Mitte (zweiseitig) bzw. ab links: [left%, width%]. */
  protected readonly fill = computed<[number, number]>(() => {
    const [lo] = this.range();
    const p = this.pos();
    if (lo < 0) {
      const zero = this.zeroPos();
      return [Math.min(zero, p), Math.abs(p - zero)];
    }
    return [0, p];
  });

  private zeroPos(): number {
    const [lo, hi] = this.range();
    return ((0 - lo) / (hi - lo)) * 100;
  }

  private start: { x: number; y: number; value: number; width: number; id: number } | null = null;
  private lastTap = 0;
  private lastFactor: number | undefined;

  protected down(e: PointerEvent): void {
    if (this.disabled() || !e.isPrimary) return;
    const now = Date.now();
    if (now - this.lastTap < DOUBLE_TAP_MS) {
      this.lastTap = 0;
      void this.lr.run({ cmd: 'reset', param: this.def().id });
      return;
    }
    this.lastTap = now;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const [lo] = this.range();
    this.start = { x: e.clientX, y: e.clientY, value: this.value() ?? (lo < 0 ? 0 : lo), width: el.getBoundingClientRect().width, id: e.pointerId };
  }

  protected move(e: PointerEvent): void {
    const s = this.start;
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x;
    if (!this.dragging() && Math.abs(dx) < 3) return;
    this.dragging.set(true);
    // Feinmodus: ab 60 px senkrechtem Abstand halbe, ab 140 px viertel Geschwindigkeit.
    const dy = Math.abs(e.clientY - s.y);
    const factor = dy > 140 ? 0.25 : dy > 60 ? 0.5 : 1;
    this.fine.set(factor < 1);
    const [lo, hi] = this.range();
    const next = s.value + (dx / s.width) * (hi - lo) * factor;
    // Bei Wechsel des Feinmodus von der aktuellen Position aus weiterrechnen.
    if (factor !== this.lastFactor) {
      this.lastFactor = factor;
      s.x = e.clientX;
      s.value = this.value() ?? s.value;
      return;
    }
    this.lr.set(this.def().id, next);
  }

  protected up(e: PointerEvent): void {
    const s = this.start;
    if (!s || e.pointerId !== s.id) return;
    this.start = null;
    this.lastFactor = undefined;
    if (this.dragging()) {
      this.lastTap = 0; // Ziehen zählt nicht als erster Tipp eines Doppeltipps
      this.lr.release(this.def().id);
    }
    this.dragging.set(false);
    this.fine.set(false);
  }
}
