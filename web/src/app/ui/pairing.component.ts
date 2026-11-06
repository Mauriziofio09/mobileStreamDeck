import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { ApiError, PairResponse } from '@copper-deck/shared';
import { AuthService, isIOS, isStandalone } from '../core/auth.service';
import { ConnectionService } from '../core/connection.service';
import { SurfaceDirective } from '../core/surface.directive';

/**
 * Kopplung. Auf iOS nur in der installierten Home-Bildschirm-App, weil Safari und
 * Home-Bildschirm-App getrennten Speicher haben (ein in Safari gespeichertes Token wäre dort nicht da).
 */
@Component({
  selector: 'cd-pairing',
  imports: [SurfaceDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel" cdSurface="sheet" [cdRadius]="0.1">
      <h1>Copper Deck</h1>
      @if (needsInstall) {
        <p class="lead">Zuerst auf den Home-Bildschirm legen – gekoppelt wird in der installierten App.</p>
        <ol>
          <li>Unten bzw. oben in Safari auf <strong>Teilen</strong> tippen.</li>
          <li><strong>Zum Home-Bildschirm</strong> wählen und <strong>Hinzufügen</strong>.</li>
          <li><strong>Copper Deck</strong> vom Home-Bildschirm öffnen und dort den Code eingeben.</li>
        </ol>
        <p class="note">Warum? iOS trennt den Speicher von Safari und Home-Bildschirm-Apps. Ein hier gespeichertes Token wäre in der App nicht vorhanden.</p>
      } @else {
        <p class="lead">Am Mac im Terminal <code>copper-deck pair</code> ausführen und den 6-stelligen Code eingeben.</p>
        @if (conn.lastError(); as e) { <p class="error">{{ e }}</p> }
        <form (submit)="submit($event)">
          <label>
            <span>Code</span>
            <input
              class="code"
              name="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="7"
              placeholder="000 000"
              [value]="code()"
              (input)="code.set(digits($event))"
            />
          </label>
          <label>
            <span>Gerätename</span>
            <input name="name" maxlength="40" [value]="name()" (input)="name.set(value($event))" />
          </label>
          @if (error(); as e) { <p class="error">{{ e }}</p> }
          <button type="submit" class="submit" cdSurface="tile-brown" [cdRadius]="0.3" [disabled]="busy() || code().length !== 6">
            {{ busy() ? 'Koppeln …' : 'Koppeln' }}
          </button>
        </form>
      }
    </div>
  `,
  styleUrl: './pairing.component.css',
})
export class PairingComponent {
  protected readonly conn = inject(ConnectionService);
  private readonly auth = inject(AuthService);
  protected readonly needsInstall = isIOS() && !isStandalone();
  protected readonly code = signal('');
  protected readonly name = signal(defaultName());
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected digits(e: Event): string {
    const v = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
    (e.target as HTMLInputElement).value = v.length > 3 ? `${v.slice(0, 3)} ${v.slice(3)}` : v;
    return v;
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected async submit(e: Event): Promise<void> {
    e.preventDefault();
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const res = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: this.code(), deviceName: this.name().trim() || defaultName() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: `Fehler ${res.status}` }))) as ApiError;
        this.error.set(body.attemptsLeft ? `${body.error} Noch ${body.attemptsLeft} Versuche.` : body.error);
        return;
      }
      const body = (await res.json()) as PairResponse;
      this.auth.save(body.token, body.deviceId);
      this.conn.lastError.set(null);
      this.conn.connect();
    } catch {
      this.error.set('Mac nicht erreichbar. Läuft der Helper, und bist du im selben WLAN?');
    } finally {
      this.busy.set(false);
    }
  }
}

function defaultName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  return 'Browser';
}
