import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { Tile } from '@copper-deck/shared';
import { ActionService } from '../core/action.service';
import { AppCatalogService } from '../core/app-catalog.service';
import { DeckStore } from '../core/deck.store';
import { GESTURE, GestureBus } from '../core/gestures';
import { SurfaceDirective, SurfaceVariant } from '../core/surface.directive';
import { TimerService } from '../core/timer.service';
import { IconComponent } from './icons';

type Status = 'idle' | 'busy' | 'ok' | 'error';

@Component({
  selector: 'cd-tile',
  imports: [SurfaceDirective, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-pressed]': 'pressed()',
    '[class.is-editing]': 'store.editMode()',
    '[class.is-empty]': '!tile()',
    '[style.--wiggle-delay]': 'wiggleDelay',
    '[style.--label-scale]': 'labelScale()',
    '(pointerdown)': 'onDown($event)',
    '(pointermove)': 'onMove($event)',
    '(pointerup)': 'onUp($event)',
    '(pointercancel)': 'cancel()',
    '(contextmenu)': '$event.preventDefault()',
  },
  template: `
    <div class="frame" cdSurface="frame" [cdRadius]="0.27">
      @if (tile(); as t) {
        <div class="tile" [cdSurface]="variant()" [cdRadius]="0.25" [class.violet]="isViolet()" [class.missing]="look() === 'missing'">
          @switch (look()) {
            @case ('app') {
              <img class="app-icon" [src]="appIcon()" alt="" draggable="false" />
            }
            @case ('missing') {
              <span class="missing-mark">?</span>
              <span class="label">{{ t.label }}</span>
              <span class="missing-note">Nicht<br />installiert</span>
            }
            @default {
              @if (t.kind === 'action') {
                @switch (t.icon.type) {
                  @case ('emoji') { <span class="glyph emoji">{{ emoji() }}</span> }
                  @case ('appIcon') { <img class="glyph app-glyph" [src]="glyphSrc()" alt="" draggable="false" /> }
                  @case ('image') { <img class="glyph image-glyph" [src]="glyphSrc()" alt="" draggable="false" /> }
                }
              }
              <span class="label">{{ t.label }}</span>
              @if (timerText(); as tt) { <span class="countdown">{{ tt }}</span> }
            }
          }
          <span class="flash" [class.on]="flash()"></span>
        </div>
        @if (status() === 'ok' || status() === 'error') {
          <span class="badge" [class.error]="status() === 'error'">
            <cd-icon [name]="status() === 'ok' ? 'check' : 'cross'" />
          </span>
        }
        @if (store.editMode()) {
          <span class="delete" aria-label="Entfernen"><cd-icon name="minus" /></span>
        }
      } @else {
        <div class="tile empty" [class.visible]="store.editMode()" cdSurface="tile-empty" [cdRadius]="0.25"></div>
      }
    </div>
  `,
  styleUrl: './tile.component.css',
})
export class TileComponent {
  readonly tile = input<Tile | null>(null);

  protected readonly store = inject(DeckStore);
  private readonly catalog = inject(AppCatalogService);
  private readonly actions = inject(ActionService);
  private readonly timers = inject(TimerService);
  private readonly bus = inject(GestureBus);

  protected readonly pressed = signal(false);
  protected readonly flash = signal(false);
  protected readonly status = signal<Status>('idle');
  protected readonly wiggleDelay = `${-Math.round(Math.random() * 300)}ms`;

  private start: { x: number; y: number; id: number } | null = null;
  private longTimer: ReturnType<typeof setTimeout> | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private longFired = false;

  /** Darstellung: echtes App-Icon, Verlaufskachel oder "nicht installiert". */
  protected readonly look = computed<'app' | 'action' | 'missing'>(() => {
    const t = this.tile();
    if (!t) return 'action';
    if (t.action.type === 'openApp') {
      const entry = this.catalog.lookup(t.action.bundleId);
      if (entry === null) return 'missing';
      // Unbekannt (Index fehlt) oder kein Icon extrahierbar: als Verlaufskachel mit Beschriftung.
      if (t.kind === 'app') return entry?.icon ? 'app' : 'action';
    }
    return 'action';
  });

