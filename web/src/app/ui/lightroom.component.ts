import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { LR_PARAMS, type LrFlag, type LrLabel, type LrPanel, type LrParamDef } from '@copper-deck/shared';
import { confirmRemoval } from '../core/confirm';
import { LightroomService } from '../core/lightroom.service';
import { PlatformService } from '../core/platform.service';
import { SurfaceDirective } from '../core/surface.directive';
import { IconComponent } from './icons';
import { LrSliderComponent } from './lr-slider.component';

type Tab = LrPanel | 'presets';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'basic', label: 'Grundeinstellungen' },
  { id: 'curve', label: 'Kurve' },
  { id: 'hsl', label: 'HSL' },
  { id: 'grading', label: 'Color Grading' },
  { id: 'detail', label: 'Details' },
  { id: 'effects', label: 'Effekte' },
  { id: 'presets', label: 'Vorgaben' },
];

const LABELS: readonly { id: Exclude<LrLabel, 'none'>; name: string; color: string }[] = [
  { id: 'red', name: 'Rot', color: '#e5484d' },
  { id: 'yellow', name: 'Gelb', color: '#e9c53a' },
  { id: 'green', name: 'Grün', color: '#46a758' },
  { id: 'blue', name: 'Blau', color: '#3e63dd' },
  { id: 'purple', name: 'Lila', color: '#8e4ec6' },
];

const TAB_KEY = 'copperdeck.lr.tab';

/** Lightroom-Classic-Ansicht: Foto, Bewertung, Markierung, Navigation, Regler, Vorgaben, Schnellaktionen. */
@Component({
  selector: 'cd-lightroom',
  imports: [SurfaceDirective, IconComponent, LrSliderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lightroom.component.html',
  styleUrl: './lightroom.component.css',
  host: { 'data-no-swipe': '' },
})
export class LightroomComponent {
  protected readonly lr = inject(LightroomService);
  protected readonly platform = inject(PlatformService);
  protected readonly tabs = TABS;
  protected readonly labels = LABELS;
  protected readonly stars = [1, 2, 3, 4, 5] as const;
  protected readonly tab = signal<Tab>(readTab());
  protected readonly hslMode = signal<'Farbton' | 'Sättigung' | 'Luminanz'>('Farbton');
  protected readonly openFolders = signal<ReadonlySet<string>>(new Set());

  protected readonly state = this.lr.state;
  protected readonly photo = computed(() => this.state().photo);
  protected readonly canEdit = computed(() => this.lr.connected() && !!this.photo() && this.lr.inDevelop());

  /** Regler des aktiven Panels, nach Untergruppe. */
  protected readonly groups = computed(() => {
    const t = this.tab();
    if (t === 'presets') return [];
    let defs: LrParamDef[] = LR_PARAMS.filter((d) => d.panel === t);
    if (t === 'hsl') defs = defs.filter((d) => d.group === this.hslMode());
    const out: { name: string; params: LrParamDef[] }[] = [];
    for (const d of defs) {
      const g = t === 'hsl' ? '' : d.group;
      const last = out.at(-1);
      if (last && last.name === g) last.params.push(d);
      else out.push({ name: g, params: [d] });
    }
    return out;
  });

  constructor() {
    effect(() => {
      const t = this.tab();
      try { localStorage.setItem(TAB_KEY, t); } catch { /* privat */ }
      // Vorgaben bei Bedarf laden (Lightroom kann neue Vorgaben haben).
      if (t === 'presets' && this.lr.connected()) untracked(() => void this.lr.run({ cmd: 'presets' }));
    });
  }

  protected setRating(n: number): void {
    const current = this.photo()?.rating ?? 0;
    // Wie in Lightroom: erneutes Tippen auf denselben Stern entfernt die Bewertung.
    const value = (n === current ? 0 : n) as 0 | 1 | 2 | 3 | 4 | 5;
    void this.lr.run({ cmd: 'rating', value });
  }

  protected setFlag(f: Exclude<LrFlag, 'none'>): void {
    void this.lr.run({ cmd: 'flag', value: this.photo()?.flag === f ? 'none' : f });
  }

  protected setLabel(l: Exclude<LrLabel, 'none'>): void {
    void this.lr.run({ cmd: 'label', value: this.photo()?.label === l ? 'none' : l });
  }

  protected resetAll(): void {
    if (confirmRemoval('lr-resetall', 'Alle Entwicklungseinstellungen')) void this.lr.run({ cmd: 'resetall' }, 'Einstellungen zurückgesetzt.');
  }

  protected toggleFolder(name: string): void {
    this.openFolders.update((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });
  }
}

function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.id === t) ? (t as Tab) : 'basic';
  } catch {
    return 'basic';
  }
}
