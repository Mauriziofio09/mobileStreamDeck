#!/usr/bin/env node
// Baut "Copper Deck Helper.app" (ad-hoc signiert) nach helper/dist/.
// Das Bundle enthält bewusst NUR das Programm + Info.plist: Jede Änderung am Bundle-Inhalt
// ändert den Code-Hash und damit die Identität, an der die macOS-Berechtigungen hängen.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUNDLE_ID = 'ch.copperdeck.helper';
export const APP_NAME = 'Copper Deck Helper';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'CopperDeckHelper.swift');
const out = path.resolve(here, '../dist', `${APP_NAME}.app`);
const version = JSON.parse(readFileSync(path.join(here, '../package.json'), 'utf8')).version;
const sourceHash = createHash('sha256').update(readFileSync(src)).digest('hex').slice(0, 16);

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'Contents/MacOS'), { recursive: true });
execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-target', 'arm64-apple-macos14', src, '-o', path.join(out, 'Contents/MacOS/CopperDeckHelper')], { stdio: 'inherit' });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleName</key><string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key><string>${APP_NAME}</string>
  <key>CFBundleExecutable</key><string>CopperDeckHelper</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${sourceHash}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>Copper Deck sendet Tastenkombinationen über System Events, wenn du auf iPhone oder iPad eine Kachel antippst.</string>
  <key>CopperDeckSourceHash</key><string>${sourceHash}</string>
</dict>
</plist>
`;
writeFileSync(path.join(out, 'Contents/Info.plist'), plist);
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', BUNDLE_ID, out], { stdio: 'inherit' });
console.log(`✓ ${out} (Quelle ${sourceHash})`);
