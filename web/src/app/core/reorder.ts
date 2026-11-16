import { signal } from '@angular/core';
import { GESTURE } from './gestures';

export interface ReorderOptions {
  /** Wartezeit ohne Bewegung, bevor im Bearbeitungsmodus das Ziehen beginnt (0 = sofort bei Bewegung). */
  readonly holdMs: number;
  /** Bearbeitungsmodus aktiv? */
  readonly editMode: () => boolean;
  /** Langes Drücken ausserhalb des Bearbeitungsmodus: Modus starten. */
  readonly onLongPress: () => void;
  /** Tippen: ausserhalb Aktion ausführen, im Bearbeitungsmodus Editor öffnen. */
  readonly onTap: (id: string) => void;
  /** Ziehen beendet: Eintrag an Index `to` (Liste ohne den Eintrag) verschieben. */
  readonly onDrop: (id: string, to: number) => void;
  /** Horizontal scrollender Container (Dock), wird am Rand während des Ziehens automatisch gescrollt. */
  readonly scroller?: () => HTMLElement | undefined;
}

/** Im Bearbeitungsmodus kurz halten, dann ziehen (sofortiges Wischen scrollt die Leiste). */
export const HOLD_TO_DRAG_MS = 200;

const AUTOSCROLL_EDGE = 44;
const AUTOSCROLL_SPEED = 9;

/**
 * Tippen, langes Drücken und Umsortieren für eine horizontale Liste (Emoji-Leiste, Dock).
 * Die Elemente tragen `data-reorder-id`. Während des Ziehens folgt eine Kopie dem Finger (nur transform),
 * und `preview` liefert die vorläufige Reihenfolge, damit die Liste live nachrückt.
 */
export class ReorderController {
  /** Vorläufige Reihenfolge der IDs während des Ziehens, sonst null. */
  readonly preview = signal<readonly string[] | null>(null);
  /** ID des gezogenen Eintrags. */
  readonly dragId = signal<string | null>(null);
  readonly pressedId = signal<string | null>(null);

  private start: { x: number; y: number; pointer: number; id: string; el: HTMLElement } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private armed = false;
  private suppressClick = false;
  private ghost: HTMLElement | null = null;
  private offset = { x: 0, y: 0 };
  private lastX = 0;
  private raf = 0;
  private ids: readonly string[] = [];
  /** Verhindert natives Scrollen (iOS), sobald das Ziehen scharf ist. */
  private readonly blockTouch = (e: TouchEvent) => {
    if (this.armed || this.ghost) e.preventDefault();
  };

  constructor(private readonly opts: ReorderOptions) {}

  down(e: PointerEvent, id: string, ids: readonly string[]): void {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.reset();
    const el = e.currentTarget as HTMLElement;
    this.start = { x: e.clientX, y: e.clientY, pointer: e.pointerId, id, el };
    this.ids = ids;
    this.suppressClick = false;
    el.addEventListener('touchmove', this.blockTouch, { passive: false });
    if (this.opts.editMode()) {
      if (this.opts.holdMs <= 0) this.armed = true;
      else this.timer = setTimeout(() => (this.armed = true), this.opts.holdMs);
    } else {
      this.pressedId.set(id);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.suppressClick = true;
        this.pressedId.set(null);
        this.opts.onLongPress();
      }, GESTURE.longPressMs);
    }
  }

  move(e: PointerEvent): void {
    const s = this.start;
    if (!s || e.pointerId !== s.pointer) return;
    if (this.ghost) {
      this.follow(e.clientX, e.clientY);
      return;
    }
    const moved = Math.hypot(e.clientX - s.x, e.clientY - s.y) > GESTURE.slop;
    if (!moved) return;
    if (this.opts.editMode() && this.armed) {
      this.begin(e);
    } else {
      // Bewegung vor dem Halten: Scrollen bzw. kein Tippen mehr.
      this.clearTimer();
      this.pressedId.set(null);
      this.suppressClick = true;
      this.start = null;
    }
  }

  up(e: PointerEvent): void {
    const s = this.start;
    if (!s || e.pointerId !== s.pointer) return;
    if (this.ghost) {
      const order = this.preview();
      const to = order ? order.indexOf(s.id) : -1;
      this.suppressClick = true;
      this.reset();
      if (to >= 0) this.opts.onDrop(s.id, to);
      return;
    }
    this.reset();
  }

  cancel(): void {
    this.suppressClick = true;
    this.reset();
  }

  /** click-Handler: Tippen auswerten (auch Tastatur), ausser nach langem Drücken oder Ziehen. */
  click(id: string): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.opts.onTap(id);
  }

  private begin(e: PointerEvent): void {
    const s = this.start!;
    this.clearTimer();
    s.el.setPointerCapture(s.pointer);
    const rect = s.el.getBoundingClientRect();
    const ghost = s.el.cloneNode(true) as HTMLElement;
    ghost.classList.add('cd-drag-ghost');
    ghost.removeAttribute('data-reorder-id');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.margin = '0';
    // In app-root einhängen; die Grössen-Variablen des Ursprungs mitnehmen (Overlay hat eigene Werte).
    const cs = getComputedStyle(s.el);
    for (const v of ['--dock-item', '--emoji-bar-h']) ghost.style.setProperty(v, cs.getPropertyValue(v));
    (document.querySelector('app-root') ?? document.body).appendChild(ghost);
    this.ghost = ghost;
    this.offset = { x: s.x - rect.left, y: s.y - rect.top };
    this.dragId.set(s.id);
    this.preview.set(this.ids);
    this.follow(e.clientX, e.clientY);
    this.autoScroll();
  }

  private follow(x: number, y: number): void {
    this.lastX = x;
    this.ghost!.style.transform = `translate3d(${x - this.offset.x}px, ${y - this.offset.y}px, 0) scale(1.1)`;
    this.updateTarget(x);
  }

  /** Zielposition = Anzahl der übrigen Einträge, deren Mitte links vom Finger liegt. */
  private updateTarget(x: number): void {
    const s = this.start;
    if (!s) return;
    const parent = s.el.parentElement;
    if (!parent) return;
    let index = 0;
    for (const el of Array.from(parent.querySelectorAll<HTMLElement>('[data-reorder-id]'))) {
      if (el.dataset['reorderId'] === s.id) continue;
      const r = el.getBoundingClientRect();
      if (r.left + r.width / 2 < x) index++;
    }
    const others = this.ids.filter((i) => i !== s.id);
    const next = [...others.slice(0, index), s.id, ...others.slice(index)];
    const cur = this.preview();
    if (!cur || cur.some((v, i) => v !== next[i])) this.preview.set(next);
  }

  private autoScroll(): void {
    const tick = () => {
      if (!this.ghost) return;
      const sc = this.opts.scroller?.();
      if (sc) {
        const r = sc.getBoundingClientRect();
        const dx = this.lastX < r.left + AUTOSCROLL_EDGE ? -AUTOSCROLL_SPEED : this.lastX > r.right - AUTOSCROLL_EDGE ? AUTOSCROLL_SPEED : 0;
        if (dx) {
          const before = sc.scrollLeft;
          sc.scrollLeft += dx;
          if (sc.scrollLeft !== before) this.updateTarget(this.lastX);
        }
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private reset(): void {
    this.clearTimer();
    cancelAnimationFrame(this.raf);
    this.start?.el.removeEventListener('touchmove', this.blockTouch);
    this.start = null;
    this.armed = false;
    this.ghost?.remove();
    this.ghost = null;
    this.dragId.set(null);
    this.preview.set(null);
    this.pressedId.set(null);
  }
}
