#!/usr/bin/env node
// Schreibt web/src/version.ts (Version + Build-Zeit) vor jedem Web-Build.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const built = new Date().toISOString();
writeFileSync(path.join(root, 'web/src/version.ts'),
  `// Automatisch erzeugt (tools/write-version.mjs) – nicht von Hand ändern.\nexport const APP_VERSION = '${version}';\nexport const BUILD_TIME = '${built}';\n`);
console.log(`version.ts: ${version} (${built})`);
