import { Injectable, computed, inject, signal } from '@angular/core';
import { LR_PARAMS, type LrCommand, type LrParamDef } from '@copper-deck/shared';
import { ConnectionService } from './connection.service';
import { DeckStore } from './deck.store';

/** Wie lange nach dem Loslassen der eigene Wert Vorrang vor gemeldeten Werten hat (Lightroom meldet verzögert). */
const HOLD_LOCAL_MS = 900;

const DEFS = new Map(LR_PARAMS.map((d) => [d.id, d]));

/**
 * Lightroom-Steuerung: Zustand vom Helper, Befehle, flüssige Regler.
 * Regler senden nie mehr als einen Wert gleichzeitig: Während einer auf Antwort wartet, wird nur
 * der jeweils neueste Wert vorgemerkt (kein Stau bei schnellem Ziehen).
 */
@Injectable({ providedIn: 'root' })
export class LightroomService {
  private readonly conn = inject(ConnectionService);
  private readonly store = inject(DeckStore);

  readonly state = this.conn.lightroom;
  readonly presets = this.conn.lrPresets;
  readonly connected = computed(() => this.conn.online() && this.state().connected);
  readonly inDevelop = computed(() => this.state().module === 'develop');

  /** Lokale Werte während und kurz nach dem Ziehen. */
  private readonly local = signal<ReadonlyMap<string, number>>(new Map());
  private readonly localUntil = new Map<string, number>();
  private readonly sending = new Set<string>();
  private readonly queued = new Map<string, number>();

  readonly values = computed<Readonly<Record<string, number>>>(() => {
    const out: Record<string, number> = { ...this.state().values };
    for (const [k, v] of this.local()) out[k] = v;
    return out;
  });

  def(id: string): LrParamDef | undefined {
    return DEFS.get(id);
  }

  range(id: string): readonly [number, number] {
    const r = this.state().ranges[id];
    if (r) return r;
    const d = DEFS.get(id);
    return d ? [d.min, d.max] : [-100, 100];
  }

  /** Reglerwert setzen (lokal sofort, an Lightroom gedrosselt). */
  set(id: string, value: number): void {
    const [lo, hi] = this.range(id);
    const d = DEFS.get(id);
    const step = d ? 10 ** -d.decimals : 1;
    const v = Math.round(Math.min(hi, Math.max(lo, value)) / step) * step;
    this.local.update((m) => new Map(m).set(id, v));
    this.localUntil.set(id, Number.POSITIVE_INFINITY);
    if (this.sending.has(id)) {
      this.queued.set(id, v);
      return;
    }
    void this.push(id, v);
  }

  /** Ziehen beendet: eigener Wert gilt noch kurz, danach wieder der gemeldete. */
  release(id: string): void {
    this.localUntil.set(id, Date.now() + HOLD_LOCAL_MS);
    setTimeout(() => this.expire(id), HOLD_LOCAL_MS + 50);
  }

  async run(command: LrCommand, success?: string): Promise<boolean> {
    const r = await this.conn.lr(command);
    if (!r.ok) this.store.toast(r.message ?? 'Lightroom hat den Befehl nicht ausgeführt.', 'error');
    else if (success) this.store.toast(success, 'info');
    return r.ok;
  }

  private async push(id: string, v: number): Promise<void> {
    this.sending.add(id);
    const r = await this.conn.lr({ cmd: 'set', param: id, value: v });
    this.sending.delete(id);
    const next = this.queued.get(id);
    this.queued.delete(id);
    if (next !== undefined && next !== v) {
      void this.push(id, next);
      return;
    }
    if (!r.ok) {
      this.store.toast(r.message ?? 'Wert nicht übernommen.', 'error');
      this.localUntil.set(id, 0);
      this.expire(id);
    }
  }

  private expire(id: string): void {
    if ((this.localUntil.get(id) ?? 0) > Date.now() || this.sending.has(id)) return;
    this.localUntil.delete(id);
    this.local.update((m) => {
      const n = new Map(m);
      n.delete(id);
      return n;
    });
  }
}

/** Anzeige wie in Lightroom: Vorzeichen bei zweiseitigen Reglern, Komma, Kelvin bei Raw-Temperatur. */
export function formatLr(def: LrParamDef, value: number | undefined, range: readonly [number, number]): string {
  if (value === undefined) return '–';
  if (def.id === 'Temperature' && range[1] > 1000) return `${Math.round(value)} K`;
  const s = value.toLocaleString('de-CH', { minimumFractionDigits: def.decimals, maximumFractionDigits: def.decimals });
  return range[0] < 0 && value > 0 ? `+${s}` : s;
}