  protected readonly variant = computed<SurfaceVariant>(() => {
    const t = this.tile();
    const look = this.look();
    if (look === 'missing') return 'tile-missing';
    if (look === 'app') return 'icon';
    return t?.kind === 'action' && t.color === 'violet' ? 'tile-violet' : 'tile-brown';
  });

  /** Lange Einzelwörter (z. B. BILDSCHIRMFOTO) verkleinern statt trennen. */
  protected readonly labelScale = computed(() => {
    const longest = Math.max(0, ...(this.tile()?.label ?? '').split(/\s+/).map((w) => w.length));
    return Math.min(1, 10 / Math.max(1, longest));
  });

  protected readonly isViolet = computed(() => this.variant() === 'tile-violet');

  protected readonly appIcon = computed(() => {
    const t = this.tile();
    return t?.action.type === 'openApp' ? (this.catalog.lookup(t.action.bundleId)?.icon ?? '') : '';
  });

  protected readonly emoji = computed(() => {
    const t = this.tile();
    return t?.kind === 'action' && t.icon.type === 'emoji' ? t.icon.emoji : '';
  });

  protected readonly glyphSrc = computed(() => {
    const t = this.tile();
    if (t?.kind !== 'action') return '';
    if (t.icon.type === 'appIcon') return this.catalog.lookup(t.icon.bundleId)?.icon ?? '';
    if (t.icon.type === 'image') return `media/${encodeURIComponent(t.icon.file)}`;
    return '';
  });

  /** Countdown direkt auf der Timer-Kachel. */
  protected readonly timerText = computed(() => {
    const t = this.tile();
    const run = this.timers.running();
    if (t?.action.type !== 'timer' || run?.preset !== t.action.preset) return null;
    return this.timers.display();
  });

  constructor() {
    // Seitenwischen übernimmt -> Tippen und langes Drücken abbrechen.
    let first = true;
    effect(() => {
      this.bus.swipeStarted();
      if (first) { first = false; return; }
      this.cancel();
    });
    inject(DestroyRef).onDestroy(() => {
      this.clearLong();
      if (this.statusTimer) clearTimeout(this.statusTimer);
    });
  }

  protected onDown(e: PointerEvent): void {
    if (!e.isPrimary || !this.tile()) return;
    this.start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    this.longFired = false;
    this.pressed.set(!this.store.editMode());
    this.clearLong();
    this.longTimer = setTimeout(() => {
      this.longFired = true;
      this.pressed.set(false);
      this.store.editMode.set(true);
    }, GESTURE.longPressMs);
  }

  protected onMove(e: PointerEvent): void {
    if (!this.start || e.pointerId !== this.start.id) return;
    if (Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y) > GESTURE.slop) this.cancel();
  }

  protected onUp(e: PointerEvent): void {
    if (!this.start || e.pointerId !== this.start.id) return;
    const wasTap = !this.longFired;
    this.cancel();
    if (wasTap && !this.store.editMode()) void this.trigger();
  }

  protected cancel(): void {
    this.start = null;
    this.pressed.set(false);
    this.clearLong();
  }

  private clearLong(): void {
    if (this.longTimer) clearTimeout(this.longTimer);
    this.longTimer = null;
  }

  private async trigger(): Promise<void> {
    const t = this.tile();
    if (!t || this.status() === 'busy') return;
    this.flash.set(true);
    setTimeout(() => this.flash.set(false), 260);
    this.status.set('busy');
    const result = await this.actions.run(t.action);
    this.status.set(result.ok ? 'ok' : 'error');
    if (!result.ok) this.store.toast(result.reason, 'error');
    else if (result.message) this.store.toast(result.message, 'info');
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this.status.set('idle'), result.ok ? 900 : 1800);
  }
}
