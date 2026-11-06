import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TimerPreset } from '@copper-deck/shared';
import { DeckStore } from '../core/deck.store';
import { LayoutService } from '../core/layout.service';
import { SurfaceDirective } from '../core/surface.directive';
import { TIMER_LABEL, TIMER_MINUTES, TimerService } from '../core/timer.service';
import { IconComponent } from './icons';

/** About- und Timer-Auswahl als Overlay (ohne backdrop-filter). */
@Component({
  selector: 'cd-sheets',
  imports: [SurfaceDirective, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.sheet() !== 'none') {
      <div class="scrim" data-no-swipe (click)="store.sheet.set('none')">
        <div class="sheet" cdSurface="sheet" [cdRadius]="0.14" (click)="$event.stopPropagation()">
          @if (store.sheet() === 'about') {
            <h2>Copper Deck</h2>
            <p class="sub">Touch-Panel für deinen Mac</p>
            <dl>
              <dt>Verbindung</dt>
              <dd class="status demo"><cd-icon name="offline" /> Demo-Modus – noch kein Helper (Meilenstein 1)</dd>
              <dt>Gerät</dt>
              <dd>{{ layout.layout().device === 'pad' ? 'iPad' : 'iPhone' }}, {{ layout.layout().orientation === 'landscape' ? 'Querformat' : 'Hochformat' }}, {{ layout.layout().vw }}×{{ layout.layout().vh }}</dd>
              <dt>Konfiguration</dt>
              <dd>{{ store.config().groups.length }} Gruppen · {{ store.pages().length }} Seiten · Revision {{ store.config().revision }}</dd>
            </dl>
            <p class="hint">Langes Drücken auf eine Kachel startet den Bearbeitungsmodus.</p>
          } @else {
            <h2>Timer</h2>
            @if (timers.running(); as run) {
              <p class="running">{{ label(run.preset) }} läuft · <strong>{{ timers.display() }}</strong></p>
            } @else {
              <p class="sub">Es läuft immer nur ein Timer.</p>
            }
            <div class="choices">
              @for (p of presets; track p) {
                <button type="button" class="choice" [class.violet]="p === 'break'" [cdSurface]="p === 'break' ? 'tile-violet' : 'tile-brown'" [cdRadius]="0.22" (click)="toggle(p)">
                  <span class="emoji">{{ p === 'pomodoro' ? '🍅' : '😌' }}</span>
                  <span class="name">{{ label(p) }}</span>
                  <span class="min">{{ minutes(p) }} Min. · {{ timers.running()?.preset === p ? 'Stoppen' : 'Starten' }}</span>
                </button>
              }
            </div>
          }
          <button type="button" class="close" (click)="store.sheet.set('none')">Schliessen</button>
        </div>
      </div>
    }
  `,
  styleUrl: './sheets.component.css',
})
export class SheetsComponent {
  protected readonly store = inject(DeckStore);
  protected readonly timers = inject(TimerService);
  protected readonly layout = inject(LayoutService);
  protected readonly presets: readonly TimerPreset[] = ['pomodoro', 'break'];

  protected label(p: TimerPreset): string { return TIMER_LABEL[p]; }
  protected minutes(p: TimerPreset): number { return TIMER_MINUTES[p]; }

  protected toggle(p: TimerPreset): void {
    this.timers.toggle(p);
    this.store.sheet.set('none');
  }
}
