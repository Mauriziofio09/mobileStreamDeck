/**
 * Bestätigung ohne Browser-Dialog (window.confirm blockiert und ist in iOS-PWAs unschön):
 * zweites Tippen innerhalb von 3 s bestätigt.
 */
let pendingRemoval: { key: string; until: number } | null = null;

export function confirmRemoval(key: string, label: string): boolean {
  const now = Date.now();
  if (pendingRemoval && pendingRemoval.key === key && now < pendingRemoval.until) {
    pendingRemoval = null;
    return true;
  }
  pendingRemoval = { key, until: now + 3000 };
  window.dispatchEvent(new CustomEvent('cd-toast', { detail: `„${label}“ entfernen? Zum Bestätigen nochmals tippen.` }));
  return false;
}
