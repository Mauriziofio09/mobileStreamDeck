/**
 * Continuous Corners (Squircle) als SVG-Pfad.
 * Eigene Implementierung der bekannten Bezier-Näherung für iOS-artige Ecken:
 * Die Krümmung beginnt 1.5287·r vor der Ecke und läuft stetig aus (keine Kreisbögen).
 */
const K = {
  start: 1.52866483,
  c1: 1.08849323,
  c2: 0.86840689,
  p1x: 0.63149399,
  p1y: 0.074911,
  c3x: 0.37282392,
  c3y: 0.169056,
} as const;

/** Grösster Radius, bei dem sich die Ecken nicht überlappen (ergibt eine Kapsel). */
export function maxSquircleRadius(w: number, h: number): number {
  return Math.min(w, h) / 2 / K.start;
}

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

export function squirclePath(x: number, y: number, w: number, h: number, radius: number): string {
  if (w <= 0 || h <= 0) return '';
  const r = Math.max(0, Math.min(radius, maxSquircleRadius(w, h)));
  const L = x, T = y, R = x + w, B = y + h;
  const s = K.start * r, c1 = K.c1 * r, c2 = K.c2 * r;
  const px = K.p1x * r, py = K.p1y * r, cx = K.c3x * r, cy = K.c3y * r;

  // Im Uhrzeigersinn, beginnend oben links nach der Rundung.
  return [
    `M${f(L + s)} ${f(T)}`,
    `L${f(R - s)} ${f(T)}`,
    // oben rechts
    `C${f(R - c1)} ${f(T)} ${f(R - c2)} ${f(T)} ${f(R - px)} ${f(T + py)}`,
    `C${f(R - cx)} ${f(T + cy)} ${f(R - cy)} ${f(T + cx)} ${f(R - py)} ${f(T + px)}`,
    `C${f(R)} ${f(T + c2)} ${f(R)} ${f(T + c1)} ${f(R)} ${f(T + s)}`,
    `L${f(R)} ${f(B - s)}`,
    // unten rechts
    `C${f(R)} ${f(B - c1)} ${f(R)} ${f(B - c2)} ${f(R - py)} ${f(B - px)}`,
    `C${f(R - cy)} ${f(B - cx)} ${f(R - cx)} ${f(B - cy)} ${f(R - px)} ${f(B - py)}`,
    `C${f(R - c2)} ${f(B)} ${f(R - c1)} ${f(B)} ${f(R - s)} ${f(B)}`,
    `L${f(L + s)} ${f(B)}`,
    // unten links
    `C${f(L + c1)} ${f(B)} ${f(L + c2)} ${f(B)} ${f(L + px)} ${f(B - py)}`,
    `C${f(L + cx)} ${f(B - cy)} ${f(L + cy)} ${f(B - cx)} ${f(L + py)} ${f(B - px)}`,
    `C${f(L)} ${f(B - c2)} ${f(L)} ${f(B - c1)} ${f(L)} ${f(B - s)}`,
    `L${f(L)} ${f(T + s)}`,
    // oben links
    `C${f(L)} ${f(T + c1)} ${f(L)} ${f(T + c2)} ${f(L + py)} ${f(T + px)}`,
    `C${f(L + cy)} ${f(T + cx)} ${f(L + cx)} ${f(T + cy)} ${f(L + px)} ${f(T + py)}`,
    `C${f(L + c2)} ${f(T)} ${f(L + c1)} ${f(T)} ${f(L + s)} ${f(T)}`,
    'Z',
  ].join('');
}
