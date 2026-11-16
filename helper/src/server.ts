import { existsSync } from 'node:fs';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { z } from 'zod';
import {
  CLOSE, PROTOCOL_VERSION, WS_PATH,
  type DeckConfig, type InstalledApp, type ServerMessage,
} from '@copper-deck/shared';
import { APP_ID_PATTERN, clientMessageSchema, deckConfigSchema, pairRequestSchema } from '@copper-deck/shared/schema';
import { MEDIA_MAX_BYTES, MEDIA_TYPES } from '@copper-deck/shared';
import type { MediaStore } from './media';
import { isSystemAction, resolveAction, type ActionRunner, type RunResult } from './actions/runner';
import type { AppCatalog } from './apps';
import type { ConfigStore } from './config-store';
import type { DeviceStore } from './devices';
import { log } from './log';
import type { PairingManager } from './pairing';
import type { PermissionMonitor } from './permissions';
import type { TimerManager } from './timer';
import { PLATFORM } from './platform';
import type { LightroomBridge } from './lightroom';
import type { LrCommand } from '@copper-deck/shared';

export interface ServerDeps {
  readonly devices: DeviceStore;
  readonly pairing: PairingManager;
  readonly config: ConfigStore;
  readonly catalog: AppCatalog;
  readonly runner: ActionRunner;
  readonly timers: TimerManager;
  readonly permissions: PermissionMonitor;
  readonly media: MediaStore;
  /** Erlaubte Origins, z. B. https://macbook-pro-von-maurizio.local:7443 */
  readonly origins: readonly string[];
  readonly webRoot: string;
  readonly tls: { key: string | Buffer; cert: string | Buffer };
  readonly version: string;
  /** Wartezeit nach fehlgeschlagener Kopplung (bremst Raten). */
  readonly pairFailDelayMs?: number;
  readonly actionTimeoutMs?: number;
  /** Verbindung zum Lightroom-Classic-Plugin (fehlt in Tests ohne Lightroom). */
  readonly lightroom?: LightroomBridge;
  /** "Mit vorherigen Einstellungen exportieren" (Tastenkombination in Lightroom). */
  readonly lightroomExport?: () => Promise<RunResult>;
}

interface Session {
  deviceId: string | null;
  inflight: number;
  alive: boolean;
}

const AUTH_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 20_000;
const MAX_INFLIGHT = 4;

