import { Injectable, computed, signal } from '@angular/core';

export type DeviceClass = 'pad' | 'phone';
export type Orientation = 'landscape' | 'portrait';

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Proportionen aus der Vorlage, bezogen auf die Rahmengrösse f einer Kachel
 * (iPad-Vorlage: Rahmen ≈ 150 px, Kachel ≈ 118 px, Abstand ≈ 23 px, Gruppen-Innenabstand ≈ 45/38 px).
 */
export const RATIO = {
  tileInset: 0.105,
  gap: 0.15,
  padPadX: 0.27,
  padPadY: 0.24,
  phonePadX: 0.13,
  phonePadY: 0.1,
} as const;

export interface DeckLayout {
  readonly device: DeviceClass;
  readonly orientation: Orientation;
  readonly vw: number;
  readonly vh: number;
  readonly safe: Insets;
  /** Kantenlänge eines Kachelrahmens in px. */
  readonly frame: number;
  readonly cols: number;
  readonly rows: number;
  readonly padX: number;
  readonly padY: number;
  readonly groupW: number;
  readonly groupH: number;
  readonly groupsPerPage: number;
  /** Gruppen einer Seite neben- oder untereinander. */
  readonly pageFlow: 'row' | 'column';
  readonly groupGap: number;
  /** Breite einer Seite inkl. Abstand zur nächsten (Schrittweite beim Blättern). */
  readonly pageStep: number;
  /** Linker Rand der ersten Gruppe ab Bildschirmkante. */
  readonly startX: number;
  /** Oberkante des Seitenbereichs. */
  readonly stageTop: number;
  readonly stageH: number;
  /** Höhe des Seiteninhalts (iPad hochkant: zwei Gruppen untereinander). */
  readonly contentH: number;
  /** Oberkante der Emoji-Leiste (iPad). */
  readonly barTop: number;
  /** Bar (Emoji-Leiste + Dock) dauerhaft im Layout (iPad) oder als Overlay (iPhone). */
  readonly barMode: 'inline' | 'overlay';
  readonly controls: 'side' | 'bottom';
}

// Feste Masse in pt (aus der Vorlage, iPad-Massstab ≈ 0.9).
const EMOJI_BAR_H = 68;
const DOCK_H = 96;
const DOTS_H = 28;
const SIDE_COL = 72;

@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly viewport = signal({ w: window.innerWidth, h: window.innerHeight });
  private readonly insets = signal<Insets>({ top: 0, right: 0, bottom: 0, left: 0 });
  /** Ist die Bar (Emoji-Leiste + Dock) eingeblendet? */
  readonly barVisible = signal(true);

  private readonly params = new URLSearchParams(location.search);
  private readonly forcedDevice = this.params.get('device') as DeviceClass | null;
  private readonly probe: HTMLElement;

  readonly layout = computed<DeckLayout>(() =>
    computeLayout(this.viewport(), this.insets(), this.device(), this.barVisible()),
  );

  constructor() {
    this.applySimulatedSafeArea();
    this.probe = document.createElement('div');
    this.probe.className = 'cd-safe-probe';
    document.body.appendChild(this.probe);
    const update = (): void => this.update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', () => setTimeout(update, 50));
    window.visualViewport?.addEventListener('resize', update);
    this.update();
  }

  private device(): DeviceClass {
    if (this.forcedDevice === 'pad' || this.forcedDevice === 'phone') return this.forcedDevice;
    return Math.min(screen.width, screen.height) >= 600 ? 'pad' : 'phone';
  }

  /** `?safe=oben,rechts,unten,links` simuliert Safe Areas (für Playwright-Screenshots). */
  private applySimulatedSafeArea(): void {
    const raw = this.params.get('safe');
    if (!raw) return;
    const v = raw.split(',').map((n) => Math.max(0, Math.min(200, Number(n) || 0)));
    const root = document.documentElement.style;
    root.setProperty('--sa-t', `${v[0] ?? 0}px`);
    root.setProperty('--sa-r', `${v[1] ?? 0}px`);
    root.setProperty('--sa-b', `${v[2] ?? 0}px`);
    root.setProperty('--sa-l', `${v[3] ?? 0}px`);
  }

  private update(): void {
    const cs = getComputedStyle(this.probe);
    this.insets.set({
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    });
    this.viewport.set({ w: window.innerWidth, h: window.innerHeight });
  }
}

