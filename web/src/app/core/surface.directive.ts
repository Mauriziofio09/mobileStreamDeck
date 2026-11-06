import { DestroyRef, Directive, ElementRef, effect, inject, input } from '@angular/core';
import { squirclePath } from './squircle';

/**
 * Zeichnet Fläche, Rand, Innenleuchten, Bevel und Schatten eines Elements als SVG-Ebene
 * mit Continuous Corners. Es wird bewusst NICHT mit clip-path/mask gearbeitet:
 * Rand und Leuchten liegen innerhalb der Form, der Schatten ausserhalb (overflow: visible),
 * dadurch wird nichts abgeschnitten. Funktioniert ohne `corner-shape` (Safari iOS).
 *
 * Alle Farben kommen als CSS-Variablen aus styles.css.
 */
export type SurfaceVariant =
  | 'group'
  | 'frame'
  | 'tile-brown'
  | 'tile-violet'
  | 'tile-missing'
  | 'tile-empty'
  | 'icon'
  | 'bar'
  | 'pill'
  | 'segment'
  | 'button'
  | 'dock-frame'
  | 'sheet';

interface Spec {
  fill?: readonly (readonly [number, string])[] | string;
  rim?: string;
  rimDash?: string;
  glow?: { color: string; width: number; blur: number };
  bevel?: boolean;
  sheen?: boolean;
  shadow?: { color: string; dy: number; blur: number; spread?: number };
}

const SPECS: Record<SurfaceVariant, Spec> = {
  group: {
    fill: [[0, 'var(--c-group-fill-top)'], [1, 'var(--c-group-fill-bottom)']],
    rim: 'var(--c-group-rim)',
  },
  frame: {
    fill: [[0, 'var(--c-frame-fill-top)'], [1, 'var(--c-frame-fill-bottom)']],
    rim: 'var(--c-frame-rim)',
    glow: { color: 'var(--c-frame-glow)', width: 5, blur: 3 },
  },
  'tile-brown': {
    fill: [[0, 'var(--c-brown-top)'], [0.55, 'var(--c-brown-mid)'], [1, 'var(--c-brown-bottom)']],
    bevel: true,
    sheen: true,
    shadow: { color: 'var(--c-tile-shadow)', dy: 3, blur: 3.5 },
  },
  'tile-violet': {
    fill: [[0, 'var(--c-violet-top)'], [0.55, 'var(--c-violet-mid)'], [1, 'var(--c-violet-bottom)']],
    bevel: true,
    sheen: true,
    shadow: { color: 'var(--c-tile-shadow)', dy: 3, blur: 3.5 },
  },
  'tile-missing': {
    fill: [[0, 'var(--c-missing-top)'], [1, 'var(--c-missing-bottom)']],
    rim: 'var(--c-missing-rim)',
    rimDash: '5 4',
  },
  'tile-empty': {
    rim: 'var(--c-empty-rim)',
    rimDash: '4 5',
  },
  icon: {
    shadow: { color: 'var(--c-tile-shadow)', dy: 3, blur: 3.5, spread: -2 },
  },
  bar: {
    fill: [[0, 'var(--c-bar-fill-top)'], [1, 'var(--c-bar-fill-bottom)']],
    rim: 'var(--c-bar-rim)',
  },
  pill: {
    fill: [[0, 'var(--c-pill-fill-top)'], [1, 'var(--c-pill-fill-bottom)']],
    rim: 'var(--c-pill-rim)',
    glow: { color: 'var(--c-pill-glow)', width: 4, blur: 3 },
  },
  segment: {
    fill: [[0, 'var(--c-seg-fill-top)'], [1, 'var(--c-seg-fill-bottom)']],
    rim: 'var(--c-seg-rim)',
    bevel: true,
  },
  button: {
    fill: [[0, 'var(--c-pill-fill-top)'], [1, 'var(--c-pill-fill-bottom)']],
    rim: 'var(--c-pill-rim)',
    glow: { color: 'var(--c-pill-glow)', width: 4, blur: 3 },
  },
  'dock-frame': {
    fill: [[0, 'var(--c-dock-fill-top)'], [1, 'var(--c-dock-fill-bottom)']],
    rim: 'var(--c-dock-rim)',
    glow: { color: 'var(--c-frame-glow)', width: 4, blur: 2.5 },
    shadow: { color: 'var(--c-dock-shadow)', dy: 0, blur: 5 },
  },
  sheet: {
    fill: [[0, 'var(--c-sheet-top)'], [1, 'var(--c-sheet-bottom)']],
    rim: 'var(--c-group-rim)',
    glow: { color: 'var(--c-frame-glow)', width: 6, blur: 5 },
    shadow: { color: 'var(--c-tile-shadow)', dy: 10, blur: 18 },
  },
};

let uidCounter = 0;
const SVG_NS = 'http://www.w3.org/2000/svg';

function stops(list: readonly (readonly [number, string])[]): string {
  return list.map(([o, c]) => `<stop offset="${o}" style="stop-color:${c}"/>`).join('');
}

