import { X509Certificate } from 'node:crypto';
import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Exec } from './exec';
import { writeFileAtomic } from './fsutil';
import { log } from './log';
import { IS_WINDOWS } from './platform';

/**
 * Tailscale: Geräte erreichen den Helper überall (Firmen-WLAN, Mobilfunk) über das eigene Tailscale-Netz,
 * meist direkt Gerät zu Gerät. Dazu ein echtes Zertifikat (Let's Encrypt über `tailscale cert`) für den
 * Namen <rechner>.<tailnet>.ts.net – dann braucht das iPhone kein mkcert-Profil.
 * Tailscale ist optional: Fehlt es oder ist es aus, läuft alles wie bisher im lokalen Netz.
 */

const CANDIDATES = IS_WINDOWS
  ? [path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe')]
  : ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale'];

/**
 * Die macOS-App von Tailscale ist zugleich die CLI. Ohne Terminal (launchd) versucht sie sonst, ihr Fenster zu
 * starten ("The Tailscale GUI failed to start"); TAILSCALE_BE_CLI=1 erzwingt den CLI-Modus.
 */
const CLI_ENV = { TAILSCALE_BE_CLI: '1' } as const;

/** Neu holen, wenn das Zertifikat weniger als 30 Tage gilt (Let's Encrypt: 90 Tage). */
const RENEW_BEFORE_MS = 30 * 24 * 3600_000;

export interface TailscaleStatus {
  readonly installed: boolean;
  readonly running: boolean;
  /** z. B. copperdeck-mac.tailf11a59.ts.net (ohne Punkt am Ende) */
  readonly dnsName: string | null;
  /** Darf dieser Rechner ein Zertifikat holen (HTTPS im Tailnet aktiviert)? */
  readonly certAllowed: boolean;
}

export interface TailscaleCert {
  readonly name: string;
  readonly key: Buffer;
  readonly cert: Buffer;
  readonly validTo: Date;
}

export async function findTailscale(): Promise<string | null> {
  for (const c of CANDIDATES) if (await access(c).then(() => true, () => false)) return c;
  return null;
}

/** Ein ts.net-Name, wie ihn Tailscale vergibt (wird als Dateiname und Zertifikatsname verwendet). */
export const TS_NAME = /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63}){1,4}\.ts\.net$/;

export async function tailscaleStatus(exec: Exec, bin: string | null): Promise<TailscaleStatus> {
  if (!bin) return { installed: false, running: false, dnsName: null, certAllowed: false };
  try {
    const { stdout } = await exec(bin, ['status', '--json'], { timeoutMs: 8000, env: CLI_ENV });
    if (!stdout.trimStart().startsWith('{')) throw Object.assign(new Error('keine JSON-Ausgabe'), { stderr: stdout.slice(0, 400) });
    const st = parseStatus(stdout);
    if (!st.running) log('info', 'Tailscale nicht aktiv', { state: (JSON.parse(stdout) as { BackendState?: string }).BackendState ?? null });
    return st;
  } catch (e) {
    const err = e as Error & { stderr?: string };
    log('warn', 'tailscale status fehlgeschlagen', { error: (err.stderr || err.message).trim().slice(0, 300) });
    return { installed: true, running: false, dnsName: null, certAllowed: false };
  }
}

export function parseStatus(json: string): TailscaleStatus {
  const d = JSON.parse(json) as { BackendState?: string; Self?: { DNSName?: string }; CertDomains?: string[] | null };
  const dnsName = (d.Self?.DNSName ?? '').replace(/\.$/, '').toLowerCase() || null;
  const ok = !!dnsName && TS_NAME.test(dnsName);
  return {
    installed: true,
    running: d.BackendState === 'Running',
    dnsName: ok ? dnsName : null,
    certAllowed: ok && (d.CertDomains ?? []).map((x) => x.toLowerCase()).includes(dnsName),
  };
}