export function createServer(deps: ServerDeps) {
  const allowed = new Set(deps.origins.map((o) => o.toLowerCase()));
  const originOk = (origin: string | undefined): boolean => !!origin && allowed.has(origin.toLowerCase());
  const sockets = new Map<WebSocket, Session>();

  // ---------- HTTP ----------
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', 'strong');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data:",
        "font-src 'self'",
        "connect-src 'self'",
        "manifest-src 'self'",
        "worker-src 'self'",
        "base-uri 'self'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
    next();
  });

  const api = express.Router();
  // Fremde Origins (CSRF) abweisen; Anfragen ohne Origin (z. B. curl) brauchen trotzdem ein Token.
  api.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin !== undefined && !originOk(origin)) {
      res.status(403).json({ error: 'Origin nicht erlaubt' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Betriebssystem (ohne Token): Kopplungs- und Offline-Ansicht sprechen von "Mac" bzw. "PC".
  api.get('/platform', (_req, res) => {
    res.json({ platform: PLATFORM });
  });

  // Kopplung (ohne Token)
  api.post('/pair', express.json({ limit: '2kb' }), async (req, res) => {
    const body = pairRequestSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Bitte den 6-stelligen Code und einen Gerätenamen angeben.' });
      return;
    }
    const check = deps.pairing.check(body.data.code);
    if (!check.ok) {
      await delay(deps.pairFailDelayMs ?? 400);
      const messages = {
        no_code: 'Kein aktiver Code. Im Terminal "copper-deck pair" ausführen.',
        expired: 'Der Code ist abgelaufen. Bitte mit "copper-deck pair" einen neuen erzeugen.',
        locked: 'Zu viele Fehlversuche. Der Code ist ungültig, bitte einen neuen erzeugen.',
        wrong: 'Falscher Code.',
      } as const;
      log('warn', 'Kopplung abgelehnt', { reason: check.reason, attemptsLeft: check.attemptsLeft });
      res.status(check.reason === 'wrong' ? 401 : 410).json({ error: messages[check.reason], attemptsLeft: check.attemptsLeft });
      return;
    }
    const { id, token } = await deps.devices.add(body.data.deviceName);
    log('info', 'Gerät gekoppelt', { deviceId: id, name: body.data.deviceName });
    res.status(201).json({ deviceId: id, token });
  });

  // Alles Weitere nur mit gültigem Token (Authorization: Bearer …)
  api.use((req, res, next) => {
    const m = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(req.headers.authorization ?? '');
    const device = m ? deps.devices.verify(m[1]) : null;
    if (!device) {
      res.status(401).json({ error: 'Nicht gekoppelt oder Token widerrufen.' });
      return;
    }
    res.locals['deviceId'] = device.id;
    next();
  });

  api.get('/session', (_req, res) => {
    const id = res.locals['deviceId'] as string;
    const d = deps.devices.list().find((x) => x.id === id);
    res.json({ deviceId: id, name: d?.name ?? '' });
  });

  api.get('/devices', (_req, res) => {
    const id = res.locals['deviceId'] as string;
    res.json(deps.devices.list().map((d) => ({ ...d, current: d.id === id })));
  });

  api.delete('/devices/:id', async (req, res) => {
    const ok = await revokeDevice(req.params['id'] ?? '');
    res.status(ok ? 204 : 404).end();
  });

  api.get('/apps', async (_req, res) => {
    res.json(await deps.catalog.list());
  });

  api.get('/icons/:bundleId', async (req, res) => {
    const bundleId = String(req.params['bundleId'] ?? '').replace(/\.png$/, '');
    if (!APP_ID_PATTERN.test(bundleId)) {
      res.status(400).end();
      return;
    }
    const file = await deps.catalog.icon(bundleId);
    if (!file) {
      res.status(404).json({ error: 'App nicht installiert' });
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.type('png').sendFile(file);
  });

  // Eigene Bilder: nur PNG/JPEG/WebP, Grössenlimit, Dateiname vom Helper.
  api.post('/media', express.raw({ type: () => true, limit: MEDIA_MAX_BYTES }), async (req, res) => {
    const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (!(MEDIA_TYPES as readonly string[]).includes(type)) {
      res.status(415).json({ error: 'Nur PNG, JPEG oder WebP (kein SVG).' });
      return;
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const r = await deps.media.save(body);
    if (!r.ok) {
      const msg = { too_large: 'Bild ist grösser als 2 MB.', unsupported: 'Nur PNG, JPEG oder WebP (kein SVG).', invalid_image: 'Bild ist beschädigt oder nicht lesbar.' }[r.error];
      res.status(r.error === 'too_large' ? 413 : 415).json({ error: msg });
      return;
    }
    log('info', 'Bild gespeichert', { deviceId: res.locals['deviceId'], file: r.file });
    res.status(201).json({ file: r.file });
  });

  api.get('/media/:file', async (req, res) => {
    const p = await deps.media.resolve(String(req.params['file'] ?? ''));
    if (!p) {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.type('png').sendFile(p);
  });

  api.use((_req, res) => {
    res.status(404).json({ error: 'Unbekannter Endpunkt' });
  });
  app.use('/api', api);

  // App-Shell (öffentlich)
  if (existsSync(path.join(deps.webRoot, 'index.html'))) {
    app.use(
      express.static(deps.webRoot, {
        index: false,
        setHeaders(res, file) {
          const base = path.basename(file);
          // Gehashte Bundles dürfen lange gecacht werden; Shell und SW-Dateien nie.
          if (/-[A-Z0-9]{8}\.(js|css)$/.test(base)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          else res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.get('/{*path}', (req, res) => {
      if (req.path.startsWith('/api') || req.path === WS_PATH) {
        res.status(404).end();
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(deps.webRoot, 'index.html'));
    });
  } else {
    app.get('/{*path}', (_req, res) => {
      res.status(503).type('text').send('Web-App ist nicht gebaut: npm run build');
    });
  }

  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.too.large') {
      if (!res.headersSent) res.status(413).json({ error: 'Bild ist grösser als 2 MB.' });
      return;
    }
    log('error', 'HTTP-Fehler', { error: err.message });
    if (!res.headersSent) res.status(err.status && err.status < 500 ? err.status : 500).json({ error: 'Anfrage ungültig' });
  });

  const server = https.createServer({ key: deps.tls.key, cert: deps.tls.cert, minVersion: 'TLSv1.2' }, app);

  // ---------- WebSocket ----------
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'https://x');
    if (url.pathname !== WS_PATH) return reject(socket, 404, 'Not Found');
    if (url.search) return reject(socket, 400, 'Bad Request'); // nichts in der URL, insbesondere kein Token
    if (!originOk(req.headers.origin)) {
      log('warn', 'WebSocket mit fremdem Origin abgelehnt', { origin: req.headers.origin ?? null });
      return reject(socket, 403, 'Forbidden');
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
  });

  function onConnection(ws: WebSocket): void {
    const session: Session = { deviceId: null, inflight: 0, alive: true };
    sockets.set(ws, session);
    const authTimer = setTimeout(() => ws.close(CLOSE.authTimeout, 'auth timeout'), AUTH_TIMEOUT_MS);
    ws.on('pong', () => (session.alive = true));
    ws.on('close', () => {
      clearTimeout(authTimer);
      sockets.delete(ws);
    });
    ws.on('error', () => undefined);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(CLOSE.invalidMessage, 'binary');
      let parsed: z.infer<typeof clientMessageSchema>;
      try {
        const res = clientMessageSchema.safeParse(JSON.parse(String(data)));
        if (!res.success) throw new Error('schema');
        parsed = res.data;
      } catch {
        if (!session.deviceId) return ws.close(CLOSE.unauthorized, 'auth required');
        return; // ungültige Nachricht nach Auth ignorieren; ohne requestId keine Antwort möglich
      }
      if (!session.deviceId) {
        if (parsed.type !== 'auth') return ws.close(CLOSE.unauthorized, 'auth required');
        if (parsed.protocol !== PROTOCOL_VERSION) return ws.close(CLOSE.protocolMismatch, 'protocol');
        const device = deps.devices.verify(parsed.token);
        if (!device) {
          log('warn', 'WebSocket mit ungültigem Token abgelehnt');
          return ws.close(CLOSE.unauthorized, 'invalid token');
        }
        clearTimeout(authTimer);
        session.deviceId = device.id;
        deps.devices.touch(device.id);
        send(ws, { type: 'ready', deviceId: device.id, deviceName: device.name, protocol: PROTOCOL_VERSION, helperVersion: deps.version, platform: PLATFORM });
        send(ws, { type: 'config', config: deps.config.get() });
        send(ws, { type: 'timer', timer: deps.timers.get(), serverNow: Date.now() });
        send(ws, { type: 'permissions', permissions: deps.permissions.get() });
        void sendApps(ws);
        if (deps.lightroom) {
          send(ws, { type: 'lightroom', state: deps.lightroom.get() });
          send(ws, { type: 'lrPresets', folders: deps.lightroom.getPresets() });
        }
        return;
      }
      switch (parsed.type) {
        case 'ping':
          send(ws, { type: 'pong', t: parsed.t });
          return;
        case 'run':
          void handleRun(ws, session, parsed.requestId, parsed.actionId);
          return;
        case 'saveConfig':
          void handleSave(ws, session, parsed.requestId, parsed.baseRevision, parsed.config);
          return;
        case 'lr':
          void handleLightroom(ws, parsed.requestId, parsed.command as LrCommand);
          return;
        case 'auth':
          return; // bereits angemeldet
      }
    });
  }

  async function handleRun(ws: WebSocket, session: Session, requestId: string, actionId: string): Promise<void> {
    const system = isSystemAction(actionId) ? actionId : null;
    const action = system ? null : resolveAction(deps.config.get(), actionId);
    if (!system && !action) {
      send(ws, { type: 'result', requestId, ok: false, code: 'unknown_action', message: 'Unbekannte Aktion. Die Konfiguration wurde evtl. geändert.' });
      return;
    }
    if (session.inflight >= MAX_INFLIGHT) {
      send(ws, { type: 'result', requestId, ok: false, code: 'busy', message: 'Zu viele gleichzeitige Aktionen.' });
      return;
    }
    session.inflight += 1;
    const timeoutMs = deps.actionTimeoutMs ?? 15_000;
    let timer: NodeJS.Timeout | undefined;
    try {
      const result: RunResult = await Promise.race([
        system ? deps.runner.runSystem(system) : deps.runner.run(action!),
        new Promise<RunResult>((resolve) => {
          timer = setTimeout(() => resolve({ ok: false, code: 'timeout', message: 'Der Mac hat nicht rechtzeitig geantwortet.' }), timeoutMs);
        }),
      ]);
      log(result.ok ? 'info' : 'warn', 'Aktion', { deviceId: session.deviceId, actionId, type: system ?? action!.type, ok: result.ok, code: result.ok ? undefined : result.code });
      send(ws, result.ok
        ? { type: 'result', requestId, ok: true, ...(result.message ? { message: result.message } : {}), ...(result.details?.length ? { details: result.details } : {}) }
        : { type: 'result', requestId, ok: false, code: result.code, message: result.message, ...(result.permission ? { permission: result.permission } : {}) });
    } catch (e) {
      log('error', 'Aktion abgestürzt', { actionId, error: (e as Error).message });
      send(ws, { type: 'result', requestId, ok: false, code: 'exec_failed', message: 'Interner Fehler beim Ausführen.' });
    } finally {
      clearTimeout(timer);
      session.inflight -= 1;
    }
  }

  async function handleLightroom(ws: WebSocket, requestId: string, command: LrCommand): Promise<void> {
    if (command.cmd === 'export') {
      const r = deps.lightroomExport ? await deps.lightroomExport() : { ok: false as const, message: 'Export ist nicht verfügbar.' };
      send(ws, { type: 'lrResult', requestId, ok: r.ok, ...(r.message ? { message: r.message } : {}) });
      return;
    }
    if (!deps.lightroom) {
      send(ws, { type: 'lrResult', requestId, ok: false, message: 'Lightroom-Steuerung ist nicht aktiv.' });
      return;
    }
    const r = await deps.lightroom.run(command);
    // Reglerbewegungen nicht einzeln protokollieren (bis zu 20 pro Sekunde).
    if (!r.ok || command.cmd !== 'set') log(r.ok ? 'info' : 'warn', 'Lightroom', { cmd: command.cmd, ok: r.ok, message: r.message });
    send(ws, { type: 'lrResult', requestId, ok: r.ok, ...(r.message ? { message: r.message } : {}) });
  }

  /** Konfigurationsänderung: Revision + Schema + Bilder prüfen, atomar speichern, an alle senden. */
  async function handleSave(ws: WebSocket, session: Session, requestId: string, baseRevision: number, next: unknown): Promise<void> {
    const parsed = deckConfigSchema.safeParse({ ...(next as object), revision: deps.config.get().revision });
    if (parsed.success) {
      const missing = await deps.media.missing(parsed.data as DeckConfig);
      if (missing.length) {
        send(ws, { type: 'saveResult', requestId, ok: false, reason: 'invalid', message: 'Ein Bild fehlt auf dem Mac. Bitte erneut hochladen.', issues: missing });
        return;
      }
    }
    const r = await deps.config.update(next, baseRevision);
    if (r.ok) {
      log('info', 'Konfiguration geändert', { deviceId: session.deviceId, revision: r.config.revision });
      send(ws, { type: 'saveResult', requestId, ok: true, revision: r.config.revision });
      void deps.media.gc(r.config).catch(() => undefined);
      return;
    }
    if (r.reason === 'stale') {
      log('warn', 'Veraltete Änderung abgelehnt', { deviceId: session.deviceId, baseRevision, current: r.current.revision });
      send(ws, { type: 'saveResult', requestId, ok: false, reason: 'stale', message: 'Ein anderes Gerät hat inzwischen etwas geändert. Der aktuelle Stand wurde geladen.' });
      send(ws, { type: 'config', config: r.current });
      return;
    }
    log('warn', 'Ungültige Konfiguration abgelehnt', { deviceId: session.deviceId, issues: r.issues.slice(0, 5) });
    send(ws, { type: 'saveResult', requestId, ok: false, reason: 'invalid', message: 'Die Änderung ist ungültig und wurde nicht gespeichert.', issues: r.issues.slice(0, 10) });
  }

  async function sendApps(ws: WebSocket): Promise<void> {
    const apps = await installedReferencedApps(deps.config.get());
    send(ws, { type: 'apps', apps });
  }

  async function installedReferencedApps(cfg: DeckConfig): Promise<InstalledApp[]> {
    const ids = new Set<string>();
    for (const g of cfg.groups) {
      for (const t of g.tiles) {
        if (!t) continue;
        if (t.action.type === 'openApp') ids.add(t.action.bundleId);
        if (t.kind === 'action' && t.icon.type === 'appIcon') ids.add(t.icon.bundleId);
      }
    }
    for (const d of cfg.dock) ids.add(d.bundleId);
    const out: InstalledApp[] = [];
    for (const id of ids) {
      const a = await deps.catalog.get(id);
      if (a) out.push(a);
    }
    return out;
  }

  async function revokeDevice(id: string): Promise<boolean> {
    const ok = await deps.devices.revoke(id);
    if (ok) {
      log('info', 'Gerät widerrufen', { deviceId: id });
      for (const [ws, s] of sockets) if (s.deviceId === id) ws.close(CLOSE.revoked, 'revoked');
    }
    return ok;
  }

  // Live-Sync: Konfigurationsänderungen an alle angemeldeten Geräte
  const unsubscribe = deps.config.onChange((config) => {
    for (const [ws, s] of sockets) {
      if (!s.deviceId) continue;
      send(ws, { type: 'config', config });
      void sendApps(ws);
    }
  });

  const broadcast = (msg: ServerMessage): void => {
    for (const [ws, s] of sockets) if (s.deviceId) send(ws, msg);
  };
  const unsubTimer = deps.timers.onChange((timer) => broadcast({ type: 'timer', timer, serverNow: Date.now() }));
  const unsubPerm = deps.permissions.onChange((permissions) => broadcast({ type: 'permissions', permissions }));
  const unsubLr = deps.lightroom?.onState((state) => broadcast({ type: 'lightroom', state }));
  const unsubLrPresets = deps.lightroom?.onPresets((folders) => broadcast({ type: 'lrPresets', folders }));

  // Tote Verbindungen erkennen (iOS trennt im Hintergrund oft ohne Close-Frame)
  const heartbeat = setInterval(() => {
    for (const [ws, s] of sockets) {
      if (!s.alive) {
        ws.terminate();
        continue;
      }
      s.alive = false;
      ws.ping();
    }
    void deps.devices.flushSeen().catch(() => undefined);
  }, HEARTBEAT_MS);

  return {
    server,
    revokeDevice,
    connectedDevices: () => new Set([...sockets.values()].map((s) => s.deviceId).filter(Boolean)),
    async close(): Promise<void> {
      clearInterval(heartbeat);
      unsubscribe();
      unsubTimer();
      unsubPerm();
      unsubLr?.();
      unsubLrPresets?.();
      for (const ws of sockets.keys()) ws.terminate();
      wss.close();
      const closed = new Promise<void>((r) => server.close(() => r()));
      server.closeAllConnections();
      await closed;
    },
  };
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
