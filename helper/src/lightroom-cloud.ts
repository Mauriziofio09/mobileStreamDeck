import type { HotkeyKey, InstalledApp, LrCloudCommand, Modifier } from '@copper-deck/shared';
import type { ActionRunner } from './actions/runner';
import { classifyAppleScriptError, PERMISSION_TEXT } from './actions/runner';
import type { AppCatalog } from './apps';
import { ExecError, type Exec } from './exec';
import { log } from './log';
import type { PermissionMonitor } from './permissions';
import { IS_WINDOWS } from './platform';

/**
 * Adobe Lightroom (Cloud-Version). Keine Plugin-Schnittstelle und keine Bedienelemente für die Bedienungshilfen
 * im Fenster – aber die Menüleiste ist zugänglich. Am Mac wählt Copper Deck deshalb den Menüeintrag aus
 * (helper/native/lightroom-menu.applescript); gefunden wird er über seinen Kurzbefehl, also unabhängig von der
 * Sprache. Tastendrücke waren im Test unzuverlässig: Ziffern (Sterne) kamen nicht an.
 * Unter Windows: die Kurzbefehle aus Lightrooms eigener Liste (AgKeyboardShortcuts), Strg statt ⌘.
 */

const MAC_BUNDLES = ['com.adobe.mas.lightroomCC', 'com.adobe.lightroomCC'];

/** Menüleiste von Lightroom: 3 Datei, 4 Bearbeiten, 5 Foto, 6 Ansicht. */
type MenuSpec =
  | { readonly menu: 3 | 4 | 5 | 6; readonly key: string; readonly mods: number }
  | { readonly menu: 3 | 4 | 5 | 6; readonly name: string; readonly parent?: string };

/** AXMenuItemCmdModifiers: 0 = ⌘, 1 = ⇧⌘, 8 = ohne ⌘, 9 = ⇧ ohne ⌘. */
const k = (menu: 3 | 4 | 5 | 6, key: string, mods: number): MenuSpec => ({ menu, key, mods });

/** Kurzbefehle unter Windows (Strg = control). Fehlt ein Eintrag, gibt es den Befehl dort nicht. */
type WinKey = { readonly key: HotkeyKey; readonly mods?: readonly Modifier[] };

interface Def {
  readonly mac: MenuSpec;
  readonly win?: WinKey;
  readonly label: string;
}

const LABEL_PARENT = 'Farbbeschriftung festlegen|Set Color Label';

export const LR_CLOUD: Readonly<Record<LrCloudCommand, Def>> = {
  prev: { mac: { menu: 4, name: 'Vorheriges Foto|Previous Photo' }, win: { key: 'left' }, label: 'Vorheriges Foto' },
  next: { mac: { menu: 4, name: 'Nächstes Foto|Next Photo' }, win: { key: 'right' }, label: 'Nächstes Foto' },
  rating0: { mac: k(5, '0', 8), win: { key: '0' }, label: 'Keine Sterne' },
  rating1: { mac: k(5, '1', 8), win: { key: '1' }, label: '1 Stern' },
  rating2: { mac: k(5, '2', 8), win: { key: '2' }, label: '2 Sterne' },
  rating3: { mac: k(5, '3', 8), win: { key: '3' }, label: '3 Sterne' },
  rating4: { mac: k(5, '4', 8), win: { key: '4' }, label: '4 Sterne' },
  rating5: { mac: k(5, '5', 8), win: { key: '5' }, label: '5 Sterne' },
  pick: { mac: k(5, 'Z', 8), win: { key: 'z' }, label: 'Markiert' },
  reject: { mac: k(5, 'X', 8), win: { key: 'x' }, label: 'Abgelehnt' },
  unflag: { mac: k(5, 'U', 8), win: { key: 'u' }, label: 'Unmarkiert' },
  labelRed: { mac: k(5, '6', 8), win: { key: '6' }, label: 'Rot' },
  labelYellow: { mac: k(5, '7', 8), win: { key: '7' }, label: 'Gelb' },
  labelGreen: { mac: k(5, '8', 8), win: { key: '8' }, label: 'Grün' },
  labelBlue: { mac: k(5, '9', 8), win: { key: '9' }, label: 'Blau' },
  labelPurple: { mac: { menu: 5, name: 'Lila|Purple', parent: LABEL_PARENT }, label: 'Lila' },
  labelNone: { mac: { menu: 5, name: 'Keine|None', parent: LABEL_PARENT }, label: 'Keine Farbe' },
  auto: { mac: k(5, 'A', 9), win: { key: 'a', mods: ['shift'] }, label: 'Auto' },
  copy: { mac: k(5, 'C', 0), win: { key: 'c', mods: ['control'] }, label: 'Einstellungen kopieren' },
  paste: { mac: k(5, 'V', 0), win: { key: 'v', mods: ['control'] }, label: 'Einstellungen einfügen' },
  undo: { mac: k(4, 'Z', 0), win: { key: 'z', mods: ['control'] }, label: 'Rückgängig' },
  redo: { mac: k(4, 'Z', 1), win: { key: 'y', mods: ['control'] }, label: 'Wiederholen' },
  resetEdits: { mac: k(5, 'R', 0), win: { key: 'r', mods: ['control'] }, label: 'Bearbeitungen zurücksetzen' },
  crop: { mac: k(6, 'C', 8), win: { key: 'c' }, label: 'Zuschneiden' },
  heal: { mac: k(6, 'H', 8), win: { key: 'h' }, label: 'Entfernen' },
  mask: { mac: k(6, 'M', 8), win: { key: 'm' }, label: 'Maskieren' },
  edit: { mac: k(6, 'E', 8), win: { key: 'e' }, label: 'Bearbeiten' },
  presets: { mac: k(6, 'P', 9), win: { key: 'p', mods: ['shift'] }, label: 'Presets' },
  profiles: { mac: k(6, 'B', 9), win: { key: 'b', mods: ['shift'] }, label: 'Profile' },
  panelLight: { mac: k(6, '1', 0), win: { key: '1', mods: ['control'] }, label: 'Licht' },
  panelColor: { mac: k(6, '2', 0), win: { key: '2', mods: ['control'] }, label: 'Farbe' },
  panelEffects: { mac: k(6, '3', 0), win: { key: '3', mods: ['control'] }, label: 'Effekte' },
  panelDetail: { mac: k(6, '4', 0), win: { key: '4', mods: ['control'] }, label: 'Details' },
  panelOptics: { mac: k(6, '5', 0), win: { key: '5', mods: ['control'] }, label: 'Optik' },
  panelGeometry: { mac: k(6, '7', 0), win: { key: '7', mods: ['control'] }, label: 'Geometrie' },
  grid: { mac: k(6, 'G', 8), win: { key: 'g' }, label: 'Raster' },
  detail: { mac: k(6, 'D', 8), win: { key: 'd' }, label: 'Details' },
  original: { mac: k(6, '.', 8), label: 'Original anzeigen' },
  beforeAfter: { mac: { menu: 6, name: 'Vorher und nachher vergleichen|Compare Before and After' }, label: 'Vorher/Nachher' },
  exportDialog: { mac: k(3, 'E', 9), win: { key: 'e', mods: ['shift'] }, label: 'Exportieren' },
  exportPrevious: { mac: k(3, 'E', 0), win: { key: 'e', mods: ['control'] }, label: 'Wie vorher exportieren' },
};

