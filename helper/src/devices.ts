import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { DeviceInfo } from '@copper-deck/shared';
import { readJson, writeFileAtomic } from './fsutil';

/**
 * Gekoppelte Geräte. Pro Gerät ein eigenes Token; gespeichert wird nur der SHA-256-Hash
 * (Tokens haben 256 Bit Zufall, daher genügt ein schneller Hash). Datei mit Rechten 600.
 */
interface DeviceRecord {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string | null;
}

const fileSchema = z.object({
  version: z.literal(1),
  devices: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
      createdAt: z.string(),
      lastSeenAt: z.string().nullable(),
    }),
  ),
});

const hash = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest();

export class DeviceStore {
  private devices: DeviceRecord[] = [];
  private seenDirty = false;

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    const raw = await readJson(this.file);
    this.devices = raw === undefined ? [] : fileSchema.parse(raw).devices;
  }

  /** Legt ein Gerät an und gibt das Klartext-Token genau einmal zurück. */
  async add(name: string): Promise<{ id: string; token: string }> {
    const token = randomBytes(32).toString('base64url');
    const id = `dev_${randomBytes(6).toString('hex')}`;
    this.devices.push({
      id,
      name,
      tokenHash: hash(token).toString('hex'),
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
    });
    await this.save();
    return { id, token };
  }

  /** Prüft ein Token in konstanter Zeit gegen alle Hashes. */
  verify(token: unknown): DeviceRecord | null {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    const h = hash(token);
    let match: DeviceRecord | null = null;
    for (const d of this.devices) {
      if (timingSafeEqual(h, Buffer.from(d.tokenHash, 'hex'))) match = d;
    }
    return match;
  }

  touch(id: string): void {
    const d = this.devices.find((x) => x.id === id);
    if (d) {
      d.lastSeenAt = new Date().toISOString();
      this.seenDirty = true;
    }
  }

  async flushSeen(): Promise<void> {
    if (!this.seenDirty) return;
    this.seenDirty = false;
    await this.save();
  }

  list(): DeviceInfo[] {
    return this.devices.map(({ id, name, createdAt, lastSeenAt }) => ({ id, name, createdAt, lastSeenAt }));
  }

  async revoke(id: string): Promise<boolean> {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== id);
    if (this.devices.length === before) return false;
    await this.save();
    return true;
  }

  private async save(): Promise<void> {
    await writeFileAtomic(this.file, JSON.stringify({ version: 1, devices: this.devices }, null, 2), { mode: 0o600 });
  }
}
