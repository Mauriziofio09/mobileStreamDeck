import { defaultConfig, type DeckConfig, type DockItem } from '@copper-deck/shared';
import { deckConfigSchema } from '@copper-deck/shared/schema';
import { readJson, writeFileAtomic } from './fsutil';
import { log } from './log';

export type UpdateResult =
  | { readonly ok: true; readonly config: DeckConfig }
  | { readonly ok: false; readonly reason: 'stale'; readonly current: DeckConfig }
  | { readonly ok: false; readonly reason: 'invalid'; readonly issues: string[] };

/**
 * Versionierte Konfiguration als JSON. Atomar geschrieben, letzte Version als Backup.
 * Jede Änderung wird gegen das Schema geprüft und trägt eine Revisionsnummer.
 */
export class ConfigStore {
  private current!: DeckConfig;
  private readonly listeners = new Set<(c: DeckConfig) => void>();

  constructor(private readonly file: string, private readonly backup: string) {}

  /** `makeDefault` erzeugt die Startbelegung (macOS bzw. Windows), wenn noch keine config.json existiert. */
  async load(makeDock: () => Promise<DockItem[]>, makeDefault: (dock: DockItem[]) => DeckConfig | Promise<DeckConfig> = defaultConfig): Promise<DeckConfig> {
    const raw = await readJson(this.file);
    if (raw !== undefined) {
      const parsed = deckConfigSchema.safeParse(raw);
      if (parsed.success) {
        this.current = parsed.data as DeckConfig;
        return this.current;
      }
      log('error', 'config.json ungültig, versuche Backup', { issues: parsed.error.issues.slice(0, 5).map((i) => i.message) });
      const bak = deckConfigSchema.safeParse(await readJson(this.backup));
      if (bak.success) {
        this.current = bak.data as DeckConfig;
        await this.write(this.current, false);
        return this.current;
      }
      throw new Error(`config.json und Backup sind ungültig (${this.file}). Datei prüfen oder löschen, um die Startbelegung neu anzulegen.`);
    }
    this.current = deckConfigSchema.parse(await makeDefault(await makeDock())) as DeckConfig;
    await this.write(this.current, false);
    log('info', 'Startbelegung angelegt');
    return this.current;
  }

  get(): DeckConfig {
    return this.current;
  }

  /** Übernimmt eine Änderung nur, wenn sie auf der aktuellen Revision basiert. */
  async update(next: unknown, baseRevision: number): Promise<UpdateResult> {
    if (baseRevision !== this.current.revision) return { ok: false, reason: 'stale', current: this.current };
    const parsed = deckConfigSchema.safeParse({ ...(next as object), revision: this.current.revision + 1 });
    if (!parsed.success) return { ok: false, reason: 'invalid', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
    this.current = parsed.data as DeckConfig;
    await this.write(this.current, true);
    for (const l of this.listeners) l(this.current);
    return { ok: true, config: this.current };
  }

  onChange(fn: (c: DeckConfig) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private async write(cfg: DeckConfig, backup: boolean): Promise<void> {
    await writeFileAtomic(this.file, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600, ...(backup ? { backup: this.backup } : {}) });
  }
}