export interface LightroomCloudDeps {
  readonly exec: Exec;
  readonly catalog: AppCatalog;
  readonly runner: ActionRunner;
  readonly permissions: PermissionMonitor;
  readonly menuScript: string;
}

export type CloudResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export class LightroomCloud {
  constructor(private readonly d: LightroomCloudDeps) {}

  /** Installierte Lightroom-Cloud-App (nicht Classic) oder null. */
  async app(): Promise<InstalledApp | null> {
    if (IS_WINDOWS) {
      const apps = await this.d.catalog.list();
      return apps.find((a) => /^Adobe Lightroom$/i.test(a.name)) ?? null;
    }
    for (const id of MAC_BUNDLES) {
      const a = await this.d.catalog.get(id);
      if (a) return a;
    }
    return null;
  }

  async run(cmd: LrCloudCommand): Promise<CloudResult> {
    const def = LR_CLOUD[cmd];
    const app = await this.app();
    if (!app) return { ok: false, message: 'Adobe Lightroom ist nicht installiert.' };
    return IS_WINDOWS ? this.runWindows(app, def) : this.runMac(app, def);
  }

  private async runMac(app: InstalledApp, def: Def): Promise<CloudResult> {
    const m = def.mac;
    const args = 'key' in m
      ? [this.d.menuScript, app.bundleId, String(m.menu), 'key', m.key, String(m.mods)]
      : [this.d.menuScript, app.bundleId, String(m.menu), 'name', m.name, m.parent ?? '-'];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.d.exec('/usr/bin/osascript', args, { timeoutMs: 15_000 });
        return { ok: true };
      } catch (e) {
        const err = e as ExecError;
        const out = `${err.stderr ?? ''} ${err.message}`;
        if (/not_running/.test(out) && attempt === 0) {
          // Lightroom starten und den Befehl einmal wiederholen
          const opened = await this.d.runner.run({ type: 'openApp', bundleId: app.bundleId });
          if (!opened.ok) return { ok: false, message: opened.message };
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        // Eigene Fehler des Skripts zuerst (Nummern 9001–9003, damit sie nicht mit macOS-Codes verwechselt werden)
        if (/disabled/.test(out)) return { ok: false, message: `„${def.label}“ ist in Lightroom gerade nicht möglich (z. B. kein Foto ausgewählt oder falsche Ansicht).` };
        if (/not_found/.test(out)) return { ok: false, message: `„${def.label}“ nicht im Menü von Lightroom gefunden (andere Version?).` };
        const kind = classifyAppleScriptError(err.stderr ?? '');
        if (kind) {
          this.d.permissions.report(kind);
          return { ok: false, message: PERMISSION_TEXT[kind] };
        }
        if (err.timedOut) return { ok: false, message: 'Lightroom hat nicht rechtzeitig reagiert.' };
        log('warn', 'Lightroom-Menü fehlgeschlagen', { label: def.label, stderr: (err.stderr ?? '').slice(0, 200) });
        return { ok: false, message: `„${def.label}“ konnte nicht ausgeführt werden.` };
      }
    }
    return { ok: false, message: 'Lightroom startet noch – bitte gleich nochmals tippen.' };
  }

  /** Windows: Lightroom nach vorne holen, dann den Kurzbefehl senden. */
  private async runWindows(app: InstalledApp, def: Def): Promise<CloudResult> {
    if (!def.win) return { ok: false, message: `„${def.label}“ gibt es unter Windows (noch) nicht.` };
    const opened = await this.d.runner.run({ type: 'openApp', bundleId: app.bundleId });
    if (!opened.ok) return { ok: false, message: opened.message };
    await new Promise((r) => setTimeout(r, 250));
    const r = await this.d.runner.run({ type: 'hotkey', modifiers: [...(def.win.mods ?? [])], key: def.win.key });
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  }
}
