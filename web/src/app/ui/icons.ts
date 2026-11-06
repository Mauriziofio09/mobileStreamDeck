import { Component, input } from '@angular/core';

/** Eigene, einfache Linien-Icons (24×24), Farbe über currentColor. */
@Component({
  selector: 'cd-icon',
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      @switch (name()) {
        @case ('info') {
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
          <path d="M12 11v6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          <circle cx="12" cy="7.6" r="1.4" fill="currentColor" />
        }
        @case ('grid') {
          <rect x="3.5" y="3.5" width="7" height="7" rx="2" fill="currentColor" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="2" fill="currentColor" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="2" fill="currentColor" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="2" fill="currentColor" />
        }
        @case ('clock') {
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2" />
          <path d="M12 7.5V12h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        }
        @case ('check') {
          <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        }
        @case ('cross') {
          <path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        }
        @case ('minus') {
          <path d="M6 12h12" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        }
        @case ('offline') {
          <path d="M3 9.5a13 13 0 0 1 18 0M6.5 13a8 8 0 0 1 11 0M10 16.5a3 3 0 0 1 4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <path d="M4 4l16 16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        }
      }
    </svg>
  `,
  styles: `
    :host { display: inline-block; width: 1em; height: 1em; line-height: 0; }
    svg { width: 100%; height: 100%; }
  `,
})
export class IconComponent {
  readonly name = input.required<'info' | 'grid' | 'clock' | 'check' | 'cross' | 'minus' | 'offline'>();
}
