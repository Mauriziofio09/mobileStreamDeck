import net from 'node:net';
import { LR_EMPTY_STATE, LR_PARAM_IDS, LR_PORTS, type LrCommand, type LrPresetFolder, type LrState } from '@copper-deck/shared';
import { log } from './log';

const RECONNECT_MS = 2000;
const COMMAND_TIMEOUT_MS = 8000;
const MAX_LINE = 1024 * 1024;

export interface LrResult {
  readonly ok: boolean;
  readonly message?: string;
}

interface Pending {
  resolve: (r: LrResult) => void;
  timer: NodeJS.Timeout;
}

/**
 * Verbindung zum Lightroom-Classic-Plugin (lightroom/CopperDeck.lrplugin) über zwei lokale TCP-Sockets.
 * Das Plugin ist der Server (LrSocket), der Helper verbindet sich und versucht es alle 2 s erneut.
 * Befehle: eine Tabulator-getrennte Zeile pro Befehl; Antworten und Zustand: eine JSON-Zeile.
 */
export class LightroomBridge {
  private toPlugin: net.Socket | null = null;
  private fromPlugin: net.Socket | null = null;
  private state: LrState = LR_EMPTY_STATE;
  private presets: readonly LrPresetFolder[] = [];
  private readonly pending = new Map<string, Pending>();
  private readonly stateListeners = new Set<(s: LrState) => void>();
  private readonly presetListeners = new Set<(p: readonly LrPresetFolder[]) => void>();
  private retry: NodeJS.Timeout | null = null;
  private seq = 0;
  private stopped = false;

  constructor(private readonly ports: { readonly toPlugin: number; readonly fromPlugin: number } = LR_PORTS, private readonly host = '127.0.0.1') {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.toPlugin?.destroy();
    this.fromPlugin?.destroy();
  }

  get(): LrState {
    return this.state;
  }

  getPresets(): readonly LrPresetFolder[] {
    return this.presets;
  }

  onState(fn: (s: LrState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  onPresets(fn: (p: readonly LrPresetFolder[]) => void): () => void {
    this.presetListeners.add(fn);
    return () => this.presetListeners.delete(fn);
  }

  /** Sendet einen (bereits geprüften) Befehl ans Plugin und wartet auf dessen Antwort. */
  run(command: LrCommand): Promise<LrResult> {
    const sock = this.toPlugin;
    if (!this.state.connected || !sock) {
      return Promise.resolve({ ok: false, message: 'Lightroom Classic ist nicht verbunden. Läuft es mit dem Copper-Deck-Plugin?' });
    }
    const id = `c${++this.seq}`;
    const line = [id, ...toArgs(command)].map(clean).join('\t') + '\n';
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, message: 'Lightroom antwortet nicht (Zeitüberschreitung).' });
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      sock.write(line);
    });
  }

  // ------------------------------------------------------------ Verbindung

  private connect(): void {
    if (this.stopped) return;
    this.retry = null;
    let opened = 0;
    let failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      to.destroy();
      from.destroy();
      this.disconnected();
    };
    const to = net.createConnection({ host: this.host, port: this.ports.toPlugin });
    const from = net.createConnection({ host: this.host, port: this.ports.fromPlugin });
    for (const s of [to, from]) {
      s.setNoDelay(true);
      s.on('error', fail);
      s.on('close', fail);
      s.on('connect', () => {
        if (++opened === 2) this.connected(to, from);
      });
    }
    let buf = '';
    from.setEncoding('utf8');
    from.on('data', (chunk: string) => {
      buf += chunk;
      if (buf.length > MAX_LINE) {
        log('warn', 'Lightroom-Plugin: Nachricht zu gross, Verbindung wird neu aufgebaut');
        fail();
        return;
      }
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) this.message(line);
      }
    });
  }

  private connected(to: net.Socket, from: net.Socket): void {
    this.toPlugin = to;
    this.fromPlugin = from;
    log('info', 'Lightroom Classic verbunden');
    // Vollständigen Zustand und Vorgaben anfordern
    to.write(`h${++this.seq}\thello\n`);
    to.write(`p${++this.seq}\tpresets\n`);
  }

  private disconnected(): void {
    const was = this.state.connected;
    this.toPlugin = null;
    this.fromPlugin = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, message: 'Verbindung zu Lightroom unterbrochen.' });
      this.pending.delete(id);
    }
    if (was) {
      log('info', 'Lightroom Classic getrennt');
      this.setState(LR_EMPTY_STATE);
    }
    if (!this.stopped && !this.retry) this.retry = setTimeout(() => this.connect(), RECONNECT_MS);
  }

  private message(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      log('warn', 'Lightroom-Plugin: ungültige Nachricht', { line: line.slice(0, 120) });
      return;
    }
    switch (msg['type']) {
      case 'result': {
        const id = String(msg['id'] ?? '');
        const p = this.pending.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.resolve(msg['ok'] === true ? { ok: true } : { ok: false, message: str(msg['message']) ?? 'Lightroom hat den Befehl abgelehnt.' });
        return;
      }
      case 'state':
        this.setState({
          connected: true,
          module: str(msg['module']) ?? null,
          photo: photo(msg['photo']),
          values: values(msg['values']),
          ranges: ranges(msg['ranges']),
          beforeAfter: msg['beforeAfter'] === true,
          lrVersion: str(msg['lrVersion']) ?? null,
        });
        return;
      case 'values':
        if (!this.state.connected) return;
        this.setState({ ...this.state, values: { ...this.state.values, ...values(msg['values']) } });
        return;
      case 'presets':
        this.presets = presets(msg['folders']);
        for (const l of this.presetListeners) l(this.presets);
        return;
    }
  }

  private setState(s: LrState): void {
    this.state = s;
    for (const l of this.stateListeners) l(s);
  }
}

