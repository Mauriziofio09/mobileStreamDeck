#!/usr/bin/env node
// Nachgebildetes Lightroom-Classic-Plugin für Entwicklung und Tests (ohne Lightroom).
// Öffnet dieselben lokalen Ports wie lightroom/CopperDeck.lrplugin und verhält sich wie Lightroom:
// drei Fotos, Regler, Bewertung, Markierung, Farbmarkierung, Module, Vorgaben, Rückgängig.
//   node tools/fake-lightroom.mjs        (läuft, bis Ctrl+C)
// Als Modul: import { startFakeLightroom } from './fake-lightroom.mjs'
import net from 'node:net';
import { pathToFileURL } from 'node:url';

const PARAMS = {
  Temperature: [2000, 50000, 5500], Tint: [-150, 150, 0], Exposure2012: [-5, 5, 0], Contrast2012: [-100, 100, 0],
  Highlights2012: [-100, 100, 0], Shadows2012: [-100, 100, 0], Whites2012: [-100, 100, 0], Blacks2012: [-100, 100, 0],
  Texture: [-100, 100, 0], Clarity2012: [-100, 100, 0], Dehaze: [-100, 100, 0], Vibrance: [-100, 100, 0], Saturation: [-100, 100, 0],
  Sharpness: [0, 150, 40], PostCropVignetteAmount: [-100, 100, 0], GrainAmount: [0, 100, 0],
};
for (const c of ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta']) {
  for (const k of ['HueAdjustment', 'SaturationAdjustment', 'LuminanceAdjustment']) PARAMS[k + c] = [-100, 100, 0];
}
const STEP = { Exposure2012: 0.05, Temperature: 50 };

export async function startFakeLightroom({ ports = { toPlugin: 47801, fromPlugin: 47802 }, log = () => {} } = {}) {
  const photos = ['DSC_0041.NEF', 'DSC_0042.NEF', 'IMG_2201.jpg'].map((name) => ({
    name, rating: 0, flag: 'none', label: 'none',
    values: Object.fromEntries(Object.entries(PARAMS).map(([k, v]) => [k, k === 'Temperature' && name.endsWith('.jpg') ? 0 : v[2]])),
  }));
  const st = { index: 1, module: 'develop', beforeAfter: false, clipboard: null, undo: [], commands: [] };
  let out = null;
  const send = (o) => out?.write(JSON.stringify(o) + '\n');
  const photo = () => photos[st.index];
  const fullState = () => {
    const p = photo();
    send({
      type: 'state', module: st.module, lrVersion: 'Fake 14.1', beforeAfter: st.beforeAfter,
      photo: { name: p.name, rating: p.rating, flag: p.flag, label: p.label },
      values: st.module === 'develop' ? p.values : {},
      ranges: st.module === 'develop' ? { Temperature: p.name.endsWith('.jpg') ? [-100, 100] : [2000, 50000] } : {},
    });
  };
  const snapshot = () => st.undo.push(JSON.stringify(photos));
  const setValue = (k, v) => {
    const [lo, hi] = PARAMS[k] ?? [-100, 100];
    snapshot();
    photo().values[k] = Math.min(hi, Math.max(lo, v));
    send({ type: 'values', values: { [k]: photo().values[k] } });
  };

  const handle = (line) => {
    const [id, cmd, a, b] = line.split('\t');
    st.commands.push([cmd, a, b].filter((x) => x !== undefined));
    log(`← ${cmd} ${a ?? ''} ${b ?? ''}`);
    const ok = () => send({ type: 'result', id, ok: true });
    const err = (message) => send({ type: 'result', id, ok: false, message });
    switch (cmd) {
      case 'hello': case 'state': fullState(); return ok();
      case 'set': st.module = 'develop'; setValue(a, Number(b)); return ok();
      case 'inc': case 'dec': setValue(a, photo().values[a] + (cmd === 'inc' ? 1 : -1) * (STEP[a] ?? 1)); return ok();
      case 'reset': setValue(a, PARAMS[a]?.[2] ?? 0); return ok();
      case 'rating': snapshot(); photo().rating = Number(a); fullState(); return ok();
      case 'flag': snapshot(); photo().flag = a; fullState(); return ok();
      case 'label': snapshot(); photo().label = a; fullState(); return ok();
      case 'nav': st.index = Math.max(0, Math.min(photos.length - 1, st.index + (a === 'next' ? 1 : -1))); fullState(); return ok();
      case 'module': st.module = a; fullState(); return ok();
      case 'auto': snapshot(); photo().values.Exposure2012 = 0.65; photo().values.Contrast2012 = 14; fullState(); return ok();
      case 'resetall': snapshot(); for (const [k, v] of Object.entries(PARAMS)) photo().values[k] = v[2]; fullState(); return ok();
      case 'copy': st.clipboard = { ...photo().values }; return ok();
      case 'paste': if (!st.clipboard) return err('Nichts kopiert'); snapshot(); photo().values = { ...st.clipboard }; fullState(); return ok();
      case 'undo': if (!st.undo.length) return err('Nichts zum Rückgängigmachen'); Object.assign(photos, JSON.parse(st.undo.pop())); fullState(); return ok();
      case 'redo': return err('Nichts zum Wiederholen');
      case 'beforeafter': st.beforeAfter = !st.beforeAfter; fullState(); return ok();
      case 'tool': return ok();
      case 'presets':
        send({ type: 'presets', folders: [
          { name: 'Eigene Vorgaben', presets: [{ id: 'P-WARM-1', name: 'Warm & weich' }, { id: 'P-BW-2', name: 'Schwarzweiss Kontrast' }] },
          { name: 'Adobe: Porträts', presets: [{ id: 'P-PT-3', name: 'PT01' }] },
        ] });
        return ok();
      case 'preset': if (!a?.startsWith('P-')) return err('Vorgabe nicht gefunden'); snapshot(); photo().values.Saturation = a === 'P-BW-2' ? -100 : 10; fullState(); return ok();
      default: return err('Unbekannter Befehl');
    }
  };

  const inbound = net.createServer((s) => {
    let buf = '';
    s.setEncoding('utf8');
    s.on('data', (c) => {
      buf += c;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, nl); buf = buf.slice(nl + 1); if (l) handle(l); }
    });
    s.on('error', () => {});
  });
  const outbound = net.createServer((s) => { out?.destroy(); out = s; s.on('error', () => {}); });
  await new Promise((r, j) => inbound.once('error', j).listen(ports.toPlugin, '127.0.0.1', r));
  await new Promise((r, j) => outbound.once('error', j).listen(ports.fromPlugin, '127.0.0.1', r));
  return {
    state: st, photos,
    close: async () => { out?.destroy(); await new Promise((r) => inbound.close(r)); await new Promise((r) => outbound.close(r)); },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startFakeLightroom({ log: (l) => console.log(l) });
  console.log('Nachgebildetes Lightroom läuft auf 127.0.0.1:47801/47802 (Ctrl+C beendet).');
}
