// Baut die beiden Startseiten (Mac und Windows) aus einer Vorlage: node site/build.mjs
// Ergebnis: site/dist/mac/ und site/dist/windows/ – rein statisch, ohne Inline-Skript (strikte CSP).
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'site/src');
const out = path.join(root, 'site/dist');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

export const SITES = {
  mac: {
    host: 'macmobilestreamdeck.battle-isle.app',
    vars: { SYSTEM: 'Mac', HOST: 'Mac', OTHER_SYSTEM: 'Windows', EXAMPLE_URL: 'https://dein-mac.local:7443' },
    keep: 'mac', drop: 'win',
  },
  windows: {
    host: 'windowsmobilestreamdeck.battle-isle.app',
    vars: { SYSTEM: 'Windows', HOST: 'PC', OTHER_SYSTEM: 'Mac', EXAMPLE_URL: 'https://dein-pc.local:7443' },
    keep: 'win', drop: 'mac',
  },
};

const template = await readFile(path.join(src, 'page.html'), 'utf8');
await rm(out, { recursive: true, force: true });

for (const [name, site] of Object.entries(SITES)) {
  const other = Object.values(SITES).find((s) => s !== site);
  const vars = { ...site.vars, VERSION: version, OTHER_URL: `https://${other.host}/` };
  let html = template
    // Blöcke des anderen Systems entfernen, eigene Markierungen löschen
    .replace(new RegExp(`<!--${site.drop}-->[\\s\\S]*?<!--/${site.drop}-->\\n?`, 'g'), '')
    .replace(new RegExp(`<!--/?${site.keep}-->\\n?`, 'g'), '');
  html = html.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in vars)) throw new Error(`Platzhalter ohne Wert: ${m}`);
    return vars[k];
  });
  if (/<!--\/?(mac|win)-->|\{\{/.test(html)) throw new Error(`Unaufgelöste Marken in ${name}`);

  const dir = path.join(out, name);
  await mkdir(path.join(dir, 'fonts'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), html);
  await cp(path.join(src, 'styles.css'), path.join(dir, 'styles.css'));
  await cp(path.join(src, 'app.js'), path.join(dir, 'app.js'));
  await cp(path.join(src, 'img'), path.join(dir, 'img'), { recursive: true });
  for (const f of ['barlow-condensed-latin-600-normal.woff2', 'barlow-condensed-latin-700-normal.woff2', 'OFL-BarlowCondensed.txt']) {
    await cp(path.join(root, 'web/public/fonts', f), path.join(dir, 'fonts', f));
  }
  for (const f of ['icon-192.png', 'favicon-64.png']) await cp(path.join(root, 'web/public/icons', f), path.join(dir, f));
  await writeFile(path.join(dir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  console.log(`${name}: ${dir} (${site.host})`);
}
