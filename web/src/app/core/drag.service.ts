import { Injectable, inject, signal } from '@angular/core';
import { DeckStore } from './deck.store';
import { EditorService, type Slot } from './editor.service';

const EDGE_PX = 40;
const EDGE_DELAY_MS = 550;
const EDGE_REPEAT_MS = 900;

/**
 * Ziehen von Kacheln im Bearbeitungsmodus (Touch/Pointer).
 * Eine Kopie folgt dem Finger (nur transform); Ziel ist der Platz unter dem Finger.
 * Am linken/rechten Rand verweilen blättert zur vorigen/nächsten Seite.
 */
@Injectable({ providedIn: 'root' })
export class DragService {
  private readonly store = inject(DeckStore);
  private readonly editor = inject(EditorService);

  readonly source = signal<Slot | null>(null);
  readonly target = signal<Slot | null>(null);

  private ghost: HTMLElement | null = null;
  private offset = { x: 0, y: 0 };
  private edgeTimer: ReturnType<typeof setTimeout> | null = null;
  private edgeSide: -1 | 0 | 1 = 0;

  start(slot: Slot, el: HTMLElement, e: PointerEvent): void {
    const rect = el.getBoundingClientRect();
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.add('cd-drag-ghost');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    // In app-root einhängen, damit die CSS-Variablen (--frame, --tile) gelten.
    (document.querySelector('app-root') ?? document.body).appendChild(ghost);
    this.ghost = ghost;
    this.offset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.source.set(slot);
    this.move(e);
  }

  move(e: PointerEvent): void {
    if (!this.ghost) return;
    const x = e.clientX - this.offset.x;
    const y = e.clientY - this.offset.y;
    this.ghost.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.08)`;
    this.target.set(this.slotAt(e.clientX, e.clientY));
    this.edge(e.clientX);
  }

  end(): void {
    const from = this.source();
    const to = this.target();
    this.cleanup();
    if (from && to) this.editor.move(from, to);
  }

  cancel(): void {
    this.cleanup();
  }

  private cleanup(): void {
    this.ghost?.remove();
    this.ghost = null;
    this.source.set(null);
    this.target.set(null);
    this.clearEdge();
  }

  private slotAt(x: number, y: number): Slot | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('cd-tile[data-group-id]');
    if (!el) return null;
    const groupId = el.dataset['groupId'];
    const index = Number(el.dataset['index']);
    return groupId && Number.isInteger(index) ? { groupId, index } : null;
  }

  private edge(x: number): void {
    const side: -1 | 0 | 1 = x < EDGE_PX ? -1 : x > window.innerWidth - EDGE_PX ? 1 : 0;
    if (side === this.edgeSide) return;
    this.clearEdge();
    this.edgeSide = side;
    if (side === 0) return;
    const flip = (delay: number) => {
      this.edgeTimer = setTimeout(() => {
        const page = this.store.page() + side;
        if (page >= 0 && page < this.store.pages().length) this.store.goTo(page);
        flip(EDGE_REPEAT_MS);
      }, delay);
    };
    flip(EDGE_DELAY_MS);
  }

  private clearEdge(): void {
    if (this.edgeTimer) clearTimeout(this.edgeTimer);
    this.edgeTimer = null;
    this.edgeSide = 0;
  }
}
