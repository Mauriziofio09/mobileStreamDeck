import { randomInt, timingSafeEqual } from 'node:crypto';

export const PAIR_CODE_TTL_MS = 5 * 60_000;
export const PAIR_MAX_ATTEMPTS = 5;

export type PairCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'no_code' | 'expired' | 'wrong' | 'locked'; readonly attemptsLeft: number };

/**
 * Kopplungscode: 6-stellig, einmalig, 5 Minuten gültig, höchstens 5 Fehlversuche.
 * Ein neuer Code ersetzt den alten.
 */
export class PairingManager {
  private code: string | null = null;
  private expiresAt = 0;
  private failures = 0;

  constructor(private readonly now: () => number = Date.now) {}

  create(): { code: string; expiresAt: number } {
    this.code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    this.expiresAt = this.now() + PAIR_CODE_TTL_MS;
    this.failures = 0;
    return { code: this.code, expiresAt: this.expiresAt };
  }

  /** Prüft und verbraucht den Code bei Erfolg. */
  check(input: string): PairCheck {
    if (!this.code) return { ok: false, reason: 'no_code', attemptsLeft: 0 };
    if (this.now() > this.expiresAt) {
      this.code = null;
      return { ok: false, reason: 'expired', attemptsLeft: 0 };
    }
    const a = Buffer.from(input.padEnd(6, ' ').slice(0, 6));
    const b = Buffer.from(this.code);
    if (input.length === 6 && timingSafeEqual(a, b)) {
      this.code = null;
      return { ok: true };
    }
    this.failures += 1;
    const left = PAIR_MAX_ATTEMPTS - this.failures;
    if (left <= 0) {
      this.code = null;
      return { ok: false, reason: 'locked', attemptsLeft: 0 };
    }
    return { ok: false, reason: 'wrong', attemptsLeft: left };
  }

  status(): { active: boolean; expiresAt: number | null } {
    const active = !!this.code && this.now() <= this.expiresAt;
    return { active, expiresAt: active ? this.expiresAt : null };
  }
}
