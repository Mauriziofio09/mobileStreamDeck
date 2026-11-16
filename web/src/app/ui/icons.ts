import { Component, input } from '@angular/core';

export type IconName =
  | 'info' | 'grid' | 'clock' | 'check' | 'cross' | 'minus' | 'offline'
  | 'aperture' | 'prev' | 'next' | 'undo' | 'redo' | 'star' | 'flag';

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
        @case ('aperture') {
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
          <path d="M12 3l3.2 7.6M21 12l-8.1 1.4M16.5 19.8L11.3 13M7.5 19.8l3.6-7.2M3 12l8.2-1M7.5 4.2l5 6.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        }
        @case ('prev') {
          <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
        }
        @case ('next') {
          <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
        }
        @case ('undo') {
          <path d="M9 7L4.5 11.5 9 16M5 11.5h9a5.5 5.5 0 0 1 0 11h-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -3)" />
        }
        @case ('redo') {
          <path d="M15 7l4.5 4.5L15 16M19 11.5h-9a5.5 5.5 0 0 0 0 11h3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -3)" />
        }
        @case ('star') {
          <path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill="currentColor" />
        }
        @case ('flag') {
          <path d="M6 21V4M6 4h10l-2 4 2 4H6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
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
  readonly name = input.required<IconName>();
}
