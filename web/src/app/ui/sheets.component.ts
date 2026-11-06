import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import type { DeviceInfo } from '@copper-deck/shared';
import { AuthService } from '../core/auth.service';
import { ConnectionService } from '../core/connection.service';
import { TimerPreset } from '@copper-deck/shared';
import { DeckStore } from '../core/deck.store';
import { LayoutService } from '../core/layout.service';
import { SurfaceDirective } from '../core/surface.directive';
import { TIMER_LABEL, TIMER_MINUTES, TimerService } from '../core/timer.service';

/** About- und Timer-Auswahl als Overlay (ohne backdrop-filter). */
@Component({
  selector: 'cd-sheets',
  imports: [SurfaceDirective],
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
              <dd class="status" [attr.data-state]="conn.state()">
                <span class="dot"></span>{{ stateText() }}
              </dd>
              @if (conn.lastError(); as e) { <dt></dt><dd class="err">{{ e }}</dd> }
              <dt>Mac</dt>
              <dd>{{ host }}</dd>
              <dt>Dieses Gerät</dt>
              <dd>{{ conn.deviceName() || '–' }}</dd>
              <dt>Helper</dt>
              <dd>{{ conn.helperVersion() || '–' }}</dd>
              <dt>Ansicht</dt>
              <dd>{{ layout.layout().device === 'pad' ? 'iPad' : 'iPhone' }}, {{ layout.layout().orientation === 'landscape' ? 'Querformat' : 'Hochformat' }} · {{ store.pages().length }} Seiten · Rev. {{ store.config().revision }}</dd>
            </dl>
            @if (conn.online()) {
              <h3>Gekoppelte Geräte</h3>
              @if (devices(); as list) {
                <ul class="devices">
                  @for (d of list; track d.id) {
                    <li>
                      <span class="dname">{{ d.name }}@if (d.current) { <em> (dieses)</em> }</span>
                      <span class="dmeta">seit {{ d.createdAt.slice(0, 10) }}</span>
                      <button type="button" class="revoke" (click)="revoke(d)">Widerrufen</button>
                    </li>
                  }
                </ul>
              } @else {
                <p class="sub">Lade …</p>
              }
            }
            <p class="hint">Langes Drücken auf eine Kachel startet den Bearbeitungsmodus.</p>
          } @else {
            <h2>Timer</h2>
            <p class="notice">Timer folgen in Meilenstein 3 (Helper speichert dann die Endzeit).</p>
            @if (timers.running(); as run) {
              <p class="running">{{ label(run.preset) }} läuft · <strong>{{ timers.display() }}</strong></p>
            } @else {
              <p class="sub">Es läuft immer nur ein Timer.</p>
            }
            <div class="choices">
              @for (p of presets; track p) {
                <button type="button" disabled class="choice" [class.violet]="p === 'break'" [cdSurface]="p === 'break' ? 'tile-violet' : 'tile-brown'" [cdRadius]="0.22" (click)="toggle(p)">
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
  protected readonly conn = inject(ConnectionService);
  private readonly auth = inject(AuthService);
  protected readonly host = location.host;
  protected readonly devices = signal<DeviceInfo[] | null>(null);

  protected readonly stateText = computed(() => {
    switch (this.conn.state()) {
      case 'online': return 'Verbunden';
      case 'connecting': return 'Verbinde …';
      case 'offline': return `Offline – neuer Versuch läuft (${this.conn.attempt()})`;
      case 'unpaired': return 'Nicht gekoppelt';
    }
  });

  constructor() {
    effect(() => {
      if (this.store.sheet() === 'about' && this.conn.online()) void this.loadDevices();
    });
  }

  private async loadDevices(): Promise<void> {
    this.devices.set(null);
    try {
      const res = await fetch('/api/devices', { headers: this.auth.authHeader() });
      if (res.ok) this.devices.set((await res.json()) as DeviceInfo[]);
    } catch {
      /* offline */
    }
  }

  protected async revoke(d: DeviceInfo): Promise<void> {
    const res = await fetch(`/api/devices/${encodeURIComponent(d.id)}`, { method: 'DELETE', headers: this.auth.authHeader() }).catch(() => null);
    if (!res?.ok) {
      this.store.toast('Widerrufen fehlgeschlagen.', 'error');
      return;
    }
    if (d.current) {
      this.store.sheet.set('none');
      this.conn.forget();
      return;
    }
    this.store.toast(`${d.name} widerrufen.`, 'info');
    void this.loadDevices();
  }

  protected label(p: TimerPreset): string { return TIMER_LABEL[p]; }
  protected minutes(p: TimerPreset): number { return TIMER_MINUTES[p]; }

  protected toggle(p: TimerPreset): void {
    this.timers.toggle(p);
    this.store.sheet.set('none');
  }
}
