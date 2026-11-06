import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ConnectionService } from './core/connection.service';
import { DeckStore } from './core/deck.store';
import { LayoutService, RATIO } from './core/layout.service';
import { SurfaceDirective } from './core/surface.directive';
import { DockComponent } from './ui/dock.component';
import { EmojiBarComponent } from './ui/emoji-bar.component';
import { PageDotsComponent } from './ui/page-dots.component';
import { PagerComponent } from './ui/pager.component';
import { SheetsComponent } from './ui/sheets.component';
import { OfflineComponent } from './ui/offline.component';
import { PairingComponent } from './ui/pairing.component';
import { SideControlsComponent } from './ui/side-controls.component';

@Component({
  selector: 'app-root',
  imports: [
    PagerComponent, PageDotsComponent, EmojiBarComponent, DockComponent,
    SideControlsComponent, SheetsComponent, SurfaceDirective, PairingComponent, OfflineComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClass()',
    '[style]': 'vars()',
  },
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly store = inject(DeckStore);
  protected readonly layoutService = inject(LayoutService);
  protected readonly layout = this.layoutService.layout;
  protected readonly conn = inject(ConnectionService);

  /** Kopplung, Offline-Vollbild (noch nie Konfiguration erhalten) oder das Deck. */
  protected readonly view = computed<'pairing' | 'offline' | 'deck'>(() => {
    if (this.conn.state() === 'unpaired') return 'pairing';
    if (!this.conn.config()) return 'offline';
    return 'deck';
  });

  protected readonly hostClass = computed(() => {
    const l = this.layout();
    return `is-${l.device} is-${l.orientation} bar-${l.barMode}`;
  });

  /** Geometrie als CSS-Variablen; alle Kachelmasse leiten sich von --frame ab. */
  protected readonly vars = computed(() => {
    const l = this.layout();
    const f = l.frame;
    const groupsBottom = l.stageTop + l.stageH / 2 + l.contentH / 2;
    return {
      '--frame': `${f}px`,
      '--tile': `${Math.round(f * (1 - 2 * RATIO.tileInset))}px`,
      '--gap': `${Math.round(f * RATIO.gap)}px`,
      '--groups-bottom': `${Math.round(groupsBottom)}px`,
      '--groups-mid': `${Math.round(l.stageTop + l.stageH / 2)}px`,
      '--stage-top': `${l.stageTop}px`,
      '--bar-top': `${l.barTop}px`,
    };
  });
}
