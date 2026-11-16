import { chmod, rm } from 'node:fs/promises';
import net from 'node:net';
import { log } from './log';
import { IS_WINDOWS } from './platform';

/**
 * Lokaler Admin-Kanal für die CLI (copper-deck pair/devices/revoke) über einen Unix-Socket
 * im Datenordner (Rechte 600). Der Helper läuft später ohne Terminal; die CLI holt sich so den Code.
 */
export type AdminRequest =
  | { cmd: 'pair' }
  | { cmd: 'devices' }
  | { cmd: 'revoke'; id: string }
  | { cmd: 'status' }
  | { cmd: 'reloadTls' }
  | { cmd: 'permissions' }
  | { cmd: 'runAction'; action: unknown }
  | { cmd: 'notifyTest' };

export type AdminHandler = (req: AdminRequest) => Promise<unknown>;

export async function startAdminServer(socketPath: string, handler: AdminHandler): Promise<net.Server> {
  // Verwaisten Socket eines abgestürzten Laufs entfernen, aber keinen laufenden Helper verdrängen.
  // Ein gerade beendeter Vorgänger (z. B. Neustart durch launchd) bekommt bis zu 6 s Zeit.
  for (let i = 0; ; i++) {
    const alive = await adminRequest(socketPath, { cmd: 'status' }, 800).then(() => true, () => false);
    if (!alive) break;
    if (i >= 12) throw new Error('Ein anderer Copper-Deck-Helper läuft bereits.');
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!IS_WINDOWS) await rm(socketPath, { force: true });
  const server = net.createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string): void => {
      buf += chunk;
      if (buf.length > 4096) {
        sock.destroy();
        return;
      }
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      let req: AdminRequest;
      try {
        req = JSON.parse(buf.slice(0, nl)) as AdminRequest;
      } catch {
        sock.end(JSON.stringify({ error: 'invalid' }) + '\n');
        return;
      }
      handler(req)
        .then((res) => sock.end(JSON.stringify({ ok: true, result: res }) + '\n'))
        .catch((e: Error) => sock.end(JSON.stringify({ ok: false, error: e.message }) + '\n'));
    });
    sock.on('error', () => undefined);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });
  if (!IS_WINDOWS) await chmod(socketPath, 0o600);
  log('info', 'Admin-Socket bereit');
  return server;
}

export function adminRequest(socketPath: string, req: AdminRequest, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath);
    let buf = '';
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('Zeitüberschreitung'));
    }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(JSON.stringify(req) + '\n'));
    sock.on('data', (c: string) => (buf += c));
    sock.on('end', () => {
      clearTimeout(timer);
      try {
        const res = JSON.parse(buf) as { ok: boolean; result?: unknown; error?: string };
        if (res.ok) resolve(res.result);
        else reject(new Error(res.error ?? 'Fehler'));
      } catch {
        reject(new Error('Ungültige Antwort'));
      }
    });
    sock.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
