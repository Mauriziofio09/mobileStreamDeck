import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActionService } from '../core/action.service';
import { DeckStore } from '../core/deck.store';
import { SurfaceDirective } from '../core/surface.directive';

/** Pillenförmige Emoji-Leiste (8 Emojis). */
@Component({
  selector: 'cd-emoji-bar',
  imports: [SurfaceDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar" cdSurface="bar" [cdRadius]="0.5" data-no-swipe>
      @for (e of store.config().emojis; track $index) {
        <button type="button" class="emoji" [class.hit]="hit() === $index" (click)="insert(e, $index)">{{ e }}</button>
      }
    </div>
  `,
  styles: `
    :host { display: flex; justify-content: center; }
    .bar {
      display: flex;
      align-items: center;
      height: var(--emoji-bar-h);
      padding: 0 calc(var(--emoji-bar-h) * 0.32);
      gap: calc(var(--emoji-bar-h) * 0.12);
    }
    .emoji {
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
    .emoji:active { transform: scale(0.85); }
    .emoji.hit { animation: pop 300ms var(--ease-spring); }
    @keyframes pop { 50% { transform: scale(1.25); } }
  `,
})
export class EmojiBarComponent {
  protected readonly store = inject(DeckStore);
  private readonly actions = inject(ActionService);
  protected readonly hit = signal<number | null>(null);

  protected async insert(emoji: string, i: number): Promise<void> {
    this.hit.set(i);
    setTimeout(() => this.hit.set(null), 320);
    const r = await this.actions.run({ type: 'insertEmoji', emoji });
    if (!r.ok) this.store.toast(r.reason, 'error');
  }
}
