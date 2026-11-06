#!/usr/bin/env node
// Meilenstein 1: extrahiert App-Icons lokal vom Mac nach web/public/app-icons/ (von Git ignoriert)
// und schreibt index.json mit installierten Apps und Dock-Vorschlägen.
// Alle Prozesse via execFile mit Argument-Arrays, keine Shell-Strings.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, realpath, writeFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'web/public/app-icons');
const cacheDir = path.join(root, 'node_modules/.cache/copper-deck');
const SIZE = 256;

const SEARCH_DIRS = [
  '/Applications',
  path.join(homedir(), 'Applications'),
  '/System/Applications',
  '/System/Library/CoreServices',
];
const BUNDLE_ID_RE = /^[A-Za-z0-9.-]{1,200}$/;

// Apps, die die Beispielkonfiguration braucht (Startbelegung).
const WANTED = [
  'com.apple.finder', 'com.apple.iBooksX', 'com.apple.MobileSMS', 'com.apple.iCal',
  'com.apple.Music', 'com.apple.Safari', 'com.apple.Notes', 'com.apple.mail',
  'notion.id', 'com.figma.Desktop',
];
// Ergänzung fürs Dock, falls installiert (nach Dock- und "Zuletzt verwendet"-Einträgen).
const DOCK_FILL = [
  'com.google.Chrome', 'com.microsoft.VSCode', 'com.hnc.Discord', 'net.whatsapp.WhatsApp',
  'com.apple.dt.Xcode', 'com.apple.Terminal', 'com.apple.systempreferences',
];
const DOCK_MAX = 12;

const exists = (p) => access(p).then(() => true, () => false);

async function plistValue(plist, key) {
  try {
    const { stdout } = await run('plutil', ['-extract', key, 'raw', '-o', '-', plist]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function listApps(dir, depth = 0) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const apps = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.name.endsWith('.app')) apps.push(p);
    else if (e.isDirectory() && depth < 1 && !e.name.startsWith('.')) apps.push(...(await listApps(p, depth + 1)));
  }
  return apps;
}

async function describe(linkPath) {
  // Symlinks (z. B. Safari -> Cryptex) auflösen, sonst zeichnet NSWorkspace ein Alias-Badge.
  const appPath = await realpath(linkPath).catch(() => linkPath);
  const plist = path.join(appPath, 'Contents/Info.plist');
  const bundleId = await plistValue(plist, 'CFBundleIdentifier');
  if (!bundleId || !BUNDLE_ID_RE.test(bundleId)) return null;
  let name = path.basename(appPath, '.app');
  try {
    const { stdout } = await run('mdls', ['-name', 'kMDItemDisplayName', '-raw', appPath]);
    if (stdout && stdout !== '(null)') name = stdout.replace(/\.app$/, '');
  } catch { /* Spotlight evtl. aus: Ordnername genügt */ }
  return { bundleId, name, appPath, plist };
}

async function nativeTool() {
  const bin = path.join(cacheDir, 'app-icon');
  if (!(await exists(bin))) {
    await mkdir(cacheDir, { recursive: true });
    await run('swiftc', ['-O', path.join(root, 'tools/native/app-icon.swift'), '-o', bin]);
  }
  return bin;
}

async function extractIcon(app, file) {
  const res = path.join(app.appPath, 'Contents/Resources');
  const iconName = await plistValue(app.plist, 'CFBundleIconName');
  const hasCar = await exists(path.join(res, 'Assets.car'));
  let iconFile = await plistValue(app.plist, 'CFBundleIconFile');
  if (iconFile && !iconFile.endsWith('.icns')) iconFile += '.icns';
  const icns = iconFile ? path.join(res, iconFile) : null;

  // Liegt das aktuelle Icon in Assets.car, ist die .icns oft nur ein veralteter Fallback
  // (z. B. Electron-Apps wie Notion). Dann NSWorkspace, sonst sips aus der .icns.
  if (icns && (await exists(icns)) && !(iconName && hasCar)) {
    await run('sips', ['-s', 'format', 'png', '-Z', String(SIZE), icns, '--out', file]);
    return 'sips';
  }
  await run(await nativeTool(), [app.appPath, file, String(SIZE)]);
  return 'nsworkspace';
}

async function dockBundleIds() {
  const ids = [];
  for (const key of ['persistent-apps', 'recent-apps']) {
    try {
      const { stdout } = await run('defaults', ['read', 'com.apple.dock', key]);
      for (const m of stdout.matchAll(/"bundle-identifier" = "([^"]+)"/g)) ids.push(m[1]);
    } catch { /* Schlüssel fehlt */ }
  }
  return ids;
}

const appPaths = (await Promise.all(SEARCH_DIRS.map((d) => listApps(d)))).flat();
const apps = new Map();
for (const p of appPaths) {
  const d = await describe(p);
  if (d && !apps.has(d.bundleId)) apps.set(d.bundleId, d);
}

const dock = [];
for (const id of [...(await dockBundleIds()), ...DOCK_FILL]) {
  if (apps.has(id) && !dock.includes(id) && dock.length < DOCK_MAX) dock.push(id);
}

await mkdir(outDir, { recursive: true });
const wanted = new Set([...WANTED, ...dock]);
const index = { generatedAt: new Date().toISOString(), apps: {}, dock };
for (const id of wanted) {
  const app = apps.get(id);
  if (!app) { console.log(`– ${id}: nicht installiert`); continue; }
  const file = `${id}.png`;
  try {
    const how = await extractIcon(app, path.join(outDir, file));
    index.apps[id] = { name: app.name, icon: `app-icons/${file}` };
    console.log(`✓ ${id} (${app.name}) via ${how}`);
  } catch (err) {
    index.apps[id] = { name: app.name, icon: null };
    console.log(`✗ ${id}: ${err.message.split('\n')[0]}`);
  }
}
await writeFile(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2));
console.log(`\n${Object.keys(index.apps).length} Apps, Dock: ${dock.join(', ')}`);
