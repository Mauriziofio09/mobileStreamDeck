import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConnectionService } from '../core/connection.service';
import { PlatformService } from '../core/platform.service';
import { SurfaceDirective } from '../core/surface.directive';
import { IconComponent } from './icons';

/** Vollbild-Offline-Ansicht (aus dem Service-Worker-Cache), wenn noch keine Konfiguration bekannt ist. */
@Component({
  selector: 'cd-offline',
  imports: [SurfaceDirective, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel" cdSurface="sheet" [cdRadius]="0.1">
      <span class="icon"><cd-icon name="offline" /></span>
      <h1>{{ platform.host() }} nicht erreichbar</h1>
      <p>{{ conn.state() === 'connecting' ? 'Verbinde …' : 'Neuer Versuch läuft automatisch.' }}</p>
      <ul>
        <li>Ist der {{ platform.host() }} wach und im selben WLAN?</li>
        <li>Läuft der Copper-Deck-Helper? (<code>copper-deck status</code>)</li>
        <li>Lässt die {{ platform.isWindows() ? 'Windows' : 'macOS' }}-Firewall Verbindungen zu?</li>
      </ul>
      <button type="button" cdSurface="tile-brown" [cdRadius]="0.3" (click)="conn.connect()">Erneut versuchen</button>
    </div>
  `,
  styles: `
    :host { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 16px; }
    .panel { width: min(440px, 100%); padding: 28px; text-align: center; color: var(--c-text-cream); }
    .icon { font-size: 42px; color: var(--c-warn); }
    h1 { margin: 8px 0 4px; font: 700 30px/1 var(--font-label); text-transform: uppercase; }
    p { margin: 0 0 14px; color: var(--c-text-muted); }
    ul { text-align: left; margin: 0 0 20px; padding-left: 20px; line-height: 1.7; font-size: 15px; }
    code { font-family: ui-monospace, Menlo, monospace; color: var(--c-text-lilac); }
    button {
      border: 0; background: transparent; height: 52px; width: 100%;
      font: 700 19px var(--font-label); text-transform: uppercase; color: var(--c-text-cream);
    }
    button:active { transform: scale(0.97); }
  `,
})
export class OfflineComponent {
  protected readonly conn = inject(ConnectionService);
  protected readonly platform = inject(PlatformService);
}