export function renderSurface(variant: SurfaceVariant, w: number, h: number, r: number, uid: string): string {
  const s = SPECS[variant];
  const d = squirclePath(0, 0, w, h, r);
  const defs: string[] = [];
  const body: string[] = [];

  if (s.shadow) {
    const sp = s.shadow.spread ?? 0;
    const sd = squirclePath(-sp, -sp, w + 2 * sp, h + 2 * sp, r + sp);
    defs.push(
      `<filter id="${uid}s" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="${s.shadow.blur}"/></filter>`,
    );
    body.push(
      `<path d="${sd}" transform="translate(0 ${s.shadow.dy})" style="fill:${s.shadow.color}" filter="url(#${uid}s)"/>`,
    );
  }
  if (s.fill) {
    if (typeof s.fill === 'string') {
      body.push(`<path d="${d}" style="fill:${s.fill}"/>`);
    } else {
      defs.push(`<linearGradient id="${uid}f" x1="0" y1="0" x2="0.18" y2="1">${stops(s.fill)}</linearGradient>`);
      body.push(`<path d="${d}" fill="url(#${uid}f)"/>`);
    }
  }
  const needsClip = !!(s.glow || s.bevel || s.sheen);
  if (needsClip) defs.push(`<clipPath id="${uid}c"><path d="${d}"/></clipPath>`);

  if (s.sheen) {
    defs.push(
      `<linearGradient id="${uid}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--c-sheen)"/><stop offset="0.5" style="stop-color:var(--c-sheen);stop-opacity:0"/></linearGradient>`,
    );
    body.push(`<path d="${d}" fill="url(#${uid}g)"/>`);
  }
  if (s.glow) {
    defs.push(
      `<filter id="${uid}b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${s.glow.blur}"/></filter>`,
    );
    body.push(
      `<g clip-path="url(#${uid}c)"><path d="${d}" fill="none" style="stroke:${s.glow.color}" stroke-width="${s.glow.width * 2}" filter="url(#${uid}b)"/></g>`,
    );
  }
  if (s.bevel) {
    // Glanzlicht oben, Abdunklung unten: zwei Verlaufs-Konturen innerhalb der Form.
    defs.push(
      `<linearGradient id="${uid}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--c-bevel-hi)"/><stop offset="0.3" style="stop-color:var(--c-bevel-hi);stop-opacity:0"/></linearGradient>`,
      `<linearGradient id="${uid}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0.6" style="stop-color:var(--c-bevel-lo);stop-opacity:0"/><stop offset="1" style="stop-color:var(--c-bevel-lo)"/></linearGradient>`,
    );
    body.push(
      `<g clip-path="url(#${uid}c)"><path d="${d}" fill="none" stroke="url(#${uid}h)" stroke-width="3"/><path d="${d}" fill="none" stroke="url(#${uid}l)" stroke-width="5"/></g>`,
    );
  }
  if (s.rim) {
    const rd = squirclePath(0.5, 0.5, w - 1, h - 1, Math.max(0, r - 0.5));
    const dash = s.rimDash ? ` stroke-dasharray="${s.rimDash}"` : '';
    body.push(`<path d="${rd}" fill="none" style="stroke:${s.rim}" stroke-width="1"${dash}/>`);
  }
  return `<defs>${defs.join('')}</defs>${body.join('')}`;
}

@Directive({
  selector: '[cdSurface]',
  host: { class: 'cd-surface' },
})
export class SurfaceDirective {
  /** Darstellungsvariante. */
  readonly variant = input.required<SurfaceVariant>({ alias: 'cdSurface' });
  /** Eckenradius als Anteil der kürzeren Seite (0.5 = Kapsel). */
  readonly radius = input<number>(0.25, { alias: 'cdRadius' });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly svg = document.createElementNS(SVG_NS, 'svg');
  private readonly uid = `cds${++uidCounter}`;
  private size = { w: 0, h: 0 };
  private lastKey = '';

  constructor() {
    this.svg.setAttribute('class', 'cd-surface__svg');
    this.svg.setAttribute('aria-hidden', 'true');
    this.host.prepend(this.svg);

    const ro = new ResizeObserver(() => this.measure());
    ro.observe(this.host);
    inject(DestroyRef).onDestroy(() => ro.disconnect());

    effect(() => {
      this.variant();
      this.radius();
      this.draw();
    });
  }

  private measure(): void {
    // offsetWidth/Height ignorieren Transforms (Eindrücken, Wackeln) -> kein Neuzeichnen beim Animieren.
    this.size = { w: this.host.offsetWidth, h: this.host.offsetHeight };
    this.draw();
  }

  private draw(): void {
    const { w, h } = this.size;
    const variant = this.variant();
    const ratio = this.radius();
    const key = `${variant}|${ratio}|${w}|${h}`;
    if (key === this.lastKey || w === 0 || h === 0) return;
    this.lastKey = key;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.setAttribute('width', String(w));
    this.svg.setAttribute('height', String(h));
    this.svg.innerHTML = renderSurface(variant, w, h, ratio * Math.min(w, h), this.uid);
  }
}
