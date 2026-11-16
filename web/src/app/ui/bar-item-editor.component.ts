import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DeckStore } from '../core/deck.store';
import { EditorService } from '../core/editor.service';
import { SurfaceDirective } from '../core/surface.directive';
import { AppPickerComponent, type AppEntry } from './app-picker.component';

/** Vorschläge für die Emoji-Leiste; jedes andere Emoji geht über die Emoji-Tastatur. */
const SUGGESTIONS = ['😂', '🤩', '🤣', '❤️', '😱', '😘', '😍', '🥰', '👍', '🙏', '🔥', '🎉', '😅', '🤔', '👀', '✅'];

/** Editor für einen Eintrag der Emoji-Leiste (Emoji) oder des Docks (App-Auswahl). */
@Component({
  selector: 'cd-bar-item-editor',
  imports: [SurfaceDirective, AppPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (editor.barEditing(); as e) {
      <div class="scrim" data-no-swipe (click)="close()">
        <div class="sheet" cdSurface="sheet" [cdRadius]="0.06" (click)="$event.stopPropagation()" role="dialog"
             [attr.aria-label]="e.list === 'emojis' ? 'Emoji bearbeiten' : 'Dock bearbeiten'">
          @if (e.list === 'emojis') {
            <header>
              <h2>{{ e.id ? 'Emoji ändern' : 'Neues Emoji' }}</h2>
              <span class="big-emoji" aria-hidden="true">{{ valid() ? value().trim() : '' }}</span>
            </header>
            <section>
              <label class="lbl" for="bar-emoji">Emoji (über die Emoji-Tastatur oder unten auswählen)</label>
              <input id="bar-emoji" class="emoji-in" maxlength="16" autocomplete="off" [value]="value()" (input)="value.set(text($event))" />
              <div class="suggest">
                @for (s of suggestions; track s) {
                  <button type="button" [class.on]="value().trim() === s" (click)="value.set(s)">{{ s }}</button>
                }
              </div>
            </section>
            @if (!valid() && value().trim()) { <ul class="errors"><li>Nur ein Emoji bzw. kurze Zeichenfolge ohne Leerzeichen.</li></ul> }
            <footer>
              @if (e.id) { <button type="button" class="danger" (click)="remove()">Entfernen</button> }
              <span class="grow"></span>
              <button type="button" class="ghost" (click)="close()">Abbrechen</button>
              <button type="button" class="primary" cdSurface="tile-brown" [cdRadius]="0.3" [disabled]="!valid()" (click)="saveEmoji()">Sichern</button>
            </footer>
          } @else {
            <cd-app-picker
              [title]="e.id ? 'App im Dock ersetzen' : 'App zum Dock hinzufügen'"
              backLabel="Abbrechen"
              [selected]="currentBundle()"
              [taken]="dockBundles()"
              (picked)="pickApp($event)"
              (back)="close()"
            />
            @if (e.id) {
              <footer>
                <button type="button" class="danger" (click)="remove()">Aus dem Dock entfernen</button>
              </footer>
            }
          }
        </div>
      </div>
    }
  `,
  styleUrl: './tile-editor.component.css',
  styles: `
    .big-emoji { font-size: 56px; line-height: 1; min-width: 64px; text-align: center; font-family: 'Apple Color Emoji', system-ui, sans-serif; }
    .suggest { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; }
    .suggest button {
      border: 0; border-radius: 10px; background: transparent; padding: 6px 0;
      font-size: 28px; line-height: 1; font-family: 'Apple Color Emoji', system-ui, sans-serif;
    }
    .suggest button.on { background: var(--c-seg-fill-bottom); }
  `,
})
export class BarItemEditorComponent {
  protected readonly editor = inject(EditorService);
  private readonly store = inject(DeckStore);
  protected readonly suggestions = SUGGESTIONS;
  protected readonly value = signal('');

  protected readonly valid = computed(() => isEmojiish(this.value()));
  protected readonly dockBundles = computed(() => this.store.config().dock.map((d) => d.bundleId));
  protected readonly currentBundle = computed(() => {
    const e = this.editor.barEditing();
    return (e?.list === 'dock' && this.store.config().dock.find((d) => d.id === e.id)?.bundleId) || '';
  });

  constructor() {
    // Beim Öffnen den Entwurf befüllen.
    effect(() => {
      const e = this.editor.barEditing();
      untracked(() => {
        if (e?.list !== 'emojis') return;
        this.value.set(e.id ? (this.store.config().emojis.find((x) => x.id === e.id)?.emoji ?? '') : '');
      });
    });
    // Während der Editor offen ist, kann ein anderes Gerät den Eintrag löschen.
    effect(() => {
      const e = this.editor.barEditing();
      if (!e?.id) return;
      const cfg = this.store.config();
      const exists = e.list === 'emojis' ? cfg.emojis.some((x) => x.id === e.id) : cfg.dock.some((x) => x.id === e.id);
      if (!exists) untracked(() => this.editor.barEditing.set(null));
    });
  }

  protected text(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected saveEmoji(): void {
    const e = this.editor.barEditing();
    if (!e || !this.valid()) return;
    this.editor.saveEmoji(e.id, this.value().trim());
    this.close();
  }

  protected pickApp(a: AppEntry): void {
    const e = this.editor.barEditing();
    if (!e) return;
    const other = this.store.config().dock.find((d) => d.bundleId === a.bundleId && d.id !== e.id);
    if (other) {
      this.store.toast(`${a.name} ist schon im Dock.`, 'error');
      return;
    }
    const label = (a.name.trim() || a.bundleId).slice(0, 40);
    this.editor.saveDockApp(e.id, a.bundleId, label);
    this.close();
  }

  protected remove(): void {
    const e = this.editor.barEditing();
    if (!e?.id) return;
    this.editor.removeItem(e.list, e.id);
    this.close();
  }

  protected close(): void {
    this.editor.barEditing.set(null);
  }
}

function isEmojiish(v: string): boolean {
  const s = v.trim();
  // Wie das Schema des Helpers: 1–32 Zeichen, keine Steuerzeichen, kein Leerraum, kein < >.
  return s.length > 0 && s.length <= 32 && /^[^\p{Cc}\s<>]+$/u.test(s);
}
