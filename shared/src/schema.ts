/**
 * zod-Schemas: Der Helper prüft damit jede Konfiguration und jede Client-Nachricht.
 * Bewusst getrennt von index.ts, damit die PWA zod nicht mitlädt.
 */
import { z } from 'zod';
import { CONFIG_SCHEMA_VERSION, HOTKEY_KEYS, MODIFIERS, TILES_PER_GROUP } from './config';
import { ID_PATTERN } from './protocol';

const id = z.string().regex(ID_PATTERN);
/** IDs in der Konfiguration: "sys-" ist für feste System-Aktionen reserviert. */
const configId = id.refine((v) => !v.startsWith('sys-'), 'Präfix sys- ist reserviert');
export const BUNDLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,199}$/;
const bundleId = z.string().regex(BUNDLE_ID_PATTERN);
/** Ein Emoji bzw. eine kurze Zeichenfolge ohne Steuerzeichen. */
const emoji = z.string().min(1).max(32).regex(/^[^\p{Cc}\s<>]+$/u);
const label = z.string().trim().min(1).max(40).regex(/^[^\p{Cc}]+$/u);

/** Nur http/https, keine Zugangsdaten in der URL. */
export const httpUrl = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && !!u.hostname;
    } catch {
      return false;
    }
  }, 'Nur http- und https-Links sind erlaubt');

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('openApp'), bundleId }).strict(),
  z.object({ type: z.literal('openUrl'), url: httpUrl }).strict(),
  z.object({
    type: z.literal('hotkey'),
    modifiers: z.array(z.enum(MODIFIERS)).max(4).refine((m) => new Set(m).size === m.length, 'doppelte Modifier'),
    key: z.enum(HOTKEY_KEYS),
  }).strict(),
  z.object({ type: z.literal('tileWindows') }).strict(),
  z.object({ type: z.literal('stageManager') }).strict(),
  z.object({ type: z.literal('timer'), preset: z.enum(['pomodoro', 'break']) }).strict(),
  z.object({ type: z.literal('insertEmoji'), emoji }).strict(),
]);

export const IMAGE_FILE_PATTERN = /^[a-f0-9]{32}\.(png|jpg|webp)$/;

const tileIcon = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('emoji'), emoji }).strict(),
  z.object({ type: z.literal('appIcon'), bundleId }).strict(),
  z.object({ type: z.literal('image'), file: z.string().regex(IMAGE_FILE_PATTERN) }).strict(),
]);

export const tileSchema = z.discriminatedUnion('kind', [
  z.object({
    id: configId, kind: z.literal('app'), label,
    action: z.object({ type: z.literal('openApp'), bundleId }).strict(),
  }).strict(),
  z.object({
    id: configId, kind: z.literal('action'), label,
    color: z.enum(['brown', 'violet']),
    icon: tileIcon,
    action: actionSchema,
  }).strict(),
]);

export const deckConfigSchema = z
  .object({
    schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    groups: z.array(z.object({ id: configId, tiles: z.array(tileSchema.nullable()).length(TILES_PER_GROUP) }).strict()).max(64),
    emojis: z.array(z.object({ id: configId, emoji }).strict()).max(16),
    dock: z.array(z.object({ id: configId, bundleId, label }).strict()).max(40),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    // Alle IDs (Gruppen, Kacheln, Emojis, Dock) müssen eindeutig sein, weil Aktionen per ID laufen.
    const seen = new Set<string>();
    const ids = [
      ...cfg.groups.map((g) => g.id),
      ...cfg.groups.flatMap((g) => g.tiles.filter((t) => t !== null).map((t) => t.id)),
      ...cfg.emojis.map((e) => e.id),
      ...cfg.dock.map((d) => d.id),
    ];
    for (const i of ids) {
      if (seen.has(i)) ctx.addIssue({ code: 'custom', message: `ID doppelt: ${i}` });
      seen.add(i);
    }
  });

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().min(20).max(200), protocol: z.number().int() }).strict(),
  z.object({ type: z.literal('run'), requestId: id, actionId: id }).strict(),
  z.object({ type: z.literal('ping'), t: z.number() }).strict(),
]);

export const pairRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  deviceName: label,
}).strict();
