import { Injectable, signal } from '@angular/core';

/** Schwellen für die Gestentrennung. */
export const GESTURE = {
  /** Bewegung in px, ab der eine Berührung kein Tippen mehr ist. */
  slop: 10,
  /** Langes Drücken (ohne Bewegung). */
  longPressMs: 500,
} as const;

/** Meldet, wenn eine Wischgeste übernimmt, damit Kacheln Tippen/langes Drücken abbrechen. */
@Injectable({ providedIn: 'root' })
export class GestureBus {
  /** Wird bei jedem Start einer Seitenwisch-Geste erhöht. */
  readonly swipeStarted = signal(0);
}
