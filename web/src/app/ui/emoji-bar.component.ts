import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import type { EmojiItem } from '@copper-deck/shared';
import { ActionService } from '../core/action.service';
import { confirmRemoval } from '../core/confirm';
import { ConnectionService } from '../core/connection.service';
import { DeckStore } from '../core/deck.store';
import { EditorService, MAX_EMOJIS } from '../core/editor.service';
import { HOLD_TO_DRAG_MS, ReorderController } from '../core/reorder';
import { SurfaceDirective } from '../core/surface.directive';
import { IconComponent } from './icons';

/**
 * Pillenförmige Emoji-Leiste.
 * Bearbeitungsmodus: wackeln, ziehen zum Umsortieren, „–“ entfernt, Tippen ändert, „+“ fügt hinzu.
 */
@Component({
  selector: 'cd-emoji-bar',
  imports: [SurfaceDirective, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-editing]': 'store.editMode()' },
  template: `
    @if (items().length || store.editMode()) {
    <div class="bar" #bar cdSurface="bar" [cdRadius]="0.5" data-no-swipe>
      @for (e of items(); track e.id) {
        <button
          type="button"
          class="emoji"
          [attr.data-reorder-id]="e.id"
          [attr.aria-label]="store.editMode() ? 'Emoji ' + e.emoji + ' ändern' : e.emoji"
          [class.hit]="hit() === e.id"
          [class.offline]="!conn.online()"
          [class.drag-src]="reorder.dragId() === e.id"
          [style.--wiggle-delay]="wiggle(e.id)"
          (pointerdown)="reorder.down($event, e.id, ids())"
          (pointermove)="reorder.move($event)"
          (pointerup)="reorder.up($event)"
          (pointercancel)="reorder.cancel()"
          (contextmenu)="$event.preventDefault()"
          (click)="reorder.click(e.id)"
        >
          <span class="glyph">{{ e.emoji }}</span>
          @if (store.editMode()) {
            <span class="delete" role="button" aria-label="Emoji entfernen" (pointerdown)="$event.stopPropagation()" (click)="askRemove($event, e)"><cd-icon name="minus" /></span>
          }
        </button>
      }
      @if (store.editMode() && items().length < max) {
        <button type="button" class="add" aria-label="Emoji hinzufügen" (click)="editor.barEditing.set({ list: 'emojis', id: null })">+</button>
      }
    </div>
    }
  `,
  styles: `
    :host { display: flex; justify-content: center; }
    .bar {
      display: flex;
      align-items: center;
      height: var(--emoji-bar-h);
      padding: 0 calc(var(--emoji-bar-h) * 0.32);
      gap: calc(var(--emoji-bar-h) * 0.12);
      max-width: calc(100vw - var(--sa-l) - var(--sa-r) - 24px);
      box-sizing: border-box;
      overflow-x: auto;
      overflow-y: hidden;
      overscroll-behavior-x: contain;
      touch-action: pan-x;
      scrollbar-width: none;
    }
    .bar::-webkit-scrollbar { display: none; }
    .emoji, .add {
      position: relative;
      flex: none;
      width: calc(var(--emoji-bar-h) * 1.08);
      height: calc(var(--emoji-bar-h) * 0.9);
      border: 0;
      background: transparent;
      padding: 0;
      font-size: calc(var(--emoji-bar-h) * 0.56);
      line-height: 1;
      font-family: 'Apple Color Emoji', system-ui, sans-serif;
      transition: transform var(--t-press) var(--ease-out);
    }
    .glyph { display: inline-block; pointer-events: none; }
    .emoji:active { transform: scale(0.85); }
    .emoji.offline .glyph { opacity: 0.45; }
    .emoji.hit { animation: pop 300ms var(--ease-spring); }
    @keyframes pop { 50% { transform: scale(1.25); } }

    /* Bearbeitungsmodus */
    :host(.is-editing) .emoji:active { transform: none; }
    :host(.is-editing) .glyph { animation: wiggle 300ms ease-in-out infinite alternate; animation-delay: var(--wiggle-delay); }
    :host(.is-editing) .emoji.offline .glyph { opacity: 1; }
    .emoji.drag-src { opacity: 0.25; }
    @keyframes wiggle { from { transform: rotate(-4deg); } to { transform: rotate(4deg); } }
    .delete {
      position: absolute;
      top: calc(var(--emoji-bar-h) * 0.02);
      left: calc(var(--emoji-bar-h) * 0.02);
      width: calc(var(--emoji-bar-h) * 0.34);
      height: calc(var(--emoji-bar-h) * 0.34);
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: calc(var(--emoji-bar-h) * 0.2);
      color: var(--c-text-cream);
      background: var(--c-delete);
      box-shadow: 0 1px 4px var(--c-tile-shadow);
    }
    .add {
      font: 700 calc(var(--emoji-bar-h) * 0.48) / 1 var(--font-label);
      color: var(--c-text-cream);
      opacity: 0.8;
    }
    @media (prefers-reduced-motion: reduce) {
      :host(.is-editing) .glyph { animation: none; }
    }
  `,
})
export class EmojiBarComponent {
  protected readonly store = inject(DeckStore);
  protected readonly editor = inject(EditorService);
  private readonly actions = inject(ActionService);
  protected readonly conn = inject(ConnectionService);
  protected readonly hit = signal<string | null>(null);
  protected readonly max = MAX_EMOJIS;
  private readonly bar = viewChild<ElementRef<HTMLElement>>('bar');

  protected readonly reorder = new ReorderController({
    holdMs: HOLD_TO_DRAG_MS,
    scroller: () => this.bar()?.nativeElement,
    editMode: () => this.store.editMode(),
    onLongPress: () => this.store.enterEditMode(),
    onTap: (id) => (this.store.editMode() ? this.editor.barEditing.set({ list: 'emojis', id }) : void this.insert(id)),
    onDrop: (id, to) => this.editor.moveItem('emojis', id, to),
  });

  /** Während des Ziehens die vorläufige Reihenfolge anzeigen. */
  protected readonly items = computed<readonly EmojiItem[]>(() => {
    const list = this.store.config().emojis;
    const order = this.reorder.preview();
    if (!order) return list;
    const byId = new Map(list.map((e) => [e.id, e]));
    return order.map((id) => byId.get(id)).filter((e): e is EmojiItem => !!e);
  });
  protected readonly ids = computed(() => this.store.config().emojis.map((e) => e.id));

  private readonly delays = new Map<string, string>();
  protected wiggle(id: string): string {
    let d = this.delays.get(id);
    if (!d) this.delays.set(id, (d = `${-Math.round(Math.random() * 300)}ms`));
    return d;
  }

  protected askRemove(ev: Event, e: EmojiItem): void {
    ev.stopPropagation();
    if (confirmRemoval(e.id, e.emoji)) this.editor.removeItem('emojis', e.id);
  }


  private async insert(id: string): Promise<void> {
    this.hit.set(id);
    setTimeout(() => this.hit.set(null), 320);
    const r = await this.actions.run(id);
    if (!r.ok) this.store.toast(r.reason, 'error');
  }
}