export function computeLayout(
  vp: { w: number; h: number },
  safe: Insets,
  device: DeviceClass,
  barVisible: boolean,
): DeckLayout {
  const orientation: Orientation = vp.w >= vp.h ? 'landscape' : 'portrait';
  const cw = vp.w - safe.left - safe.right;

  if (device === 'pad') {
    const margin = 24;
    const groupGap = 24;
    const padX = RATIO.padPadX, padY = RATIO.padPadY;
    const unitW = 4 + 3 * RATIO.gap + 2 * padX; // Gruppenbreite in f
    const unitH = 2 + RATIO.gap + 2 * padY; // Gruppenhöhe in f
    const barH = barVisible ? EMOJI_BAR_H + 18 : 0;
    const dockH = barVisible ? DOCK_H + 8 : 0;
    const barTop = safe.top + (orientation === 'landscape' ? 30 : 16);
    const top = barTop + barH;
    const bottom = safe.bottom + dockH + DOTS_H + 8;
    const availH = vp.h - top - bottom;

    let frame: number;
    let pageFlow: 'row' | 'column';
    if (orientation === 'landscape') {
      // Zwei Gruppen nebeneinander, rechts bleibt Platz für die angeschnittene nächste Seite + Pille.
      pageFlow = 'row';
      const byW = (cw - margin - groupGap - groupGap - SIDE_COL) / (2 * unitW);
      const byH = (availH - 16) / unitH;
      frame = Math.min(byW, byH);
    } else {
      pageFlow = 'column';
      const byW = (cw - margin - groupGap - SIDE_COL) / unitW;
      const byH = (availH - groupGap - 16) / (2 * unitH);
      frame = Math.min(byW, byH);
    }
    frame = Math.floor(Math.max(56, frame));
    const groupW = Math.round(unitW * frame);
    const groupH = Math.round(unitH * frame);
    const pageContentW = pageFlow === 'row' ? 2 * groupW + groupGap : groupW;
    return {
      device, orientation, vw: vp.w, vh: vp.h, safe, frame,
      cols: 4, rows: 2, padX: padX * frame, padY: padY * frame,
      groupW, groupH, groupsPerPage: 2, pageFlow, groupGap,
      pageStep: pageContentW + groupGap,
      startX: safe.left + margin,
      stageTop: top,
      stageH: availH,
      contentH: pageFlow === 'row' ? groupH : 2 * groupH + groupGap,
      barTop,
      barMode: 'inline',
      controls: 'side',
    };
  }

  // iPhone: eine Gruppe pro Seite.
  const padX = RATIO.phonePadX, padY = RATIO.phonePadY;
  if (orientation === 'landscape') {
    const margin = 8;
    const unitW = 4 + 3 * RATIO.gap + 2 * padX;
    const unitH = 2 + RATIO.gap + 2 * padY;
    const top = Math.max(safe.top, 10);
    const bottom = safe.bottom + DOTS_H - 4;
    const availH = vp.h - top - bottom;
    const availW = cw - margin - SIDE_COL;
    const frame = Math.floor(Math.max(48, Math.min(availW / unitW, availH / unitH)));
    const groupW = Math.round(unitW * frame);
    const groupH = Math.round(unitH * frame);
    // Gruppe im verfügbaren Bereich zentrieren.
    const startX = safe.left + margin + Math.max(0, (availW - groupW) / 2);
    return {
      device, orientation, vw: vp.w, vh: vp.h, safe, frame,
      cols: 4, rows: 2, padX: padX * frame, padY: padY * frame,
      groupW, groupH, groupsPerPage: 1, pageFlow: 'row', groupGap: 0,
      pageStep: vp.w,
      startX,
      stageTop: top,
      stageH: availH,
      contentH: groupH,
      barTop: 0,
      barMode: 'overlay',
      controls: 'side',
    };
  }
  const margin = 16;
  const unitW = 2 + RATIO.gap + 2 * padX;
  const unitH = 4 + 3 * RATIO.gap + 2 * padY;
  const controlsH = 64;
  const top = safe.top + 12;
  const bottom = safe.bottom + controlsH + DOTS_H;
  const availH = vp.h - top - bottom;
  const frame = Math.floor(Math.max(48, Math.min((cw - 2 * margin) / unitW, availH / unitH)));
  const groupW = Math.round(unitW * frame);
  const groupH = Math.round(unitH * frame);
  return {
    device, orientation, vw: vp.w, vh: vp.h, safe, frame,
    cols: 2, rows: 4, padX: padX * frame, padY: padY * frame,
    groupW, groupH, groupsPerPage: 1, pageFlow: 'row', groupGap: 0,
    pageStep: vp.w,
    startX: safe.left + (cw - groupW) / 2,
    stageTop: top,
    stageH: availH,
    contentH: groupH,
    barTop: 0,
    barMode: 'overlay',
    controls: 'bottom',
  };
}
