import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import type { DeviceInfo } from '@copper-deck/shared';
import { ActionService } from '../core/action.service';
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
            @if (conn.permissions(); as p) {
              <h3>Berechtigungen am Mac</h3>
              @if (p.context === 'terminal') {
                <p class="notice">Der Helper läuft von Hand im Terminal. Berechtigungen gelten dann fürs Terminal, nicht für den LaunchAgent.</p>
              }
              <ul class="perms">
                @for (row of permRows(); track row.kind) {
                  <li [class.ok]="row.status === 'granted'">
                    <span class="pstate">{{ row.status === 'granted' ? '✓' : '!' }}</span>
                    <span class="pname">{{ row.title }}</span>
                    <span class="pdesc">
                      @if (row.status === 'granted') { erteilt } @else { {{ row.how }} }
                    </span>
                    @if (row.status !== 'granted') {
                      <button type="button" class="fix" (click)="run(row.action)">Am Mac öffnen</button>
                    }
                  </li>
                }
              </ul>
              @if (!allGranted()) {
                <p class="hint">Wird automatisch erkannt, sobald die Berechtigung erteilt ist.
                  <button type="button" class="link" (click)="run('sys-request-permissions')">Anfrage am Mac erneut zeigen</button></p>
              }
            }
            <p class="hint">Langes Drücken auf eine Kachel startet den Bearbeitungsmodus.</p>
          } @else {
            <h2>Timer</h2>

            @if (timers.running(); as current) {
              <p class="running">{{ label(current.preset) }} läuft · <strong>{{ timers.display() }}</strong>
                <button type="button" class="link" (click)="run('sys-timer-stop')">Stoppen</button></p>
            } @else {
              <p class="sub">Es läuft immer nur ein Timer.</p>
            }
            <div class="choices">
              @for (p of presets; track p) {
                <button type="button" class="choice" [disabled]="!conn.online()" [class.violet]="p === 'break'" [cdSurface]="p === 'break' ? 'tile-violet' : 'tile-brown'" [cdRadius]="0.22" (click)="toggle(p)">
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
  private readonly actions = inject(ActionService);
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
    void this.run(p === 'pomodoro' ? 'sys-timer-pomodoro' : 'sys-timer-break');
    this.store.sheet.set('none');
  }

  protected readonly permRows = computed(() => {
    const p = this.conn.permissions();
    if (!p) return [];
    return [
      { kind: 'accessibility', title: 'Bedienungshilfen', status: p.accessibility, action: 'sys-settings-accessibility',
        how: 'Systemeinstellungen → Datenschutz & Sicherheit → Bedienungshilfen → „Copper Deck Helper“ einschalten. Nötig für Tastenkombinationen, Emojis und Fenster.' },
      { kind: 'automation', title: 'Automation (System Events)', status: p.automation, action: 'sys-settings-automation',
        how: p.automation === 'notDetermined'
          ? 'Noch nicht gefragt: „Anfrage am Mac erneut zeigen“ tippen und am Mac „Erlauben“ wählen.'
          : 'Systemeinstellungen → Datenschutz & Sicherheit → Automation → „Copper Deck Helper“ → „System Events“ einschalten.' },
      { kind: 'notifications', title: 'Mitteilungen', status: p.notifications, action: 'sys-settings-notifications',
        how: 'Systemeinstellungen → Mitteilungen → „Copper Deck Helper“ → „Mitteilungen erlauben“. Nötig für das Timer-Ende.' },
    ] as const;
  });

  protected readonly allGranted = computed(() => this.permRows().every((r) => r.status === 'granted'));

  protected async run(actionId: string): Promise<void> {
    const r = await this.actions.run(actionId);
    this.store.toast(r.ok ? (r.message ?? 'Erledigt.') : r.reason, r.ok ? 'info' : 'error');
  }
}