/** Trennt die Ausgabe von `tailscale cert --cert-file - --key-file -` in Schlüssel und Zertifikatskette. */
export function splitPem(pem: string): { key: string; cert: string } | null {
  const blocks = [...pem.matchAll(/-----BEGIN ([A-Z ]+)-----[\s\S]+?-----END \1-----/g)];
  const key = blocks.filter((b) => b[1]!.includes('PRIVATE KEY')).map((b) => b[0]);
  const certs = blocks.filter((b) => b[1] === 'CERTIFICATE').map((b) => b[0]);
  if (key.length !== 1 || certs.length === 0) return null;
  return { key: key[0]! + '\n', cert: certs.join('\n') + '\n' };
}

export class TailscaleCerts {
  private current: TailscaleCert | null = null;
  lastError: string | null = null;

  constructor(private readonly exec: Exec, private readonly dir: string) {}

  get(): TailscaleCert | null {
    return this.current;
  }

  private files(name: string) {
    return { cert: path.join(this.dir, `${name}.crt`), key: path.join(this.dir, `${name}.key`) };
  }

  /** Gespeichertes Zertifikat laden (gilt es noch?). */
  async load(name: string): Promise<TailscaleCert | null> {
    const f = this.files(name);
    try {
      const [cert, key] = await Promise.all([readFile(f.cert), readFile(f.key)]);
      const validTo = new Date(new X509Certificate(cert).validTo);
      if (validTo.getTime() <= Date.now()) return null;
      this.current = { name, cert, key, validTo };
      return this.current;
    } catch {
      return null;
    }
  }

  /**
   * Holt bzw. erneuert das Zertifikat über `tailscale cert` (Ausgabe auf stdout: funktioniert auch mit der
   * App-Store-Version von Tailscale, die nicht in beliebige Ordner schreiben darf).
   * Rückgabe: true, wenn ein neues Zertifikat geholt wurde.
   */
  async ensure(bin: string, name: string): Promise<boolean> {
    if (!TS_NAME.test(name)) return false;
    const have = this.current?.name === name ? this.current : await this.load(name);
    if (have && have.validTo.getTime() - Date.now() > RENEW_BEFORE_MS) return false;
    try {
      const { stdout } = await this.exec(bin, ['cert', '--cert-file', '-', '--key-file', '-', name], { timeoutMs: 90_000, env: CLI_ENV });
      const parts = splitPem(stdout);
      if (!parts) throw new Error('Unerwartete Ausgabe von tailscale cert');
      const validTo = new Date(new X509Certificate(parts.cert).validTo);
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const f = this.files(name);
      await writeFileAtomic(f.key, parts.key, { mode: 0o600 });
      await writeFileAtomic(f.cert, parts.cert, { mode: 0o644 });
      this.current = { name, cert: Buffer.from(parts.cert), key: Buffer.from(parts.key), validTo };
      this.lastError = null;
      log('info', 'Tailscale-Zertifikat geholt', { name, validTo: validTo.toISOString() });
      return true;
    } catch (e) {
      const err = e as Error & { stderr?: string };
      this.lastError = explain(err.stderr || err.message);
      log('warn', 'Tailscale-Zertifikat nicht erhalten', { name, error: this.lastError });
      return false;
    }
  }
}

/** Verständlicher Grund für die häufigsten Fehler. */
export function explain(raw: string): string {
  const s = raw.trim().split('\n').pop() ?? raw;
  if (/unknown authority|x509/i.test(s)) {
    return 'Das Netzwerk prüft verschlüsselte Verbindungen mit (z. B. Firmen-WLAN). Let\'s Encrypt ist so nicht erreichbar – in einem anderen Netz klappt es.';
  }
  if (/not enabled|HTTPS.*disabled|does not support getting TLS certs/i.test(s)) {
    return 'HTTPS ist im Tailscale-Netz nicht aktiviert: login.tailscale.com → DNS → HTTPS Certificates aktivieren.';
  }
  if (/timeout|deadline|i\/o timeout/i.test(s)) return 'Zeitüberschreitung beim Holen des Zertifikats.';
  return s.slice(0, 200);
}
