// Tailscale: Status lesen, Zertifikat holen/erneuern (tailscale-CLI als Attrappe), SNI im HTTPS-Server.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSecureContext } from 'node:tls';
import { describe, test } from 'node:test';
import express from 'express';
import type { Exec } from '../src/exec';
import { ExecError } from '../src/exec';
import { explain, parseStatus, splitPem, TailscaleCerts } from '../src/tailscale';

process.env['COPPER_DECK_QUIET'] = '1';

const MKCERT = ['/opt/homebrew/bin/mkcert', '/usr/local/bin/mkcert'].find((p) => { try { statSync(p); return true; } catch { return false; } })!;
const dir = mkdtempSync(path.join(tmpdir(), 'cd-ts-'));
const NAME = 'copperdeck-mac.tailtest.ts.net';
execFileSync(MKCERT, ['-cert-file', `${dir}/ts.crt`, '-key-file', `${dir}/ts.key`, NAME], { stdio: 'ignore' });
execFileSync(MKCERT, ['-cert-file', `${dir}/local.crt`, '-key-file', `${dir}/local.key`, 'localhost', '127.0.0.1'], { stdio: 'ignore' });
const TS_CERT = readFileSync(`${dir}/ts.crt`, 'utf8');
const TS_KEY = readFileSync(`${dir}/ts.key`, 'utf8');

const STATUS = JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'CopperDeck-Mac.tailtest.ts.net.' }, CertDomains: [NAME] });

describe('Tailscale-Status', () => {
  test('liest Name, Zustand und ob ein Zertifikat erlaubt ist', () => {
    assert.deepEqual(parseStatus(STATUS), { installed: true, running: true, dnsName: NAME, certAllowed: true });
    assert.equal(parseStatus(JSON.stringify({ BackendState: 'Stopped', Self: { DNSName: NAME + '.' } })).running, false);
    assert.equal(parseStatus(JSON.stringify({ BackendState: 'Running', Self: { DNSName: NAME + '.' }, CertDomains: null })).certAllowed, false);
    assert.equal(parseStatus(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'evil/../x.ts.net.' } })).dnsName, null, 'nur gültige ts.net-Namen');
  });

  test('trennt Schlüssel und Kette aus der stdout-Ausgabe', () => {
    const out = splitPem(TS_CERT + TS_KEY + TS_CERT);
    assert.ok(out);
    assert.match(out.key, /PRIVATE KEY/);
    assert.equal((out.cert.match(/BEGIN CERTIFICATE/g) ?? []).length, 2);
    assert.equal(splitPem('nichts'), null);
  });

  test('erklärt typische Fehler verständlich', () => {
    assert.match(explain('500 Internal Server Error: acme.GetReg: … x509: certificate signed by unknown authority'), /Firmen-WLAN/);
    assert.match(explain('your Tailscale account does not support getting TLS certs'), /HTTPS Certificates aktivieren/);
  });
});

describe('Tailscale-Zertifikat', () => {
  test('holt es einmal, speichert es und holt es erst kurz vor Ablauf neu', async () => {
    const calls: (readonly string[])[] = [];
    const exec: Exec = async (_bin, args) => { calls.push(args); return { stdout: TS_CERT + TS_KEY, stderr: '' }; };
    const certs = new TailscaleCerts(exec, path.join(dir, 'store'));
    assert.equal(await certs.ensure('/ts', NAME), true);
    assert.deepEqual(calls[0], ['cert', '--cert-file', '-', '--key-file', '-', NAME]);
    assert.equal(certs.get()?.name, NAME);
    assert.equal(statSync(path.join(dir, 'store', `${NAME}.key`)).mode & 0o777, 0o600);
    // mkcert-Zertifikate gelten über 2 Jahre: kein erneutes Holen
    assert.equal(await certs.ensure('/ts', NAME), false);
    // Neuer Prozess: lädt das gespeicherte Zertifikat statt neu zu holen
    const again = new TailscaleCerts(exec, path.join(dir, 'store'));
    assert.equal(await again.ensure('/ts', NAME), false);
    assert.equal(calls.length, 1);
  });

  test('Fehlschlag (Firmen-WLAN): Grund merken, nichts kaputt machen', async () => {
    const exec: Exec = async () => { throw new ExecError('fail', 1, 'acme.GetReg: x509: certificate signed by unknown authority', false); };
    const certs = new TailscaleCerts(exec, path.join(dir, 'store-fail'));
    assert.equal(await certs.ensure('/ts', NAME), false);
    assert.equal(certs.get(), null);
    assert.match(certs.lastError ?? '', /Firmen-WLAN/);
    // Kein erneuter Versuch in den nächsten 10 Minuten
    let again = false;
    (certs as unknown as { exec: Exec }).exec = async () => { again = true; return { stdout: TS_CERT + TS_KEY, stderr: '' }; };
    assert.equal(await certs.ensure('/ts', NAME), false);
    assert.equal(again, false);
  });

  test('ungültige Namen werden gar nicht erst angefragt', async () => {
    let called = false;
    const certs = new TailscaleCerts(async () => { called = true; return { stdout: '', stderr: '' }; }, dir);
    assert.equal(await certs.ensure('/ts', '../../etc/passwd'), false);
    assert.equal(called, false);
  });
});

describe('HTTPS mit zwei Zertifikaten (SNI)', () => {
  test('ts.net-Name bekommt das Tailscale-Zertifikat, alles andere das lokale', async () => {
    const tsCtx = createSecureContext({ key: TS_KEY, cert: TS_CERT });
    const server = https.createServer({
      key: readFileSync(`${dir}/local.key`), cert: readFileSync(`${dir}/local.crt`),
      SNICallback: (name, cb) => cb(null, name === NAME ? tsCtx : undefined),
    }, express().get('/', (_q, r) => { r.send('ok'); }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const ca = readFileSync(path.join(execFileSync(MKCERT, ['-CAROOT']).toString().trim(), 'rootCA.pem'));
    const subjectFor = (servername: string) => new Promise<string>((resolve, reject) => {
      const req = https.get({ host: '127.0.0.1', port, servername, ca, checkServerIdentity: () => undefined }, (res) => {
        const cert = (res.socket as import('node:tls').TLSSocket).getPeerCertificate();
        res.resume();
        resolve(String(cert.subjectaltname));
      });
      req.on('error', reject);
    });
    assert.match(await subjectFor(NAME), new RegExp(NAME.replace(/\./g, '\\.')));
    assert.match(await subjectFor('localhost'), /localhost/);
    await new Promise((r) => server.close(r));
  });
});