/** Befehl -> Zeilenfelder (Plugin-Format). */
export function toArgs(c: LrCommand): string[] {
  switch (c.cmd) {
    case 'set': return ['set', c.param, String(c.value)];
    case 'inc': case 'dec': case 'reset': return [c.cmd, c.param];
    case 'preset': return ['preset', c.id];
    case 'rating': return ['rating', String(c.value)];
    case 'flag': case 'label': case 'nav': case 'module': case 'tool': case 'auto': return [c.cmd, c.value];
    default: return [c.cmd];
  }
}

/** Keine Tabulatoren oder Zeilenumbrüche in Feldern (die Werte sind ohnehin geprüft). */
const clean = (s: string): string => s.replace(/[\t\r\n]/g, ' ');

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v.slice(0, 300) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function values(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, x] of Object.entries(v)) {
    const n = num(x);
    if (n !== undefined && LR_PARAM_IDS.includes(k)) out[k] = n;
  }
  return out;
}

function ranges(v: unknown): Record<string, readonly [number, number]> {
  const out: Record<string, readonly [number, number]> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, x] of Object.entries(v)) {
    if (!LR_PARAM_IDS.includes(k) || !Array.isArray(x)) continue;
    const lo = num(x[0]);
    const hi = num(x[1]);
    if (lo !== undefined && hi !== undefined && lo < hi) out[k] = [lo, hi];
  }
  return out;
}

function photo(v: unknown): LrState['photo'] {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const flag = o['flag'] === 'pick' || o['flag'] === 'reject' ? o['flag'] : 'none';
  const labels = ['red', 'yellow', 'green', 'blue', 'purple'] as const;
  const label = labels.find((l) => l === o['label']) ?? 'none';
  const rating = Math.max(0, Math.min(5, Math.round(num(o['rating']) ?? 0)));
  return { name: str(o['name']) ?? '', rating, flag, label };
}

function presets(v: unknown): LrPresetFolder[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 200).flatMap((f): LrPresetFolder[] => {
    if (!f || typeof f !== 'object') return [];
    const o = f as Record<string, unknown>;
    const list = Array.isArray(o['presets']) ? o['presets'] : [];
    const items = list.slice(0, 1000).flatMap((p) => {
      const q = p as Record<string, unknown>;
      const id = str(q['id']);
      const name = str(q['name']);
      return id && name && /^[A-Za-z0-9-]{1,64}$/.test(id) ? [{ id, name }] : [];
    });
    return [{ name: str(o['name']) ?? 'Vorgaben', presets: items }];
  });
}
