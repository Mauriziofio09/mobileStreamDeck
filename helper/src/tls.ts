import { X509Certificate } from 'node:crypto';
import { access, chmod, mkdir, readFile } from 'node:fs/promises';
import { hostname, networkInterfaces } from 'node:os';
import path from 'node:path';
import type { Exec } from './exec';
import { log } from './log';
import type { Paths } from './paths';
import { IS_WINDOWS } from './platform';

export interface HostInfo {
  /** z. B. "MacBook-Pro-von-Maurizio" */
  readonly localHostName: string;
  /** z. B. "macbook-pro-von-maurizio.local" (kleingeschrieben, wie Browser den Origin senden) */
  readonly mdnsName: string;
  readonly lanIps: string[];
}

const MKCERT_CANDIDATES = IS_WINDOWS
  ? [
      // winget legt einen Link hier ab, Scoop und Chocolatey jeweils unter shims bzw. bin.
      path.join(process.env['LOCALAPPDATA'] ?? '', 'Microsoft', 'WinGet', 'Links', 'mkcert.exe'),
      path.join(process.env['USERPROFILE'] ?? '', 'scoop', 'shims', 'mkcert.exe'),
      path.join(process.env['ProgramData'] ?? 'C:\\ProgramData', 'chocolatey', 'bin', 'mkcert.exe'),
    ]
  : ['/opt/homebrew/bin/mkcert', '/usr/local/bin/mkcert'];
const RENEW_BEFORE_MS = 30 * 24 * 3600_000;

/** Virtuelle Adapter (Hyper-V, WSL, VirtualBox, VMware, VPN) gehören nicht ins Zertifikat. */
const VIRTUAL_ADAPTER = /vEthernet|WSL|VirtualBox|VMware|Hyper-V|Loopback|Tailscale|ZeroTier|VPN|TAP-/i;

export async function hostInfo(exec: Exec): Promise<HostInfo> {
  if (IS_WINDOWS) {
    // Windows 10/11 meldet den Computernamen per mDNS als <name>.local.
    const localHostName = hostname().split('.')[0] ?? '';
    if (!/^[A-Za-z0-9-]{1,63}$/.test(localHostName)) throw new Error(`Computername ist für .local ungeeignet: ${localHostName}`);
    const lanIps = Object.entries(networkInterfaces())
      .filter(([name]) => !VIRTUAL_ADAPTER.test(name))
      .flatMap(([, addrs]) => (addrs ?? []).filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')).map((a) => a.address));
    return { localHostName, mdnsName: `${localHostName.toLowerCase()}.local`, lanIps };
  }
  const { stdout } = await exec('/usr/sbin/scutil', ['--get', 'LocalHostName']);
  const localHostName = stdout.trim();
  if (!/^[A-Za-z0-9-]{1,63}$/.test(localHostName)) throw new Error(`Unerwarteter LocalHostName: ${localHostName}`);
  // Nur echte LAN-Schnittstellen (en*), keine VPN-Tunnel (utun*)
  const lanIps = Object.entries(networkInterfaces())
    .filter(([name]) => /^en\d+$/.test(name))
    .flatMap(([, addrs]) => (addrs ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => a.address));
  return { localHostName, mdnsName: `${localHostName.toLowerCase()}.local`, lanIps };
}

export async function findMkcert(): Promise<string> {
  for (const p of MKCERT_CANDIDATES) {
    if (await access(p).then(() => true, () => false)) return p;
  }
  if (IS_WINDOWS) {
    // Sonst im PATH suchen (z. B. von Hand abgelegt).
    for (const dir of (process.env['PATH'] ?? '').split(';')) {
      const p = path.join(dir.trim(), 'mkcert.exe');
      if (dir.trim() && (await access(p).then(() => true, () => false))) return p;
    }
    throw new Error('mkcert nicht gefunden. Installation: winget install FiloSottile.mkcert, danach mkcert -install');
  }
  throw new Error('mkcert nicht gefunden. Installation: brew install mkcert && mkcert -install');
}

export async function caRootFile(exec: Exec): Promise<string> {
  const { stdout } = await exec(await findMkcert(), ['-CAROOT']);
  return path.join(stdout.trim(), 'rootCA.pem');
}

export interface CertStatus {
  readonly exists: boolean;
  readonly validTo: Date | null;
  readonly names: string[];
  readonly reasons: string[];
}

export async function inspectCert(paths: Paths, host: HostInfo): Promise<CertStatus> {
  let pem: string;
  try {
    pem = await readFile(paths.cert, 'utf8');
  } catch {
    return { exists: false, validTo: null, names: [], reasons: ['kein Zertifikat'] };
  }
  const cert = new X509Certificate(pem);
  const names = (cert.subjectAltName ?? '').split(',').map((s) => s.trim().replace(/^(DNS|IP Address):/, '').toLowerCase());
  const validTo = new Date(cert.validTo);
  const reasons: string[] = [];
  if (!names.includes(host.mdnsName)) reasons.push(`${host.mdnsName} fehlt`);
  for (const ip of host.lanIps) if (!names.includes(ip)) reasons.push(`IP ${ip} fehlt`);
  if (validTo.getTime() - Date.now() < RENEW_BEFORE_MS) reasons.push('läuft bald ab');
  return { exists: true, validTo, names, reasons };
}

/** Erstellt das Zertifikat mit mkcert für <LocalHostName>.local, die LAN-IPs und localhost. */
export async function ensureCert(exec: Exec, paths: Paths, host: HostInfo, force = false): Promise<CertStatus> {
  const status = await inspectCert(paths, host);
  if (!force && status.exists && status.reasons.length === 0) return status;
  const mkcert = await findMkcert();
  await mkdir(paths.tlsDir, { recursive: true, mode: 0o700 });
  const names = [host.mdnsName, ...host.lanIps, 'localhost', '127.0.0.1'];
  log('info', `Erzeuge TLS-Zertifikat (${status.reasons.join(', ') || 'erzwungen'})`, { names });
  await exec(mkcert, ['-cert-file', paths.cert, '-key-file', paths.key, ...names], { timeoutMs: 30_000 });
  if (!IS_WINDOWS) {
    await chmod(paths.key, 0o600);
    await chmod(paths.cert, 0o644);
  }
  return inspectCert(paths, host);
}
