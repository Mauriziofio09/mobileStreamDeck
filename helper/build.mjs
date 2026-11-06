// Bündelt den Helper in eine einzige Datei (inkl. shared/ und Abhängigkeiten).
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/copper-deck.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: 'linked',
  legalComments: 'none',
  define: { __HELPER_VERSION__: JSON.stringify(pkg.version) },
  // CommonJS-Abhängigkeiten (express, ws) brauchen require im ESM-Bundle.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  // Optionale native Beschleuniger von ws nicht einbinden.
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'info',
});
