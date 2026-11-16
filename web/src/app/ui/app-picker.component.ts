import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { AppCatalogService } from '../core/app-catalog.service';

export interface AppEntry {
  readonly bundleId: string;
  readonly name: string;
}

/** Liste der installierten Apps mit Suche (Kachel-Editor und Dock). */
@Component({
  selector: 'cd-app-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="pick-head">
      <button type="button" class="ghost" (click)="back.emit()">{{ backLabel() }}</button>
      <h2>{{ title() }}</h2>
    </header>
    <input class="search" type="search" placeholder="Suchen" autocapitalize="off" autocorrect="off" [value]="query()" (input)="query.set(text($event))" />
    @if (error(); as err) { <p class="error">{{ err }}</p> }
    @if (!apps() && !error()) { <p class="muted">Lade installierte Apps …</p> }
    <ul class="apps">
      @for (a of filtered(); track a.bundleId) {
        <li>
          <button type="button" [class.on]="a.bundleId === selected()" [class.taken]="taken().includes(a.bundleId)" (click)="picked.emit(a)">
            @if (catalog.iconUrl(a.bundleId); as src) { <img [src]="src" alt="" loading="lazy" /> } @else { <span class="noicon"></span> }
            <span class="name">{{ a.name }}</span>
            <span class="bid">{{ taken().includes(a.bundleId) && a.bundleId !== selected() ? 'Schon im Dock · ' : '' }}{{ a.bundleId }}</span>
          </button>
        </li>
      }
    </ul>
  `,
  styleUrl: './tile-editor.component.css',
})
export class AppPickerComponent implements OnInit {
  readonly title = input('App auswählen');
  readonly backLabel = input('‹ Zurück');
  readonly selected = input('');
  /** Bereits verwendete Apps (nur Hinweis, z. B. im Dock). */
  readonly taken = input<readonly string[]>([]);
  readonly picked = output<AppEntry>();
  readonly back = output<void>();

  protected readonly catalog = inject(AppCatalogService);
  protected readonly apps = signal<AppEntry[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLocaleLowerCase('de');
    const list = this.apps() ?? [];
    return q ? list.filter((a) => a.name.toLocaleLowerCase('de').includes(q) || a.bundleId.toLowerCase().includes(q)) : list;
  });

  async ngOnInit(): Promise<void> {
    try {
      this.apps.set(await this.catalog.listInstalled());
    } catch {
      this.error.set('App-Liste konnte nicht geladen werden.');
    }
  }

  protected text(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }
}
